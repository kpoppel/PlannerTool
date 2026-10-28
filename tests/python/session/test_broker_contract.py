import json
import secrets
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from fastapi import Request

from planner_lib.main import Config, create_app
from planner_lib.migrations.contracts import TARGET_REVISION
from planner_lib.session.broker import BrokerClient, BrokerSettings, AuthFailure


pytestmark = pytest.mark.real_auth
CONTRACT = json.loads((Path(__file__).resolve().parents[3] / 'entra-id' / 'protocol-v1.json').read_text())
BROKER_ISSUER = 'https://auth.example.test'


def complete_login(client, state):
    response = client.get('/api/auth/login/callback', params={'state': state, 'code': 'code'})
    return client.get('/api/auth/me') if response.status_code == 200 else response


def test_broker_settings_require_no_environment_or_generation(monkeypatch, tmp_path):
    secret = tmp_path / 'service-secret'
    secret.write_text(secrets.token_urlsafe(32))
    secret.chmod(0o600)
    for key in ('PLANNER_AUTH_ENVIRONMENT', 'PLANNER_AUTH_GENERATION'):
        monkeypatch.delenv(key, raising=False)
    for key, value in {
        'PLANNER_AUTH_INSTANCE': 'alpha', 'PLANNER_AUTH_URL': 'http://auth-central/auth/',
        'PLANNER_AUTH_PUBLIC_URL': 'https://planner.example.test/auth/',
        'PLANNER_AUTH_UPSTREAM_MODE': 'entra', 'PLANNER_AUTH_SECRET_FILE': str(secret),
    }.items():
        monkeypatch.setenv(key, value)
    settings = BrokerSettings.from_env()
    assert settings.metadata() == {
        'protocol': 'plannertool-auth/1', 'upstream_mode': 'entra',
        'broker_url': 'https://planner.example.test/auth/',
    }


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
        'PLANNER_AUTH_UPSTREAM_MODE': 'mock',
        'PLANNER_AUTH_SECRET_FILE': str(secret_file),
    }.items():
        monkeypatch.setenv(key, value)
    app = create_app(Config(storage_backend='memory', data_dir=str(tmp_path), static_dir='www'))
    from planner_lib.accounts.config import AccountCredentialsPayload
    from planner_lib.session.identity import identity_key

    container = app.state.container
    storage = container.get('storage')
    accounts = container.get('account_manager')
    settings = app.state.container.get('broker_client').settings
    identities = {
        '33333333-3333-3333-3333-333333333333': ('alex@example.test', 'Alex Sandbox'),
        '44444444-4444-4444-4444-444444444444': ('sam@example.test', 'Sam Sandbox'),
    }
    for index, (subject, (email, name)) in enumerate(identities.items()):
        accounts.create_account(AccountCredentialsPayload(email=email), permissions=['admin'] if index == 0 else [])
        storage.save('external_identities', identity_key(BROKER_ISSUER, subject), {
            'version': 3, 'issuer': BROKER_ISSUER, 'subject': subject,
            'account_id': accounts.get_account_id(email), 'environment': settings.metadata(),
            'name': name, 'email': email,
        })
    storage.save('config', 'ado_config', {
        'organization_url': 'example', 'feature_flags': {'use_azure_mock': True}})
    requests = []

    def transport(request):
        assert request.headers['authorization'] == 'Bearer ' + secret_file.read_text()
        requests.append(request)
        metadata = settings.metadata()
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
                'identity': {'issuer': BROKER_ISSUER, 'subject': '33333333-3333-3333-3333-333333333333',
                             'email': 'alex@example.test', 'name': 'Alex Sandbox'},
                'grant': 'opaque-server-only-grant', 'expires_at': time.time() + 3600})
        if request.url.path.endswith('/revoke'):
            return httpx.Response(200, json={**metadata, 'status': 'revoked'})
        if request.url.path.endswith('/status'):
            return httpx.Response(200, json={**metadata, 'status': 'active'})
        if request.url.path.endswith('/token'):
            import time
            return httpx.Response(200, json={**metadata, 'resource': 'ado', 'token_kind': 'bearer',
                'access_token': 'synthetic-ado-token', 'expires_at': time.time() + 300})
        raise AssertionError('Unexpected broker operation')

    app.state.container.get('broker_client').transport = httpx.MockTransport(transport)
    from planner_lib.middleware.session import get_session_credential_from_request

    @app.post('/api/auth/sandbox/operation')
    async def delegated_operation(request: Request):
        credential = get_session_credential_from_request(request)
        return {'account_id': credential['user_id'], 'transport': credential['transport'], 'status': 'completed'}

    @app.post('/api/auth/sandbox/wiki')
    async def wiki_operation(request: Request):
        get_session_credential_from_request(request)
        pytest.fail('Fake credential reached wiki operations')

    with TestClient(app, base_url=origin) as client:
        yield client, requests


