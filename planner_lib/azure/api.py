"""Cache API endpoints.

Provides REST endpoints for cache management: inspecting, refreshing, and
metrics for the CachingBackend diskcache.
"""
from fastapi import APIRouter, Request, Query, HTTPException, Response
from typing import Optional
from datetime import datetime, timezone
import logging

from planner_lib.middleware import require_session
from planner_lib.middleware.session import get_session_credentials_from_request
from planner_lib.backend.port import BackendCredential
from planner_lib.services.resolver import resolve_service

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
    """Return a mapping of area_path to its plan's types and history window.

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
                    'project_id': project.get('id'),
                    'task_types': project.get('task_types'),
                    'closed_history_days': project['closed_history_days'],
                }
        return config_map
    except Exception as e:
        logger.warning(f"Failed to build area project config map: {e}")
        return {}


def _get_archived_project_areas(request: Request) -> set[str]:
    """Return archived project area paths for explicit refresh protection."""
    admin_svc = resolve_service(request, 'admin_service')
    projects_config = admin_svc.get_config('projects', default={}) or {}
    if not isinstance(projects_config, dict):
        raise ValueError('Projects configuration must be an object')
    project_map = projects_config.get('project_map', [])
    if not isinstance(project_map, list):
        raise ValueError('Projects configuration project_map must be a list')
    return {
        project['area_path'].strip('/\\').replace('/', '\\').casefold()
        for project in project_map
        if isinstance(project, dict)
        and project.get('archived') is True
        and isinstance(project.get('area_path'), str)
        and project['area_path'].strip('/\\')
    }


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
    backend = resolve_service(request, 'backend')

    credentials = get_session_credentials_from_request(request)
    pat = credentials['pat']
    if not pat:
        raise HTTPException(
            status_code=401,
            detail={'error': 'missing_pat', 'message': 'Personal Access Token required'}
        )

    explicit_areas = bool(areas)
    area_list = areas.split(',') if explicit_areas else _get_all_configured_areas(request)
    if not area_list:
        raise HTTPException(
            status_code=400,
            detail={'error': 'no_areas', 'message': 'No areas specified or configured'}
        )

    area_project_config = _get_area_project_config_map(request)
    archived_areas = _get_archived_project_areas(request) if explicit_areas else set()

    # Invalidate all cached task entries so the next fetch bypasses diskcache.
    backend.invalidate_cache()

    cred = BackendCredential(kind='pat', token=pat, user_id=credentials['account_id'])

    refreshed: list = []
    errors: list = []
    for area_path in area_list:
        normalized_area = area_path.strip('/\\').replace('/', '\\').casefold()
        if normalized_area in archived_areas:
            errors.append({
                'area': area_path,
                'error': 'Archived project areas cannot be refreshed',
            })
            continue
        proj_cfg = area_project_config.get(area_path, {})
        try:
            items = backend.fetch_tasks(
                area_path,
                project_id=proj_cfg.get('project_id'),
                task_types=proj_cfg.get('task_types'),
                closed_history_days=proj_cfg['closed_history_days'],
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

def _get_credential_or_raise(request: Request) -> BackendCredential:
    """Return the session's PAT credential or raise HTTP 401."""
    context = get_session_credentials_from_request(request)
    pat = context['pat']
    if not pat:
        raise HTTPException(
            status_code=401,
            detail={'error': 'missing_pat', 'message': 'Personal Access Token required in session'}
        )
    return BackendCredential(kind='pat', token=pat, user_id=context['account_id'])


def _live_client_or_raise(org_url: str, credential: BackendCredential):
    """Return a context-manager yielding a live AzureClient for *org_url*.

    Always uses the live ``AzureClient`` — never a mock.  This is intentional:
    browse endpoints are used to configure live ADO resources (projects, wikis,
    area paths) and must reach the real ADO REST API regardless of which
    work-item backend is currently active.

    Raises HTTP 400 when *org_url* is empty so the caller gets a clear message.
    """
    if not org_url or not org_url.strip():
        raise HTTPException(
            status_code=400,
            detail={
                'error': 'missing_org_url',
                'message': 'Organization Name is required. Set it in the Azure DevOps Wiki settings.',
            },
        )
    from planner_lib.azure.AzureClient import AzureClient
    return AzureClient(org_url.strip(), storage=None, cache_plans=False).connect(credential)


@browse_router.get("/projects")
@require_session
async def azure_browse_projects(
    request: Request,
    org_url: str = Query(..., description="Azure DevOps organization name or URL"),
):
    """List all Azure DevOps projects visible with the user's PAT.

    Query params:
        org_url: Azure DevOps organization name or full URL (required)

    Returns:
        { "projects": ["ProjectA", "ProjectB", ...] }
    """
    credential = _get_credential_or_raise(request)
    with _live_client_or_raise(org_url, credential) as client:
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
    credential = _get_credential_or_raise(request)
    azure_svc = resolve_service(request, 'azure_client')
    with azure_svc.connect(credential) as client:
        area_paths = client.get_area_paths(project)
    return {'area_paths': area_paths}


@browse_router.get("/wikis")
@require_session
async def azure_browse_wikis(
    request: Request,
    project: str = Query(..., description="Azure DevOps project name"),
    org_url: str = Query(..., description="Azure DevOps organization name or URL"),
):
    """List all wikis in a given Azure DevOps project.

    Query params:
        project: Azure DevOps project name (required)
        org_url:  Azure DevOps organization name or URL (required)

    Returns:
        { "wikis": [{"id": "...", "name": "MyProject.wiki", "type": "projectWiki"}, ...] }
    """
    credential = _get_credential_or_raise(request)
    with _live_client_or_raise(org_url, credential) as client:
        wikis = client.get_wikis(project)
    return {'wikis': wikis}


@browse_router.get("/wiki-pages")
@require_session
async def azure_browse_wiki_pages(
    request: Request,
    project: str = Query(..., description="Azure DevOps project name"),
    wiki_id: str = Query(..., description="Wiki name or GUID"),
    org_url: str = Query(..., description="Azure DevOps organization name or URL"),
):
    """Return a flat list of all page paths in a wiki.

    Query params:
        project: Azure DevOps project name (required)
        wiki_id: Wiki name or GUID (required)
        org_url:  Azure DevOps organization name or URL (required)

    Returns:
        { "pages": ["/Home", "/PlannerTool", "/PlannerTool/Events", ...] }
    """
    credential = _get_credential_or_raise(request)
    with _live_client_or_raise(org_url, credential) as client:
        pages = client.get_wiki_pages(project, wiki_id)
    return {'pages': pages}
