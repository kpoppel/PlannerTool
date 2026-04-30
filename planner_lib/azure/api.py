"""Cache API endpoints.

Provides REST endpoints for cache management: inspecting, refreshing, and
metrics for the CachingBackend memory+disk cache.
"""
from fastapi import APIRouter, Request, Query, HTTPException, Response
from typing import Optional
from datetime import datetime, timezone
import logging

from planner_lib.middleware import require_session
from planner_lib.middleware.session import get_session_id_from_request
from planner_lib.services.resolver import resolve_service, resolve_optional_service
from planner_lib.storage.caching import key_for_area as _key_for_area

# Namespace used by CachingBackend when storing DomainTask lists.
_BACKEND_DOMAIN_NS = 'backend_domain'


def _get_backend_memory_cache(request: Request):
    """Return the MemoryCacheManager from CachingBackend, or None if not enabled."""
    backend = resolve_service(request, 'backend')
    return getattr(backend, '_memory_cache', None)



router = APIRouter(tags=["cache"])
browse_router = APIRouter(tags=["azure"])
logger = logging.getLogger(__name__)


def _get_all_configured_areas(request: Request) -> list:
    """Get all configured area paths from projects config."""
    try:
        project_service = resolve_service(request, 'project_service')
        projects = project_service.list_projects()

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
        project_service = resolve_service(request, 'project_service')
        projects = project_service.list_projects()

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
    """Load cached Azure data (instant response from memory).
    
    Returns all cached data for the requested areas. Always succeeds even if
    data is stale. Includes metadata about cache age and staleness.
    
    Query params:
        areas: Comma-separated area paths (e.g., "Area\\Team1,Area\\Team2")
        include: Data types to include (workitems,teams,plans,markers,iterations)
    
    Returns:
        {
            "data": {"workitems": {...}, "teams": [...], ...},
            "metadata": {
                "areas": {"Area\\Team1": {"age": 120, "stale": false, ...}},
                "timestamp": "2026-03-16T10:30:00Z"
            }
        }
    """
    azure_service = resolve_service(request, 'azure_client')
    
    # Get memory cache from CachingBackend (sole owner of the memory tier).
    memory_cache = _get_backend_memory_cache(request)
    if not memory_cache:
        raise HTTPException(
            status_code=503, 
            detail={'error': 'cache_unavailable', 'message': 'Memory cache not enabled'}
        )
    
    # Parse areas and include types
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
    
    # Read from memory cache (backend_domain namespace, DomainTask format).
    all_entries = memory_cache.get_all(_BACKEND_DOMAIN_NS)
    data = {}
    metadata = {"areas": {}, "timestamp": datetime.now(timezone.utc).isoformat()}
    
    for area_path in area_list:
        area_key_prefix = _key_for_area(area_path)
        
        # Find the first cached variant for this area (keys are area__types__states).
        area_entries = {k: v for k, v in all_entries.items() if k.startswith(area_key_prefix)}
        
        if 'workitems' in include_types and area_entries:
            # Return all task variants; most callers expect one entry per area.
            first_key = next(iter(area_entries))
            data.setdefault('workitems', {})[area_path] = area_entries[first_key]
            
            meta = memory_cache.get_metadata(_BACKEND_DOMAIN_NS, first_key)
            if meta:
                age_seconds = (datetime.now(timezone.utc) - meta.last_update).total_seconds()
                metadata['areas'][area_path] = {
                    'age': int(age_seconds),
                    'stale': meta.needs_refresh,
                    'lastUpdate': meta.last_update.isoformat(),
                    'version': meta.version
                }
            else:
                metadata['areas'][area_path] = {
                    'age': None, 'stale': True, 'lastUpdate': None, 'version': 'v0'
                }
        else:
            metadata['areas'][area_path] = {
                'age': None, 'stale': True, 'lastUpdate': None, 'version': 'v0'
            }
    
    logger.info("Cache load: returned %d areas", len(data.get('workitems', {})))
    return {"data": data, "metadata": metadata}


