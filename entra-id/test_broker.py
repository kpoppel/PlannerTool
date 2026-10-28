from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
import importlib.util
import secrets
import sys
from pathlib import Path
import json

from cryptography.fernet import Fernet
import pytest

spec = importlib.util.spec_from_file_location('entra_broker', Path(__file__).with_name('broker.py'))
broker = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = broker
spec.loader.exec_module(broker)
CONTRACT = json.loads(Path(__file__).with_name('protocol-v1.json').read_text())


@pytest.fixture
def config(tmp_path):
    secret = tmp_path / 'client-secret'
    secret.write_text(secrets.token_urlsafe(32))
    secret.chmod(0o600)
    return broker.BrokerConfig(
        'mock', 'http://localhost:8080/auth/',
        str(tmp_path / 'state' / 'broker.sqlite'), Fernet.generate_key().decode(),
        {'alpha': {'completion_url': 'http://localhost:8080/alpha/api/auth/login/callback',
                   'secret_file': str(secret)}},
    )


def prepared(store):
    verifier = secrets.token_urlsafe(32)
    reference, _ = store.begin('alpha', store.config.instances['alpha']['completion_url'],
                               broker.challenge(verifier), secrets.token_urlsafe(32))
    browser = secrets.token_urlsafe(32)
    store.bind_browser(reference, browser)
    _, code = store.authorize(reference, browser, {
        'issuer': 'https://auth.example.test', 'subject': 'opaque-user',
        'name': 'Synthetic', 'email': 'user@example.test'})
    return reference, code, verifier


def test_concurrent_redemption_has_exactly_one_success_and_survives_restart(config):
    store = broker.BrokerStore(config)
    reference, code, verifier = prepared(store)

    def redeem():
        try:
            return store.redeem('alpha', reference, code, verifier)
        except broker.ProtocolError:
            return None

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda index: redeem(), range(8)))
    successful = [result for result in results if result is not None]
    assert len(successful) == 1
    restarted = broker.BrokerStore(config)
    grant = successful[0]['grant']
    assert restarted.grant('alpha', grant, 'status')['status'] == 'active'
    assert restarted.grant('alpha', grant, 'revoke')['status'] == 'revoked'
    assert restarted.grant('alpha', grant, 'revoke')['status'] == 'revoked'
    with pytest.raises(broker.ProtocolError, match='interaction_required'):
        restarted.grant('alpha', grant, 'token', 'ado')


def test_invalid_binding_does_not_consume_code(config):
    store = broker.BrokerStore(config)
    reference, code, verifier = prepared(store)
    for owner, value in [('beta', verifier), ('alpha', 'wrong-verifier')]:
        with pytest.raises(broker.ProtocolError, match='invalid_binding'):
            store.redeem(owner, reference, code, value)
    assert store.redeem('alpha', reference, code, verifier)['identity']['subject'] == 'opaque-user'


def test_wrong_browser_and_replay_rejected(config):
    store = broker.BrokerStore(config)
    verifier = secrets.token_urlsafe(32)
    reference, _ = store.begin('alpha', config.instances['alpha']['completion_url'],
                               broker.challenge(verifier), secrets.token_urlsafe(32))
    store.bind_browser(reference, 'browser-one')
    with pytest.raises(broker.ProtocolError, match='invalid_browser'):
        store.authorize(reference, 'browser-two', {})
    store.authorize(reference, 'browser-one', {})
    with pytest.raises(broker.ProtocolError, match='replay'):
        store.authorize(reference, 'browser-one', {})


def test_store_is_encrypted_and_rejects_key_changes(config):
    store = broker.BrokerStore(config)
    reference, code, verifier = prepared(store)
    result = store.redeem('alpha', reference, code, verifier)
    raw = Path(config.store_path).read_bytes()
    for value in (reference, code, verifier, result['grant'], 'synthetic'):
        assert value.encode() not in raw
    for changed in (replace(config, key=Fernet.generate_key().decode()),):
        with pytest.raises(ValueError, match='mismatch'):
            broker.BrokerStore(changed)


