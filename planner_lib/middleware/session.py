
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

#from planner_lib.config.config import account_manager
from planner_lib.storage import StorageBackend
from planner_lib.accounts.interfaces import AccountManagerProtocol
from planner_lib.accounts import config as accounts_config_mod
from planner_lib.services.resolver import resolve_service

logger = logging.getLogger(__name__)

# Cookie name used by the frontend
SESSION_COOKIE = "sessionId"


class SessionManager:
    """In-memory session manager. Thread-safe and minimal.

    Methods return None on missing sessions where convenient so callers
    can use `manager.get(sid) or {}` without try/except.
    """

    def __init__(self, session_storage: StorageBackend, account_manager: AccountManagerProtocol) -> None:
        # TODO: Make session_storage as injected storage backend. Make an in-memory backend?
        self._store: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._account_manager = account_manager
    def create(self, email: str, request: Optional[Request] = None) -> str:
        # Ensure the account exists before creating a session. We consider
        # missing account a client error — do not create sessions for unknown
        # emails. Let account_manager.load raise KeyError if not present.
        try:
            # Prefer a test-injected module-level storage when present so tests
            # that set `planner_lib.accounts.config._storage` are honored.
            test_store = getattr(accounts_config_mod, '_storage', None)
            if test_store is not None:
                mgr = AccountManager(account_storage=test_store)
                cfg = mgr.load(email)
            else:
                cfg = self._account_manager.load(email)
        except KeyError:
            # If the account is not present in the primary accounts namespace
            # but an admin marker exists under `accounts_admin`, allow session
            # creation for admin users (no PAT will be set). This keeps admin
            # bootstrap working where admin markers live separately.
            if request is not None:
                try:
                    admin_svc = resolve_service(request, 'admin_service')
                    if admin_svc and getattr(admin_svc, 'is_admin', lambda e: False)(email):
                        # Create a session context without a PAT.
                        with self._lock:
                            for sid, ctx in list(self._store.items()):
                                if ctx.get('email') == email:
                                    logger.debug("Pruning existing session %s for %s", sid, email)
                                    del self._store[sid]

                            sid = uuid.uuid4().hex
                            ctx: dict[str, Any] = {
                                'email': email,
                                'pat': None,
                            }

                            self._store[sid] = ctx
                            return sid
                except Exception:
                    logger.debug('Admin fallback lookup failed')
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
            ctx: dict[str, Any] = {
                'email': email,
                'pat': cfg.get('pat'),
            }

            self._store[sid] = ctx
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


def create_session(email: str, request: Request) -> str:
    """Create a session for `email` and return the session id.

    This will prune any existing sessions for the same email and attempt
    to load the user's PAT into the session context.

    The SessionManager is looked up from `request.app.state.session_manager`.
    """
    # Use the centralized resolver which prefers an explicit
    # `app.state.session_manager` override (tests may set this),
    # otherwise falls back to the application container.
    mgr = resolve_service(request, 'session_manager')
    # Pass the request through so session manager can consult other
    # services (e.g., `admin_service`) when deciding whether to allow
    # session creation for emails not present in the primary accounts.
    return mgr.create(email, request=request)


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
    # Prefer JSON for API clients and HTML for browser-based UI. Heuristics:
    # - If the request Accept header prefers JSON, return JSON
    # - If the path looks like an API route (starts with /api), return JSON
    # - Otherwise return HTML
    accept = (request.headers.get('accept') or '').lower()
    path = (request.url.path or '')
    if 'application/json' in accept:# or path.startswith('/api'):
        return JSONResponse(status_code=401, content=error_code)

    path = Path('www/404.html')
    content = path.read_text(encoding='utf-8')
    content = content.replace('{{ error_code }}', json.dumps(error_code))
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