def test_external_identity_keys_are_opaque_and_issuer_scoped():
    from planner_lib.session.identity import identity_key

    assert identity_key('https://auth.example.test', 'opaque-user') == identity_key(
        'https://auth.example.test', 'opaque-user')
    assert identity_key('https://auth.example.test', 'opaque-user') != identity_key(
        'https://other.example.test', 'opaque-user')
    assert identity_key('issuer:subject', 'user') != identity_key('issuer', 'subject:user')
    for issuer, subject in [('', 'user'), ('issuer', ''), ('issuer', None),
                            ('issuer', 'user\n'), ('issuer', 'x' * 513)]:
        with pytest.raises(ValueError):
            identity_key(issuer, subject)


def prepare_live_accounts(client, identity):
    import time
    from dataclasses import replace
    from planner_lib.session.identity import initialize_legacy_claims

    container = client.app.state.container
    storage = container.get('storage')
    for key in list(storage.list_keys('external_identities')):
        storage.delete('external_identities', key)
    initialize_legacy_claims(storage)
    broker = container.get('broker_client')
    login = container.get('login_adapter')
    settings = replace(broker.settings, upstream_mode='entra')
    broker.settings = settings
    login.settings = settings
    login.identities.settings = settings

    def transport(request):
        metadata = settings.metadata()
        payload = json.loads(request.content)
        if request.url.path.endswith('/begin'):
            value = {'transaction': 'live-transaction', 'expires_at': time.time() + 300,
                     'authorization_url': settings.public_url + 'v1/browser/authorize?transaction=live-transaction'}
        elif request.url.path.endswith('/redeem'):
            value = {'transaction': payload['transaction'], 'identity': identity,
                     'grant': 'live-grant', 'expires_at': time.time() + 3600}
        elif request.url.path.endswith('/status'):
            value = {'status': 'active'}
        else:
            raise AssertionError('Unexpected operation')
        return httpx.Response(200, json={**metadata, **value})

    broker.transport = httpx.MockTransport(transport)
    return login


def test_live_email_claim_is_one_time_and_keeps_existing_permissions(sandbox):
    from planner_lib.accounts.config import AccountCredentialsPayload
    client, requests = sandbox
    identity = {'issuer': BROKER_ISSUER, 'subject': 'live-subject',
                'name': 'Live User', 'email': 'ALEX@EXAMPLE.TEST'}
    login = prepare_live_accounts(client, identity)
    original = login.accounts.get_account_id('alex@example.test')
    assert login.identities.resolve(identity)['id'] == original
    assert login.identities.resolve({**identity, 'email': 'changed@example.test'})['id'] == original
    assert login.accounts.get_account_by_id(original)['permissions'] == ['admin']
    assert original not in login.storage.load('system', 'legacy_email_claims')['accounts']
    new = login.identities.resolve({**identity, 'subject': 'different-identity'})
    assert new['id'] != original
    assert new['permissions'] == []
    later = login.accounts.create_account(AccountCredentialsPayload(email='later@example.test'), permissions=[])
    another = login.identities.resolve({**identity, 'subject': 'later-identity', 'email': 'later@example.test'})
    assert another['id'] != later['id']