def test_expiry_and_resource_allowlist(config):
    now = [1000]
    store = broker.BrokerStore(config, clock=lambda: now[0])
    reference, code, verifier = prepared(store)
    now[0] += broker.CODE_TTL
    with pytest.raises(broker.ProtocolError, match='expired'):
        store.redeem('alpha', reference, code, verifier)
    reference, code, verifier = prepared(store)
    grant = store.redeem('alpha', reference, code, verifier)['grant']
    with pytest.raises(broker.ProtocolError, match='invalid_resource'):
        store.grant('alpha', grant, 'token', 'https://dev.azure.com/other')
    fixture = store.grant('alpha', grant, 'token', 'ado')
    assert fixture['token_kind'] == 'fixture'
    assert fixture['upstream_mode'] == 'mock'


def test_shared_versioned_protocol_fixture(config):
    store = broker.BrokerStore(config)
    assert store.metadata() == CONTRACT['metadata']
    assert broker.TRANSACTION_TTL == CONTRACT['ttl_seconds']['transaction']
    assert broker.CODE_TTL == CONTRACT['ttl_seconds']['handoff']
    assert broker.GRANT_TTL == CONTRACT['ttl_seconds']['grant']


@pytest.fixture
def live_broker(config):
    import time
    from fastapi.testclient import TestClient

    sys.path.insert(0, str(Path(__file__).parent))
    from app import Settings, create_app

    origin = 'https://planner.example.test'
    configured = replace(config, mode='entra', public_url=origin + '/auth/', ado_transport='live',
                         instances={'alpha': {**config.instances['alpha'],
                                    'completion_url': origin + '/alpha/api/auth/login/callback'}})
    settings = Settings('11111111-1111-1111-1111-111111111111',
                        '22222222-2222-2222-2222-222222222222', 'synthetic', 'example',
                        origin + '/auth/callback', auth_mode='entra', broker_config=configured)
    calls = {'token': 0, 'error': None, 'email': 'legacy@example.test'}

    class IdentityClient:
        def __init__(self, client_id, *, token_cache, **kwargs):
            self.cache = token_cache

        def initiate_auth_code_flow(self, *, state, **kwargs):
            return {'state': state, 'auth_uri': 'https://login.microsoftonline.com/authorize',
                    'code_verifier': 'private-pkce-verifier'}

        def acquire_token_by_auth_code_flow(self, flow, response):
            if response['state'] != flow['state']:
                raise ValueError('state mismatch')
            if response.get('error') == 'access_denied':
                return {'error': 'access_denied'}
            self.cache._cache['test_account'] = 'private-refresh-token'
            claims = {'iss': f'https://login.microsoftonline.com/{settings.tenant_id}/v2.0',
                      'tid': settings.tenant_id, 'aud': settings.client_id,
                      'sub': 'opaque-live-subject', 'name': 'Live User'}
            if calls['email'] is not None:
                claims['email'] = calls['email']
            return {'access_token': 'private-initial-token', 'id_token_claims': claims}

        def get_accounts(self):
            return [{'home_account_id': 'opaque-live-subject'}] if 'test_account' in self.cache._cache else []

        def acquire_token_silent_with_error(self, scopes, account):
            calls['token'] += 1
            if calls['error'] is not None:
                return {'error': calls['error']}
            self.cache._cache['renewals'] = calls['token']
            return {'access_token': 'private-live-token', 'token_type': 'Bearer',
                    'expires_on': str(time.time() + 3600)}

    app = create_app(settings, IdentityClient)
    headers = {'X-Planner-Instance': 'alpha', 'Authorization': 'Bearer ' +
               Path(configured.instances['alpha']['secret_file']).read_text()}
    with TestClient(app, base_url=origin + '/auth/', follow_redirects=False) as client:
        yield client, app, headers, calls, settings, IdentityClient


