"""Authenticated canonical workforce editing; never activates a migration."""
from collections.abc import Callable
import json
import logging
from typing import Any, cast

from fastapi import APIRouter, HTTPException, Request

from planner_lib.admin.workforce_config import (
    DefinitionKind, WorkforceConfigManager, WorkforceConflictError, WorkforceSnapshot,
    WorkforceUnavailableError,
)
from planner_lib.admin.workforce_deletion import TeamDeletionReview
from planner_lib.admin.workforce_transfer import MAX_TRANSFER_BYTES
from planner_lib.middleware import require_admin_session
from planner_lib.middleware.admin import has_admin_access, require_permission
from planner_lib.accounts.constants import AccountPermissions
from planner_lib.services.resolver import resolve_service


router = APIRouter()
logger = logging.getLogger(__name__)


async def _payload(request: Request, required: set[str], optional: set[str]) -> dict[str, Any]:
    try:
        payload = await request.json()
    except ValueError as error:
        raise HTTPException(400, detail={
            'error': 'invalid_payload', 'message': 'Expecting a JSON object',
        }) from error
    if not isinstance(payload, dict) or required - payload.keys() or (
        payload.keys() - required - optional
    ):
        raise HTTPException(400, detail={
            'error': 'invalid_payload', 'message': 'Unexpected or missing workforce payload fields',
        })
    if not isinstance(payload['revision'], str) or not payload['revision'].strip():
        raise HTTPException(400, detail={
            'error': 'invalid_payload', 'message': 'A configuration revision is required',
        })
    for field in required - {'revision'}:
        if not isinstance(payload[field], dict):
            raise HTTPException(400, detail={
                'error': 'invalid_payload', 'message': f'{field} must be an object',
            })
    return payload


def _execute(
    request: Request, operation: str,
    action: Callable[[], WorkforceSnapshot | TeamDeletionReview | dict[str, Any]],
    *, mutation: bool,
) -> dict[str, Any]:
    try:
        snapshot = action()
    except WorkforceUnavailableError as error:
        raise HTTPException(409, detail={
            'error': 'workforce_not_migrated', 'message': str(error),
        }) from error
    except WorkforceConflictError as error:
        raise HTTPException(409, detail={
            'error': 'workforce_conflict', 'message': str(error),
        }) from error
    except ValueError as error:
        raise HTTPException(422, detail={
            'error': 'invalid_workforce', 'message': str(error),
        }) from error
    except Exception as error:
        logger.exception('Workforce %s failed', operation)
        raise HTTPException(500, detail='Internal server error') from error
    response: dict[str, Any] = {'content': snapshot}
    if mutation:
        response['ok'] = True
        try:
            resolve_service(request, 'cost_service').invalidate_cache()
        except Exception:
            logger.exception('Cost cache invalidation failed after committed workforce %s', operation)
            response['warnings'] = [{
                'error': 'cost_cache_invalidation_failed',
                'message': 'Configuration saved, but cost cache refresh failed',
            }]
    return response


@router.get('/admin/v1/workforce')
@require_permission(AccountPermissions.MANAGE_WORKFORCE_TEAMS, AccountPermissions.MANAGE_WORKFORCE_COSTS,
                    AccountPermissions.MANAGE_PROJECTS)
async def admin_get_workforce(request: Request) -> dict[str, Any]:
    """Return the canonical editing snapshot for an authorized administrator."""
    service = resolve_service(request, 'admin_service')
    return _execute(request, 'read', service.get_workforce_snapshot, mutation=False)


@router.post('/admin/v1/workforce')
@require_permission(AccountPermissions.MANAGE_WORKFORCE_TEAMS, AccountPermissions.MANAGE_WORKFORCE_COSTS)
async def admin_save_workforce(request: Request) -> dict[str, Any]:
    """Save paired team/workforce edits with server-enforced lifecycle validation."""
    payload = await _payload(request, {'revision', 'teams', 'workforce'}, set())
    service = resolve_service(request, 'admin_service')
    current = _execute(request, 'read', service.get_workforce_snapshot, mutation=False)['content']
    if not has_admin_access(request, AccountPermissions.MANAGE_WORKFORCE_TEAMS):
        if payload['teams'] != current['teams'] or (
            payload['workforce'].get('staffing') != current['workforce']['staffing']
        ):
            raise HTTPException(403, detail='Workforce team permission required')
    if not has_admin_access(request, AccountPermissions.MANAGE_WORKFORCE_COSTS):
        if payload['workforce'].get('suppliers') != current['workforce']['suppliers']:
            raise HTTPException(403, detail='Workforce cost permission required')
    return _execute(request, 'save', lambda: service.save_workforce_configuration(
        payload['teams'], payload['workforce'], payload['revision'],
    ), mutation=True)


