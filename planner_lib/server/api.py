from fastapi import APIRouter, Request
from planner_lib.middleware import require_session
from .health import get_health

router = APIRouter()


@router.get('/v1/server/projects')
@require_session
async def api_config_projects(request):
    project_svc = getattr(request.app.state, 'project_service', None)
    if project_svc is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail='ProjectService not configured')
    return project_svc.list_projects()


@router.get('/v1/server/teams')
@require_session
async def api_config_teams(request):
    team_svc = getattr(request.app.state, 'team_service', None)
    if team_svc is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail='TeamService not configured')
    return team_svc.list_teams()


@router.get('/v1/server/tasks')
@require_session
async def api_config_tasks(request):
    task_svc = getattr(request.app.state, 'task_service', None)
    if task_svc is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail='TaskService not configured')
    return task_svc.list_tasks(pat=None)


@router.get('/health')
async def api_health():
    return get_health()
