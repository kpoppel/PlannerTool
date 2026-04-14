"""Admin user management and cache route handlers.

Covers: users (GET/POST) and cache invalidation/cleanup.
"""
from fastapi import APIRouter, HTTPException, Request
import logging

from planner_lib.middleware import require_admin_session
from planner_lib.services.resolver import resolve_service
from planner_lib.middleware.session import get_session_id_from_request as _get_session_id_or_raise

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get('/admin/v1/users')
@require_admin_session
async def admin_get_users(request: Request):
    """Return ``{ users: [...], admins: [...], current: email }``."""
    try:
        admin_svc = resolve_service(request, 'admin_service')

        current_email = None
        try:
            sid = _get_session_id_or_raise(request)
            session_mgr = resolve_service(request, 'session_manager')
            ctx = session_mgr.get(sid) or {}
            current_email = ctx.get('email')
        except Exception:
            pass

        resp = {'users': admin_svc.get_all_users(), 'admins': admin_svc.get_all_admins()}
        if current_email:
            resp['current'] = current_email
        return resp
    except Exception as e:
        logger.exception('Failed to list users/admins: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/users')
@require_admin_session
async def admin_save_users(request: Request):
    """Apply a ``{ users: [...], admins: [...] }`` modification atomically.

    Guards against the current admin removing their own access.
    """
    try:
        payload = await request.json()
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Expected JSON object'})

        users = payload.get('users', []) or []
        admins = payload.get('admins', []) or []
        if not isinstance(users, list) or not isinstance(admins, list):
            raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': '`users` and `admins` must be lists'})

        admin_svc = resolve_service(request, 'admin_service')

        current_users = set(admin_svc.get_all_users())
        current_admins = set(admin_svc.get_all_admins())
        incoming_users = set(users)
        incoming_admins = set(admins)

        current_email = None
        try:
            sid = _get_session_id_or_raise(request)
            session_mgr = resolve_service(request, 'session_manager')
            ctx = session_mgr.get(sid) or {}
            current_email = ctx.get('email')
        except Exception:
            pass

        if current_email:
            if current_email in current_admins and current_email not in incoming_admins:
                raise HTTPException(status_code=400, detail={'error': 'forbidden', 'message': 'Cannot remove current admin from admin list'})
            if current_email in current_users and current_email not in incoming_users:
                raise HTTPException(status_code=400, detail={'error': 'forbidden', 'message': 'Cannot remove current admin user account'})

        admin_svc.sync_accounts_full(users, admins)
        return {'ok': True}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to save users/admins: %s', e)
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
        result = coordinator.invalidate_all()
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
        result = azure_svc.cleanup_orphaned_cache_keys()
        logger.info('Cache cleanup completed: %s', result)
        return result
    except Exception as e:
        logger.exception('Failed to cleanup cache: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')
