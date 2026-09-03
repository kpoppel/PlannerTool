"""Admin user management and cache route handlers.

Covers: users (GET/POST) and cache invalidation/cleanup.
"""
import asyncio

from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError
import logging

from planner_lib.middleware import require_admin_session
from planner_lib.services.resolver import resolve_service
from planner_lib.middleware.session import get_session_id_from_request as _get_session_id_or_raise
from planner_lib.accounts.config import _is_valid_email, AccountCredentialsPayload
from planner_lib.accounts.constants import AccountPermissions

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get('/admin/v1/users')
@require_admin_session
async def admin_get_users(request: Request):
    """Return account summaries and the current account's anonymous ID."""
    try:
        current_email = None
        try:
            sid = _get_session_id_or_raise(request)
            session_mgr = resolve_service(request, 'session_manager')
            ctx = session_mgr.get(sid) or {}
            current_email = ctx.get('email')
        except Exception:
            pass

        account_manager = resolve_service(request, 'account_manager')
        resp = {'accounts': account_manager.list_accounts()}
        if current_email:
            resp['currentId'] = account_manager.get_account_id(current_email)
        return resp
    except Exception as e:
        logger.exception('Failed to list users/admins: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


def _get_current_email(request: Request) -> str:
    sid = _get_session_id_or_raise(request)
    session_manager = resolve_service(request, 'session_manager')
    context = session_manager.get(sid)
    email = context.get('email')
    if not email:
        raise HTTPException(status_code=401, detail='Session account is missing')
    return email


def _validate_permissions(value) -> list[str]:
    if not isinstance(value, list) or any(item != AccountPermissions.ADMIN for item in value):
        raise HTTPException(
            status_code=400,
            detail={'error': 'invalid_payload', 'message': 'Unsupported permissions'},
        )
    return list(dict.fromkeys(value))


@router.post('/admin/v1/users')
@require_admin_session
async def admin_create_user(request: Request):
    """Create one account with an explicit initial permission set."""
    try:
        payload = await request.json()
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Expected JSON object'})
        credentials = AccountCredentialsPayload(email=payload.get('email'), pat=None)
        if not _is_valid_email(credentials.email):
            raise HTTPException(status_code=400, detail={'error': 'invalid_email', 'message': 'Invalid email'})
        permissions = _validate_permissions(payload.get('permissions', []))
        account_manager = resolve_service(request, 'account_manager')
        account_manager.create_account(credentials, permissions)
        logger.info('Admin %s created account %s with permissions %s', _get_current_email(request), credentials.email, permissions)
        return {'ok': True}
    except ValidationError as error:
        raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': str(error)})
    except ValueError as error:
        raise HTTPException(status_code=409, detail={'error': 'account_exists', 'message': str(error)})
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to create user: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.put('/admin/v1/users/{account_id}/permissions')
@require_admin_session
async def admin_set_user_permissions(account_id: str, request: Request):
    """Replace one account's permissions."""
    try:
        payload = await request.json()
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Expected JSON object'})
        permissions = _validate_permissions(payload.get('permissions'))
        actor = _get_current_email(request)
        account_manager = resolve_service(request, 'account_manager')
        target = account_manager.get_account_by_id(account_id)
        if target['email'] == actor and AccountPermissions.ADMIN not in permissions:
            raise HTTPException(status_code=400, detail={'error': 'forbidden', 'message': 'Cannot remove current admin'})
        previous_permissions = target['permissions']
        removing_admin = (
            AccountPermissions.ADMIN in previous_permissions
            and AccountPermissions.ADMIN not in permissions
        )
        if removing_admin and account_manager.count_all_with_permission(AccountPermissions.ADMIN) == 1:
            raise HTTPException(status_code=400, detail={'error': 'forbidden', 'message': 'Cannot remove final admin'})
        account_manager.set_permissions(account_id, permissions)
        logger.info(
            'Admin %s changed account %s permissions from %s to %s',
            actor,
            target['email'],
            previous_permissions,
            permissions,
        )
        return {'ok': True}
    except HTTPException:
        raise
    except KeyError:
        raise HTTPException(status_code=404, detail={'error': 'account_not_found', 'message': 'Account not found'})
    except Exception as e:
        logger.exception('Failed to update user permissions: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.delete('/admin/v1/users/{account_id}')
@require_admin_session
async def admin_delete_user(account_id: str, request: Request):
    """Delete one account while protecting the authenticated administrator."""
    try:
        actor = _get_current_email(request)
        account_manager = resolve_service(request, 'account_manager')
        target = account_manager.get_account_by_id(account_id)
        if target['email'] == actor:
            raise HTTPException(status_code=400, detail={'error': 'forbidden', 'message': 'Cannot remove current admin user account'})
        permissions = target['permissions']
        if (
            AccountPermissions.ADMIN in permissions
            and account_manager.count_all_with_permission(AccountPermissions.ADMIN) == 1
        ):
            raise HTTPException(status_code=400, detail={'error': 'forbidden', 'message': 'Cannot remove final admin'})
        account_manager.delete_account(account_id)
        logger.info('Admin %s deleted account %s with permissions %s', actor, target['email'], permissions)
        return {'ok': True}
    except HTTPException:
        raise
    except KeyError:
        raise HTTPException(status_code=404, detail={'error': 'account_not_found', 'message': 'Account not found'})
    except Exception as e:
        logger.exception('Failed to delete user: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


# ---------------------------------------------------------------------------
# Cache management
# ---------------------------------------------------------------------------

@router.post('/admin/v1/cache/invalidate')
@require_admin_session
async def admin_cache_invalidate(request: Request):
    """Invalidate all caches via CacheCoordinator."""
    logger.info('Cache invalidation requested')
    try:
        coordinator = resolve_service(request, 'cache_coordinator')
        result = await asyncio.to_thread(coordinator.invalidate_all)
        logger.info('Cache invalidation completed: %s', result)
        return result
    except Exception as e:
        logger.exception('Failed to invalidate caches: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/cache/cleanup')
@require_admin_session
async def admin_cache_cleanup(request: Request):
    """Remove orphaned cache index entries."""
    logger.info('Cache cleanup requested')
    try:
        azure_svc = resolve_service(request, 'azure_client')
        result = await asyncio.to_thread(azure_svc.cleanup_orphaned_cache_keys)
        logger.info('Cache cleanup completed: %s', result)
        return result
    except Exception as e:
        logger.exception('Failed to cleanup cache: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')
