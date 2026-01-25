from typing import Callable, Optional
import functools
from fastapi import HTTPException
from starlette.requests import Request

from planner_lib.services.resolver import resolve_service
from .session import get_session_id_from_request


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
                raise HTTPException(status_code=401, detail={'error': 'access_denied', 'message': '100 - Admin access required.'})
            raise

        # Resolve session to retrieve email
        session_mgr = resolve_service(request, 'session_manager')
        ctx = session_mgr.get(sid) or {}
        email = ctx.get('email')
        if not email:
            raise HTTPException(status_code=401, detail={'error': 'access_denied', 'message': '200 - Admin access required.'})

        # Check admin storage presence under data/accounts_admin/<email>
        storage = resolve_service(request, 'account_storage')
        try:
            is_admin = storage.exists('accounts_admin', email)
        except Exception:
            is_admin = False

        if not is_admin:
            raise HTTPException(status_code=401, detail={'error': 'access_denied', 'message': '300 - Admin access required.'})

        return await func(*args, **kwargs)

    try:
        import inspect

        wrapper.__signature__ = inspect.signature(func)  # preserve signature for FastAPI
    except Exception:
        pass

    return wrapper