def test_missing_email_manual_claim_moves_owned_data_and_rotates_session(sandbox):
    from planner_lib.storage.user_store import UserDataStore
    client, requests = sandbox
    login = prepare_live_accounts(client, {'issuer': BROKER_ISSUER,
        'subject': 'missing-email-subject', 'name': 'Live User'})
    destination = login.accounts.get_account_id('alex@example.test')
    state = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()['state']
    signed_in = complete_login(client, state)
    assert signed_in.status_code == 200
    source = signed_in.json()['account']['uuid']
    assert source != destination
    assert signed_in.json()['account']['email'] == ''
    assert signed_in.json()['capabilities']['linkAccount'] is True
    for namespace, register in (('views', 'view_register'), ('scenarios', 'scenario_register')):
        store = UserDataStore(namespace, register, register + '.lock', login.storage)
        store.save_item(destination, 'existing', {'name': 'Existing'})
        store.save_item(source, 'fresh', {'name': 'Fresh'})
    assert client.post('/api/auth/links/claim', json={'email': 'alex@example.test'},
                       headers={'Origin': 'https://other.example.test'}).status_code == 403
    claimed = client.post('/api/auth/links/claim', json={'email': 'alex@example.test'},
                          headers={'Origin': 'http://localhost:8765'})
    assert claimed.status_code == 200
    assert claimed.json()['account']['uuid'] == destination
    assert claimed.json()['permissions'] == ['admin']
    assert client.get('/api/auth/me').json()['account']['uuid'] == destination
    with pytest.raises(KeyError):
        login.accounts.get_account_by_id(source)
    for namespace, register in (('views', 'view_register'), ('scenarios', 'scenario_register')):
        assert login.storage.load(namespace, destination + '_existing')['name'] == 'Existing'
        assert login.storage.load(namespace, destination + '_fresh')['name'] == 'Fresh'
        assert login.storage.load(namespace, register)[destination + '_fresh']['user'] == destination
    assert client.post('/api/auth/links/claim', json={'email': 'sam@example.test'},
                       headers={'Origin': 'http://localhost:8765'}).status_code == 403


def test_fresh_live_installation_first_account_is_only_initial_admin(sandbox):
    client, requests = sandbox
    login = prepare_live_accounts(client, {'issuer': BROKER_ISSUER, 'subject': 'first', 'name': 'First'})
    for email in list(login.storage.list_keys('accounts')):
        login.storage.delete('accounts', email)
    login.storage.save('system', 'legacy_email_claims', {'initialized': True, 'accounts': []})
    first = login.identities.resolve({'issuer': BROKER_ISSUER, 'subject': 'first', 'name': 'First'})
    second = login.identities.resolve({'issuer': BROKER_ISSUER, 'subject': 'second', 'name': 'Second'})
    assert first['permissions'] == ['admin']
    assert second['permissions'] == []


def test_mock_to_live_startup_preserves_accounts_and_consumed_claims(sandbox, tmp_path, monkeypatch):
    from planner_lib.accounts.config import AccountCredentialsPayload
    client, requests = sandbox
    root = tmp_path / 'cutover'
    config = Config(data_dir=str(root), static_dir='www')
    mock_app = create_app(config)
    with TestClient(mock_app):
        login = mock_app.state.container.get('login_adapter')
        existing = login.accounts.create_account(AccountCredentialsPayload(email='owner@example.test'),
                                                 permissions=['admin'])['id']
        login.identities.resolve({'issuer': login.settings.public_url, 'subject': 'mock-subject',
            'name': 'Mock Owner', 'email': 'owner@example.test', 'link_existing_by_email': True})
        epoch = login.policy()['epoch']
    monkeypatch.setenv('PLANNER_AUTH_UPSTREAM_MODE', 'entra')
    live_app = create_app(config)
    with TestClient(live_app):
        login = live_app.state.container.get('login_adapter')
        assert login.policy()['epoch'] == epoch + 1
        assert not list(login.storage.list_keys('external_identities'))
        account = login.identities.resolve({'issuer': BROKER_ISSUER, 'subject': 'live-owner',
            'name': 'Live Owner', 'email': 'owner@example.test'})
        assert account['id'] == existing
        assert account['permissions'] == ['admin']
        assert login.storage.load('system', 'legacy_email_claims')['accounts'] == []
    restarted = create_app(config)
    with TestClient(restarted):
        login = restarted.state.container.get('login_adapter')
        assert login.policy()['epoch'] == epoch + 1
        assert login.storage.load('system', 'legacy_email_claims')['accounts'] == []


