"""Azure cache API endpoints.

This module provides REST API endpoints for cache management operations including
loading cached data and triggering refreshes from Azure DevOps.
"""
from fastapi import APIRouter, Request, Query, HTTPException, Response
from typing import Optional
from datetime import datetime, timezone
import logging

from planner_lib.middleware import require_session
from planner_lib.middleware.session import get_session_id_from_request
from planner_lib.services.resolver import resolve_service, resolve_optional_service

router = APIRouter(prefix="/api/cache", tags=["cache"])
browse_router = APIRouter(prefix="/api/azure", tags=["azure"])
logger = logging.getLogger(__name__)


def _key_for_area(area_path: str) -> str:
    """Generate cache key for an area path (matches AzureCachingClient logic)."""
    safe = area_path.replace('\\', '__').replace('/', '__').replace(' ', '_')
    safe = ''.join(c for c in safe if c.isalnum() or c in ('_', '-'))
    return safe


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
    
    # Get memory cache from azure service
    memory_cache = getattr(azure_service, '_memory_cache', None)
    if not memory_cache:
        raise HTTPException(
            status_code=503, 
            detail={'error': 'cache_unavailable', 'message': 'Memory cache not enabled'}
        )
    
    # Parse areas and include types
    area_list = areas.split(',') if areas else _get_all_configured_areas(request)
    include_types = include.split(',') if include else ['work_items', 'teams', 'plans', 'markers', 'iterations']
    
    if not area_list:
        return {
            "data": {},
            "metadata": {
                "areas": {},
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "warning": "No areas configured or specified"
            }
        }
    
    # Read from memory cache
    data = {}
    metadata = {"areas": {}, "timestamp": datetime.now(timezone.utc).isoformat()}
    
    for area_path in area_list:
        area_key = _key_for_area(area_path)
        
        if 'workitems' in include_types:
            workitems = memory_cache.read('azure_workitems', area_key)
            meta = memory_cache.get_metadata('azure_workitems', area_key)
            
            if workitems:
                data.setdefault('workitems', {})[area_path] = workitems
            
            if meta:
                age_seconds = (datetime.now(timezone.utc) - meta.last_update).total_seconds()
                metadata['areas'][area_path] = {
                    'age': int(age_seconds),
                    'stale': meta.needs_refresh,  # Uses configured staleness threshold
                    'lastUpdate': meta.last_update.isoformat(),
                    'version': meta.version
                }
            else:
                # No metadata means no cache
                metadata['areas'][area_path] = {
                    'age': None,
                    'stale': True,
                    'lastUpdate': None,
                    'version': 'v0'
                }
    
    logger.info(f"Cache load: returned {len(data.get('workitems', {}))} areas")
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
    azure_service = resolve_service(request, 'azure_client')
    
    # Get user PAT from session
    pat = session_mgr.get_val(sid, 'pat')
    if not pat:
        raise HTTPException(
            status_code=401, 
            detail={'error': 'missing_pat', 'message': 'Personal Access Token required'}
        )
    
    # Get memory cache
    memory_cache = getattr(azure_service, '_memory_cache', None)
    if not memory_cache:
        raise HTTPException(
            status_code=503, 
            detail={'error': 'cache_unavailable', 'message': 'Memory cache not enabled'}
        )
    
    # Parse areas
    area_list = areas.split(',') if areas else _get_all_configured_areas(request)

    if not area_list:
        raise HTTPException(
            status_code=400,
            detail={'error': 'no_areas', 'message': 'No areas specified or configured'}
        )

    # Build per-area project config (task_types, include_states) so the refresh
    # honours each project's configured type hierarchy rather than falling back
    # to the hard-coded default ['epic', 'feature'].
    area_project_config = _get_area_project_config_map(request)

    # Check if recently refreshed (debounce) or needs refresh based on staleness
    recently_refreshed = []
    needs_refresh = []

    for area_path in area_list:
        area_key = _key_for_area(area_path)
        meta = memory_cache.get_metadata('azure_workitems', area_key)

        if meta and not force:
            age_seconds = (datetime.now(timezone.utc) - meta.last_update).total_seconds()
            if age_seconds < 30:  # Recently refreshed (debounce to prevent rapid re-fetches)
                recently_refreshed.append(area_path)
            elif meta.needs_refresh:  # Stale based on configured threshold
                needs_refresh.append(area_path)
            # else: fresh and not recently refreshed, don't add to either list
        else:
            needs_refresh.append(area_path)

    # Return 304 if all areas recently refreshed
    if not needs_refresh and recently_refreshed:
        logger.info(f"Cache refresh: 304 Not Modified (all areas recently refreshed)")
        return Response(status_code=304)

    # Refresh stale areas using user PAT
    refreshed_data = {}
    errors = []

    try:
        with azure_service.connect(pat) as client:
            for area_path in needs_refresh:
                try:
                    # Pass project-configured task_types and include_states so every
                    # configured work item type hierarchy is fetched, not just the
                    # built-in default ('epic', 'feature').
                    proj_cfg = area_project_config.get(area_path, {})
                    workitems = client.get_work_items(
                        area_path,
                        task_types=proj_cfg.get('task_types'),
                        include_states=proj_cfg.get('include_states'),
                    )
                    refreshed_data[area_path] = workitems
                    logger.info(f"Refreshed area '{area_path}' from Azure ({len(workitems)} items)")
                except Exception as e:
                    logger.error(f"Failed to refresh area '{area_path}': {e}")
                    errors.append({
                        'area': area_path,
                        'error': str(e)
                    })
    except Exception as e:
        logger.error(f"Failed to connect to Azure: {e}")
        raise HTTPException(
            status_code=503,
            detail={'error': 'azure_connection_failed', 'message': str(e)}
        )
    
    response = {
        "refreshed": list(refreshed_data.keys()),
        "skipped": recently_refreshed,
        "data": {"workitems": refreshed_data},
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    
    if errors:
        response['errors'] = errors
    
    logger.info(f"Cache refresh: {len(refreshed_data)} areas refreshed, {len(recently_refreshed)} skipped")
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
    azure_service = resolve_service(request, 'azure_client')
    memory_cache = getattr(azure_service, '_memory_cache', None)
    
    if not memory_cache:
        raise HTTPException(
            status_code=503, 
            detail={'error': 'cache_unavailable', 'message': 'Memory cache not enabled'}
        )
    
    # Count entries
    total_entries = sum(
        len(memory_cache.get_all(ns)) 
        for ns in ['azure_workitems', 'teams', 'plans', 'markers', 'iterations']
    )
    
    return {
        "memory_cache": {
            "total_size_mb": round(memory_cache.get_total_size() / (1024 * 1024), 2),
            "entry_count": total_entries,
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