def begin_live(client, app, headers):
    verifier = secrets.token_urlsafe(32)
    result = client.post('/v1/transactions/begin', headers=headers, json={
        **app.state.broker_store.metadata(), 'completion_url': app.state.broker_store.config.instances['alpha']['completion_url'],
        'challenge': broker.challenge(verifier), 'state': secrets.token_urlsafe(32),
    })
    assert result.status_code == 200
    begun = result.json()
    response = client.get(begun['authorization_url'])
    assert response.status_code == 303
    assert response.headers['location'].startswith('https://login.microsoftonline.com/')
    assert 'SameSite=none' in response.headers['set-cookie']
    assert 'Secure' in response.headers['set-cookie']
    return begun, verifier


def redeem_live(client, app, headers, begun, verifier):
    from urllib.parse import parse_qs, urlsplit

    callback = client.post('/callback', data={'state': begun['transaction'], 'code': 'synthetic-code'})
    assert callback.status_code == 303
    query = parse_qs(urlsplit(callback.headers['location']).query)
    result = client.post('/v1/transactions/redeem', headers=headers, json={
        **app.state.broker_store.metadata(), 'transaction': begun['transaction'],
        'code': query['code'][0], 'verifier': verifier,
    })
    assert result.status_code == 200
    assert 'private-' not in result.text
    return result.json()


def test_live_broker_persists_cache_and_renews_only_on_token_requests(live_broker):
    client, app, headers, calls, settings, factory = live_broker
    assert client.get('/v1/readiness').json()['live_capable'] is True
    begun, verifier = begin_live(client, app, headers)
    result = redeem_live(client, app, headers, begun, verifier)
    assert result['identity']['email'] == 'legacy@example.test'
    assert 'link_existing_by_email' not in result['identity']
    payload = {**app.state.broker_store.metadata(), 'grant': result['grant']}
    assert client.post('/v1/grants/status', headers=headers, json=payload).status_code == 200
    assert calls['token'] == 0
    token = client.post('/v1/grants/token', headers=headers, json={**payload, 'resource': 'ado'})
    assert token.status_code == 200
    assert token.json()['token_kind'] == 'bearer'
    assert 'refresh_token' not in token.text
    from app import create_app
    from fastapi.testclient import TestClient
    restarted = create_app(settings, factory)
    with TestClient(restarted, base_url=settings.origin + '/auth/') as browser:
        assert browser.post('/v1/grants/token', headers=headers,
                            json={**payload, 'resource': 'ado'}).status_code == 200
    assert calls['token'] == 2
    assert b'private-refresh-token' not in Path(settings.broker_config.store_path).read_bytes()
    assert client.post('/callback', data={'state': begun['transaction'], 'code': 'replay'}).status_code == 400


@pytest.mark.parametrize('upstream_error,status', [
    ('interaction_required', 409), ('invalid_grant', 409), ('temporarily_unavailable', 503),
])
def test_live_renewal_errors_preserve_grant(live_broker, upstream_error, status):
    client, app, headers, calls, settings, factory = live_broker
    begun, verifier = begin_live(client, app, headers)
    result = redeem_live(client, app, headers, begun, verifier)
    payload = {**app.state.broker_store.metadata(), 'grant': result['grant']}
    calls['error'] = upstream_error
    assert client.post('/v1/grants/token', headers=headers,
                       json={**payload, 'resource': 'ado'}).status_code == status
    assert client.post('/v1/grants/status', headers=headers, json=payload).json()['status'] == 'active'
    calls['error'] = None
    assert client.post('/v1/grants/revoke', headers=headers, json=payload).status_code == 200
    assert client.post('/v1/grants/token', headers=headers,
                       json={**payload, 'resource': 'ado'}).status_code == 409


