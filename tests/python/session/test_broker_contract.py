import json
import secrets
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from planner_lib.main import Config, create_app
from planner_lib.session.broker import BrokerClient, BrokerSettings, AuthFailure, SANDBOX_TENANT


pytestmark = pytest.mark.real_auth
CONTRACT = json.loads((Path(__file__).resolve().parents[3] / 'entra-id' / 'protocol-v1.json').read_text())


@pytest.fixture
def sandbox(monkeypatch, tmp_path):
    secret_file = tmp_path / 'instance-secret'
    secret_file.write_text(secrets.token_urlsafe(32))
    secret_file.chmod(0o600)
    for key, value in {
        'PLANNER_AUTH_PROVIDER': 'entra', 'PLANNER_AUTH_INSTANCE': 'alpha',
        'PLANNER_AUTH_URL': 'http://localhost:8765/auth/',
        'PLANNER_AUTH_PUBLIC_URL': 'http://localhost:8765/auth/',
        'PLANNER_AUTH_ENVIRONMENT': 'sandbox', 'PLANNER_AUTH_GENERATION': 'test-1',
        'PLANNER_AUTH_UPSTREAM_MODE': 'mock', 'PLANNER_AUTH_ISOLATED_SANDBOX': '1',
        'PLANNER_AUTH_SECRET_FILE': str(secret_file),
    }.items():
        monkeypatch.setenv(key, value)
    app = create_app(Config(storage_backend='memory', data_dir=str(tmp_path), static_dir='www'))
    settings = app.state.container.get('broker_client').settings
    requests = []

    def transport(request):
        assert request.headers['authorization'] == 'Bearer ' + secret_file.read_text()
        requests.append(request)
        metadata = settings.metadata()
        if request.url.path.endswith('/readiness'):
            return httpx.Response(200, json={**metadata, 'ready': True, 'live_capable': False})
        payload = json.loads(request.content)
        assert all(payload[key] == value for key, value in metadata.items())
        if request.url.path.endswith('/begin'):
            import time
            return httpx.Response(200, json={**metadata, 'transaction': 'test-transaction',
                'authorization_url': settings.public_url + 'v1/browser/authorize?transaction=test-transaction',
                'expires_at': time.time() + 300})
        if request.url.path.endswith('/redeem'):
            import time
            return httpx.Response(200, json={**metadata, 'transaction': payload['transaction'],
                'identity': {'tid': SANDBOX_TENANT, 'oid': '33333333-3333-3333-3333-333333333333'},
                'grant': 'opaque-server-only-grant', 'expires_at': time.time() + 3600})
        if request.url.path.endswith('/revoke'):
            return httpx.Response(200, json={**metadata, 'status': 'revoked'})
        if request.url.path.endswith('/status'):
            return httpx.Response(200, json={**metadata, 'status': 'active'})
        raise AssertionError('Unexpected broker operation')

    app.state.container.get('broker_client').transport = httpx.MockTransport(transport)
    with TestClient(app, base_url='http://localhost:8765') as client:
        yield client, requests


def test_sandbox_login_profile_logout_and_disabled_enrollment(sandbox):
    client, requests = sandbox
    assert client.get('/api/auth/config').json()['mode'] == 'entra'
    assert client.get('/api/auth/me').json()['account'] is None
    assert client.post('/api/auth/enroll', json={'email': 'new@example.test'}).status_code == 403
    begin = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'})
    assert begin.status_code == 200
    assert 'HttpOnly' in begin.headers['set-cookie']
    state = begin.json()['state']
    completed = client.post('/api/auth/login/complete', json={'state': state, 'code': 'code'})
    assert completed.status_code == 200
    assert completed.json()['account']['email'] == 'alex@example.test'
    for key, value in CONTRACT['profile'].items():
        assert completed.json()[key] == value
    assert 'opaque-server-only-grant' not in completed.text
    before_profile = len(requests)
    assert client.get('/api/auth/me').json()['account']['uuid']
    assert len(requests) == before_profile + 1
    assert requests[-1].url.path.endswith('/status')
    assert client.post('/api/auth/login/complete', json={'state': state, 'code': 'code'}).status_code == 401
    assert client.post('/api/auth/logout').json()['account'] is None
    assert client.get('/api/auth/me').json()['account'] is None


