import json
import secrets
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from planner_lib.main import Config, create_app
from planner_lib.migrations.contracts import TARGET_REVISION
from planner_lib.session.broker import BrokerClient, BrokerSettings, AuthFailure, SANDBOX_TENANT


pytestmark = pytest.mark.real_auth
CONTRACT = json.loads((Path(__file__).resolve().parents[3] / 'entra-id' / 'protocol-v1.json').read_text())


@pytest.fixture
def sandbox(monkeypatch, tmp_path, request):
    origin = getattr(request, 'param', 'http://localhost:8765')
    secret_file = tmp_path / 'instance-secret'
    secret_file.write_text(secrets.token_urlsafe(32))
    secret_file.chmod(0o600)
    for key, value in {
        'PLANNER_AUTH_PROVIDER': 'entra', 'PLANNER_AUTH_INSTANCE': 'alpha',
        'PLANNER_AUTH_URL': 'http://localhost:8765/auth/',
        'PLANNER_AUTH_PUBLIC_URL': origin + '/auth/',
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
            return httpx.Response(200, json={**metadata, 'ready': True, 'live_capable': False,
                'instances': ['alpha'], 'completion_urls': {'alpha': settings.completion_url},
                'tenant': SANDBOX_TENANT, 'organization': 'example'})
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
        if request.url.path.endswith('/token'):
            import time
            return httpx.Response(200, json={**metadata, 'resource': 'ado', 'token_kind': 'fixture',
                'access_token': 'invalid-sandbox-ado-fixture', 'expires_at': time.time() + 300})
        raise AssertionError('Unexpected broker operation')

    app.state.container.get('broker_client').transport = httpx.MockTransport(transport)
    with TestClient(app, base_url=origin) as client:
        yield client, requests


def test_mock_auth_preserves_admin_backend_choice_and_authentication(sandbox):
    from planner_lib.admin.config_manager import ConfigManager
    from planner_lib.session.broker import prepare_sandbox

    client, requests = sandbox
    container = client.app.state.container
    storage = container.get('storage')
    settings = container.get('broker_client').settings
    authentication = dict(storage.load('config', 'authentication'))
    manager = ConfigManager(storage)
    local_config = {'organization_url': 'example', 'feature_flags': {'use_azure_mock_generator': True}}
    manager.save_config('ado_config', local_config)
    prepare_sandbox(storage, settings)
    assert storage.load('config', 'ado_config') == local_config
    assert storage.load('config', 'authentication') == authentication
    assert client.get('/api/auth/config').json()['mode'] == 'entra'
    with pytest.raises(ValueError, match='fixture transport'):
        manager.save_config('ado_config', {'organization_url': 'example', 'feature_flags': {}})
    assert storage.load('config', 'ado_config') == local_config
    assert requests == []


@pytest.mark.parametrize('sandbox', ['http://localhost:8765', 'https://planner.example.test'], indirect=True)
def test_sandbox_login_profile_logout_and_disabled_enrollment(sandbox):
    client, requests = sandbox
    assert client.get('/api/auth/config').json()['mode'] == 'entra'
    assert client.get('/api/auth/me').json()['account'] is None
    assert client.post('/api/auth/enroll', json={'email': 'new@example.test'}).status_code == 403
    begin = client.post('/api/auth/login/begin', headers={'Origin': str(client.base_url).rstrip('/')})
    assert begin.status_code == 200
    assert 'HttpOnly' in begin.headers['set-cookie']
    assert ('Secure' in begin.headers['set-cookie']) == (client.base_url.scheme == 'https')
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


@pytest.mark.parametrize('remote_state', ['expired', 'revoked'])
def test_remote_grant_expiry_preserves_local_routes_and_requires_ado_reauthentication(sandbox, remote_state):
    import time
    from planner_lib.middleware.session import SESSION_COOKIE

    client, requests = sandbox
    state = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()['state']
    profile = client.post('/api/auth/login/complete', json={'state': state, 'code': 'code'}).json()
    container = client.app.state.container
    sessions = container.get('session_manager')
    sid = client.cookies.get(SESSION_COOKIE)
    context = sessions.get(sid)
    storage = container.get('storage')
    grant = storage.load('auth_grants', context['binding'])
    storage.save('auth_grants', context['binding'], {
        **grant, 'expires_at': time.time() - 1 if remote_state == 'expired' else grant['expires_at'],
        'revoked': remote_state == 'revoked',
    })
    before_local = len(requests)

    assert client.get('/admin/check').status_code == 200
    current = client.get('/api/auth/me').json()
    assert current['account'] == profile['account']
    assert current['status'] == 'interaction_required'
    assert len(requests) == before_local
    result = client.post('/api/auth/sandbox/operation')
    assert result.status_code == 409
    assert result.json() == {'error': 'interaction_required'}
    assert len(requests) == before_local
    assert sessions.is_valid(sid)
    assert client.get('/admin/check').status_code == 200
    assert client.post('/api/auth/logout').status_code == 200
    assert not sessions.is_valid(sid)


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
    with pytest.raises(ValueError, match='deployment-controlled'):
        manager.save_config('authentication', incompatible)
    with pytest.raises(ValueError, match='deployment-controlled'):
        manager.restore_backup({'schema_revision': TARGET_REVISION, 'config': {'authentication': incompatible}})
    with pytest.raises(ValueError, match='fixture transport'):
        manager.save_config('ado_config', {'organization_url': 'example', 'feature_flags': {}})


def test_entra_denies_pat_and_enrollment_mutations(sandbox):
    client, requests = sandbox
    for path in ('/api/config', '/admin/v1/users', '/api/session',
                 '/api/auth/enrollment-status', '/api/auth/admin-reset/account'):
        assert client.post(path, json={}).status_code == 403


def test_delegated_provider_requires_exact_session_and_revokes_locally(sandbox):
    from planner_lib.middleware.session import current_session_context, SESSION_COOKIE
    client, requests = sandbox
    state = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()['state']
    profile = client.post('/api/auth/login/complete', json={'state': state, 'code': 'code'}).json()
    provider = client.app.state.container.get('credential_provider')
    context = client.app.state.container.get('session_manager').get(client.cookies.get(SESSION_COOKIE))
    token = current_session_context.set(context)
    try:
        credential = provider.get_credential(profile['account']['uuid'])
        assert credential['kind'] == 'bearer'
        assert credential['transport'] == 'fixture'
        assert credential['binding'] == context['binding']
        assert credential['token'] == 'invalid-sandbox-ado-fixture'
        assert requests[-1].url.path.endswith('/token')
        with pytest.raises(AuthFailure, match='invalid_session'):
            provider.get_credential('another-account')
        assert client.post('/api/auth/logout').status_code == 200
        with pytest.raises(AuthFailure, match='invalid_session'):
            provider.renew(credential)
    finally:
        current_session_context.reset(token)


def test_sandbox_delegated_operation_uses_bound_fixture_without_credential_disclosure(sandbox):
    client, requests = sandbox
    state = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()['state']
    profile = client.post('/api/auth/login/complete', json={'state': state, 'code': 'code'}).json()
    result = client.post('/api/auth/sandbox/operation')
    assert result.status_code == 200
    assert result.json() == {'account_id': profile['account']['uuid'], 'transport': 'fixture', 'status': 'completed'}
    assert 'invalid-sandbox-ado-fixture' not in result.text
    assert requests[-1].url.path.endswith('/token')


@pytest.mark.parametrize('status,code', [(403, 'access_denied'), (409, 'interaction_required'), (503, 'auth_unavailable')])
def test_delegated_acquisition_keeps_denial_interaction_and_outage_distinct(sandbox, status, code):
    from planner_lib.middleware.session import current_session_context, SESSION_COOKIE
    client, requests = sandbox
    state = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()['state']
    profile = client.post('/api/auth/login/complete', json={'state': state, 'code': 'code'}).json()
    context = client.app.state.container.get('session_manager').get(client.cookies.get(SESSION_COOKIE))
    provider = client.app.state.container.get('credential_provider')
    broker = client.app.state.container.get('broker_client')
    broker.transport = httpx.MockTransport(lambda request: httpx.Response(status, json={'error': code}))
    token = current_session_context.set(context)
    try:
        with pytest.raises(AuthFailure) as raised:
            provider.get_credential(profile['account']['uuid'])
        assert (raised.value.status, raised.value.code) == (status, code)
    finally:
        current_session_context.reset(token)


@pytest.mark.parametrize('change', [
    {'resource': 'other'}, {'token_kind': 'bearer'}, {'access_token': ''},
    {'expires_at': 0}, {'expires_at': float('inf')}, {'refresh_token': 'forbidden'},
    {'generation': 'wrong-generation'},
])
def test_delegated_token_response_fails_closed(sandbox, change):
    import time
    client, requests = sandbox
    state = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()['state']
    client.post('/api/auth/login/complete', json={'state': state, 'code': 'code'})
    broker = client.app.state.container.get('broker_client')
    payload = {**broker.settings.metadata(), 'resource': 'ado', 'token_kind': 'fixture',
        'access_token': 'synthetic-token', 'expires_at': time.time() + 300, **change}
    broker.transport = httpx.MockTransport(lambda request: httpx.Response(200,
        content=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'}))
    response = client.post('/api/auth/sandbox/operation')
    assert response.status_code == 503
    assert response.json() == {'error': 'auth_configuration_error'}
    assert 'synthetic-token' not in response.text


def test_delegated_publication_rejects_changed_epoch(sandbox):
    client, requests = sandbox
    state = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()['state']
    client.post('/api/auth/login/complete', json={'state': state, 'code': 'code'})
    container = client.app.state.container
    storage = container.get('storage')
    binding = next(iter(storage.list_keys('auth_grants')))
    grant = storage.load('auth_grants', binding)
    credential = container.get('credential_provider').acquire(grant['account_id'], binding, grant['epoch'])
    policy = storage.load('config', 'authentication')
    storage.save('config', 'authentication', {**policy, 'epoch': policy['epoch'] + 1})
    with pytest.raises(AuthFailure, match='invalid_session'):
        with container.get('credential_provider').publication_guard(credential):
            pytest.fail('A revoked epoch must not publish')


def test_delegated_renewal_rejects_a_deleted_owning_session(sandbox):
    from planner_lib.middleware.session import SESSION_COOKIE
    client, requests = sandbox
    state = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()['state']
    client.post('/api/auth/login/complete', json={'state': state, 'code': 'code'})
    container = client.app.state.container
    sessions = container.get('session_manager')
    sid = client.cookies.get(SESSION_COOKIE)
    context = sessions.get(sid)
    provider = container.get('credential_provider')
    credential = provider.acquire(context['account_id'], context['binding'], 1)
    sessions.delete(sid)
    with pytest.raises(AuthFailure, match='invalid_session'):
        provider.renew(credential)


def test_login_body_limit(sandbox):
    client, requests = sandbox
    response = client.post('/api/auth/login/complete', content=b'x' * 16385)
    assert response.status_code == 401
    assert not requests


def test_verified_new_identity_is_provisioned_without_permissions_or_email_linking(sandbox):
    client, requests = sandbox
    broker = client.app.state.container.get('broker_client')
    transport = broker.transport

    def new_identity(request):
        response = transport.handle_request(request)
        if request.url.path.endswith('/redeem'):
            value = json.loads(response.content)
            value['identity'] = {'tid': SANDBOX_TENANT,
                'oid': '55555555-5555-5555-5555-555555555555',
                'email': 'alex@example.test', 'name': 'Different Alex'}
            return httpx.Response(200, json=value)
        return response

    accounts = client.app.state.container.get('account_manager')
    existing_uuid = accounts.get_account_id('alex@example.test')
    broker.transport = httpx.MockTransport(new_identity)
    state = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()['state']
    response = client.post('/api/auth/login/complete', json={'state': state, 'code': 'code'})
    assert response.status_code == 200
    assert response.json()['account']['uuid'] != existing_uuid
    assert response.json()['account']['name'] == 'Different Alex'
    assert response.json()['permissions'] == []
    assert accounts.get_account_by_id(existing_uuid)['permissions'] == ['admin']


def test_admin_link_requires_proof_and_preserves_uuid_permissions(sandbox):
    from planner_lib.accounts.config import AccountCredentialsPayload
    client, requests = sandbox
    accounts = client.app.state.container.get('account_manager')
    target = accounts.create_account(AccountCredentialsPayload(email='existing@example.test'), permissions=['cost'])['id']
    state = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()['state']
    assert client.post('/api/auth/login/complete', json={'state': state, 'code': 'code'}).status_code == 200
    begun = client.post('/api/auth/links/begin', json={'account_id': target},
        headers={'Origin': 'http://localhost:8765'})
    assert begun.status_code == 200
    assert list(client.app.state.container.get('storage').list_keys('auth_link_approvals'))
    broker = client.app.state.container.get('broker_client')
    transport = broker.transport

    def proof(request):
        response = transport.handle_request(request)
        if request.url.path.endswith('/redeem'):
            value = json.loads(response.content)
            value['identity'] = {'tid': SANDBOX_TENANT,
                'oid': '55555555-5555-5555-5555-555555555555',
                'email': 'proven@example.test', 'name': 'Proven Identity'}
            return httpx.Response(200, json=value)
        return response

    broker.transport = httpx.MockTransport(proof)
    completed = client.post('/api/auth/login/complete', json={'state': begun.json()['state'], 'code': 'proof-code'})
    assert completed.status_code == 200
    assert completed.json()['account']['uuid'] == target
    assert completed.json()['permissions'] == ['cost']
    assert client.post('/api/auth/links/begin', json={'account_id': target},
        headers={'Origin': 'http://localhost:8765'}).status_code == 403


def test_link_cannot_reassign_identity_or_remove_last_admin(sandbox):
    from planner_lib.accounts.config import AccountCredentialsPayload
    client, requests = sandbox
    accounts = client.app.state.container.get('account_manager')
    admin = accounts.get_account_id('alex@example.test')
    with pytest.raises(ValueError, match='final admin'):
        accounts.delete_account(admin)
    target = accounts.create_account(AccountCredentialsPayload(email='target@example.test'))['id']
    state = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()['state']
    client.post('/api/auth/login/complete', json={'state': state, 'code': 'code'})
    begun = client.post('/api/auth/links/begin', json={'account_id': target},
        headers={'Origin': 'http://localhost:8765'}).json()
    result = client.post('/api/auth/login/complete', json={'state': begun['state'], 'code': 'linked-identity'})
    assert result.status_code == 403
    assert accounts.get_account_by_id(admin)['permissions'] == ['admin']
    assert accounts.get_account_by_id(target)['permissions'] == []


def test_link_proof_requires_approving_session_to_remain_valid(sandbox):
    from planner_lib.accounts.config import AccountCredentialsPayload
    from planner_lib.middleware.session import SESSION_COOKIE
    client, requests = sandbox
    accounts = client.app.state.container.get('account_manager')
    target = accounts.create_account(AccountCredentialsPayload(email='target@example.test'))['id']
    state = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()['state']
    client.post('/api/auth/login/complete', json={'state': state, 'code': 'code'})
    begun = client.post('/api/auth/links/begin', json={'account_id': target},
        headers={'Origin': 'http://localhost:8765'}).json()
    client.app.state.container.get('session_manager').delete(client.cookies.get(SESSION_COOKIE))
    result = client.post('/api/auth/login/complete', json={'state': begun['state'], 'code': 'identity-proof'})
    assert result.status_code == 403


def test_cancellation_validates_browser_and_consumes_pending_state(sandbox):
    client, requests = sandbox
    begin = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()
    assert client.get('/api/auth/login/callback', params={
        'state': 'tampered', 'error': 'cancelled'}, follow_redirects=False).status_code == 401
    cancelled = client.get('/api/auth/login/callback', params={
        'state': begin['state'], 'error': 'cancelled'}, follow_redirects=False)
    assert cancelled.status_code == 303
    assert client.post('/api/auth/login/complete', json={'state': begin['state'], 'code': 'code'}).status_code == 401


def test_staged_link_proves_admin_without_issuing_entra_session(sandbox):
    from planner_lib.session.enrollment import EnrollmentLoginAdapter

    client, requests = sandbox
    container = client.app.state.container
    storage = container.get('storage')
    accounts = container.get('account_manager')
    sessions = container.get('session_manager')
    admin = accounts.get_account_by_id(accounts.get_account_id('alex@example.test'))
    storage.save('config', 'authentication', {
        'version': 1, 'selected': 'enrollment', 'active': 'enrollment',
        'backend_credentials': 'pat', 'epoch': 1})
    login = EnrollmentLoginAdapter(container.get('auth_manager'), accounts, storage)
    device, sid, enrolled = login.enroll('alex@example.test', 'Alex Sandbox')
    adapter = container.get('login_adapter')
    binding, begun = adapter.begin_link(admin['id'], admin['id'], sid)
    assert adapter.complete(begun['state'], 'code', binding, sid) is None
    assert sessions.is_valid(sid)
    assert storage.load('config', 'authentication')['active'] == 'enrollment'
    proof = storage.load('auth_transition_proofs', admin['id'])
    assert proof['epoch'] == 1
    assert not list(storage.list_keys('auth_grants'))


def test_staged_browser_callback_and_admin_proof_need_no_pat(sandbox, monkeypatch, tmp_path):
    from planner_lib.middleware.session import SESSION_COOKIE
    from planner_lib.accounts.config import AccountCredentialsPayload

    source = sandbox[0].app.state.container
    monkeypatch.setenv('PLANNER_AUTH_PROVIDER', 'enrollment')
    app = create_app(Config(storage_backend='memory', data_dir=str(tmp_path / 'staged'), static_dir='www'))
    app.state.container.get('broker_client').transport = source.get('broker_client').transport
    with TestClient(app, base_url='http://localhost:8765') as client:
        assert client.post('/api/auth/enroll', json={
            'email': 'alex@example.test', 'name': 'Alex Sandbox'}).status_code == 200
        sid = client.cookies.get(SESSION_COOKIE)
        accounts = app.state.container.get('account_manager')
        admin_id = accounts.get_account_id('alex@example.test')
        monkeypatch.setattr(app.state.container.get('credential_policy'), 'credential_error', lambda user: 'pat_invalid')
        begun = client.post('/api/auth/links/begin', json={'account_id': admin_id},
                            headers={'Origin': 'http://localhost:8765'})
        assert begun.status_code == 200
        assert client.get('/api/auth/login/callback', params={
            'state': begun.json()['state'], 'code': 'code'}).status_code == 200
        assert client.cookies.get(SESSION_COOKIE) == sid
        assert app.state.container.get('session_manager').is_valid(sid)
        assert app.state.container.get('storage').exists('auth_transition_proofs', admin_id)
        assert client.post('/api/auth/settings', json={'selected': 'entra'}).status_code == 409


def test_entra_rejects_pat_at_account_storage_boundary(sandbox):
    from planner_lib.accounts.config import AccountCredentialsPayload

    accounts = sandbox[0].app.state.container.get('account_manager')
    with pytest.raises(ValueError, match='forbids PAT'):
        accounts.update_credentials(AccountCredentialsPayload(email='alex@example.test', pat='new-synthetic-pat'))


def test_sandbox_wiki_events_use_renewed_acting_session_fixture(sandbox):
    client, requests = sandbox
    begun = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()
    profile = client.post('/api/auth/login/complete', json={'state': begun['state'], 'code': 'code'}).json()
    response = client.post('/api/auth/sandbox/wiki')
    assert response.status_code == 200
    assert response.json() == {'account_id': profile['account']['uuid'], 'transport': 'fixture', 'status': 'completed'}
    storage = client.app.state.container.get('storage')
    records = [storage.load('sandbox_wiki', key) for key in storage.list_keys('sandbox_wiki')]
    assert len(records) == 1
    assert records[0]['account_id'] == profile['account']['uuid']
    assert records[0]['revision'] == 3
    assert sum(request.url.path.endswith('/token') for request in requests) >= 7
def test_admin_selection_rejected_without_activation_or_session_invalidation(client):
    assert client.post('/api/auth/enroll', json={
        'email': 'staging@example.test', 'name': 'Staging Administrator',
    }).status_code == 200
    before = client.get('/api/auth/settings').json()
    response = client.post('/api/auth/settings', json={'selected': 'entra'})
    assert response.status_code == 409
    assert response.json() == {'error': 'deployment_policy_required'}
    assert client.get('/api/auth/settings').json() == before
    assert client.get('/api/auth/me').status_code == 200
    assert client.post('/api/auth/settings', json={'selected': 'entra', 'active': 'entra'}).status_code == 422


def test_sandbox_fleet_transition_requires_proof_and_resumes_after_commit(sandbox):
    from types import SimpleNamespace
    from uuid import uuid4
    from planner_lib.session.enrollment import EnrollmentLoginAdapter
    from planner_lib.session.policy import require_serving_policy
    from planner_lib.session.transition import SandboxFleetTransition

    client, requests = sandbox
    container = client.app.state.container
    storage = container.get('storage')
    accounts = container.get('account_manager')
    sessions = container.get('session_manager')
    storage.save('config', 'authentication', {
        'version': 1, 'selected': 'enrollment', 'active': 'enrollment',
        'backend_credentials': 'pat', 'epoch': 1})
    login = EnrollmentLoginAdapter(container.get('auth_manager'), accounts, storage)
    device, sid, enrolled = login.enroll('alex@example.test', 'Alex Sandbox')
    admin_id = accounts.get_account_id('alex@example.test')
    instance = SimpleNamespace(storage=storage, accounts=accounts, sessions=sessions,
                               client=container.get('broker_client'))
    transition_id = str(uuid4())
    transition = SandboxFleetTransition({'alpha': instance}, transition_id)
    with pytest.raises(ValueError, match='confirmation'):
        transition.execute()
    with pytest.raises(ValueError, match='proof'):
        transition.execute(confirmed=True)
    adapter = container.get('login_adapter')
    binding, begun = adapter.begin_link(admin_id, admin_id, sid)
    adapter.complete(begun['state'], 'code', binding, sid)
    original = accounts.get_account_by_id(admin_id)

    def crash(name, state):
        if state == 'committed':
            raise RuntimeError('injected crash')

    transition.fault = crash
    with pytest.raises(RuntimeError, match='injected crash'):
        transition.execute(confirmed=True)
    assert storage.load('config', 'authentication')['epoch'] == 2
    assert not list(storage.list_keys('auth_sessions'))
    assert storage.load('account_auth', admin_id) == {'enrolled': False}
    assert accounts.get_account_by_id(admin_id)['permissions'] == original['permissions']
    with pytest.raises(PermissionError, match='fenced'):
        require_serving_policy(storage)
    with pytest.raises(ValueError, match='Cannot abort'):
        transition.abort()
    transition.fault = None
    transition.execute(confirmed=True)
    require_serving_policy(storage)
    assert storage.load('system', 'authentication_transition')['state'] == 'released'
    transition.execute(confirmed=True)
    assert storage.load('config', 'authentication')['epoch'] == 2


@pytest.mark.parametrize('failed_state', ['prepared', 'fenced', 'committed', 'released'])
def test_two_instance_transition_failure_is_recoverable_without_mixed_serving(sandbox, failed_state):
    from dataclasses import replace
    from types import SimpleNamespace
    from uuid import uuid4
    from planner_lib.accounts.config import AccountManager
    from planner_lib.middleware.session import SessionManager
    from planner_lib.session.auth import AuthManager
    from planner_lib.session.broker import EntraLoginAdapter
    from planner_lib.session.policy import SessionPolicy, require_serving_policy
    from planner_lib.session.transition import SandboxFleetTransition
    from planner_lib.storage.memory_backend import MemoryStorage

    source = sandbox[0].app.state.container
    instances = {}
    for name in ('alpha', 'beta'):
        storage = MemoryStorage()
        for namespace in ('system', 'config', 'accounts', 'account_auth', 'external_identities'):
            for key in source.get('storage').list_keys(namespace):
                storage.save(namespace, key, source.get('storage').load(namespace, key))
        storage.save('config', 'authentication', {
            'version': 1, 'selected': 'enrollment', 'active': 'enrollment',
            'backend_credentials': 'pat', 'epoch': 1})
        accounts = AccountManager(storage)
        sessions = SessionManager(accounts, storage, auth_policy=SessionPolicy(storage))
        auth = AuthManager(storage, accounts, sessions)
        device, account_key, sid = auth.enroll('alex@example.test', 'Alex')
        settings = replace(source.get('broker_client').settings, instance=name)

        def transport(request, settings=settings):
            if request.url.path.endswith('/deployment/readiness'):
                return httpx.Response(200, json={**settings.metadata(), 'ready': True,
                    'instances': ['alpha', 'beta'],
                    'completion_urls': {settings.instance: settings.completion_url},
                    'tenant': SANDBOX_TENANT, 'organization': 'example'})
            return source.get('broker_client').transport.handle_request(request)

        client = BrokerClient(settings, transport=httpx.MockTransport(transport))
        login = EntraLoginAdapter(storage, accounts, sessions, client)
        admin_id = accounts.get_account_id('alex@example.test')
        binding, begun = login.begin_link(admin_id, admin_id, sid)
        login.complete(begun['state'], 'code', binding, sid)
        instances[name] = SimpleNamespace(storage=storage, accounts=accounts, sessions=sessions, client=client)

    def crash(name, state):
        if name == 'alpha' and state == failed_state:
            raise RuntimeError('injected fleet crash')

    transition = SandboxFleetTransition(instances, str(uuid4()), fault=crash)
    with pytest.raises(RuntimeError, match='fleet crash'):
        transition.execute(confirmed=True)
    if failed_state in ('committed', 'released'):
        for instance in instances.values():
            if instance.storage.load('system', 'authentication_transition')['state'] != 'released':
                with pytest.raises(PermissionError):
                    require_serving_policy(instance.storage)
        with pytest.raises(ValueError, match='Cannot abort'):
            transition.abort()
    else:
        transition.abort()
        for instance in instances.values():
            assert instance.storage.load('system', 'authentication_transition')['state'] == 'idle'
            assert instance.storage.load('config', 'authentication')['epoch'] == 1
    SandboxFleetTransition(instances, transition.transition_id).execute(confirmed=True)
    for instance in instances.values():
        require_serving_policy(instance.storage)
        assert instance.storage.load('config', 'authentication')['epoch'] == 2
        assert instance.storage.load('system', 'authentication_transition')['state'] == 'released'


@pytest.mark.parametrize('failure', ['expired', 'revoked_session', 'revoked_grant', 'lost_admin', 'lost_link', 'omitted_member'])
def test_transition_rejects_lost_authority_before_fencing(sandbox, failure):
    import time
    from types import SimpleNamespace
    from uuid import uuid4
    from planner_lib.session.enrollment import EnrollmentLoginAdapter
    from planner_lib.session.transition import SandboxFleetTransition

    container = sandbox[0].app.state.container
    storage = container.get('storage')
    accounts = container.get('account_manager')
    sessions = container.get('session_manager')
    client = container.get('broker_client')
    storage.save('config', 'authentication', {
        'version': 1, 'selected': 'enrollment', 'active': 'enrollment',
        'backend_credentials': 'pat', 'epoch': 1})
    device, sid, enrollment = EnrollmentLoginAdapter(container.get('auth_manager'), accounts, storage).enroll(
        'alex@example.test', 'Alex')
    admin_id = accounts.get_account_id('alex@example.test')
    adapter = container.get('login_adapter')
    binding, begun = adapter.begin_link(admin_id, admin_id, sid)
    adapter.complete(begun['state'], 'code', binding, sid)
    proof = storage.load('auth_transition_proofs', admin_id)
    if failure == 'expired':
        storage.save('auth_transition_proofs', admin_id, {**proof, 'expires_at': time.time() - 1})
    elif failure == 'revoked_session':
        sessions.delete(sid)
    elif failure == 'lost_admin':
        account = storage.load('accounts', 'alex@example.test')
        storage.save('accounts', 'alex@example.test', {**account, 'permissions': []})
    elif failure == 'lost_link':
        for key in list(storage.list_keys('external_identities')):
            storage.delete('external_identities', key)
    else:
        original = client.transport

        def transport(request):
            response = original.handle_request(request)
            value = json.loads(response.content)
            if failure == 'revoked_grant' and request.url.path.endswith('/status'):
                value['status'] = 'revoked'
            if failure == 'omitted_member' and request.url.path.endswith('/deployment/readiness'):
                value['instances'] = ['alpha', 'beta']
            return httpx.Response(200, json=value)

        client.transport = httpx.MockTransport(transport)
    transition = SandboxFleetTransition({'alpha': SimpleNamespace(
        storage=storage, accounts=accounts, sessions=sessions, client=client)}, str(uuid4()))
    with pytest.raises(ValueError):
        transition.execute(confirmed=True)
    assert storage.load('system', 'authentication_transition')['state'] == 'idle'
    assert storage.load('config', 'authentication')['epoch'] == 1
    assert storage.load('account_auth', admin_id)['enrolled'] is True


@pytest.mark.parametrize('invalid', [{'state': 'idle'}, {'state': 'unknown'}, {'id': 'not-a-uuid'}, {'secret': 'forbidden'}])
def test_transition_journal_is_strict_without_any_sessions(sandbox, invalid):
    from planner_lib.migrations.contracts import SchemaError
    from planner_lib.migrations.revisions import validate_records

    storage = sandbox[0].app.state.container.get('storage')
    assert not list(storage.list_keys('auth_sessions'))
    record = storage.load('system', 'authentication_transition')
    if invalid == {'state': 'idle'}:
        del record['fleet']
    else:
        record.update(invalid)
    storage.save('system', 'authentication_transition', record)
    with pytest.raises(SchemaError, match='transition'):
        validate_records(storage, TARGET_REVISION)