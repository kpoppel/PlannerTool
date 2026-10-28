from typing import Callable, Optional
import functools
from fastapi import HTTPException
from starlette.requests import Request

from planner_lib.accounts.constants import AccountPermissions
from planner_lib.services.resolver import resolve_service
from .session import get_session_id_from_request, get_session_context_from_request
import logging

logger = logging.getLogger(__name__)


def require_admin_session(func: Callable) -> Callable:
    """Require full administrator access; delegated permissions do not qualify."""
    return _require_permissions(func, ())


def require_permission(*permissions: str) -> Callable:
    """Accept any listed permission or full administrator access."""
    return lambda func: _require_permissions(func, permissions)


def has_admin_access(request: Request, *permissions: str) -> bool:
    context = get_session_context_from_request(request)
    accounts = resolve_service(request, 'account_manager')
    return any(accounts.has_permission(context['email'], permission)
               for permission in (AccountPermissions.ADMIN, *permissions))


def _require_permissions(func: Callable, permissions: tuple[str, ...]) -> Callable:

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
            get_session_id_from_request(request)
        except HTTPException as e:
            # Only translate 401 session errors; re-raise others unchanged.
            if getattr(e, 'status_code', None) == 401:
                try:
                    path = getattr(request, 'url', '')
                    logger.warning('Admin access denied (invalid session) path=%s detail=%s', path, e.detail)
                except Exception:
                    logger.warning('Admin access denied (invalid session)')
                raise HTTPException(status_code=401, detail={'error': 'access_denied', 'message': '100 - Admin access required.'})
            raise

        # Resolve session to retrieve email
        ctx = get_session_context_from_request(request)
        email = ctx.get('email')
        if not email:
            try:
                path = getattr(request, 'url', '')
                logger.warning('Admin access denied (no email in session) path=%s', path)
            except Exception:
                logger.warning('Admin access denied (no email in session)')
            raise HTTPException(status_code=401, detail={'error': 'access_denied', 'message': '200 - Admin access required.'})

        # Delegate admin membership check to the AccountManager
        is_admin = has_admin_access(request, *permissions)

        if not is_admin:
            try:
                path = getattr(request, 'url', '')
                logger.warning('Admin access denied (not admin) path=%s email=%s', path, email)
            except Exception:
                logger.warning('Admin access denied (not admin)')
            status = 403 if (resolve_service(request, 'authentication_provider') == 'entra'
                             or has_admin_access(request, *AccountPermissions.DELEGATED)) else 401
            raise HTTPException(status_code=status, detail={'error': 'access_denied', 'message': '300 - Admin access required.'})

        return await func(*args, **kwargs)

    try:
        import inspect

        wrapper.__signature__ = inspect.signature(func)  # preserve signature for FastAPI
    except Exception:
        pass

    return wrapper
