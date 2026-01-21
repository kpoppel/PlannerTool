from fastapi import APIRouter, Request, Body
from planner_lib.middleware import require_session
from planner_lib.middleware.session import get_session_id_from_request, session_manager
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get('/teams')
@require_session
async def api_teams(request: Request):
    from planner_lib.projects import list_teams
    return list_teams()


@router.get('/projects')
@require_session
async def api_projects(request: Request):
    from planner_lib.projects import list_projects
    return list_projects()


@router.get('/tasks')
@require_session
async def api_tasks(request: Request):
    sid = get_session_id_from_request(request)
    logger.debug("Fetching tasks for session for %s", sid)

    from planner_lib.projects import list_tasks

    pat = session_manager.get_val(sid, 'pat')
    project_id = request.query_params.get('project')
    if project_id:
        return list_tasks(pat=pat, project_id=project_id)
    return list_tasks(pat=pat)


@router.post('/tasks')
@require_session
async def api_tasks_update(request: Request, payload: list[dict] = Body(default=[])):
    sid = get_session_id_from_request(request)
    logger.debug("Updating tasks for session %s: %d items", sid, len(payload or []))

    from planner_lib.projects import update_tasks
    pat = session_manager.get_val(sid, 'pat')
    result = update_tasks(payload or [], pat=pat)
    if not result.get('ok', True) and result.get('errors'):
        logger.warning("Task update completed with errors: %s", result['errors'])
    return result
