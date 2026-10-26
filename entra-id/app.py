"""Standalone, read-only Entra delegated authentication experiment."""
import html
import json
import os
import re
import secrets
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from uuid import UUID

import httpx
import msal
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from starlette.concurrency import run_in_threadpool
from starlette.middleware.trustedhost import TrustedHostMiddleware


SCOPES = ['https://app.vssps.visualstudio.com/.default']
COOKIE = 'entra_poc_session'
ENV_NAMES = ('ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET', 'ADO_ORGANIZATION')


@dataclass(frozen=True)
class Settings:
    tenant_id: str
    client_id: str
    client_secret: str = field(repr=False)
    organization: str
    redirect_uri: str = 'http://localhost:8765/auth/callback'
    listen_host: str = '127.0.0.1'
    listen_port: int = 8765

    def __post_init__(self):
        for value in (self.tenant_id, self.client_id):
            if value:
                if str(UUID(value)) != value:
                    raise ValueError('Tenant and client IDs must be canonical lowercase GUIDs')
        if self.organization and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]*', self.organization):
            raise ValueError('ADO_ORGANIZATION must be an organization name, not a URL')
        parsed = urlsplit(self.redirect_uri)
        if (not parsed.hostname or parsed.scheme not in ('http', 'https')
                or not re.fullmatch(r'(?:/[A-Za-z0-9_-]+)*/auth/callback', parsed.path)
                or parsed.query or parsed.fragment or parsed.username or parsed.password):
            raise ValueError('Use an HTTPS callback URL ending in /auth/callback')
        if parsed.scheme == 'http' and (parsed.hostname != 'localhost' or parsed.port is None):
            raise ValueError('HTTP is allowed only for http://localhost:PORT/auth/callback')
        if not re.fullmatch(r'[a-z0-9]+(?:[.-][a-z0-9]+)*', parsed.hostname):
            raise ValueError('The callback must use a lowercase DNS hostname')
        if parsed.port == 0 or not 1 <= self.listen_port <= 65535:
            raise ValueError('Ports must be between 1 and 65535')

    @classmethod
    def from_env(cls):
        redirect_uri = os.environ.get('ENTRA_REDIRECT_URI', 'http://localhost:8765/auth/callback')
        secret = os.environ.get('ENTRA_CLIENT_SECRET', '')
        secret_file = os.environ.get('ENTRA_CLIENT_SECRET_FILE', '')
        if secret_file:
            if secret:
                raise ValueError('Set ENTRA_CLIENT_SECRET or ENTRA_CLIENT_SECRET_FILE, not both')
            secret = Path(secret_file).read_text().strip()
        parsed = urlsplit(redirect_uri)
        default_port = parsed.port if parsed.scheme == 'http' else 8765
        return cls(
            tenant_id=os.environ.get('ENTRA_TENANT_ID', ''),
            client_id=os.environ.get('ENTRA_CLIENT_ID', ''),
            client_secret=secret,
            organization=os.environ.get('ADO_ORGANIZATION', ''),
            redirect_uri=redirect_uri,
            listen_host=os.environ.get('ENTRA_LISTEN_HOST', '127.0.0.1'),
            listen_port=int(os.environ.get('ENTRA_LISTEN_PORT', str(default_port))),
        )

    @property
    def missing(self):
        values = (self.tenant_id, self.client_id, self.client_secret, self.organization)
        return [name for name, value in zip(ENV_NAMES, values) if not value]

    @property
    def origin(self):
        parsed = urlsplit(self.redirect_uri)
        return f'{parsed.scheme}://{parsed.netloc}'

    @property
    def root_path(self):
        return urlsplit(self.redirect_uri).path[:-len('/auth/callback')]

    @property
    def secure(self):
        return urlsplit(self.redirect_uri).scheme == 'https'

    @property
    def response_mode(self):
        return 'form_post' if self.secure else 'query'


@dataclass
class BrowserSession:
    client: object
    flow: dict
    expires_at: float
    claims: dict = field(default_factory=dict)
    lock: object = field(default_factory=threading.RLock)