def test_popup_callback_consumes_once_and_exposes_only_bound_completion(sandbox):
    client, requests = sandbox
    begun = client.post('/api/auth/login/begin', headers={
        'Origin': 'http://localhost:8765', 'X-Planner-Login-Target': 'app',
    }).json()
    response = client.get('/api/auth/login/callback', params={
        'state': begun['state'], 'code': 'code',
    })
    assert response.status_code == 200
    assert 'postMessage' in response.text
    assert 'http://localhost:8765' in response.text
    assert 'opaque-server-only-grant' not in response.text
    assert "script-src 'nonce-" in response.headers['content-security-policy']
    assert client.get('/api/auth/me').json()['account']['email'] == 'alex@example.test'
    assert client.post('/api/auth/login/complete', json={
        'state': begun['state'], 'code': 'code',
    }).status_code == 401
    assert sum(request.url.path.endswith('/redeem') for request in requests) == 1


def test_popup_cancellation_and_untrusted_return_target(sandbox):
    client, requests = sandbox
    assert client.post('/api/auth/login/begin', headers={
        'Origin': 'http://localhost:8765', 'X-Planner-Login-Target': 'https://other.example.test/',
    }).status_code == 403
    begun = client.post('/api/auth/login/begin', headers={
        'Origin': 'http://localhost:8765', 'X-Planner-Login-Target': 'admin',
    }).json()
    response = client.get('/api/auth/login/callback', params={
        'state': begun['state'], 'error': 'cancelled',
    })
    assert response.status_code == 200
    assert '"error": "cancelled"' in response.text
    assert '/alpha/admin' in response.text
    assert not any(request.url.path.endswith('/redeem') for request in requests)
    assert client.get('/api/auth/me').json()['account'] is None


def test_popup_reports_expired_handoff_to_bound_opener(sandbox):
    client, requests = sandbox
    state = client.post('/api/auth/login/begin', headers={
        'Origin': 'http://localhost:8765', 'X-Planner-Login-Target': 'app',
    }).json()['state']
    broker = client.app.state.container.get('broker_client')
    broker.transport = httpx.MockTransport(lambda request: httpx.Response(400, json={'error': 'expired'}))
    response = client.get('/api/auth/login/callback', params={'state': state, 'code': 'code'})
    assert response.status_code == 401
    assert '"error": "invalid_session"' in response.text
    assert 'postMessage' in response.text


def test_authenticated_non_admin_is_denied_without_session_expiry(sandbox):
    client, requests = sandbox
    broker = client.app.state.container.get('broker_client')
    transport = broker.transport

    def sam(request):
        response = transport.handle_request(request)
        if request.url.path.endswith('/redeem'):
            value = json.loads(response.content)
            value['identity']['oid'] = '44444444-4444-4444-4444-444444444444'
            return httpx.Response(200, json=value)
        return response

    broker.transport = httpx.MockTransport(sam)
    state = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()['state']
    assert client.post('/api/auth/login/complete', json={'state': state, 'code': 'code'}).status_code == 200
    assert client.get('/admin/check').status_code == 403
    assert client.get('/api/auth/me').json()['account']['email'] == 'sam@example.test'


def test_completion_wrong_browser_fails_without_consuming_transaction(sandbox):
    client, requests = sandbox
    state = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()['state']
    binding = client.cookies.get('plannerLogin')
    client.cookies.clear()
    assert client.post('/api/auth/login/complete', json={'state': state, 'code': 'code'}).status_code == 401
    client.cookies.set('plannerLogin', binding, path='/api/auth/')
    assert client.post('/api/auth/login/complete', json={'state': state, 'code': 'code'}).status_code == 200


def test_logout_commits_local_revocation_when_broker_is_unavailable(sandbox):
    client, requests = sandbox
    state = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()['state']
    assert client.post('/api/auth/login/complete', json={'state': state, 'code': 'code'}).status_code == 200
    from planner_lib.middleware.session import SESSION_COOKIE
    sid = client.cookies.get(SESSION_COOKIE)
    sessions = client.app.state.container.get('session_manager')
    assert sessions.is_valid(sid)
    broker = client.app.state.container.get('broker_client')
    broker.transport = httpx.MockTransport(lambda request: httpx.Response(503))
    diagnostic = client.get('/api/auth/sandbox')
    assert diagnostic.status_code == 200
    profile = client.get('/api/auth/me').json()
    assert profile['status'] == 'unavailable'
    assert profile['account']['email'] == 'alex@example.test'
    assert client.get('/admin/check').status_code == 200
    assert client.get('/api/auth/config').json()['mode'] == 'entra'
    logged_out = client.post('/api/auth/logout')
    assert logged_out.status_code == 200
    assert logged_out.json()['revocation_pending'] is True
    assert not sessions.is_valid(sid)
    storage = client.app.state.container.get('storage')
    assert all(storage.load('auth_grants', key)['revoked'] for key in storage.list_keys('auth_grants'))


