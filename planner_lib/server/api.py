from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from planner_lib.middleware import require_session, get_session_id_from_request
from planner_lib.services.resolver import resolve_service, resolve_optional_service
from .health import get_health
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

_DEPRECATION_HEADER = "X-Deprecated"
_DEPRECATION_MSG = "This endpoint is deprecated. Use /api/projects, /api/teams, or /api/tasks instead."


def _deprecated_response(data) -> JSONResponse:
    """Wrap a response with a deprecation header."""
    response = JSONResponse(content=data)
    response.headers[_DEPRECATION_HEADER] = _DEPRECATION_MSG
    return response


@router.get('/v1/server/projects')
@require_session
async def api_config_projects(request):
    logger.warning("Deprecated endpoint /api/v1/server/projects called; use /api/projects")
    project_svc = resolve_service(request, 'project_service')
    return _deprecated_response(project_svc.list_projects())


@router.get('/v1/server/teams')
@require_session
async def api_config_teams(request):
    logger.warning("Deprecated endpoint /api/v1/server/teams called; use /api/teams")
    team_svc = resolve_service(request, 'team_service')
    return _deprecated_response(team_svc.list_teams())


@router.get('/v1/server/tasks')
@require_session
async def api_config_tasks(request):
    logger.warning("Deprecated endpoint /api/v1/server/tasks called; use /api/tasks")
    task_svc = resolve_service(request, 'task_service')
    sid = get_session_id_from_request(request)
    session_mgr = resolve_service(request, 'session_manager')
    pat = session_mgr.get_val(sid, 'pat')
    if not pat:
        raise HTTPException(status_code=401, detail={'error': 'missing_pat', 'message': 'Personal Access Token required'})
    return _deprecated_response(task_svc.list_tasks(pat=pat))


@router.get('/health')
async def api_health(request: Request):
    health_config = resolve_optional_service(request, 'health_config')
    return get_health(health_config)
