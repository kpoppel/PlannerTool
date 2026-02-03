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
        storage = create_storage(serializer='yaml', accessor='dict', data_dir='data')
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
        
        return {'iterations': all_iterations}
    
    except HTTPException:
        raise
    except Exception as e:
        import logging
        logger = logging.getLogger(__name__)
        logger.exception('Failed to fetch iterations: %s', e)
        raise HTTPException(status_code=500, detail=str(e))

