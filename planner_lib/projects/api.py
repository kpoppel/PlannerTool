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

    task_svc = resolve_service(request, 'task_service')
    session_mgr = resolve_service(request, 'session_manager')
    pat = session_mgr.get_val(sid, 'pat')
    result = task_svc.update_tasks(payload or [], pat=pat)
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
    try:
        # Get PAT from session
        sid = get_session_id_from_request(request)
        session_mgr = resolve_service(request, 'session_manager')
        pat = session_mgr.get_val(sid, 'pat')
        if not pat:
            raise HTTPException(status_code=401, detail={'error': 'missing_pat', 'message': 'Personal Access Token required'})
        
        # Load iterations config
        from planner_lib.storage import create_storage
        storage = create_storage(serializer='yaml', data_dir='data')
        try:
            iterations_cfg = storage.load('config', 'iterations') or {}
        except KeyError:
            iterations_cfg = {}
        
        # Get Azure project name from config
        azure_project = iterations_cfg.get('azure_project', '')
        if not azure_project:
            raise HTTPException(status_code=400, detail={'error': 'missing_config', 'message': 'azure_project not configured in iterations.yml'})
        
        # Determine which roots to use (project override or defaults)
        project_filter = request.query_params.get('project')
        if project_filter and 'project_overrides' in iterations_cfg:
            roots = iterations_cfg.get('project_overrides', {}).get(project_filter)
            if not roots:
                # Fall back to defaults if no override exists
                roots = iterations_cfg.get('default_roots', [])
        else:
            roots = iterations_cfg.get('default_roots', [])
        
        if not roots:
            return {'iterations': []}
        
        # Connect to Azure and fetch iterations for each root
        def _strip_iteration_segment(path: str) -> str:
            """Remove any 'Iteration' or 'Iterations' path segments from an Azure path.

            Example: 'Project\\Iteration\\eSW\\Sprint 1' -> 'Project\\eSW\\Sprint 1'
            """
            if not path or not isinstance(path, str):
                return path
            parts = path.split('\\')
            parts = [p for p in parts if p and p.lower() not in ('iteration', 'iterations')]
            return '\\'.join(parts)

        azure_svc = resolve_service(request, 'azure_client')
        all_iterations = []
        seen_paths = set()

        with azure_svc.connect(pat) as client:
            for root in roots:
                # Construct full path with Iteration\ prefix for Azure API
                full_root = f"{azure_project}\\Iteration\\{root}"

                try:
                    iterations = client.get_iterations(azure_project, root_path=full_root)
                    # Deduplicate by normalized path (strip any 'Iteration' segments)
                    for it in iterations:
                        raw_path = it.get('path') or ''
                        norm_path = _strip_iteration_segment(raw_path)
                        # update the item with the normalized path for consumers
                        it['path'] = norm_path
                        if norm_path not in seen_paths:
                            all_iterations.append(it)
                            seen_paths.add(norm_path)
                except Exception as e:
                    import logging
                    logger = logging.getLogger(__name__)
                    logger.warning(f'Failed to fetch iterations for root {full_root}: {e}')
                    continue
        
        # Sort by startDate (already done in get_iterations, but ensure consistency)
        def sort_key(item):
            start = item.get('startDate')
            if start:
                return (0, start, item.get('path', ''))
            return (1, '', item.get('path', ''))
        
        all_iterations.sort(key=sort_key)
        
        # Filter out iterations without dates and iterations where both dates are before current year
        from datetime import datetime
        current_year = datetime.now().year
        
        def should_include_iteration(it):
            start = it.get('startDate')
            finish = it.get('finishDate')
            
            # Exclude if both dates are missing
            if not start and not finish:
                return False
            
            # Parse dates and check if at least one is in current year or later
            try:
                # Check if at least one date exists and is >= current year
                has_valid_date = False
                
                if start:
                    start_year = int(start[:4])
                    if start_year >= current_year:
                        has_valid_date = True
                
                if finish:
                    finish_year = int(finish[:4])
                    if finish_year >= current_year:
                        has_valid_date = True
                
                return has_valid_date
            except (ValueError, IndexError):
                # If date parsing fails, exclude the iteration
                return False
        
        filtered_iterations = [it for it in all_iterations if should_include_iteration(it)]
        
        return {'iterations': filtered_iterations}
    
    except HTTPException:
        raise
    except Exception as e:
        import logging
        logger = logging.getLogger(__name__)
        logger.exception('Failed to fetch iterations: %s', e)
        raise HTTPException(status_code=500, detail=str(e))


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
        azure_svc = resolve_service(request, 'azure_client')
        result = azure_svc.invalidate_all_caches()
        logger.info(f"Cache invalidation completed: {result}")
        return result
    except Exception as e:
        logger.exception('Failed to invalidate caches: %s', e)
        raise HTTPException(status_code=500, detail=str(e))


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
        
        # Create history service and fetch data
        from planner_lib.projects.history_service import HistoryService
        from planner_lib.storage import create_storage
        
        storage = create_storage(serializer='yaml', data_dir='data')
        history_svc = HistoryService(storage_config=storage)
        
        # Get task service and azure client for fetching tasks and revisions
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
        raise HTTPException(status_code=500, detail=str(e))