def render(title, body, status_code=200):
    return HTMLResponse(f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>{html.escape(title)} | Entra ADO PoC</title><style>
:root {{ color-scheme: light; --ink: #202724; --accent: #176c53; --line: #cbd4cf; }}
* {{ box-sizing: border-box; }}
body {{ margin: 0; color: var(--ink); background: #f5f7f6;
font: 16px/1.6 'Segoe UI', sans-serif; letter-spacing: 0; }}
header {{ border-bottom: 1px solid var(--line); padding: 20px 40px; background: white; }}
main {{ max-width: 1000px; margin: 40px auto; padding: 0 32px; }}
h1 {{ font: 32px/1.2 Georgia, serif; }}
nav {{ display: flex; flex-wrap: wrap; gap: 20px; align-items: center; margin: 28px 0; }}
a {{ color: var(--accent); }} button {{ padding: 8px 16px; cursor: pointer; font: inherit;
border: 1px solid var(--accent); border-radius: 4px; background: white; color: var(--accent); }}
pre {{ padding: 20px 0; border-top: 1px solid var(--line); white-space: pre-wrap;
overflow-wrap: anywhere; font-size: 14px; }}
dt {{ font-weight: 600; }} dd {{ margin: 0 0 16px; overflow-wrap: anywhere; }}
</style></head><body><header>Entra / Azure DevOps</header><main>
<h1>{html.escape(title)}</h1>{body}</main></body></html>''', status_code=status_code)


def create_app(settings=None, client_factory=msal.ConfidentialClientApplication, ado_get=httpx.get):
    if settings is None:
        settings = Settings.from_env()
    app = FastAPI(root_path=settings.root_path, docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=[urlsplit(settings.redirect_uri).hostname])
    sessions = {}
    registry_lock = threading.RLock()

    def public_path(path):
        return settings.root_path + path

    def set_session_cookie(response, session_id, max_age, pending=False):
        response.set_cookie(
            COOKIE, session_id, httponly=True, secure=settings.secure,
            samesite='none' if pending and settings.secure else 'lax',
            path=public_path('/'), max_age=max_age,
        )

    @app.middleware('http')
    async def protect_responses(request, call_next):
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        if settings.secure:
            response.headers['Strict-Transport-Security'] = 'max-age=31536000'
        response.headers['Content-Security-Policy'] = (
            "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"
        )
        return response

    def current_session(request):
        with registry_lock:
            for key, session in list(sessions.items()):
                if session.expires_at <= time.monotonic():
                    del sessions[key]
            return sessions.get(request.cookies.get(COOKIE))

    def require_session(request):
        session = current_session(request)
        if session is None or not session.claims:
            raise HTTPException(401, 'Sign in with Entra ID to continue.')
        return session

    def require_origin(request):
        if request.headers.get('origin') != settings.origin:
            raise HTTPException(403, 'Same-origin POST required.')

    def acquire_token(session, force_refresh=False):
        with session.lock:
            accounts = session.client.get_accounts()
            if len(accounts) != 1:
                raise HTTPException(401, 'Sign in again; no unique cached account exists.')
            result = session.client.acquire_token_silent_with_error(
                SCOPES, account=accounts[0], force_refresh=force_refresh,
            )
            if result is None or 'access_token' not in result:
                raise HTTPException(401, 'Entra authorization must be renewed. Sign in again.')
            return result['access_token']

    @app.get('/', response_class=HTMLResponse)
    def home(request: Request):
        if settings.missing:
            missing = html.escape(', '.join(settings.missing))
            return render('Configuration required', f'<p>Missing environment variables: {missing}</p>')
        session = current_session(request)
        if session is None or not session.claims:
            return render('Azure DevOps',
                          f'<nav><a href="{public_path("/login")}">Sign in with Entra ID</a></nav>')
        claims = session.claims
        identity = ''.join(
            f'<dt>{html.escape(label)}</dt><dd>{html.escape(str(claims[key]))}</dd>'
            for label, key in [('Name', 'name'), ('Tenant ID', 'tid'), ('Object ID', 'oid')]
            if key in claims
        )
        return render('Azure DevOps', f'''<dl>{identity}
<dt>Organization</dt><dd>{html.escape(settings.organization)}</dd></dl><nav>
<a href="{public_path('/ado/identity')}">ADO identity</a>
<a href="{public_path('/ado/projects')}">Projects</a>
<form method="post" action="{public_path('/refresh')}"><button>Refresh token</button></form>
<form method="post" action="{public_path('/logout')}"><button>Sign out</button></form></nav>''')

    @app.get('/login')
    def login(request: Request):
        if settings.missing:
            raise HTTPException(503, 'Configure the Entra application and ADO organization first.')
        current_session(request)
        client = client_factory(
            settings.client_id, client_credential=settings.client_secret,
            authority=f'https://login.microsoftonline.com/{settings.tenant_id}',
            token_cache=msal.TokenCache(), timeout=20,
        )
        flow = client.initiate_auth_code_flow(
            scopes=SCOPES, redirect_uri=settings.redirect_uri,
            prompt='select_account', response_mode=settings.response_mode,
        )
        session_id = secrets.token_urlsafe(32)
        with registry_lock:
            if len(sessions) >= 128:
                raise HTTPException(503, 'PoC session limit reached. Try again later.')
            sessions.pop(request.cookies.get(COOKIE), None)
            sessions[session_id] = BrowserSession(client, flow, time.monotonic() + 600)
        response = RedirectResponse(flow['auth_uri'], status_code=303)
        set_session_cookie(response, session_id, max_age=600, pending=True)
        return response

    @app.api_route('/auth/callback', methods=['GET', 'POST'])
    async def callback(request: Request):
        if settings.secure:
            if request.method != 'POST':
                raise HTTPException(405, 'HTTPS sign-in requires a form_post callback.')
            if request.headers.get('content-type', '').split(';')[0] != 'application/x-www-form-urlencoded':
                raise HTTPException(415, 'Expected an OAuth form response.')
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 16384:
                    raise HTTPException(413, 'OAuth response is too large.')
            try:
                fields = parse_qs(body.decode('utf-8'), keep_blank_values=True, strict_parsing=True)
            except ValueError as exc:
                raise HTTPException(400, 'Invalid OAuth form response.') from exc
            if any(len(values) != 1 for values in fields.values()) or request.query_params:
                raise HTTPException(400, 'Ambiguous OAuth response.')
            auth_response = {key: values[0] for key, values in fields.items()}
        else:
            if request.method != 'GET':
                raise HTTPException(405, 'Local HTTP sign-in requires a query callback.')
            if len(request.query_params) != len(request.query_params.multi_items()):
                raise HTTPException(400, 'Ambiguous OAuth response.')
            auth_response = dict(request.query_params)
        return await run_in_threadpool(complete_callback, request, auth_response)

    def complete_callback(request, auth_response):
        session = current_session(request)
        if session is None:
            raise HTTPException(400, 'Login session missing or expired. Start sign-in again.')
        with session.lock:
            if not session.flow:
                raise HTTPException(400, 'This sign-in response has already been used.')
            flow = session.flow
            session.flow = {}
            try:
                result = session.client.acquire_token_by_auth_code_flow(
                    flow, auth_response,
                )
            except ValueError as exc:
                raise HTTPException(400, 'Invalid sign-in response. Start sign-in again.') from exc
            if 'access_token' not in result:
                raise HTTPException(401, 'Entra denied authorization. Check consent and sign in again.')
            claims = result['id_token_claims']
            if claims['tid'] != settings.tenant_id or not claims.get('oid'):
                raise HTTPException(403, 'The signed-in identity is not in the configured tenant.')
            session.claims = {key: claims[key] for key in ('name', 'tid', 'oid') if key in claims}
            session.expires_at = time.monotonic() + 3600
        new_session_id = secrets.token_urlsafe(32)
        with registry_lock:
            sessions.pop(request.cookies.get(COOKIE), None)
            sessions[new_session_id] = session
        response = RedirectResponse(public_path('/'), status_code=303)
        set_session_cookie(response, new_session_id, max_age=3600)
        return response

    @app.get('/ado/{resource}', response_class=HTMLResponse)
    def read_ado(resource: str, request: Request):
        paths = {
            'identity': '/_apis/connectionData?api-version=7.1-preview.1',
            'projects': '/_apis/projects?api-version=7.1&$top=100',
        }
        if resource not in paths:
            raise HTTPException(404, 'Unknown ADO operation.')
        token = acquire_token(require_session(request))
        try:
            response = ado_get(
                f'https://dev.azure.com/{settings.organization}{paths[resource]}',
                headers={'Authorization': f'Bearer {token}', 'Accept': 'application/json'},
                timeout=20, follow_redirects=False,
            )
        except httpx.RequestError as exc:
            raise HTTPException(502, 'Could not reach Azure DevOps.') from exc
        if response.status_code == 401:
            raise HTTPException(401, 'ADO rejected authorization. Sign in again; tenant policy may apply.')
        if response.status_code == 403:
            raise HTTPException(403, 'ADO denied access. Check user permissions and organization membership.')
        if response.status_code != 200:
            raise HTTPException(502, f'Unexpected ADO response: HTTP {response.status_code}.')
        try:
            payload = response.json()
        except ValueError as exc:
            raise HTTPException(502, 'ADO did not return JSON. Check organization access.') from exc
        if resource == 'identity':
            payload = {'authenticatedUser': payload['authenticatedUser'],
                       'authorizedUser': payload['authorizedUser']}
        data = html.escape(json.dumps(payload, indent=2))
        return render(f'ADO {resource}', f'<a href="{public_path("/")}">Back</a><pre>{data}</pre>')

    @app.post('/refresh', response_class=HTMLResponse)
    def refresh(request: Request):
        require_origin(request)
        acquire_token(require_session(request), force_refresh=True)
        return render('Token renewed', f'<a href="{public_path("/")}">Back</a>')

    @app.post('/logout')
    def logout(request: Request):
        require_origin(request)
        with registry_lock:
            sessions.pop(request.cookies.get(COOKIE), None)
        response = RedirectResponse(public_path('/'), status_code=303)
        response.delete_cookie(COOKIE, httponly=True, secure=settings.secure,
                       samesite='lax', path=public_path('/'))
        return response

    return app


if __name__ == '__main__':
    import uvicorn

    configuration = Settings.from_env()
    uvicorn.run(create_app(configuration), host=configuration.listen_host,
                port=configuration.listen_port, access_log=False, proxy_headers=False)