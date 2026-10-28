
from typing import Callable, Optional, Any
from contextvars import ContextVar
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
from planner_lib.backend.port import BackendCredential
from planner_lib.services.resolver import resolve_service
from planner_lib.session.enrollment import EnrollmentSessionBinding

logger = logging.getLogger(__name__)

# Cookie name used by the frontend
SESSION_COOKIE = "sessionId"
DEVICE_COOKIE = "plannerDevice"
SESSION_IDLE = 14 * 86400
SESSION_MAX = 30 * 86400
current_session_context = ContextVar('planner_session_context', default=None)

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
        session_binding_factory=EnrollmentSessionBinding,
        auth_policy=None,
    ) -> None:
        self._lock = threading.Lock()
        self._account_manager = account_manager
        self._storage = storage
        self._session_binding = session_binding_factory(storage)
        from planner_lib.session.policy import SessionPolicy
        self._auth_policy = SessionPolicy() if auth_policy is None else auth_policy

    @property
    def authentication_source(self):
        return self._auth_policy.current()['active']

    def create(self, email: str, device_id: Optional[str] = None, *, source='enrollment', binding=None) -> str:
        account_id = self._account_manager.get_account_id(email)
        policy = self._auth_policy.current()
        if source != policy['active']:
            raise PermissionError('Inactive authentication source')
        sid = secrets.token_urlsafe(32)
        now = time.time()
        self._storage.save('auth_sessions', hashlib.sha256(sid.encode()).hexdigest(), {
            'account_id': account_id,
            'device_id': device_id, 'created': now, 'last_seen': now,
            'source': source, 'epoch': policy['epoch'], 'authenticated_at': now,
            'binding': device_id if source == 'enrollment' else binding,
        }, ttl_seconds=SESSION_MAX)
        self._record_activity(account_id, now)
        return sid

    def _record_activity(self, account_id: str, now: float) -> None:
        if self._storage.exists('account_activity', account_id):
            previous = self._storage.load('account_activity', account_id)['last_active']
            if now - previous < 60:
                return
        self._storage.save('account_activity', account_id, {'last_active': now})

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
        policy = self._auth_policy.current()
        if (record.get('source') != policy['active'] or record.get('epoch') != policy['epoch']
                or record.get('source') not in ('enrollment', 'entra')):
            self._storage.delete('auth_sessions', key)
            return None
        if now - record['last_seen'] > SESSION_IDLE or now - record['created'] > SESSION_MAX:
            self._storage.delete('auth_sessions', key)
            return None
        account_id = record['account_id']
        try:
            email = self._account_manager.get_account_by_id(account_id)['email']
        except KeyError:
            self._storage.delete('auth_sessions', key)
            return None
        if record['source'] == 'enrollment':
            try:
                valid_binding = self._session_binding.validate(
                    account_id, record['device_id'], now, refresh=refresh,
                )
            except KeyError:
                return None
            if not valid_binding:
                self._storage.delete('auth_sessions', key)
                return None
        else:
            binding = record.get('binding')
            if (not isinstance(binding, str) or not self._storage.exists('auth_grants', binding)):
                self._storage.delete('auth_sessions', key)
                return None
            grant = self._storage.load('auth_grants', binding)
            if (grant['account_id'] != account_id or grant['epoch'] != policy['epoch']
                    or grant['expires_at'] <= now or grant['revoked']):
                self._storage.delete('auth_sessions', key)
                return None
        if refresh:
            record['last_seen'] = now
            self._storage.save('auth_sessions', key, record, ttl_seconds=SESSION_MAX - (now - record['created']))
            self._record_activity(account_id, now)
        context = {'account_id': account_id, 'email': email, 'device_id': record['device_id']}
        if record['source'] == 'entra':
            context['binding'] = record['binding']
        return context

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
    cached = getattr(request.state, '_planner_session', None)
    if cached is not None and cached[0] == sid:
        current_session_context.set(cached[1])
        return cached[1]
    mgr = resolve_service(request, 'session_manager')
    context = mgr.get(sid)
    if context is None:
        raise HTTPException(status_code=401, detail={'error': 'invalid_session', 'message': 'Your session is invalid or expired.'})
    request.state._planner_session = (sid, context)
    current_session_context.set(context)
    return context