def test_live_callback_requires_bound_browser_and_supports_missing_email(live_broker):
    client, app, headers, calls, settings, factory = live_broker
    begun, verifier = begin_live(client, app, headers)
    assert client.get('/callback', params={'state': begun['transaction'], 'code': 'code'}).status_code == 405
    assert client.post('/v1/browser/choose', data={}).status_code == 404
    browser_cookie = client.cookies.get('planner_broker_browser')
    client.cookies.clear()
    assert client.post('/callback', data={'state': begun['transaction'], 'code': 'code'}).status_code == 400
    client.cookies.set('planner_broker_browser', browser_cookie)
    calls['email'] = None
    result = redeem_live(client, app, headers, begun, verifier)
    assert 'email' not in result['identity']


def test_broker_headers_host_check_and_no_diagnostic_routes(live_broker):
    client = live_broker[0]
    response = client.get('/v1/readiness')
    assert response.headers['cache-control'] == 'no-store'
    assert response.headers['referrer-policy'] == 'no-referrer'
    assert response.headers['x-content-type-options'] == 'nosniff'
    assert response.headers['strict-transport-security'] == 'max-age=31536000'
    assert "frame-ancestors 'none'" in response.headers['content-security-policy']
    assert client.get('/v1/readiness', headers={'Host': 'attacker.example'}).status_code == 400
    for path in ('/', '/login', '/ado/projects', '/ado/identity', '/mock/authorize'):
        assert client.get(path).status_code == 404


@pytest.mark.parametrize('body,content_type,status', [
    ('state=expected&state=other&code=code', 'application/x-www-form-urlencoded', 400),
    ('x' * 16385, 'application/x-www-form-urlencoded', 413),
    ('{}', 'application/json', 415),
])
def test_broker_callback_rejects_invalid_forms(live_broker, body, content_type, status):
    client, app, headers, calls, settings, factory = live_broker
    begin_live(client, app, headers)
    response = client.post('/callback', content=body, headers={'Content-Type': content_type})
    assert response.status_code == status
    assert calls['token'] == 0


def test_real_msal_generates_pkce_and_rejects_wrong_state_without_exchange(live_broker):
    from unittest.mock import Mock
    from urllib.parse import parse_qs, urlsplit
    import httpx
    import msal
    from broker import ProtocolError
    from upstream import EntraUpstream, SCOPES

    settings = live_broker[4]
    transport = Mock()
    authority = f'https://login.microsoftonline.com/{settings.tenant_id}/oauth2/v2.0'
    transport.get.return_value = httpx.Response(200, json={
        'authorization_endpoint': authority + '/authorize', 'token_endpoint': authority + '/token',
        'issuer': f'https://login.microsoftonline.com/{settings.tenant_id}/v2.0',
    })

    def factory(*args, **kwargs):
        return msal.ConfidentialClientApplication(
            *args, **kwargs, http_client=transport, instance_discovery=False)

    upstream = EntraUpstream(settings, factory)
    flow, cache = upstream.begin('bound-state')
    query = parse_qs(urlsplit(flow['auth_uri']).query)
    assert query['code_challenge_method'] == ['S256']
    assert len(query['code_challenge'][0]) >= 43
    assert query['nonce'][0]
    assert query['state'] == ['bound-state']
    assert query['response_mode'] == ['form_post']
    assert all(scope in query['scope'][0].split() for scope in SCOPES + ['openid', 'offline_access'])
    with pytest.raises(ProtocolError, match='invalid_binding'):
        upstream.complete(flow, cache, {'state': 'wrong', 'code': 'code'})
    transport.post.assert_not_called()


def test_grant_owner_and_revocation_token_race(config):
    store = broker.BrokerStore(config)
    grant = store.redeem('alpha', *prepared(store))['grant']
    for operation in ('status', 'token', 'revoke'):
        with pytest.raises(broker.ProtocolError, match='invalid_binding'):
            store.grant('beta', grant, operation, 'ado')

    def token():
        try:
            return store.grant('alpha', grant, 'token', 'ado')['token_kind']
        except broker.ProtocolError as error:
            return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = pool.submit(token)
        revoked = pool.submit(store.grant, 'alpha', grant, 'revoke')
        assert pending.result() in ('fixture', 'interaction_required')
        assert revoked.result()['status'] == 'revoked'
    assert token() == 'interaction_required'


