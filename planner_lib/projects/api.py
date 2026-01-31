from fastapi import APIRouter, Request, Body
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