def test_manual_claim_collision_rolls_back_identity_and_data(sandbox):
    from planner_lib.storage.user_store import UserDataStore
    client, requests = sandbox
    login = prepare_live_accounts(client, {'issuer': BROKER_ISSUER,
        'subject': 'unclaimed-subject', 'name': 'New User'})
    source = login.identities.resolve({'issuer': BROKER_ISSUER,
        'subject': 'unclaimed-subject', 'name': 'New User'})['id']
    target = login.accounts.get_account_id('alex@example.test')
    store = UserDataStore('views', 'view_register', 'view_register.lock', login.storage)
    store.save_item(source, 'same-id', {'name': 'Fresh'})
    store.save_item(target, 'same-id', {'name': 'Existing'})
    with pytest.raises(ValueError, match='collision'):
        login.identities.claim(source, 'alex@example.test')
    assert store.load_item(source, 'same-id')['name'] == 'Fresh'
    assert store.load_item(target, 'same-id')['name'] == 'Existing'
    assert login.accounts.get_account_by_id(source)
    assert target in login.storage.load('system', 'legacy_email_claims')['accounts']


def test_other_broker_provider_uses_the_same_identity_contract(sandbox):
    from dataclasses import replace

    client, requests = sandbox
    login = client.app.state.container.get('login_adapter')
    login.identities.settings = replace(login.settings, upstream_mode='another_provider')
    identity = {'issuer': 'https://another.example.test', 'subject': 'opaque-user',
                'name': 'Another User', 'email': 'another@example.test'}
    account = login.identities.resolve(identity)
    assert account['permissions'] == []
    assert login.identities.resolve(identity)['id'] == account['id']
    other_issuer = login.identities.resolve({**identity, 'issuer': 'https://third.example.test'})
    assert other_issuer['id'] != account['id']
    with pytest.raises(AuthFailure, match='auth_configuration_error'):
        login.identities.resolve({**identity, 'link_existing_by_email': True})
    with pytest.raises(AuthFailure, match='auth_configuration_error'):
        login.identities.resolve({**identity, 'provider_specific_claim': 'not-part-of-the-contract'})


def set_broker_token_kind(client, token_kind):
    broker = client.app.state.container.get('broker_client')
    original = broker.transport

    def token_response(request):
        response = original.handle_request(request)
        value = json.loads(response.content)
        if request.url.path.endswith('/token'):
            value['token_kind'] = token_kind
        return httpx.Response(200, json=value)

    broker.transport = httpx.MockTransport(token_response)


def test_mock_auth_accepts_copied_accounts_and_preserves_configuration(sandbox, monkeypatch, tmp_path):
    from planner_lib.accounts.config import AccountCredentialsPayload

    monkeypatch.setenv('PLANNER_AUTH_PROVIDER', 'enrollment')
    config = Config(data_dir=str(tmp_path / 'copied'), static_dir='www')
    original = create_app(config)
    container = original.state.container
    storage = container.get('storage')
    accounts = container.get('account_manager')
    accounts.create_account(AccountCredentialsPayload(
        email='existing@example.test', pat='synthetic-existing-pat'), permissions=['admin'])
    ado_config = {'organization_url': 'copied-projects', 'feature_flags': {}}
    storage.save('config', 'ado_config', ado_config)
    namespaces = ('accounts', 'account_auth', 'config', 'views', 'scenarios', 'external_identities')
    before = {namespace: {key: storage.load(namespace, key) for key in storage.list_keys(namespace)}
              for namespace in namespaces}
    old_epoch = before['config']['authentication']['epoch']
    original.state.database_handle.close()

    monkeypatch.setenv('PLANNER_AUTH_PROVIDER', 'entra')
    with TestClient(create_app(config)) as client:
        storage = client.app.state.container.get('storage')
        for namespace, records in before.items():
            after = {key: storage.load(namespace, key) for key in storage.list_keys(namespace)}
            if namespace == 'config':
                records = {**records, 'authentication': {
                    'version': 1, 'selected': 'entra', 'active': 'entra',
                    'backend_credentials': 'delegated', 'epoch': old_epoch + 1}}
            assert after == records
        assert not storage.exists('system', 'sandbox_auth')
        assert client.get('/api/auth/config').json()['mode'] == 'broker'

    with TestClient(create_app(config)) as client:
        storage = client.app.state.container.get('storage')
        assert storage.load('config', 'authentication')['epoch'] == old_epoch + 1
        assert storage.load('config', 'ado_config') == ado_config