@pytest.mark.parametrize('expected', ['active', 'revoked', 'expired'])
def test_grant_lifecycle_status_and_token_decisions(config, expected):
    store = broker.BrokerStore(config)
    grant = store.redeem('alpha', *prepared(store))['grant']
    if expected == 'revoked':
        store.grant('alpha', grant, 'revoke')
    elif expected == 'expired':
        expires = store.clock() + broker.GRANT_TTL
        store.clock = lambda: expires
    assert store.grant('alpha', grant, 'status')['status'] == expected
    if expected != 'active':
        with pytest.raises(broker.ProtocolError, match='interaction_required'):
            store.grant('alpha', grant, 'token', 'ado')


@pytest.mark.parametrize('field,value', [
    ('ENTRA_TENANT_ID', ''), ('ENTRA_CLIENT_ID', 'not-a-guid'),
    ('ENTRA_CLIENT_ID', '55555555-5555-5555-5555-555555555555'),
    ('ENTRA_REDIRECT_URI', 'http://localhost:9999/auth/callback'),
    ('ENTRA_AUTH_MODE', 'unknown'), ('ENTRA_ADO_TRANSPORT', 'live'),
])
def test_startup_rejects_missing_malformed_or_mismatched_sandbox_configuration(
        config, monkeypatch, tmp_path, field, value):
    sys.path.insert(0, str(Path(__file__).parent))
    from app import Settings

    registry_path = tmp_path / 'registry.json'
    registry_path.write_text(json.dumps({
        'version': 1, 'instances': config.instances,
        'mock_registration': {
            'tenant_id': '11111111-1111-1111-1111-111111111111',
            'client_id': '22222222-2222-2222-2222-222222222222',
            'organization': 'example', 'redirect_uri': 'http://localhost:8080/auth/callback',
        },
    }))
    key_path = tmp_path / 'key'
    key_path.write_text(config.key)
    key_path.chmod(0o600)
    for name, setting in {
        'ENTRA_AUTH_MODE': 'mock', 'ENTRA_TENANT_ID': '11111111-1111-1111-1111-111111111111',
        'ENTRA_CLIENT_ID': '22222222-2222-2222-2222-222222222222', 'ADO_ORGANIZATION': 'example',
        'ENTRA_REDIRECT_URI': 'http://localhost:8080/auth/callback',
        'ENTRA_CLIENT_SECRET_FILE': config.instances['alpha']['secret_file'],
        'ENTRA_BROKER_KEY_FILE': str(key_path), 'ENTRA_BROKER_REGISTRY_FILE': str(registry_path),
        'ENTRA_BROKER_PUBLIC_URL': config.public_url, 'ENTRA_BROKER_STORE': config.store_path,
        'ENTRA_ADO_TRANSPORT': 'fixture', 'ENTRA_NETWORK': 'loopback',
    }.items():
        monkeypatch.setenv(name, setting)
    monkeypatch.delenv('ENTRA_CLIENT_SECRET', raising=False)
    assert Settings.from_env().broker_config.mode == 'mock'
    monkeypatch.setenv(field, value)
    with pytest.raises(ValueError):
        Settings.from_env()


def test_configuration_rejects_public_sandbox_and_live_transport(config):
    with pytest.raises(ValueError, match='ingress'):
        replace(config, public_url='https://auth.example.test/auth/')
    with pytest.raises(ValueError, match='live ADO'):
        replace(config, ado_transport='live')


