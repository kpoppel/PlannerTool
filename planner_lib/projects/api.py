from fastapi import APIRouter, Request, Body
from planner_lib.middleware import require_session
from planner_lib.middleware.session import get_session_id_from_request
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get('/teams')
@require_session
async def api_teams(request: Request):
    team_svc = getattr(request.app.state, 'team_service', None)
    if team_svc is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail='TeamService not configured')
    return team_svc.list_teams()


@router.get('/projects')
@require_session
async def api_projects(request: Request):
    project_svc = getattr(request.app.state, 'project_service', None)
    if project_svc is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail='ProjectService not configured')
    return project_svc.list_projects()


@router.get('/tasks')
@require_session
async def api_tasks(request: Request):
    # TODO: Should this support a list of projects?
    sid = get_session_id_from_request(request)
    logger.debug("Fetching tasks for session for %s", sid)
    task_svc = getattr(request.app.state, 'task_service', None)
    if task_svc is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail='TaskService not configured')

    pat = request.app.state.session_manager.get_val(sid, 'pat')
    project_id = request.query_params.get('project')
    if project_id:
        return task_svc.list_tasks(pat=pat, project_id=project_id)
    return task_svc.list_tasks(pat=pat)


@router.post('/tasks')
@require_session
async def api_tasks_update(request: Request, payload: list[dict] = Body(default=[])):
    sid = get_session_id_from_request(request)
    logger.debug("Updating tasks for session %s: %d items", sid, len(payload or []))

    task_svc = getattr(request.app.state, 'task_service', None)
    if task_svc is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail='TaskService not configured')

    pat = request.app.state.session_manager.get_val(sid, 'pat')
    result = task_svc.update_tasks(payload or [], pat=pat)
    if not result.get('ok', True) and result.get('errors'):
        logger.warning("Task update completed with errors: %s", result['errors'])
    return result
