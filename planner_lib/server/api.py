from fastapi import APIRouter, Request, HTTPException
from planner_lib.middleware import require_session, get_session_id_from_request
from planner_lib.services.resolver import resolve_service
from .health import get_health

router = APIRouter()


@router.get('/v1/server/projects')
@require_session
async def api_config_projects(request):
    project_svc = resolve_service(request, 'project_service')
    return project_svc.list_projects()


@router.get('/v1/server/teams')
@require_session
async def api_config_teams(request):
    team_svc = resolve_service(request, 'team_service')
    return team_svc.list_teams()


@router.get('/v1/server/tasks')
@require_session
async def api_config_tasks(request):
    task_svc = resolve_service(request, 'task_service')
    # Resolve session id and retrieve PAT from the session manager. All
    # Azure accesses require a PAT; return 401 if missing.
    sid = get_session_id_from_request(request)
    session_mgr = resolve_service(request, 'session_manager')
    pat = session_mgr.get_val(sid, 'pat')
    if not pat:
        raise HTTPException(status_code=401, detail={'error': 'missing_pat', 'message': 'Personal Access Token required'})
    return task_svc.list_tasks(pat=pat)


@router.get('/health')
async def api_health():
    return get_health()
