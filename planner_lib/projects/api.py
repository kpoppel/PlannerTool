import asyncio
from typing import Optional

from fastapi import APIRouter, Request, Body, HTTPException, Response
from pydantic import BaseModel, ConfigDict
from planner_lib.middleware import require_session
from planner_lib.middleware.session import get_session_id_from_request
from planner_lib.services.resolver import resolve_service
from planner_lib.backend.port import BackendCredential
from planner_lib.backend.errors import BackendAuthError, BackendConfigError, BackendUnavailableError
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


class TaskCapacityEntry(BaseModel):
    model_config = ConfigDict(extra='forbid')

    team: str
    capacity: float


class TaskRelationEntry(BaseModel):
    model_config = ConfigDict(extra='forbid')

    type: str
    id: str
    url: Optional[str] = None


class TaskUpdatePayload(BaseModel):
    model_config = ConfigDict(extra='forbid')

    id: str | int
    start: Optional[str] = None
    end: Optional[str] = None
    capacity: Optional[list[TaskCapacityEntry]] = None
    state: Optional[str] = None
    iterationPath: Optional[str] = None
    tags: Optional[str] = None
    relations: Optional[list[TaskRelationEntry]] = None


def _get_credential(request: Request, sid: str):
    """Build a BackendCredential from the current session's PAT and email."""
    session_mgr = resolve_service(request, 'session_manager')
    pat = session_mgr.get_val(sid, 'pat')
    email = session_mgr.get_val(sid, 'email') or ''
    if not pat:
        return None, email
    return BackendCredential(token=pat, user_id=email), email


@router.get('/teams')
@require_session
async def api_teams(request: Request):
    team_repo = resolve_service(request, 'team_repository')
    return await asyncio.to_thread(team_repo.list_teams)


@router.get('/projects')
@require_session
async def api_projects(request: Request):
    project_repo = resolve_service(request, 'project_repository')
    return await asyncio.to_thread(project_repo.list_projects)


@router.get('/tasks')
@require_session
async def api_tasks(request: Request, response: Response):
    sid = get_session_id_from_request(request)
    logger.debug("Fetching tasks for session %s", sid)
    task_repo = resolve_service(request, 'task_repository')
    credential, email = _get_credential(request, sid)
    project_id = request.query_params.get('project')
    try:
        tasks = await asyncio.to_thread(
            task_repo.read, project_id=project_id or None, credential=credential
        )
    except BackendAuthError:
        raise HTTPException(
            status_code=401,
            detail={'error': 'invalid_pat', 'message': 'Personal Access Token is invalid or expired'},
        )
    except BackendUnavailableError:
        raise HTTPException(
            status_code=503,
            detail={'error': 'backend_unavailable', 'message': 'Azure DevOps is currently unreachable. Please try again later.'},
        )
    except BackendConfigError:
        raise HTTPException(
            status_code=500,
            detail={
                'error': 'backend_misconfigured',
                'message': 'Task source configuration is invalid. See server logs for project and area path details.',
            },
        )
    try:
        backend = resolve_service(request, 'backend')
        consume_warnings = getattr(backend, 'consume_warnings', None)
        if callable(consume_warnings):
            warnings = consume_warnings(user_id=email or None)
            if warnings:
                warning = warnings[-1]
                response.headers['X-Tasks-Data-Stale'] = 'true'
                response.headers['X-Tasks-Warning-Code'] = str(warning.get('code') or 'tasks_stale')
                response.headers['X-Tasks-Warning-Message'] = str(
                    warning.get('message') or 'Showing cached task data that may be out of date.'
                )
    except Exception:
        # Warning propagation must never break task reads.
        pass
    return tasks


@router.get('/markers')
@require_session
async def api_markers(request: Request):
    sid = get_session_id_from_request(request)
    logger.debug("Fetching markers for session %s", sid)
    plan_repo = resolve_service(request, 'plan_repository')
    _credential, email = _get_credential(request, sid)
    project_id = request.query_params.get('project')
    return await asyncio.to_thread(
        plan_repo.list_markers, project_id=project_id or None, user_id=email or None
    )


@router.post('/tasks')
@require_session
async def api_tasks_update(
    request: Request,
    payload: list[TaskUpdatePayload] = Body(default=[]),
):
    sid = get_session_id_from_request(request)
    logger.debug("Updating tasks for session %s: %d items", sid, len(payload or []))

    task_repo = resolve_service(request, 'task_repository')
    _credential, email = _get_credential(request, sid)
    normalized_payload = [item.model_dump(exclude_unset=True) for item in (payload or [])]
    result = await asyncio.to_thread(task_repo.write, normalized_payload, user_id=email)
    if not result.get('ok', True) and result.get('errors'):
        logger.warning("Task update completed with errors: %s", result['errors'])

    # The CachingBackend.write_task implementation already patches the in-memory
    # and disk cache in-place for the affected tasks, so no full invalidation is
    # needed here.  A full cache flush is only warranted on an explicit admin
    # refresh (POST /api/cache/invalidate).
    if result.get('updated', 0) > 0:
        logger.debug("Write-through cache patch applied for %d task update(s)", result['updated'])

    return result


