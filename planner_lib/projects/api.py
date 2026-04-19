from fastapi import APIRouter, Request, Body, HTTPException
from planner_lib.middleware import require_session
from planner_lib.middleware.session import get_session_id_from_request
from planner_lib.services.resolver import resolve_service
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get('/teams')
@require_session
async def api_teams(request: Request):
    team_svc = resolve_service(request, 'team_service')
    return team_svc.list_teams()


@router.get('/projects')
@require_session
async def api_projects(request: Request):
    project_svc = resolve_service(request, 'project_service')
    return project_svc.list_projects()


@router.get('/tasks')
@require_session
async def api_tasks(request: Request):
    # TODO: Should this support a list of projects?
    sid = get_session_id_from_request(request)
    logger.debug("Fetching tasks for session for %s", sid)
    task_svc = resolve_service(request, 'task_service')
    session_mgr = resolve_service(request, 'session_manager')
    pat = session_mgr.get_val(sid, 'pat')
    project_id = request.query_params.get('project')
    if project_id:
        return task_svc.list_tasks(pat=pat, project_id=project_id)
    return task_svc.list_tasks(pat=pat)


@router.get('/markers')
@require_session
async def api_markers(request: Request):
    sid = get_session_id_from_request(request)
    logger.debug("Fetching markers for session %s", sid)
    task_svc = resolve_service(request, 'task_service')
    session_mgr = resolve_service(request, 'session_manager')
    pat = session_mgr.get_val(sid, 'pat')
    project_id = request.query_params.get('project')
    if project_id:
        return task_svc.list_markers(pat=pat, project_id=project_id)
    return task_svc.list_markers(pat=pat)


@router.post('/tasks')
@require_session
async def api_tasks_update(request: Request, payload: list[dict] = Body(default=[])):
    sid = get_session_id_from_request(request)
    logger.debug("Updating tasks for session %s: %d items", sid, len(payload or []))

    task_update_svc = resolve_service(request, 'task_update_service')
    session_mgr = resolve_service(request, 'session_manager')
    pat = session_mgr.get_val(sid, 'pat')
    result = task_update_svc.update_tasks(payload or [], pat=pat)
    if not result.get('ok', True) and result.get('errors'):
        logger.warning("Task update completed with errors: %s", result['errors'])
    return result


@router.get('/iterations')
@require_session
async def api_config_iterations(request: Request):
    """Return all configured iterations, optionally filtered by project.

    Query params:
        project: Optional project name to use project_overrides from iterations.yml

    Returns:
        JSON with flat list of iterations sorted by startDate
    """
    sid = get_session_id_from_request(request)
    session_mgr = resolve_service(request, 'session_manager')
    pat = session_mgr.get_val(sid, 'pat')

    azure_client = resolve_service(request, 'azure_client')
    # Only require a PAT when talking to the live Azure DevOps endpoint.
    # Mock clients (fixture replay and synthetic generator) work without one.
    pat_required = getattr(azure_client, 'requires_pat', True)
    if pat_required and not pat:
        raise HTTPException(status_code=401, detail={'error': 'missing_pat', 'message': 'Personal Access Token required'})

    project_filter = request.query_params.get('project')
    task_svc = resolve_service(request, 'task_service')
    try:
        iterations = task_svc.list_iterations(pat, project_filter=project_filter)
    except ValueError as e:
        raise HTTPException(status_code=400, detail={'error': 'missing_config', 'message': str(e)})
    except Exception as e:
        logger.exception('Failed to fetch iterations: %s', e)
        raise HTTPException(status_code=500, detail="Internal server error")

    return {'iterations': iterations}


@router.post('/cache/invalidate')
@require_session
async def api_cache_invalidate(request: Request):
    """Invalidate all Azure caches to force a fresh data fetch.
    
    This clears all cached work items, teams, plans, markers, and iterations.
    The next data fetch will retrieve fresh data from Azure DevOps.
    Also cleans up orphaned index entries.
    
    Returns:
        JSON with status and count of cleared cache entries
    """
    logger.info("Cache invalidation requested")
    try:
        coordinator = resolve_service(request, 'cache_coordinator')
        result = coordinator.invalidate_all()
        logger.info("Cache invalidation completed: %s", result)
        return result
    except Exception as e:
        logger.exception('Failed to invalidate caches: %s', e)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get('/history/tasks')
@require_session
async def api_history_tasks(request: Request):
    """Fetch task history for timeline visualization.
    
    Returns revision history for work items, filtered to show only changes
    to start dates, end dates, and iteration paths. Results are paginated
    and deduplicated for efficient frontend rendering.
    
    Query params:
        project: Optional project ID filter
        team: Optional team ID filter
        plan: Optional plan ID filter
        since: Optional start date filter (ISO format YYYY-MM-DD)
        until: Optional end date filter (ISO format YYYY-MM-DD)
        page: Page number (1-indexed, default: 1)
        per_page: Items per page (default: 100, max: 500)
        invalidate_cache: If 'true', clears cached history data before fetching (default: false)
    
    Returns:
        JSON with pagination info and task history data:
        {
            "page": 1,
            "per_page": 100,
            "total": 123,
            "tasks": [
                {
                    "task_id": 12345,
                    "title": "Feature name",
                    "plan_id": "plan_1",
                    "history": [
                        {
                            "field": "start|end|iteration",
                            "value": "2025-05-08",
                            "changed_at": "2025-05-08T09:10:00Z",
                            "changed_by": "alice"
                        }
                    ]
                }
            ]
        }
    """
    try:
        sid = get_session_id_from_request(request)
        logger.debug("Fetching task history for session %s", sid)
        
        session_mgr = resolve_service(request, 'session_manager')
        pat = session_mgr.get_val(sid, 'pat')
        
        if not pat:
            raise HTTPException(status_code=401, detail={'error': 'missing_pat', 'message': 'Personal Access Token required'})
        
        # Get query parameters
        project_id = request.query_params.get('project')
        team_id = request.query_params.get('team')
        plan_id = request.query_params.get('plan')
        since = request.query_params.get('since')
        until = request.query_params.get('until')
        invalidate_cache = request.query_params.get('invalidate_cache', '').lower() == 'true'
        
        # Pagination parameters
        try:
            page = int(request.query_params.get('page', '1'))
        except ValueError:
            page = 1
        
        try:
            per_page = min(int(request.query_params.get('per_page', '100')), 500)
        except ValueError:
            per_page = 100
        
        # Resolve services from DI container
        history_svc = resolve_service(request, 'history_service')
        task_svc = resolve_service(request, 'task_service')
        azure_svc = resolve_service(request, 'azure_client')
        
        # Invalidate cache if requested
        if invalidate_cache:
            logger.info(f"Invalidating history cache for project={project_id}")
            history_svc.invalidate_cache(azure_svc, project_id=project_id)
        
        result = history_svc.list_task_history(
            pat=pat,
            task_service=task_svc,
            azure_client=azure_svc,
            project_id=project_id,
            team_id=team_id,
            plan_id=plan_id,
            since=since,
            until=until,
            page=page,
            per_page=per_page
        )
        
        logger.debug(f"Returning {len(result.get('tasks', []))} tasks with history")
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to fetch task history: %s', e)
        raise HTTPException(status_code=500, detail="Internal server error")
