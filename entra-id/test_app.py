import importlib.util
import sys
from pathlib import Path
from unittest.mock import Mock
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from fastapi.testclient import TestClient

spec = importlib.util.spec_from_file_location('entra_poc_app', Path(__file__).with_name('app.py'))
poc_app = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = poc_app
spec.loader.exec_module(poc_app)
COOKIE = poc_app.COOKIE
SCOPES = poc_app.SCOPES
Settings = poc_app.Settings
create_app = poc_app.create_app


TENANT = '11111111-1111-1111-1111-111111111111'
CLIENT = '22222222-2222-2222-2222-222222222222'
ORIGIN = 'http://localhost:8765'


@pytest.fixture(params=[ORIGIN])
def setup(request):
    origin = request.param
    clients = []

    def factory(*args, **kwargs):
        client = Mock()
        client.initiate_auth_code_flow.return_value = {
            'auth_uri': 'https://login.microsoftonline.com/authorize', 'state': 'expected',
        }

        def redeem(flow, response):
            if response.get('state') != flow['state']:
                raise ValueError('state mismatch')
            return {'access_token': 'private-token', 'id_token_claims': {
                'name': 'Test User', 'tid': TENANT, 'oid': f'user-{len(clients)}',
            }}

        client.acquire_token_by_auth_code_flow.side_effect = redeem
        client.get_accounts.return_value = [{'username': f'user-{len(clients)}'}]
        client.acquire_token_silent_with_error.return_value = {'access_token': 'private-token'}
        clients.append(client)
        return client

    ado = Mock(return_value=httpx.Response(200, json={'value': [{'name': 'Project'}]}))
    app = create_app(Settings(TENANT, CLIENT, 'test-secret', 'example',
                              origin + '/auth/callback'), factory, ado)
    with TestClient(app, base_url=origin, follow_redirects=False) as browser:
        yield browser, clients, ado, app


def sign_in(browser):
    assert browser.get('/login').status_code == 303
    assert browser.get('/auth/callback?state=expected&code=test-code').status_code == 303


def test_signed_out_and_unconfigured():
    app = create_app(Settings('', '', '', ''))
    with TestClient(app, base_url=ORIGIN) as browser:
        assert 'ENTRA_CLIENT_SECRET' in browser.get('/').text
        assert browser.get('/login').status_code == 503
        assert browser.get('/ado/projects').status_code == 401


def test_login_callback_rotation_and_no_token_disclosure(setup):
    browser, clients, ado, app = setup
    assert browser.get('/login').status_code == 303
    old_cookie = browser.cookies.get(COOKIE)
    response = browser.get('/auth/callback?state=expected&code=test-code')
    assert response.status_code == 303
    assert browser.cookies.get(COOKIE) != old_cookie
    assert 'HttpOnly' in response.headers['set-cookie']
    home = browser.get('/')
    assert 'Test User' in home.text
    assert 'private-token' not in home.text
    assert 'test-secret' not in home.text
    assert home.headers['cache-control'] == 'no-store'
    clients[0].initiate_auth_code_flow.assert_called_once_with(
        scopes=SCOPES, redirect_uri=ORIGIN + '/auth/callback',
        prompt='select_account', response_mode='query',
    )
    assert browser.get('/auth/callback?state=expected&code=test-code').status_code == 400


def test_missing_and_mismatched_state_rejected(setup):
    browser, clients, ado, app = setup
    assert browser.get('/auth/callback?state=expected').status_code == 400
    browser.get('/login')
    assert browser.get('/auth/callback?state=wrong&code=test-code').status_code == 400
    assert browser.get('/ado/projects').status_code == 401
    ado.assert_not_called()


def test_user_token_sent_as_bearer_only_to_allowed_ado_endpoint(setup):
    browser, clients, ado, app = setup
    sign_in(browser)
    response = browser.get('/ado/projects')
    assert response.status_code == 200
    assert 'Project' in response.text
    assert 'private-token' not in response.text
    ado.assert_called_once_with(
        'https://dev.azure.com/example/_apis/projects?api-version=7.1&$top=100',
        headers={'Authorization': 'Bearer private-token', 'Accept': 'application/json'},
        timeout=20, follow_redirects=False,
    )
    assert browser.get('/ado/anything-else').status_code == 404


def test_identity_from_ado_not_just_entra_claims(setup):
    browser, clients, ado, app = setup
    sign_in(browser)
    ado.return_value = httpx.Response(200, json={
        'authenticatedUser': {'id': 'ado-user', 'providerDisplayName': 'ADO User'},
        'authorizedUser': {'id': 'ado-user'},
    })
    response = browser.get('/ado/identity')
    assert response.status_code == 200
    assert 'ADO User' in response.text


