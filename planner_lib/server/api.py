import asyncio

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from planner_lib.middleware import require_session, get_session_id_from_request
from planner_lib.services.resolver import resolve_service, resolve_optional_service
from planner_lib.backend.port import BackendCredential
from planner_lib.admin.plugin_runtime_config import normalize_plugin_runtime_config
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
    project_repo = resolve_service(request, 'project_repository')
    return _deprecated_response(await asyncio.to_thread(project_repo.list_projects))


@router.get('/v1/server/teams')
@require_session
async def api_config_teams(request):
    logger.warning("Deprecated endpoint /api/v1/server/teams called; use /api/teams")
    team_repo = resolve_service(request, 'team_repository')
    return _deprecated_response(await asyncio.to_thread(team_repo.list_teams))


@router.get('/v1/server/tasks')
@require_session
async def api_config_tasks(request):
    logger.warning("Deprecated endpoint /api/v1/server/tasks called; use /api/tasks")
    task_repo = resolve_service(request, 'task_repository')
    sid = get_session_id_from_request(request)
    session_mgr = resolve_service(request, 'session_manager')
    pat = session_mgr.get_val(sid, 'pat')
    email = session_mgr.get_val(sid, 'email') or ''
    if not pat:
        raise HTTPException(status_code=401, detail={'error': 'missing_pat', 'message': 'Personal Access Token required'})
    cred = BackendCredential(token=pat, user_id=email)
    return _deprecated_response(await asyncio.to_thread(task_repo.read, credential=cred))


@router.get('/health')
async def api_health(request: Request):
    health_config = resolve_optional_service(request, 'health_config')
    return get_health(health_config)


@router.get('/plugins/config')
@require_session
async def api_plugins_config(request: Request):
    """Return runtime-manageable plugin configuration for the user app."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        content = admin_svc.get_config('plugin_runtime_config', default=None)
        return normalize_plugin_runtime_config(content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': str(e)})
    except Exception as e:
        logger.exception('Failed to load runtime plugin config: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')