@router.get("/refresh")
@require_session
async def cache_refresh(
    request: Request,
    areas: Optional[str] = Query(None, description="Comma-separated area paths"),
    force: bool = Query(False, description="Force refresh even if recently updated")
):
    """Refresh Azure data from API using user PAT.
    
    Checks cache staleness and refreshes from Azure if needed. Returns 304 if
    cache was recently refreshed (<30 seconds ago) unless force=true.
    
    Query params:
        areas: Comma-separated area paths to refresh
        force: Force refresh even if recently updated
    
    Returns:
        304 Not Modified - if cache recently refreshed
        200 OK - with updated data and metadata
    """
    sid = get_session_id_from_request(request)
    session_mgr = resolve_service(request, 'session_manager')
    backend = resolve_service(request, 'backend')
    
    # Get user PAT from session
    pat = session_mgr.get_val(sid, 'pat')
    if not pat:
        raise HTTPException(
            status_code=401, 
            detail={'error': 'missing_pat', 'message': 'Personal Access Token required'}
        )
    
    # Memory cache is optional (disk-only cache still benefits from invalidate+refetch).
    memory_cache = getattr(backend, '_memory_cache', None)
    
    # Parse areas
    area_list = areas.split(',') if areas else _get_all_configured_areas(request)

    if not area_list:
        raise HTTPException(
            status_code=400,
            detail={'error': 'no_areas', 'message': 'No areas specified or configured'}
        )

    area_project_config = _get_area_project_config_map(request)

    # Debounce: if memory cache is present, skip areas refreshed < 30 s ago.
    recently_refreshed = []
    needs_refresh = list(area_list)

    if memory_cache and not force:
        all_entries = memory_cache.get_all(_BACKEND_DOMAIN_NS)
        needs_refresh = []
        for area_path in area_list:
            area_key_prefix = _key_for_area(area_path)
            area_keys = [k for k in all_entries if k.startswith(area_key_prefix)]
            recently = False
            for k in area_keys:
                meta = memory_cache.get_metadata(_BACKEND_DOMAIN_NS, k)
                if meta:
                    age = (datetime.now(timezone.utc) - meta.last_update).total_seconds()
                    if age < 30:
                        recently = True
                        break
            if recently:
                recently_refreshed.append(area_path)
            else:
                needs_refresh.append(area_path)

    if not needs_refresh and recently_refreshed:
        logger.info("Cache refresh: 304 Not Modified (all areas recently refreshed)")
        return Response(status_code=304)

    # Invalidate the backend cache so the next fetch goes to the inner backend.
    backend.invalidate_cache()

    # Re-fetch each area through CachingBackend (writes into both cache tiers).
    from planner_lib.backend.port import BackendCredential
    cred = BackendCredential(token=pat, user_id=sid)

    refreshed_data = {}
    errors = []
    for area_path in needs_refresh:
        proj_cfg = area_project_config.get(area_path, {})
        try:
            items = backend.fetch_tasks(
                area_path,
                task_types=proj_cfg.get('task_types'),
                include_states=proj_cfg.get('include_states'),
                credential=cred,
            )
            refreshed_data[area_path] = items
            logger.info("Refreshed area '%s' (%d items)", area_path, len(items))
        except Exception as e:
            logger.error("Failed to refresh area '%s': %s", area_path, e)
            errors.append({'area': area_path, 'error': str(e)})
    
    response = {
        "refreshed": list(refreshed_data.keys()),
        "skipped": recently_refreshed,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    if errors:
        response['errors'] = errors
    
    logger.info("Cache refresh: %d areas refreshed, %d skipped", len(refreshed_data), len(recently_refreshed))
    return response


@router.get("/metrics")
@require_session
async def cache_metrics(request: Request):
    """Get cache performance metrics.
    
    Returns:
        {
            "memory_cache": {
                "total_size_mb": 12.5,
                "entry_count": 150,
                ...
            }
        }
    """
    memory_cache = _get_backend_memory_cache(request)
    
    if not memory_cache:
        raise HTTPException(
            status_code=503, 
            detail={'error': 'cache_unavailable', 'message': 'Memory cache not enabled'}
        )
    
    # Count entries in the domain cache namespace.
    total_entries = len(memory_cache.get_all(_BACKEND_DOMAIN_NS))
    
    return {
        "memory_cache": {
            "total_size_mb": round(memory_cache.get_total_size() / (1024 * 1024), 2),
            "entry_count": total_entries,
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