@pytest.mark.parametrize('status', [401, 403, 302, 500])
def test_ado_errors_do_not_expose_upstream_body(setup, status):
    browser, clients, ado, app = setup
    sign_in(browser)
    ado.return_value = httpx.Response(status, text='sensitive-upstream-body')
    response = browser.get('/ado/projects')
    assert response.status_code == (status if status in (401, 403) else 502)
    assert 'sensitive-upstream-body' not in response.text


def test_refresh_and_logout_require_same_origin(setup):
    browser, clients, ado, app = setup
    sign_in(browser)
    assert browser.post('/refresh').status_code == 403
    assert browser.post('/logout', headers={'Origin': 'https://attacker.example'}).status_code == 403
    assert browser.post('/refresh', headers={'Origin': ORIGIN}).status_code == 200
    assert clients[0].acquire_token_silent_with_error.call_args.kwargs['force_refresh'] is True
    assert browser.post('/logout', headers={'Origin': ORIGIN}).status_code == 303
    assert browser.get('/ado/projects').status_code == 401


def test_refresh_failure_requires_reauthentication(setup):
    browser, clients, ado, app = setup
    sign_in(browser)
    clients[0].acquire_token_silent_with_error.return_value = {'error': 'interaction_required'}
    assert browser.get('/ado/projects').status_code == 401
    ado.assert_not_called()


def test_separate_browsers_never_share_clients_or_credentials(setup):
    browser, clients, ado, app = setup
    sign_in(browser)
    with TestClient(app, base_url=ORIGIN, follow_redirects=False) as other:
        assert other.get('/ado/projects').status_code == 401
        sign_in(other)
        assert len(clients) == 2
        clients[0].acquire_token_silent_with_error.return_value = {'access_token': 'first-user'}
        clients[1].acquire_token_silent_with_error.return_value = {'access_token': 'second-user'}
        browser.get('/ado/projects')
        assert ado.call_args.kwargs['headers']['Authorization'] == 'Bearer first-user'
        other.get('/ado/projects')
        assert ado.call_args.kwargs['headers']['Authorization'] == 'Bearer second-user'
        browser.post('/logout', headers={'Origin': ORIGIN})
        assert other.get('/ado/projects').status_code == 200


@pytest.mark.parametrize('redirect', ['http://public.example/auth/callback',
                                     'http://localhost:8765/other',
                                     'https://public.example/auth/callback?next=evil',
                                     'https://public.example/../auth/callback',
                                     'https://user:password@public.example/auth/callback'])
def test_insecure_or_wrong_callback_rejected(redirect):
    with pytest.raises(ValueError):
        Settings(TENANT, CLIENT, 'secret', 'example', redirect)


@pytest.mark.parametrize('origin', [ORIGIN, 'https://poc.example.com'])
def test_real_msal_generates_pkce_and_rejects_wrong_state_without_token_exchange(origin):
    transport = Mock()
    authority = f'https://login.microsoftonline.com/{TENANT}/oauth2/v2.0'
    transport.get.return_value = httpx.Response(200, json={
        'authorization_endpoint': authority + '/authorize',
        'token_endpoint': authority + '/token',
        'issuer': f'https://login.microsoftonline.com/{TENANT}/v2.0',
    })

    def factory(*args, **kwargs):
        return poc_app.msal.ConfidentialClientApplication(
            *args, **kwargs, http_client=transport, instance_discovery=False,
        )

    app = create_app(Settings(TENANT, CLIENT, 'secret', 'example',
                              origin + '/auth/callback'), factory)
    with TestClient(app, base_url=origin, follow_redirects=False) as browser:
        response = browser.get('/login')
        assert response.status_code == 303
        query = parse_qs(urlsplit(response.headers['location']).query)
        assert query['code_challenge_method'] == ['S256']
        assert len(query['code_challenge'][0]) >= 43
        assert query['nonce'][0]
        assert query['state'][0]
        assert query['response_type'] == ['code']
        scopes = query['scope'][0].split()
        assert all(scope in scopes for scope in SCOPES + ['openid', 'offline_access'])
        if origin.startswith('https:'):
            assert query['response_mode'] == ['form_post']
            response = browser.post('/auth/callback', data={'state': 'wrong', 'code': 'code'})
        else:
            response = browser.get('/auth/callback?state=wrong&code=code')
        assert response.status_code == 400
        transport.post.assert_not_called()


def test_wrong_tenant_is_not_authorized(setup):
    browser, clients, ado, app = setup
    browser.get('/login')
    clients[0].acquire_token_by_auth_code_flow.side_effect = None
    clients[0].acquire_token_by_auth_code_flow.return_value = {
        'access_token': 'wrong-tenant-token',
        'id_token_claims': {'tid': CLIENT, 'oid': 'user'},
    }
    assert browser.get('/auth/callback?state=expected&code=code').status_code == 403
    assert browser.get('/ado/projects').status_code == 401
    ado.assert_not_called()