def test_new_entra_identity_can_sign_in_with_live_ado_without_pat(sandbox, monkeypatch):
    from planner_lib.session.identity import identity_key

    client, requests = sandbox
    container = client.app.state.container
    storage = container.get('storage')
    accounts = container.get('account_manager')
    admin = accounts.get_account_by_id(accounts.get_account_id('alex@example.test'))
    storage.delete('external_identities', identity_key(
        BROKER_ISSUER, '33333333-3333-3333-3333-333333333333'))
    storage.save('config', 'ado_config', {
        'organization_url': 'https://dev.azure.com/example', 'feature_flags': {}})
    monkeypatch.setattr(accounts, 'validate_pat', lambda value: pytest.fail('Login required a PAT'))

    state = client.post('/api/auth/login/begin', headers={
        'Origin': 'http://localhost:8765'}).json()['state']
    response = complete_login(client, state)

    assert response.status_code == 200
    profile = response.json()
    assert profile['account']['uuid'] != admin['id']
    assert profile['permissions'] == []
    assert profile['status'] == 'signed_in'
    assert accounts.get_account_by_id(admin['id']) == admin
    assert not accounts.requires_pat()
    assert not any(request.url.path.endswith('/token') for request in requests)


def test_mock_auth_preserves_admin_backend_choice_and_authentication(sandbox):
    from planner_lib.admin.config_manager import ConfigManager

    client, requests = sandbox
    container = client.app.state.container
    storage = container.get('storage')
    authentication = dict(storage.load('config', 'authentication'))
    manager = ConfigManager(storage)
    local_config = {'organization_url': 'example', 'feature_flags': {'use_azure_mock_generator': True}}
    manager.save_config('ado_config', local_config)
    assert storage.load('config', 'ado_config') == local_config
    assert storage.load('config', 'authentication') == authentication
    assert client.get('/api/auth/config').json()['mode'] == 'broker'
    copied_config = {'organization_url': 'copied-projects', 'feature_flags': {}}
    manager.save_config('ado_config', copied_config)
    assert storage.load('config', 'ado_config') == copied_config
    assert requests == []


@pytest.mark.parametrize('sandbox', ['http://localhost:8765', 'https://planner.example.test'], indirect=True)
def test_sandbox_login_profile_logout_and_disabled_enrollment(sandbox):
    client, requests = sandbox
    assert client.get('/api/auth/config').json()['mode'] == 'broker'
    assert client.get('/api/auth/me').json()['account'] is None
    assert client.post('/api/auth/enroll', json={'email': 'new@example.test'}).status_code == 403
    begin = client.post('/api/auth/login/begin', headers={'Origin': str(client.base_url).rstrip('/')})
    assert begin.status_code == 200
    assert 'HttpOnly' in begin.headers['set-cookie']
    assert ('Secure' in begin.headers['set-cookie']) == (client.base_url.scheme == 'https')
    state = begin.json()['state']
    completed = complete_login(client, state)
    assert completed.status_code == 200
    assert completed.json()['account']['email'] == 'alex@example.test'
    for key, value in CONTRACT['profile'].items():
        assert completed.json()[key] == value
    assert 'opaque-server-only-grant' not in completed.text
    before_profile = len(requests)
    assert client.get('/api/auth/me').json()['account']['uuid']
    assert len(requests) == before_profile + 1
    assert requests[-1].url.path.endswith('/status')
    assert complete_login(client, state).status_code == 401
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
    assert complete_login(client, begun['state']).status_code == 401
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
            value['identity']['subject'] = '44444444-4444-4444-4444-444444444444'
            return httpx.Response(200, json=value)
        return response

    broker.transport = httpx.MockTransport(sam)
    state = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()['state']
    assert complete_login(client, state).status_code == 200
    assert client.get('/admin/check').status_code == 403
    assert client.get('/api/auth/me').json()['account']['email'] == 'sam@example.test'


def test_completion_wrong_browser_fails_without_consuming_transaction(sandbox):
    client, requests = sandbox
    state = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()['state']
    binding = client.cookies.get('plannerLogin')
    client.cookies.clear()
    assert complete_login(client, state).status_code == 401
    client.cookies.set('plannerLogin', binding, path='/api/auth/')
    assert complete_login(client, state).status_code == 200


