from typing import Callable, Optional
import functools
from fastapi import HTTPException
from starlette.requests import Request

from planner_lib.services.resolver import resolve_service
from .session import get_session_id_from_request
import logging

logger = logging.getLogger(__name__)


def require_admin_session(func: Callable) -> Callable:
    """Decorator that ensures the caller has a valid session and that the
    associated account is present under `data/config/admin/`.

    This raises HTTP 401 for missing/invalid session (delegated to
    `get_session_id_from_request`) and HTTP 401 when the session is valid
    but the account is not listed as an admin so the application's
    401 handler produces the same `access_denied_response` as for regular
    user sessions.
    """

    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        request: Optional[Request] = None
        for a in args:
            if isinstance(a, Request):
                request = a
                break
        if not request:
            request = kwargs.get('request')
        if not request:
            logger.warning('Admin access denied: missing request')
            raise HTTPException(status_code=401, detail={'error': 'access_denied', 'message': 'Missing request.'})

        # Validate session (raises 401 on missing/invalid session).
        # If session validation fails, translate the error into a
        # generic admin access-denied message so callers see a consistent
        # `access_denied` payload instead of the lower-level session error.
        try:
            sid = get_session_id_from_request(request)
        except HTTPException as e:
            # Only translate 401 session errors; re-raise others unchanged.
            if getattr(e, 'status_code', None) == 401:
                try:
                    path = getattr(request, 'url', '')
                    sid = request.headers.get('X-Session-Id') or request.cookies.get('sessionId')
                    logger.warning('Admin access denied (invalid session) path=%s sid=%s detail=%s', path, sid, e.detail)
                except Exception:
                    logger.warning('Admin access denied (invalid session)')
                raise HTTPException(status_code=401, detail={'error': 'access_denied', 'message': '100 - Admin access required.'})
            raise

        # Resolve session to retrieve email
        session_mgr = resolve_service(request, 'session_manager')
        ctx = session_mgr.get(sid) or {}
        email = ctx.get('email')
        if not email:
            try:
                path = getattr(request, 'url', '')
                logger.warning('Admin access denied (no email in session) path=%s sid=%s', path, sid)
            except Exception:
                logger.warning('Admin access denied (no email in session)')
            raise HTTPException(status_code=401, detail={'error': 'access_denied', 'message': '200 - Admin access required.'})

        # Delegate admin membership check to the AdminService which was
        # constructed with the pickle-backed account storage.
        try:
            admin_svc = resolve_service(request, 'admin_service')
            is_admin = admin_svc.is_admin(email)
        except Exception:
            is_admin = False

        if not is_admin:
            try:
                path = getattr(request, 'url', '')
                logger.warning('Admin access denied (not admin) path=%s email=%s', path, email)
            except Exception:
                logger.warning('Admin access denied (not admin)')
            raise HTTPException(status_code=401, detail={'error': 'access_denied', 'message': '300 - Admin access required.'})

        return await func(*args, **kwargs)

    try:
        import inspect

        wrapper.__signature__ = inspect.signature(func)  # preserve signature for FastAPI
    except Exception:
        pass

    return wrapper
