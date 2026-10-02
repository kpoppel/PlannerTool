
from typing import Callable, Optional, Any
import functools
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import HTMLResponse, Response, JSONResponse
from starlette.requests import Request
from fastapi import HTTPException
import secrets
import hashlib
import logging
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit
import json
import os

from planner_lib.storage import StorageBackend
from planner_lib.accounts.interfaces import AccountManagerProtocol
from planner_lib.services.resolver import resolve_service

logger = logging.getLogger(__name__)

# Cookie name used by the frontend
SESSION_COOKIE = "sessionId"
DEVICE_COOKIE = "plannerDevice"
SESSION_IDLE = 14 * 86400
SESSION_MAX = 30 * 86400

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
    """Persist hashed session identifiers with idle and absolute expiration."""

    def __init__(
        self,
        account_manager: AccountManagerProtocol,
        storage: StorageBackend,
    ) -> None:
        self._lock = threading.Lock()
        self._account_manager = account_manager
        self._storage = storage

    def create(self, email: str, device_id: Optional[str] = None) -> str:
        account_id = self._account_manager.get_account_id(email)
        sid = secrets.token_urlsafe(32)
        now = time.time()
        self._storage.save('auth_sessions', hashlib.sha256(sid.encode()).hexdigest(), {
            'account_id': account_id,
            'device_id': device_id, 'created': now, 'last_seen': now,
        }, ttl_seconds=SESSION_MAX)
        return sid

    def get(self, sid: str) -> Optional[dict[str, Any]]:
        cache = getattr(self._storage, '_cache', None)
        with cache.transact() if cache is not None else self._lock:
            return self._get_record(sid)

    def _get_record(self, sid: str, *, refresh: bool = True) -> Optional[dict[str, Any]]:
        if not sid:
            return None
        key = hashlib.sha256(sid.encode()).hexdigest()
        if not self._storage.exists('auth_sessions', key):
            return None
        try:
            record = self._storage.load('auth_sessions', key)
        except KeyError:
            return None
        now = time.time()
        if now - record['last_seen'] > SESSION_IDLE or now - record['created'] > SESSION_MAX:
            self._storage.delete('auth_sessions', key)
            return None
        account_id = record['account_id']
        try:
            email = self._account_manager.get_account_by_id(account_id)['email']
        except KeyError:
            self._storage.delete('auth_sessions', key)
            return None
        if record['device_id'] is not None:
            try:
                auth = self._storage.load('account_auth', account_id)
            except KeyError:
                return None
            device = auth['devices'].get(record['device_id'])
            if device is None or device['expires'] <= now:
                self._storage.delete('auth_sessions', key)
                return None
            if refresh:
                device['expires'] = now + 90 * 86400
                self._storage.save('account_auth', account_id, auth)
        if refresh:
            record['last_seen'] = now
            self._storage.save('auth_sessions', key, record, ttl_seconds=SESSION_MAX - (now - record['created']))
        return {'account_id': account_id, 'email': email, 'device_id': record['device_id']}

    def is_valid(self, sid: str) -> bool:
        cache = getattr(self._storage, '_cache', None)
        with cache.transact() if cache is not None else self._lock:
            return self._get_record(sid, refresh=False) is not None

    def delete(self, sid: str) -> None:
        key = hashlib.sha256(sid.encode()).hexdigest()
        if self._storage.exists('auth_sessions', key):
            self._storage.delete('auth_sessions', key)

    def delete_by_account_id(self, account_id: str) -> None:
        for key in list(self._storage.list_keys('auth_sessions')):
            try:
                record = self._storage.load('auth_sessions', key)
            except KeyError:
                continue
            if record['account_id'] == account_id:
                self._storage.delete('auth_sessions', key)

def get_session_context_from_request(request: Request) -> dict[str, Any]:
    """Validate and resolve identity once for this request, without credentials."""
    sid = request.cookies.get(SESSION_COOKIE)
    if not sid:
        raise HTTPException(status_code=401, detail={'error': 'missing_session_id', 'message': 'Somehow you got here without a session.'})
    cached = getattr(request, '_planner_session', None)
    if cached is not None and cached[0] == sid:
        return cached[1]
    mgr = resolve_service(request, 'session_manager')
    context = mgr.get(sid)
    if context is None:
        raise HTTPException(status_code=401, detail={'error': 'invalid_session', 'message': 'Your session is invalid or expired.'})
    setattr(request, '_planner_session', (sid, context))
    return context


def get_session_credentials_from_request(request: Request) -> dict[str, Any]:
    """Read current account credentials once, isolated to this request's session."""
    context = get_session_context_from_request(request)
    sid = request.cookies[SESSION_COOKIE]
    cached = getattr(request, '_planner_credentials', None)
    if cached is not None and cached[0] == sid:
        return cached[1]
    accounts = resolve_service(request, 'account_manager')
    credentials = {**context, 'pat': accounts.load(context['email'])['pat']}
    setattr(request, '_planner_credentials', (sid, credentials))
    return credentials


def get_session_id_from_request(request: Request) -> str:
    """Extract and validate a cookie session, reusing this request's context."""
    get_session_context_from_request(request)
    return request.cookies[SESSION_COOKIE]


class SessionMiddleware(BaseHTTPMiddleware):
    """Middleware that converts a helper response header into a Set-Cookie.

    Route handlers may set `x-set-session-id` on the Response; the required
    session manager validates existing cookies and refreshes them centrally.
    """

    def __init__(self, app, session_manager: SessionManager):
        super().__init__(app)
        self.session_manager = session_manager

    async def dispatch(self, request: Request, call_next):
        if request.method == 'POST' and request.url.path.endswith((
            '/auth/enroll', '/auth/enrollment-status', '/auth/delete-account',
        )):
            identity = request.client.host if request.client else 'unknown'
            try:
                auth = resolve_service(request, 'auth_manager')
                auth.throttle(identity, limit=300)
                try:
                    payload = await request.json()
                except ValueError:
                    return JSONResponse(status_code=400, content={'error': 'invalid_json'})
                if isinstance(payload, dict) and isinstance(payload.get('email'), str):
                    auth.throttle(identity + ':' + payload['email'])
            except PermissionError:
                return JSONResponse(status_code=429, content={'error': 'too_many_attempts'},
                                    headers={'Retry-After': '600'})
        if request.method not in ('GET', 'HEAD', 'OPTIONS'):
            origin = request.headers.get('origin')
            if request.headers.get('sec-fetch-site') == 'cross-site' or (
                origin and urlsplit(origin).netloc != request.url.netloc
            ):
                return JSONResponse(status_code=403, content={'error': 'cross_origin_request'})
        path = request.scope.get('root_path', '').rstrip('/') + '/'
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
            response.set_cookie(key=SESSION_COOKIE, value=sid, path=path, httponly=True,
                                samesite='lax', secure=request.url.scheme == 'https',
                                max_age=SESSION_IDLE)
        elif request.cookies.get(SESSION_COOKIE) and self.session_manager.is_valid(request.cookies[SESSION_COOKIE]):
            response.set_cookie(SESSION_COOKIE, request.cookies[SESSION_COOKIE], path=path,
                                httponly=True, samesite='lax', max_age=SESSION_IDLE,
                                secure=request.url.scheme == 'https')
            device = request.cookies.get(DEVICE_COOKIE)
            if device:
                response.set_cookie(DEVICE_COOKIE, device, path=path, httponly=True,
                                    samesite='lax', max_age=90 * 86400,
                                    secure=request.url.scheme == 'https')
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

