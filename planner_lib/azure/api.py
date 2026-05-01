"""Cache API endpoints.

Provides REST endpoints for cache management: inspecting, refreshing, and
metrics for the CachingBackend diskcache.
"""
from fastapi import APIRouter, Request, Query, HTTPException, Response
from typing import Optional
from datetime import datetime, timezone
import logging

from planner_lib.middleware import require_session
from planner_lib.middleware.session import get_session_id_from_request
from planner_lib.services.resolver import resolve_service, resolve_optional_service

# Namespace used by CachingBackend when storing domain objects.
_BACKEND_DOMAIN_NS = 'backend_domain'


def _area_key_prefix(area_path: str) -> str:
    """Build the cache key prefix for an area path (matches CachingBackend key format)."""
    safe = area_path.replace('\\', '__').replace('/', '__').replace(' ', '_')
    return ''.join(c for c in safe if c.isalnum() or c in ('_', '-'))



router = APIRouter(tags=["cache"])
browse_router = APIRouter(tags=["azure"])
logger = logging.getLogger(__name__)


def _get_all_configured_areas(request: Request) -> list:
    """Get all configured area paths from projects config."""
    try:
        project_repo = resolve_service(request, 'project_repository')
        projects = project_repo.get_project_map()

        areas = []
        for project in projects:
            if isinstance(project, dict) and 'area_path' in project:
                areas.append(project['area_path'])

        return areas if areas else []
    except Exception as e:
        logger.warning(f"Failed to get configured areas: {e}")
        return []


def _get_area_project_config_map(request: Request) -> dict:
    """Return a mapping of area_path -> {task_types, include_states} from project config.

    Used by the cache refresh endpoint so each area is fetched with the
    task types and state filters configured for its project rather than the
    hard-coded default ['epic', 'feature'].
    """
    try:
        project_repo = resolve_service(request, 'project_repository')
        projects = project_repo.get_project_map()

        config_map: dict = {}
        for project in projects:
            if not isinstance(project, dict):
                continue
            area_path = project.get('area_path')
            if area_path:
                config_map[area_path] = {
                    'task_types': project.get('task_types'),
                    'include_states': project.get('include_states'),
                }
        return config_map
    except Exception as e:
        logger.warning(f"Failed to build area project config map: {e}")
        return {}


@router.get("/load")
@require_session
async def cache_load(
    request: Request,
    areas: Optional[str] = Query(None, description="Comma-separated area paths"),
    include: Optional[str] = Query("workitems", description="Data types to include")
):
    """Load cached task data from diskcache for the requested areas.

    Returns cached DomainTask lists directly from diskcache.  Always succeeds
    even if data is stale — diskcache returns KeyError for expired keys, so
    absent data is reported as a cache miss rather than an error.

    Query params:
        areas: Comma-separated area paths (e.g., "Area\\\\Team1,Area\\\\Team2")
        include: Data types to include (workitems)
    """
    backend = resolve_service(request, 'backend')
    storage = getattr(backend, '_storage', None)
    if storage is None:
        raise HTTPException(
            status_code=503,
            detail={'error': 'cache_unavailable', 'message': 'Backend has no cache storage'}
        )

    area_list = areas.split(',') if areas else _get_all_configured_areas(request)
    include_types = include.split(',') if include else ['workitems']

    if not area_list:
        return {
            "data": {},
            "metadata": {
                "areas": {},
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "warning": "No areas configured or specified"
            }
        }

    data: dict = {}
    metadata: dict = {"areas": {}, "timestamp": datetime.now(timezone.utc).isoformat()}

    if 'workitems' in include_types:
        all_keys = list(storage.list_keys(_BACKEND_DOMAIN_NS))
        for area_path in area_list:
            prefix = _area_key_prefix(area_path)
            matching = [k for k in all_keys if k.startswith(f'fetch_tasks__{prefix}')]
            if matching:
                try:
                    value = storage.load(_BACKEND_DOMAIN_NS, matching[0])
                    data.setdefault('workitems', {})[area_path] = value
                    metadata['areas'][area_path] = {'cached': True}
                except KeyError:
                    metadata['areas'][area_path] = {'cached': False}
            else:
                metadata['areas'][area_path] = {'cached': False}

    logger.info("Cache load: returned %d areas", len(data.get('workitems', {})))
    return {"data": data, "metadata": metadata}