def test_logout_commits_local_revocation_when_broker_is_unavailable(sandbox):
    client, requests = sandbox
    state = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()['state']
    assert complete_login(client, state).status_code == 200
    from planner_lib.middleware.session import SESSION_COOKIE
    sid = client.cookies.get(SESSION_COOKIE)
    sessions = client.app.state.container.get('session_manager')
    assert sessions.is_valid(sid)
    broker = client.app.state.container.get('broker_client')
    broker.transport = httpx.MockTransport(lambda request: httpx.Response(503))
    diagnostic = client.get('/api/auth/me')
    assert diagnostic.status_code == 200
    profile = client.get('/api/auth/me').json()
    assert profile['status'] == 'unavailable'
    assert profile['account']['email'] == 'alex@example.test'
    assert client.get('/admin/check').status_code == 200
    assert client.get('/api/auth/config').json()['mode'] == 'broker'
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
    profile = complete_login(client, state).json()
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
    response = complete_login(client, state)
    assert response.status_code == expected_status
    assert '"error": "' + expected_code + '"' in response.text
    assert len(calls) == 1


def test_fake_token_is_reported_at_acquisition_before_ado_fetch(sandbox, monkeypatch):
    from planner_lib.azure.AzureClient import AzureClient

    client, requests = sandbox
    set_broker_token_kind(client, 'fixture')
    state = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()['state']
    complete_login(client, state)
    monkeypatch.setattr(AzureClient, '_connect_with_authentication',
                        lambda *arguments: pytest.fail('Fake token reached the ADO SDK'))
    response = client.get('/api/azure/projects', params={'org_url': 'copied-projects'})
    assert response.status_code == 403
    assert response.json() == {'error': 'ado_credential_unusable'}
    assert 'synthetic-ado-token' not in response.text
    assert requests[-1].url.path.endswith('/token')
    assert client.get('/api/auth/me').json()['status'] == 'signed_in'
    assert client.get('/admin/check').status_code == 200


def test_fake_credential_stops_at_ado_transport_boundary(sandbox, monkeypatch):
    from planner_lib.azure.AzureClient import AzureClient

    client, requests = sandbox
    storage = client.app.state.container.get('storage')
    sdk = AzureClient('copied-projects', storage)
    monkeypatch.setattr(sdk, '_connect_with_authentication',
                        lambda authentication: pytest.fail('Fake token reached live SDK'))
    credential = {'kind': 'bearer', 'token': 'fake', 'user_id': 'acting-user', 'transport': 'fixture'}
    with pytest.raises(ValueError, match='fixture transport'):
        with sdk.connect(credential):
            pytest.fail('Fake token opened a live connection')


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
    manager.save_config('ado_config', {'organization_url': 'copied-projects', 'feature_flags': {}})


def test_entra_denies_pat_and_enrollment_mutations(sandbox):
    client, requests = sandbox
    for path in ('/api/config', '/admin/v1/users', '/api/session',
                 '/api/auth/enrollment-status', '/api/auth/admin-reset/account'):
        assert client.post(path, json={}).status_code == 403


def test_delegated_provider_requires_exact_session_and_revokes_locally(sandbox):
    from planner_lib.middleware.session import current_session_context, SESSION_COOKIE
    client, requests = sandbox
    state = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()['state']
    profile = complete_login(client, state).json()
    provider = client.app.state.container.get('credential_provider')
    context = client.app.state.container.get('session_manager').get(client.cookies.get(SESSION_COOKIE))
    token = current_session_context.set(context)
    try:
        credential = provider.get_credential(profile['account']['uuid'])
        assert credential['kind'] == 'bearer'
        assert credential['transport'] == 'live'
        assert credential['binding'] == context['binding']
        assert credential['token'] == 'synthetic-ado-token'
        assert requests[-1].url.path.endswith('/token')
        with pytest.raises(AuthFailure, match='invalid_session'):
            provider.get_credential('another-account')
        assert client.post('/api/auth/logout').status_code == 200
        with pytest.raises(AuthFailure, match='invalid_session'):
            provider.renew(credential)
    finally:
        current_session_context.reset(token)