@router.get('/iterations')
@require_session
async def api_config_iterations(request: Request):
    """Return configured iterations keyed by project id, optionally filtered.

    Query params:
        project: Optional configured project ID to narrow the response map.

    Returns:
        JSON with project-keyed effective iteration sets.
    """
    sid = get_session_id_from_request(request)

    # Only require a PAT when talking to the live Azure DevOps endpoint.
    # Mock clients (fixture replay and synthetic generator) work without one.
    azure_client = resolve_service(request, 'azure_client')
    pat_required = getattr(azure_client, 'requires_pat', True)
    credential, email = _get_credential(request, sid)
    if pat_required and not credential:
        raise HTTPException(status_code=401, detail={'error': 'missing_pat', 'message': 'Personal Access Token required'})

    project_filter = request.query_params.get('project')
    iteration_repo = resolve_service(request, 'iteration_repository')
    try:
        iterations = await asyncio.to_thread(
            iteration_repo.list_iterations,
            project_id=project_filter or None,
            user_id=email or None,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail={'error': 'missing_config', 'message': str(e)})
    except Exception as e:
        logger.exception('Failed to fetch iterations: %s', e)
        raise HTTPException(status_code=500, detail="Internal server error")

    return {'iterationsByProject': iterations}


@router.post('/cache/invalidate')
@require_session
async def api_cache_invalidate(request: Request):
    """Invalidate all Azure caches to force a fresh data fetch.

    This clears all cached work items, teams, plans, markers, and iterations.
    The next data fetch will retrieve fresh data from Azure DevOps.

    Returns:
        JSON with status and count of cleared cache entries
    """
    logger.info("Cache invalidation requested")
    try:
        coordinator = resolve_service(request, 'cache_coordinator')
        result = await asyncio.to_thread(coordinator.invalidate_all)
        logger.info("Cache invalidation completed: %s", result)
        return result
    except Exception as e:
        logger.exception('Failed to invalidate caches: %s', e)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get('/history/tasks')
@require_session
async def api_history_tasks(request: Request):
    """Fetch task history for timeline visualization.

    Returns revision history for work items, filtered to show only changes
    to start dates, end dates, and iteration paths. Results are paginated
    and deduplicated for efficient frontend rendering.

    Query params:
        project: Optional project ID filter
        team: Optional team ID filter
        plan: Optional plan ID filter
        since: Optional start date filter (ISO format YYYY-MM-DD)
        until: Optional end date filter (ISO format YYYY-MM-DD)
        page: Page number (1-indexed, default: 1)
        per_page: Items per page (default: 100, max: 500)

    Returns:
        JSON with pagination info and task history data:
        {
            "page": 1,
            "per_page": 100,
            "total": 123,
            "tasks": [...]
        }
    """
    try:
        sid = get_session_id_from_request(request)
        logger.debug("Fetching task history for session %s", sid)

        credential, email = _get_credential(request, sid)
        if not credential:
            raise HTTPException(status_code=401, detail={'error': 'missing_pat', 'message': 'Personal Access Token required'})

        # Get query parameters
        project_id = request.query_params.get('project')
        team_id = request.query_params.get('team')
        plan_id = request.query_params.get('plan')
        since = request.query_params.get('since')
        until = request.query_params.get('until')

        try:
            page = int(request.query_params.get('page', '1'))
        except ValueError:
            page = 1

        try:
            per_page = min(int(request.query_params.get('per_page', '100')), 500)
        except ValueError:
            per_page = 100

        history_repo = resolve_service(request, 'history_repository')
        task_repo = resolve_service(request, 'task_repository')

        # Resolve tasks first — HistoryRepository always takes a plain list
        task_list = await asyncio.to_thread(
            task_repo.read, project_id=project_id, credential=credential
        )

        result = await asyncio.to_thread(
            history_repo.read,
            tasks=task_list,
            project_id=project_id,
            user_id=email,
            team_id=team_id,
            plan_id=plan_id,
            since=since,
            until=until,
            page=page,
            per_page=per_page,
        )

        logger.debug("Returning %d tasks with history", len(result.get('tasks', [])))
        return result

    except HTTPException:
        raise