@pytest.mark.parametrize('origin', ['http://localhost:8080', 'https://planner.example.test'])
@pytest.mark.parametrize('action', ['sign_in', 'cancel'])
def test_authenticated_browser_handoff_and_replay(config, origin, action):
    from unittest.mock import Mock
    sys.path.insert(0, str(Path(__file__).parent))
    from app import Settings, create_app
    from fastapi.testclient import TestClient
    from urllib.parse import parse_qs, urlsplit

    https = origin.startswith('https:')
    if https:
        config = replace(config, public_url=origin + '/auth/', private_network=True,
                         instances={'alpha': {**config.instances['alpha'],
                                    'completion_url': origin + '/alpha/api/auth/login/callback'}})
    settings = Settings('11111111-1111-1111-1111-111111111111',
                        '22222222-2222-2222-2222-222222222222', 'synthetic', 'example',
                        origin + '/auth/callback', auth_mode='mock', broker_config=config,
                        network='private-compose' if https else 'loopback',
                        listen_host='0.0.0.0' if https else '127.0.0.1',
                        internal_host='auth-central' if https else '')
    client_factory = Mock(side_effect=AssertionError('Mock authentication must not initialize MSAL'))
    app = create_app(settings, client_factory)
    secret = Path(config.instances['alpha']['secret_file']).read_text()
    headers = {'X-Planner-Instance': 'alpha', 'Authorization': 'Bearer ' + secret}
    with TestClient(app, base_url=origin + '/auth/', follow_redirects=False) as client:
        metadata = client.get('/v1/readiness').json()
        envelope = {key: metadata[key] for key in app.state.broker_store.metadata()}
        verifier = secrets.token_urlsafe(32)
        body = {**envelope, 'completion_url': config.instances['alpha']['completion_url'],
                'challenge': broker.challenge(verifier), 'state': secrets.token_urlsafe(32)}
        assert client.post('/v1/transactions/begin', json=body).status_code == 403
        wrong_environment = {**body, 'broker_url': 'https://other.example.test/auth/'}
        assert client.post('/v1/transactions/begin', json=wrong_environment, headers=headers).status_code == 403
        begun = client.post('/v1/transactions/begin', json=body, headers=headers).json()
        page = client.get(begun['authorization_url'])
        assert page.status_code == 200
        assert ('Secure' in page.headers['set-cookie']) == https
        assert secret not in page.text
        assert 'name="email"' in page.text
        assert 'Alex Sandbox' not in page.text
        for invalid_email in ('not-an-email', 'one@example.test two@example.test', 'a' * 255 + '@example.test'):
            invalid = client.post('/v1/browser/choose', data={
                'transaction': begun['transaction'], 'action': 'sign_in', 'email': invalid_email},
                headers={'Origin': origin})
            assert invalid.status_code == 400
        choice = {'transaction': begun['transaction'], 'action': action, 'email': ' Admin@Example.Test '}
        browser = client.cookies.get('planner_broker_browser')
        client.cookies.clear()
        assert client.post('/v1/browser/choose', data=choice,
                           headers={'Origin': origin}).status_code == 400
        client.cookies.set('planner_broker_browser', browser)
        selected = client.post('/v1/browser/choose', data=choice, headers={'Origin': origin})
        assert selected.status_code == 303
        assert selected.headers['location'].startswith(config.instances['alpha']['completion_url'] + '?')
        query = parse_qs(urlsplit(selected.headers['location']).query)
        assert client.post('/v1/browser/choose', data=choice,
                           headers={'Origin': origin}).status_code == 400
        if action == 'cancel':
            assert query == {'state': [body['state']], 'error': ['cancelled']}
            return
        assert set(query) == {'state', 'code'}
        body = {**envelope, 'transaction': begun['transaction'], 'code': query['code'][0], 'verifier': verifier}
        response = client.post('/v1/transactions/redeem', json=body, headers=headers)
        assert response.status_code == 200
        assert response.json()['identity'] == {
            'issuer': config.public_url, 'subject': broker.digest('admin@example.test'),
            'name': 'admin@example.test', 'email': 'admin@example.test',
            'link_existing_by_email': True}
        assert client.post('/v1/transactions/redeem', json=body, headers=headers).status_code == 400
        client_factory.assert_not_called()