@pytest.mark.parametrize('token_kind,transport', [('bearer', 'live'), ('fixture', 'fixture')])
def test_credential_transport_follows_token_type_not_auth_service_mode(sandbox, token_kind, transport):
    from planner_lib.middleware.session import SESSION_COOKIE

    client, requests = sandbox
    state = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()['state']
    complete_login(client, state)
    container = client.app.state.container
    set_broker_token_kind(client, token_kind)
    context = container.get('session_manager').get(client.cookies.get(SESSION_COOKIE))
    epoch = container.get('storage').load('config', 'authentication')['epoch']
    provider = container.get('credential_provider')
    if token_kind == 'fixture':
        with pytest.raises(AuthFailure, match='ado_credential_unusable'):
            provider.acquire(context['account_id'], context['binding'], epoch)
        return
    credential = provider.acquire(context['account_id'], context['binding'], epoch)
    assert credential['kind'] == 'bearer'
    assert credential['transport'] == transport


def test_delegated_operation_uses_bound_credential_without_disclosure(sandbox):
    client, requests = sandbox
    state = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()['state']
    profile = complete_login(client, state).json()
    result = client.post('/api/auth/sandbox/operation')
    assert result.status_code == 200
    assert result.json() == {'account_id': profile['account']['uuid'], 'transport': 'live', 'status': 'completed'}
    assert 'synthetic-ado-token' not in result.text
    assert requests[-1].url.path.endswith('/token')


@pytest.mark.parametrize('status,code', [(403, 'access_denied'), (409, 'interaction_required'), (503, 'auth_unavailable')])
def test_delegated_acquisition_keeps_denial_interaction_and_outage_distinct(sandbox, status, code):
    from planner_lib.middleware.session import current_session_context, SESSION_COOKIE
    client, requests = sandbox
    state = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()['state']
    profile = complete_login(client, state).json()
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
    {'resource': 'other'}, {'token_kind': 'unsupported'}, {'access_token': ''},
    {'expires_at': 0}, {'expires_at': float('inf')}, {'refresh_token': 'forbidden'},
    {'broker_url': 'https://wrong.example.test/auth/'},
])
def test_delegated_token_response_fails_closed(sandbox, change):
    import time
    client, requests = sandbox
    state = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()['state']
    complete_login(client, state)
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
    complete_login(client, state)
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
    complete_login(client, state)
    container = client.app.state.container
    sessions = container.get('session_manager')
    sid = client.cookies.get(SESSION_COOKIE)
    context = sessions.get(sid)
    provider = container.get('credential_provider')
    epoch = client.app.state.container.get('storage').load('config', 'authentication')['epoch']
    credential = provider.acquire(context['account_id'], context['binding'], epoch)
    sessions.delete(sid)
    with pytest.raises(AuthFailure, match='invalid_session'):
        provider.renew(credential)


@pytest.mark.parametrize('params', [
    {'state': 'tampered', 'code': 'code'},
    {'state': 'tampered', 'code': 'code', 'error': 'cancelled'},
])
def test_invalid_callback_does_not_contact_broker(sandbox, params):
    client, requests = sandbox
    response = client.get('/api/auth/login/callback', params=params)
    assert response.status_code == 401
    assert not requests


@pytest.mark.parametrize('linked', [False, True])
def test_mock_email_login_reuses_existing_admin_without_changing_permissions(sandbox, linked):
    from planner_lib.session.identity import identity_key

    client, requests = sandbox
    container = client.app.state.container
    storage = container.get('storage')
    accounts = container.get('account_manager')
    broker = container.get('broker_client')
    original = broker.transport
    account_id = accounts.get_account_id('alex@example.test')
    before = storage.load('accounts', 'alex@example.test')
    if not linked:
        storage.delete('external_identities', identity_key(
            BROKER_ISSUER, '33333333-3333-3333-3333-333333333333'))

    def email_identity(request):
        response = original.handle_request(request)
        if request.url.path.endswith('/redeem'):
            payload = json.loads(response.content)
            payload['identity'] = {'issuer': BROKER_ISSUER, 'subject': 'mock-email-alex',
                'name': 'alex@example.test', 'email': 'alex@example.test',
                'link_existing_by_email': True}
            return httpx.Response(200, json=payload)
        return response

    broker.transport = httpx.MockTransport(email_identity)
    for attempt in range(2):
        state = client.post('/api/auth/login/begin', headers={
            'Origin': 'http://localhost:8765'}).json()['state']
        response = complete_login(client, state)
        assert response.status_code == 200
        assert response.json()['account']['uuid'] == account_id
        assert response.json()['permissions'] == ['admin']
        assert client.get('/admin/v1/users').status_code == 200
        assert storage.load('accounts', 'alex@example.test') == before
    assert len(list(storage.list_keys('external_identities'))) == 2
    assert not any(request.url.path.endswith('/token') for request in requests)


