import asyncio
import json

from fastapi import APIRouter, Request, Body, HTTPException, Response
from planner_lib.middleware import require_session
from planner_lib.middleware.session import (
    get_session_context_from_request,
    get_session_credential_from_request,
)
from planner_lib.services.resolver import resolve_service
from planner_lib.backend.port import DiagnosticBackend
from planner_lib.backend.errors import BackendAuthError, BackendConfigError, BackendUnavailableError
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


def _get_credential(request: Request):
    """Resolve an operation credential and the authenticated account UUID."""
    credential = get_session_credential_from_request(
        request, backend=resolve_service(request, 'backend'),
    )
    account_id = get_session_context_from_request(request)['account_id']
    if credential is None:
        return None, account_id
    return credential, account_id


@router.get('/teams')
@require_session
async def api_teams(request: Request):
    team_repo = resolve_service(request, 'team_repository')
    return await asyncio.to_thread(team_repo.list_teams, include_archived=True)


@router.get('/projects')
@require_session
async def api_projects(request: Request):
    project_repo = resolve_service(request, 'project_repository')
    return await asyncio.to_thread(project_repo.list_projects)


@router.get('/tasks')
@require_session
async def api_tasks(request: Request, response: Response):
    logger.debug("Fetching tasks")
    task_repo = resolve_service(request, 'task_repository')
    credential, account_id = _get_credential(request)
    project_id = request.query_params.get('project')

    def read_tasks():
        tasks = task_repo.read(project_id=project_id or None, credential=credential)
        return tasks, task_repo.snapshot_diagnostics()

    try:
        tasks, diagnostics = await asyncio.to_thread(read_tasks)
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
        if isinstance(backend, DiagnosticBackend):
            diagnostics.extend(backend.consume_diagnostics(user_id=account_id))
        if diagnostics:
            response.headers['X-Backend-Diagnostics'] = json.dumps([
                {key: entry[key] for key in ('code', 'severity', 'message')}
                for entry in diagnostics
            ])
    except Exception as exc:
        # Warning propagation must never break task reads.
        logger.warning('Failed to deliver task diagnostics: %s', exc)
    return tasks


@router.post('/tasks/refresh', status_code=202)
@require_session
async def api_tasks_refresh(request: Request, response: Response):
    credential, _account_id = _get_credential(request)
    repository = resolve_service(request, 'task_repository')
    try:
        result = await asyncio.to_thread(repository.request_refresh, credential)
    except BackendAuthError:
        raise HTTPException(status_code=401, detail={
            'error': 'invalid_pat', 'message': 'A valid Personal Access Token is required to refresh tasks',
        })
    except BackendUnavailableError:
        raise HTTPException(status_code=503, detail={
            'error': 'backend_unavailable', 'message': 'Task refresh is currently unavailable',
        })
    messages = {
        'queued': 'Task cache refresh queued in background. Reload later to load updated data.',
        'already_running': 'Task cache refresh already running. Reload later to load updated data.',
        'completed': 'Task cache refresh completed. Reload to load updated data.',
    }
    response.headers['X-Backend-Diagnostics'] = json.dumps([{
        'code': 'task_refresh_requested', 'severity': 'info', 'message': messages[result['status']],
    }])
    return result


@router.get('/markers')
@require_session
async def api_markers(request: Request):
    logger.debug("Fetching markers")
    plan_repo = resolve_service(request, 'plan_repository')
    account_id = get_session_context_from_request(request)['account_id']
    project_id = request.query_params.get('project')
    return await asyncio.to_thread(
        plan_repo.list_markers, project_id=project_id or None, user_id=account_id
    )


@router.post('/tasks')
@require_session
async def api_tasks_update(request: Request, payload: list[dict] = Body(default=[])):
    logger.debug("Updating tasks: %d items", len(payload or []))

    task_repo = resolve_service(request, 'task_repository')
    account_id = get_session_context_from_request(request)['account_id']
    try:
        result = await asyncio.to_thread(task_repo.write, payload or [], user_id=account_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail={'error': 'invalid_allocation', 'message': str(exc)}) from exc
    except BackendAuthError as exc:
        raise HTTPException(status_code=401, detail={'error': 'invalid_pat', 'message': 'Publication requires valid credentials'}) from exc
    except BackendUnavailableError as exc:
        raise HTTPException(status_code=503, detail={'error': 'backend_unavailable', 'message': 'Publication requires the complete task forest'}) from exc
    except BackendConfigError as exc:
        raise HTTPException(status_code=500, detail={'error': 'backend_misconfigured', 'message': 'Task source configuration is invalid'}) from exc
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
    account_id = get_session_context_from_request(request)['account_id']
    iteration_repo = resolve_service(request, 'iteration_repository')
    try:
        iteration_sets = {}
        if hasattr(iteration_repo, 'list_iteration_sets'):
            iteration_sets = await asyncio.to_thread(
                iteration_repo.list_iteration_sets,
                user_id=account_id,
            )
    except ValueError as e:
        raise HTTPException(status_code=400, detail={'error': 'missing_config', 'message': str(e)})
    except Exception as e:
        logger.exception('Failed to fetch iterations: %s', e)
        raise HTTPException(status_code=500, detail="Internal server error")

    return {
        'iterationSetsById': iteration_sets,
    }


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
        logger.debug("Fetching task history")

        credential, account_id = _get_credential(request)
        if resolve_service(request, 'backend').is_remote and credential is None:
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
            user_id=account_id,
            team_id=team_id,
            plan_id=plan_id,
            since=since,
            until=until,
            page=page,
            per_page=per_page,
            credential=credential,
        )

        logger.debug("Returning %d tasks with history", len(result.get('tasks', [])))
        return result

    except HTTPException:
        raise