def test_transport_rejects_mismatched_environment_and_outage(sandbox):
    client, requests = sandbox
    broker = client.app.state.container.get('broker_client')
    broker.transport = httpx.MockTransport(lambda request: httpx.Response(200, json={'protocol': 'wrong'}))
    assert client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json() == {
        'error': 'auth_configuration_error'}
    broker.transport = httpx.MockTransport(lambda request: httpx.Response(503))
    assert client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json() == {
        'error': 'auth_unavailable'}


@pytest.mark.parametrize('status,code,expected_status,expected_code', [
    (400, 'expired', 401, 'invalid_session'),
    (400, 'invalid_binding', 401, 'invalid_session'),
    (400, 'replay', 401, 'invalid_session'),
    (403, 'invalid_instance', 503, 'auth_configuration_error'),
    (403, 'invalid_environment', 503, 'auth_configuration_error'),
    (403, 'access_denied', 403, 'access_denied'),
    (409, 'interaction_required', 409, 'interaction_required'),
    (400, 'unrecognized', 503, 'auth_configuration_error'),
])
def test_completion_translates_typed_broker_failures(
        sandbox, status, code, expected_status, expected_code):
    client, requests = sandbox
    state = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()['state']
    broker = client.app.state.container.get('broker_client')
    calls = []

    def failure(request):
        calls.append(request)
        return httpx.Response(status, json={'error': code})

    broker.transport = httpx.MockTransport(failure)
    response = client.post('/api/auth/login/complete', json={'state': state, 'code': 'code'})
    assert response.status_code == expected_status
    assert response.json() == {'error': expected_code}
    assert len(calls) == 1


def test_sandbox_refuses_live_ado_egress(sandbox):
    import socket

    with pytest.raises(PermissionError, match='Sandbox prohibits'):
        socket.getaddrinfo('dev.azure.com', 443)


def test_config_save_and_restore_cannot_activate_a_source(sandbox):
    client, requests = sandbox
    from planner_lib.admin.config_manager import ConfigManager
    storage = client.app.state.container.get('storage')
    manager = ConfigManager(storage)
    current = storage.load('config', 'authentication')
    incompatible = {**current, 'active': 'enrollment', 'backend_credentials': 'pat'}
    with pytest.raises(ValueError, match='transition'):
        manager.save_config('authentication', incompatible)
    with pytest.raises(ValueError, match='transition'):
        manager.restore_backup({'schema_revision': 44, 'config': {'authentication': incompatible}})
    with pytest.raises(ValueError, match='fixture transport'):
        manager.save_config('ado_config', {'organization_url': 'example', 'feature_flags': {}})


def test_entra_denies_pat_and_enrollment_mutations(sandbox):
    client, requests = sandbox
    for path in ('/api/config', '/admin/v1/users', '/api/session',
                 '/api/auth/enrollment-status', '/api/auth/admin-reset/account'):
        assert client.post(path, json={}).status_code == 403


def test_login_body_limit(sandbox):
    client, requests = sandbox
    response = client.post('/api/auth/login/complete', content=b'x' * 16385)
    assert response.status_code == 401
    assert not requests


def test_cancellation_validates_browser_and_consumes_pending_state(sandbox):
    client, requests = sandbox
    begin = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()
    assert client.get('/api/auth/login/callback', params={
        'state': 'tampered', 'error': 'cancelled'}, follow_redirects=False).status_code == 401
    cancelled = client.get('/api/auth/login/callback', params={
        'state': begin['state'], 'error': 'cancelled'}, follow_redirects=False)
    assert cancelled.status_code == 303
    assert client.post('/api/auth/login/complete', json={'state': begin['state'], 'code': 'code'}).status_code == 401


def test_admin_selection_stages_without_activation_or_session_invalidation(client):
    assert client.post('/api/auth/enroll', json={
        'email': 'staging@example.test', 'name': 'Staging Administrator',
    }).status_code == 200
    before = client.get('/api/auth/settings').json()
    response = client.post('/api/auth/settings', json={'selected': 'entra'})
    assert response.status_code == 200
    assert response.json() == {**before, 'selected': 'entra'}
    assert client.get('/api/auth/me').status_code == 200
    assert client.post('/api/auth/settings', json={'selected': 'entra', 'active': 'entra'}).status_code == 422