@pytest.mark.parametrize('mode', ['mock', 'entra'])
def test_email_identity_only_matches_existing_accounts_in_mock_mode(sandbox, mode):
    from dataclasses import replace

    client, requests = sandbox
    container = client.app.state.container
    accounts = container.get('account_manager')
    login = container.get('login_adapter')
    identity = {'issuer': BROKER_ISSUER, 'subject': 'mock-email-alex',
        'email': 'alex@example.test', 'name': 'Email Identity'}
    if mode == 'mock':
        identity['link_existing_by_email'] = True
    login.identities.settings = replace(login.settings, upstream_mode=mode)
    resolved = login.identities.resolve(identity)
    assert (resolved['id'] == accounts.get_account_id('alex@example.test')) == (mode == 'mock')
    assert resolved['permissions'] == (['admin'] if mode == 'mock' else [])


def test_verified_new_identity_is_provisioned_without_permissions_or_email_linking(sandbox):
    client, requests = sandbox
    broker = client.app.state.container.get('broker_client')
    transport = broker.transport

    def new_identity(request):
        response = transport.handle_request(request)
        if request.url.path.endswith('/redeem'):
            value = json.loads(response.content)
            value['identity'] = {'issuer': BROKER_ISSUER,
                'subject': '55555555-5555-5555-5555-555555555555',
                'email': 'alex@example.test', 'name': 'Different Alex'}
            return httpx.Response(200, json=value)
        return response

    accounts = client.app.state.container.get('account_manager')
    existing_uuid = accounts.get_account_id('alex@example.test')
    broker.transport = httpx.MockTransport(new_identity)
    state = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()['state']
    response = complete_login(client, state)
    assert response.status_code == 200
    assert response.json()['account']['uuid'] != existing_uuid
    assert response.json()['account']['name'] == 'Different Alex'
    assert response.json()['permissions'] == []
    assert accounts.get_account_by_id(existing_uuid)['permissions'] == ['admin']


def test_cancellation_validates_browser_and_consumes_pending_state(sandbox):
    client, requests = sandbox
    begin = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()
    assert client.get('/api/auth/login/callback', params={
        'state': 'tampered', 'error': 'cancelled'}, follow_redirects=False).status_code == 401
    cancelled = client.get('/api/auth/login/callback', params={
        'state': begin['state'], 'error': 'cancelled'}, follow_redirects=False)
    assert cancelled.status_code == 200
    assert '"error": "cancelled"' in cancelled.text
    assert complete_login(client, begin['state']).status_code == 401


def test_entra_rejects_pat_at_account_storage_boundary(sandbox):
    from planner_lib.accounts.config import AccountCredentialsPayload

    accounts = sandbox[0].app.state.container.get('account_manager')
    with pytest.raises(ValueError, match='forbids PAT'):
        accounts.update_credentials(AccountCredentialsPayload(email='alex@example.test', pat='new-synthetic-pat'))


def test_fake_token_is_rejected_before_wiki_operations(sandbox):
    client, requests = sandbox
    set_broker_token_kind(client, 'fixture')
    begun = client.post('/api/auth/login/begin', headers={'Origin': 'http://localhost:8765'}).json()
    complete_login(client, begun['state'])
    response = client.post('/api/auth/sandbox/wiki')
    assert response.status_code == 403
    assert response.json() == {'error': 'ado_credential_unusable'}
    storage = client.app.state.container.get('storage')
    assert not list(storage.list_keys('sandbox_wiki'))
    assert sum(request.url.path.endswith('/token') for request in requests) == 1
