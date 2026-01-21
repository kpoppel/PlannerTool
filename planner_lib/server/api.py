from fastapi import APIRouter
from planner_lib.middleware import require_session
from .health import get_health

router = APIRouter()


@router.get('/v1/server/projects')
@require_session
async def api_config_projects(request):
    from planner_lib.projects import list_projects
    return list_projects()


@router.get('/v1/server/teams')
@require_session
async def api_config_teams(request):
    from planner_lib.projects import list_teams
    return list_teams()


@router.get('/v1/server/tasks')
@require_session
async def api_config_tasks(request):
    from planner_lib.projects import list_tasks
    return list_tasks(pat=None)


@router.get('/health')
async def api_health():
    return get_health()