@pytest.mark.parametrize('setup', ['https://poc.example.com'], indirect=True)
def test_https_flow_behind_caddy_uses_secure_cookies_and_post_callback(setup):
    browser, clients, ado, app = setup
    response = browser.get('/login')
    old_cookie = browser.cookies.get(COOKIE)
    assert response.status_code == 303
    assert '; Secure' in response.headers['set-cookie']
    assert 'SameSite=none' in response.headers['set-cookie']
    clients[0].initiate_auth_code_flow.assert_called_once_with(
        scopes=SCOPES, redirect_uri='https://poc.example.com/auth/callback',
        prompt='select_account', response_mode='form_post',
    )
    assert browser.get('/auth/callback?code=secret-code').status_code == 405
    response = browser.post('/auth/callback', data={'state': 'expected', 'code': 'secret-code'})
    assert response.status_code == 303
    assert browser.cookies.get(COOKIE) != old_cookie
    assert '; Secure' in response.headers['set-cookie']
    assert 'SameSite=lax' in response.headers['set-cookie']
    assert browser.get('/ado/projects').status_code == 200
    assert browser.post('/refresh', headers={'Origin': 'https://poc.example.com'}).status_code == 200
    assert browser.post('/logout', headers={'Origin': 'http://poc.example.com'}).status_code == 403
    assert browser.get('/', headers={'Host': 'attacker.example'}).status_code == 400
    assert browser.get('/').headers['strict-transport-security'] == 'max-age=31536000'
    response = browser.post('/logout', headers={'Origin': 'https://poc.example.com'})
    assert '; Secure' in response.headers['set-cookie']
    assert browser.get('/ado/projects').status_code == 401


@pytest.mark.parametrize('setup', ['https://poc.example.com'], indirect=True)
@pytest.mark.parametrize('body,content_type,status', [
    ('state=wrong&code=code', 'application/x-www-form-urlencoded', 400),
    ('state=expected&state=other&code=code', 'application/x-www-form-urlencoded', 400),
    ('x' * 16385, 'application/x-www-form-urlencoded', 413),
    ('{}', 'application/json', 415),
])
def test_https_callback_rejects_invalid_forms(setup, body, content_type, status):
    browser, clients, ado, app = setup
    browser.get('/login')
    response = browser.post('/auth/callback', content=body, headers={'Content-Type': content_type})
    assert response.status_code == status
    assert browser.get('/ado/projects').status_code == 401
    ado.assert_not_called()


def test_subpath_routing_uses_configured_public_prefix_not_forwarded_headers():
    settings = Settings(TENANT, CLIENT, 'secret', 'example',
                        'https://planner.example.com/entra-poc/auth/callback')
    client = Mock()
    client.initiate_auth_code_flow.return_value = {'auth_uri': 'https://login.microsoftonline.com'}
    client.acquire_token_by_auth_code_flow.return_value = {
        'access_token': 'token', 'id_token_claims': {'tid': TENANT, 'oid': 'user'},
    }
    app = create_app(settings, Mock(return_value=client))
    with TestClient(app, base_url='https://planner.example.com', follow_redirects=False) as browser:
        assert 'href="/entra-poc/login"' in browser.get('/entra-poc/').text
        response = browser.get('/entra-poc/login', headers={
            'X-Forwarded-Host': 'attacker.example', 'X-Forwarded-Proto': 'http',
        })
        assert 'Path=/entra-poc/' in response.headers['set-cookie']
        assert client.initiate_auth_code_flow.call_args.kwargs['redirect_uri'] == settings.redirect_uri
        response = browser.post('/entra-poc/auth/callback', data={'code': 'code', 'state': 'state'})
        assert response.status_code == 303
        assert response.headers['location'] == '/entra-poc/'
        home = browser.get('/entra-poc/').text
        assert 'action="/entra-poc/logout"' in home
        assert 'href="/entra-poc/ado/identity"' in home
        response = browser.post('/entra-poc/logout', headers={'Origin': settings.origin})
        assert 'Path=/entra-poc/' in response.headers['set-cookie']


def test_secret_file_and_independent_listening_port(monkeypatch, tmp_path):
    secret_file = tmp_path / 'secret'
    secret_file.write_text('file-secret\n')
    monkeypatch.delenv('ENTRA_CLIENT_SECRET', raising=False)
    monkeypatch.setenv('ENTRA_CLIENT_SECRET_FILE', str(secret_file))
    monkeypatch.setenv('ENTRA_REDIRECT_URI', 'https://poc.example.com/auth/callback')
    monkeypatch.setenv('ENTRA_LISTEN_HOST', '0.0.0.0')
    monkeypatch.setenv('ENTRA_LISTEN_PORT', '8000')
    settings = Settings.from_env()
    assert settings.client_secret == 'file-secret'
    assert 'file-secret' not in repr(settings)
    assert settings.listen_port == 8000
    assert settings.listen_host == '0.0.0.0'
    monkeypatch.setenv('ENTRA_CLIENT_SECRET', 'env-secret')
    with pytest.raises(ValueError, match='not both'):
        Settings.from_env()