async def _transfer_payload(request: Request, *, commit: bool) -> dict[str, Any]:
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 3 * MAX_TRANSFER_BYTES:
            raise HTTPException(413, detail={'message': 'Workforce import request is too large'})
    try:
        payload = json.loads(body)
    except (ValueError, UnicodeDecodeError) as error:
        raise HTTPException(400, detail={'message': 'Expecting a JSON object'}) from error
    fields = {'source', 'decisions'}
    if commit:
        fields.update({'revision', 'review_revision'})
    if not isinstance(payload, dict) or payload.keys() != fields:
        raise HTTPException(400, detail={'message': 'Unexpected or missing workforce transfer fields'})
    if not isinstance(payload['source'], str) or not isinstance(payload['decisions'], dict):
        raise HTTPException(400, detail={'message': 'A YAML source and decision object are required'})
    if commit and any(not isinstance(payload[key], str) or not payload[key].strip()
                      for key in ('revision', 'review_revision')):
        raise HTTPException(400, detail={'message': 'Configuration and review revisions are required'})
    return payload


@router.get('/admin/v1/workforce/export')
@require_admin_session
async def admin_export_workforce(request: Request) -> dict[str, Any]:
    service = resolve_service(request, 'admin_service')
    response = _execute(request, 'export', service.export_workforce, mutation=False)
    return response


@router.post('/admin/v1/workforce/import/preview')
@require_admin_session
async def admin_preview_workforce_import(request: Request) -> dict[str, Any]:
    payload = await _transfer_payload(request, commit=False)
    service = resolve_service(request, 'admin_service')
    return _execute(request, 'import preview', lambda: service.preview_workforce_import(
        payload['source'], payload['decisions'],
    ), mutation=False)


@router.post('/admin/v1/workforce/import')
@require_admin_session
async def admin_import_workforce(request: Request) -> dict[str, Any]:
    payload = await _transfer_payload(request, commit=True)
    service = resolve_service(request, 'admin_service')
    return _execute(request, 'import', lambda: service.import_workforce(
        payload['source'], payload['decisions'], payload['revision'], payload['review_revision'],
    ), mutation=True)


@router.post('/admin/v1/workforce/definitions/{kind}')
@require_permission(AccountPermissions.MANAGE_WORKFORCE_TEAMS, AccountPermissions.MANAGE_WORKFORCE_COSTS)
async def admin_create_workforce_definition(request: Request, kind: str) -> dict[str, Any]:
    """Create one server-issued identity without accepting client-owned identity fields."""
    if kind not in WorkforceConfigManager.CREATE_FIELDS:
        raise HTTPException(400, detail={
            'error': 'invalid_payload', 'message': 'Unknown workforce definition kind',
        })
    permission = (AccountPermissions.MANAGE_WORKFORCE_COSTS if kind in ('supplier', 'profile')
                  else AccountPermissions.MANAGE_WORKFORCE_TEAMS)
    if not has_admin_access(request, permission):
        raise HTTPException(403, detail='Workforce definition permission required')
    optional = {'supplier_id'} if kind == 'profile' else set()
    payload = await _payload(request, {'revision', 'fields'}, optional)
    supplier_id = payload.get('supplier_id')
    if supplier_id is not None and (
        not isinstance(supplier_id, str) or not supplier_id.strip()
    ):
        raise HTTPException(400, detail={
            'error': 'invalid_payload', 'message': 'supplier_id must be a nonempty string',
        })
    service = resolve_service(request, 'admin_service')
    return _execute(request, 'create', lambda: service.create_workforce_definition(
        cast(DefinitionKind, kind), payload['fields'], payload['revision'], supplier_id=supplier_id,
    ), mutation=True)


@router.get('/admin/v1/workforce/teams/{team_id:path}/deletion')
@require_permission(AccountPermissions.MANAGE_WORKFORCE_TEAMS)
async def admin_review_workforce_team_deletion(request: Request, team_id: str) -> dict[str, Any]:
    """Show known impact and a fresh confirmation receipt without contacting ADO."""
    service = resolve_service(request, 'admin_service')
    task_storage = resolve_service(request, 'remote_cache_storage')
    return _execute(request, 'deletion review', lambda: service.review_workforce_team_deletion(
        team_id, task_storage=task_storage,
    ), mutation=False)


@router.post('/admin/v1/workforce/teams/{team_id:path}/deletion')
@require_permission(AccountPermissions.MANAGE_WORKFORCE_TEAMS)
async def admin_delete_workforce_team(request: Request, team_id: str) -> dict[str, Any]:
    """Delete only after explicit acknowledgement of the freshly reviewed impact."""
    payload = await _payload(request, {'revision', 'confirmation'}, set())
    confirmation = payload['confirmation']
    if confirmation.keys() != {'acknowledged', 'review_revision'} or (
        not isinstance(confirmation['review_revision'], str) or not confirmation['review_revision'].strip()
    ):
        raise HTTPException(400, detail={
            'error': 'invalid_payload', 'message': 'Explicit acknowledgement and review revision are required',
        })
    service = resolve_service(request, 'admin_service')
    task_storage = resolve_service(request, 'remote_cache_storage')
    return _execute(request, 'team deletion', lambda: service.delete_workforce_team(
        team_id, payload['revision'], acknowledged=confirmation['acknowledged'],
        review_revision=confirmation['review_revision'], task_storage=task_storage,
    ), mutation=True)