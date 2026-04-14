
from typing import Callable, Optional, Any
import functools
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import HTMLResponse, Response, JSONResponse
from starlette.requests import Request
from fastapi import HTTPException
import uuid
import logging
import threading
from pathlib import Path
import json
import os

from planner_lib.storage import StorageBackend
from planner_lib.accounts.interfaces import AccountManagerProtocol
from planner_lib.services.resolver import resolve_service

logger = logging.getLogger(__name__)

# Cookie name used by the frontend
SESSION_COOKIE = "sessionId"

# Read the 401 HTML template once at module load.  The path is resolved
# relative to this file so the server can be started from any working directory.
_MODULE_DIR = os.path.dirname(os.path.abspath(__file__))
_ERROR_PAGE_PATH = os.path.join(_MODULE_DIR, "..", "..", "www", "404.html")
try:
    with open(_ERROR_PAGE_PATH, "r", encoding="utf-8") as _f:
        _ERROR_PAGE_TEMPLATE: str = _f.read()
except FileNotFoundError:
    _ERROR_PAGE_TEMPLATE = ""


class SessionManager:
    """In-memory session manager. Thread-safe and minimal.

    Methods return None on missing sessions where convenient so callers
    can use `manager.get(sid) or {}` without try/except.
    """

    def __init__(
        self,
        account_manager: AccountManagerProtocol,
        account_storage: Optional[StorageBackend] = None,
    ) -> None:
        self._store: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._account_manager = account_manager
        # Used for admin-fallback: check accounts_admin namespace without an HTTP round-trip.
        self._account_storage = account_storage

    def create(self, email: str) -> str:
        # Ensure the account exists before creating a session. We consider
        # missing account a client error — do not create sessions for unknown
        # emails. Let account_manager.load raise KeyError if not present.
        try:
            cfg = self._account_manager.load(email)
        except KeyError:
            # If the account is not present in the primary accounts namespace
            # but an admin marker exists under `accounts_admin`, allow session
            # creation for admin users (no PAT will be set). This keeps admin
            # bootstrap working where admin markers live separately.
            if self._account_storage is not None:
                try:
                    if self._account_storage.exists('accounts_admin', email):
                        with self._lock:
                            for sid, ctx in list(self._store.items()):
                                if ctx.get('email') == email:
                                    logger.debug("Pruning existing session %s for %s", sid, email)
                                    del self._store[sid]
                            sid = uuid.uuid4().hex
                            self._store[sid] = {'email': email, 'pat': None}
                            logger.info('Session created (admin): %s by %s', sid, email)
                            return sid
                except Exception:
                    logger.debug('Admin fallback lookup failed for %s', email)
            # Caller should translate this into an HTTP 401/400; raise to
            # indicate creation is not allowed for unknown accounts.
            raise

        with self._lock:
            # prune existing sessions for this email
            for sid, ctx in list(self._store.items()):
                if ctx.get('email') == email:
                    logger.debug("Pruning existing session %s for %s", sid, email)
                    del self._store[sid]

            sid = uuid.uuid4().hex
            self._store[sid] = {
                'email': email,
                'pat': cfg.get('pat'),
            }
            logger.info('Session created: %s by %s', sid, email)
            return sid

    def get(self, sid: str) -> Optional[dict[str, Any]]:
        with self._lock:
            return self._store.get(sid)

    def exists(self, sid: str) -> bool:
        with self._lock:
            return sid in self._store

    def delete(self, sid: str) -> None:
        with self._lock:
            self._store.pop(sid, None)

    def delete_by_email(self, email: str) -> None:
        with self._lock:
            for sid, ctx in list(self._store.items()):
                if ctx.get('email') == email:
                    del self._store[sid]

    def get_val(self, sid: str, key: str) -> Optional[str]:
        with self._lock:
            ctx = self._store.get(sid)
            if not ctx:
                return None
            return ctx.get(key)

    def set_val(self, sid: str, key: str, value: Any) -> None:
        """Set a single value in the session context if the session exists.

        Silently no-ops when the session id is unknown to keep callers
        resilient (matching get_val/get semantics used elsewhere).
        """
        with self._lock:
            ctx = self._store.get(sid)
            if not ctx:
                return
            ctx[key] = value


def create_session(email: str, request: Request) -> str:
    """Create a session for `email` and return the session id.

    This will prune any existing sessions for the same email and attempt
    to load the user's PAT into the session context.

    The SessionManager is looked up from `request.app.state.container`.
    """
    mgr = resolve_service(request, 'session_manager')
    return mgr.create(email)


def get_session_id_from_request(request: Request) -> str:
    """Extract and validate a session id from the request.

    Raises HTTPException(401) on missing/invalid session.
    """
    sid = request.headers.get('X-Session-Id') or request.cookies.get(SESSION_COOKIE)
    if not sid:
        raise HTTPException(status_code=401, detail={'error': 'missing_session_id', 'message': 'Somehow you got here without a session.'})
    # Resolve session manager via centralized resolver.
    mgr = resolve_service(request, 'session_manager')
    if not mgr.exists(sid):
        raise HTTPException(status_code=401, detail={'error': 'invalid_session', 'message': 'Your session is invalid or expired.'})
    return sid


class SessionMiddleware(BaseHTTPMiddleware):
    """Middleware that converts a helper response header into a Set-Cookie.

    Route handlers may set `x-set-session-id` on the Response to instruct
    the middleware to set the session cookie centrally.
    """

    def __init__(self, app, session_manager: Optional[SessionManager] = None):
        super().__init__(app)
        # Prefer an explicitly provided manager; otherwise middleware doesn't
        # need it for dispatch but other helpers should look up app.state.
        self.session_manager = session_manager

    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)

        # If the app set our helper header, convert it into a cookie
        sid = response.headers.get('x-set-session-id')
        if sid:
            try:
                # remove helper header if present
                if 'x-set-session-id' in response.headers:
                    del response.headers['x-set-session-id']
            except Exception:
                pass
            response.set_cookie(key=SESSION_COOKIE, value=sid, path='/', httponly=True, samesite='lax')
        return response


def access_denied_response(request: Request, error_code: dict) -> Response:
    """Return an HTML 401 response for browser clients.

    FastAPI handlers still raise HTTPException(401) for API callers; this
    function is used by a global exception handler to return friendly HTML.
    """
    accept = (request.headers.get('accept') or '').lower()
    if 'application/json' in accept:
        return JSONResponse(status_code=401, content=error_code)

    if _ERROR_PAGE_TEMPLATE:
        content = _ERROR_PAGE_TEMPLATE.replace('{{ error_code }}', json.dumps(error_code))
    else:
        content = f"<html><body>401 Unauthorized</body></html>"
    return HTMLResponse(content=content, status_code=401, media_type='text/html')

def require_session(func: Callable) -> Callable:
    """Async-only decorator that ensures a valid session exists.

    Preserves the wrapped function's signature so FastAPI validation still works.
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
            error_code = {'error': 'access_denied', 'message': 'Missing or invalid session. Please create a session.'}
            raise HTTPException(status_code=401, detail=error_code,)

        # This will raise HTTPException(401) on invalid/missing session
        get_session_id_from_request(request)
        return await func(*args, **kwargs)

    try:
        import inspect

        wrapper.__signature__ = inspect.signature(func) # pyright: ignore[reportAttributeAccessIssue]
    except Exception:
        pass

    return wrapper

