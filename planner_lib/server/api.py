from fastapi import APIRouter, Request
from planner_lib.middleware import require_session
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
    return task_svc.list_tasks(pat=None)


@router.get('/health')
async def api_health():
    return get_health()