@router.get("/refresh")
@require_session
async def cache_refresh(
    request: Request,
    areas: Optional[str] = Query(None, description="Comma-separated area paths"),
    force: bool = Query(False, description="Force refresh even if recently updated")
):
    """Invalidate cache and re-fetch task data from Azure.

    Invalidates the backend diskcache entries, then re-fetches each area via
    CachingBackend (which writes new data into diskcache with the configured TTL).

    Query params:
        areas: Comma-separated area paths to refresh
        force: accepted for API compatibility; cache is always invalidated
    """
    sid = get_session_id_from_request(request)
    session_mgr = resolve_service(request, 'session_manager')
    backend = resolve_service(request, 'backend')

    pat = session_mgr.get_val(sid, 'pat')
    if not pat:
        raise HTTPException(
            status_code=401,
            detail={'error': 'missing_pat', 'message': 'Personal Access Token required'}
        )

    area_list = areas.split(',') if areas else _get_all_configured_areas(request)
    if not area_list:
        raise HTTPException(
            status_code=400,
            detail={'error': 'no_areas', 'message': 'No areas specified or configured'}
        )

    area_project_config = _get_area_project_config_map(request)

    # Invalidate all cached task entries so the next fetch bypasses diskcache.
    backend.invalidate_cache()

    from planner_lib.backend.port import BackendCredential
    cred = BackendCredential(token=pat, user_id=sid)

    refreshed: list = []
    errors: list = []
    for area_path in area_list:
        proj_cfg = area_project_config.get(area_path, {})
        try:
            items = backend.fetch_tasks(
                area_path,
                task_types=proj_cfg.get('task_types'),
                include_states=proj_cfg.get('include_states'),
                credential=cred,
            )
            refreshed.append(area_path)
            logger.info("Refreshed area '%s' (%d items)", area_path, len(items))
        except Exception as exc:
            logger.error("Failed to refresh area '%s': %s", area_path, exc)
            errors.append({'area': area_path, 'error': str(exc)})

    response: dict = {
        "refreshed": refreshed,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    if errors:
        response['errors'] = errors
    logger.info("Cache refresh: %d areas refreshed", len(refreshed))
    return response


@router.get("/metrics")
@require_session
async def cache_metrics(request: Request):
    """Get cache storage metrics.

    Returns disk volume and entry count from the diskcache backend.
    """
    backend = resolve_service(request, 'backend')
    storage = getattr(backend, '_storage', None)
    if storage is None:
        raise HTTPException(
            status_code=503,
            detail={'error': 'cache_unavailable', 'message': 'Backend has no cache storage'}
        )

    entry_count = sum(1 for _ in storage.list_keys(_BACKEND_DOMAIN_NS))
    # diskcache Cache.volume() gives on-disk size in bytes; fall back gracefully.
    raw_cache = getattr(storage, '_cache', None)
    volume_bytes = raw_cache.volume() if raw_cache is not None else 0

    return {
        "diskcache": {
            "total_size_mb": round(volume_bytes / (1024 * 1024), 2),
            "entry_count": entry_count,
            "namespace": _BACKEND_DOMAIN_NS,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    }


# ---------------------------------------------------------------------------
# Azure browse endpoints — available to any user with a valid PAT in their
# session (no admin privilege required).
# ---------------------------------------------------------------------------

def _get_pat_or_raise(request: Request, session_mgr) -> str:
    """Return PAT from session or raise HTTP 401."""
    sid = get_session_id_from_request(request)
    pat = session_mgr.get_val(sid, 'pat')
    if not pat:
        raise HTTPException(
            status_code=401,
            detail={'error': 'missing_pat', 'message': 'Personal Access Token required in session'}
        )
    return pat


@browse_router.get("/projects")
@require_session
async def azure_browse_projects(request: Request):
    """List all Azure DevOps projects visible with the user's PAT.

    Returns:
        { "projects": ["ProjectA", "ProjectB", ...] }
    """
    session_mgr = resolve_service(request, 'session_manager')
    pat = _get_pat_or_raise(request, session_mgr)
    azure_svc = resolve_service(request, 'azure_client')
    with azure_svc.connect(pat) as client:
        projects = client.get_projects()
    return {'projects': projects}


@browse_router.get("/area-paths")
@require_session
async def azure_browse_area_paths(
    request: Request,
    project: str = Query(..., description="Azure DevOps project name"),
):
    """List all area paths under a given Azure DevOps project.

    Query params:
        project: Azure DevOps project name (required)

    Returns:
        { "area_paths": ["Project\\Team", "Project\\Team\\SubTeam", ...] }
    """
    session_mgr = resolve_service(request, 'session_manager')
    pat = _get_pat_or_raise(request, session_mgr)
    azure_svc = resolve_service(request, 'azure_client')
    with azure_svc.connect(pat) as client:
        area_paths = client.get_area_paths(project)
    return {'area_paths': area_paths}


@browse_router.get("/work-item-metadata")
@require_session
async def azure_browse_work_item_metadata(
    request: Request,
    project: str = Query(..., description="Azure DevOps project name"),
):
    """Return work item types and states for a given Azure DevOps project.

    Query params:
        project: Azure DevOps project name (required)

    Returns:
        {
            "types": ["Bug", "Epic", "Feature", "Task", "User Story"],
            "states": ["Active", "Closed", "New", ...],
            "states_by_type": { "Bug": ["Active", "Closed", "New", ...], ... }
        }
    """
    session_mgr = resolve_service(request, 'session_manager')
    pat = _get_pat_or_raise(request, session_mgr)
    azure_svc = resolve_service(request, 'azure_client')
    with azure_svc.connect(pat) as client:
        metadata = client.get_work_item_metadata(project)
    return metadata


@browse_router.get("/area-path-metadata")
@require_session
async def azure_browse_area_path_metadata(
    request: Request,
    project: str = Query(..., description="Azure DevOps project name"),
    area_path: str = Query(..., description="Area path to inspect"),
):
    """Return work item types, states and state categories for a specific area path.

    Unlike /work-item-metadata (which returns every type/state defined for the whole
    project), this endpoint queries the team backlog configuration for the given area
    path and returns only the types, states and their Azure DevOps categories that are
    configured there.

    The result is also stored in the disk-backed metadata cache keyed by the Azure
    project name so subsequent requests for the same project are served from cache.

    Query params:
        project:   Azure DevOps project name (required)
        area_path: Area path to inspect (required); sub-areas are included via UNDER match.

    Returns:
        {
            "types": ["Feature", "Bug"],
            "states": ["Active", "New"],
            "states_by_type": { "Feature": ["Active", "New"], "Bug": ["Active"] },
            "state_categories": { "Active": "InProgress", "New": "Proposed" }
        }
    """
    session_mgr = resolve_service(request, 'session_manager')
    pat = _get_pat_or_raise(request, session_mgr)
    azure_svc = resolve_service(request, 'azure_client')
    with azure_svc.connect(pat) as client:
        metadata = client.get_area_path_used_metadata(project, area_path)
    # Persist in the disk-backed metadata cache so other endpoints & tab-load prefetch
    # can reuse this without hitting Azure again.
    metadata_svc = resolve_optional_service(request, 'azure_project_metadata_service')
    if metadata_svc:
        metadata_svc.store(project, metadata)
    return metadata


@browse_router.get("/prefetch-projects-metadata")
@require_session
async def azure_prefetch_projects_metadata(
    request: Request,
    area_paths: str = Query(..., description="Comma-separated area paths to prefetch metadata for"),
):
    """Fetch and cache work-item metadata for a list of area paths.

    For each area path the Azure project name is derived from the first path segment.
    The disk cache is checked first; Azure is only contacted on a cache miss so
    repeated calls at tab-load are cheap.

    Query params:
        area_paths: Comma-separated area paths (URL-encoded).

    Returns:
        {
            "results": {
                "Platform\\Team": {
                    "azure_project": "Platform",
                    "types": [...],
                    "states": [...],
                    "states_by_type": {...},
                    "state_categories": {...}
                },
                ...
            }
        }
    """
    session_mgr = resolve_service(request, 'session_manager')
    pat = _get_pat_or_raise(request, session_mgr)
    azure_svc = resolve_service(request, 'azure_client')
    metadata_svc = resolve_optional_service(request, 'azure_project_metadata_service')

    results: dict = {}
    for raw_path in area_paths.split(','):
        area_path = raw_path.strip()
        if not area_path:
            continue
        sep = '\\' if '\\' in area_path else '/'
        azure_project = area_path.split(sep)[0]
        if not azure_project:
            continue

        if metadata_svc:
            metadata = metadata_svc.get_or_fetch(azure_project, area_path, pat, azure_svc)
        else:
            with azure_svc.connect(pat) as client:
                metadata = client.get_area_path_used_metadata(azure_project, area_path)

        results[area_path] = {'azure_project': azure_project, **metadata}

    return {'results': results}