def get_session_credential_from_request(
    request: Request, *, backend=None, acquire: bool = True,
) -> Optional[BackendCredential]:
    """Resolve the authenticated UUID's credential once within this request."""
    context = get_session_context_from_request(request)
    if backend is not None and not backend.is_remote:
        return None
    sid = request.cookies.get(SESSION_COOKIE)
    cached = getattr(request.state, '_planner_credential', None)
    if cached is not None and cached[0] == sid:
        return cached[1]
    if not acquire:
        return None

    provider = resolve_service(request, 'credential_provider')
    credential = provider.get_credential(context['account_id'])

    request.state._planner_credential = (sid, credential)
    return credential


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
        token = current_session_context.set(None)
        try:
            return await self._dispatch(request, call_next)
        finally:
            current_session_context.reset(token)

    async def _dispatch(self, request: Request, call_next):
        route_path = request.url.path.removeprefix(request.scope.get('root_path', ''))
        if route_path.startswith('/api/auth/login/') and request.method == 'POST':
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 16384:
                    return JSONResponse({'error': 'invalid_session'}, status_code=401)
            request._body = bytes(body)
        if self.session_manager.authentication_source == 'entra':
            forbidden = route_path in {
                '/api/session', '/api/auth/enroll', '/api/auth/enrollment-status',
                '/api/auth/delete-account',
            } or route_path.startswith(('/api/auth/admin-reset/', '/api/auth/devices/')) or (
                request.method == 'POST' and route_path in {'/api/config', '/admin/v1/users'})
            if forbidden:
                return JSONResponse({'error': 'access_denied'}, status_code=403)
        if request.method == 'POST' and request.url.path.endswith((
            '/auth/enroll', '/auth/enrollment-status', '/auth/delete-account',
        )):
            identity = request.client.host if request.client else 'unknown'
            try:
                auth = resolve_service(request, 'login_adapter')
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
        route_path = request.url.path.removeprefix(request.scope.get('root_path', ''))
        credential_routes = {
            '/api/auth/config', '/api/auth/login/begin', '/api/auth/login/complete', '/api/auth/login/callback',
            '/api/auth/sandbox', '/api/auth/login/redirect', '/api/auth/sandbox/logout',
            '/api/auth/settings',
            '/api/config', '/api/session', '/api/auth/me', '/api/auth/logout',
            '/api/auth/release-notes',
            '/api/auth/enroll', '/api/auth/enrollment-status', '/api/auth/delete-account',
        }
        local_admin_config_routes = {
            '/admin/check', '/admin/v1/ado', '/admin/v1/events-config',
            '/admin/v1/groups-config', '/admin/v1/system',
        }
        local_record_route = (
            route_path in {'/api/view', '/api/scenario', '/api/groups'}
            or route_path.startswith('/api/groups/')
        )
        event_route = (
            route_path in {'/api/events', '/api/event-categories'}
            or route_path.startswith(('/api/events/', '/api/event-categories/'))
        )
        if event_route and request.cookies.get(SESSION_COOKIE):
            local_record_route = not resolve_service(request, 'event_repository').requires_credential
        cached_or_local_read_routes = {
            '/api/teams', '/api/projects', '/api/tasks', '/api/markers',
            '/api/iterations', '/api/history/tasks', '/api/cost', '/api/cost/teams',
            '/api/cache/load', '/api/cache/metrics', '/api/scenario', '/api/view',
            '/api/groups', '/api/plugins/config', '/api/plugins/schemas',
            '/api/v1/server/projects', '/api/v1/server/teams', '/api/v1/server/tasks',
        }
        read_only_local_or_cached = (
            request.method in ('GET', 'HEAD')
            and (
                route_path in cached_or_local_read_routes
                or route_path.startswith('/admin/v1/')
            )
        )
        protected_api = route_path.startswith(('/api/', '/admin/v1/')) or route_path == '/admin/check'
        if (protected_api and route_path not in credential_routes
                and route_path not in local_admin_config_routes
            and not local_record_route
                and not read_only_local_or_cached
                and request.cookies.get(SESSION_COOKIE)):
            try:
                context = get_session_context_from_request(request)
            except HTTPException:
                context = None
            if context is not None:
                policy = resolve_service(request, 'credential_policy')
                error = policy.credential_error(context['account_id'])
                if error:
                    return JSONResponse(status_code=403, content={'error': error})
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
        request.scope['state'].pop('_planner_session', None)
        request.scope['state'].pop('_planner_credential', None)
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
