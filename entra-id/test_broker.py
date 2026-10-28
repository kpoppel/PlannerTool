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
        'sandbox', 'test-1', 'mock', 'http://localhost:8080/auth/',
        str(tmp_path / 'state' / 'broker.sqlite'), Fernet.generate_key().decode(),
        {'alpha': {'completion_url': 'http://localhost:8080/alpha/api/auth/login/callback',
                   'secret_file': str(secret), 'scenario': 'success'}},
    )


def prepared(store):
    verifier = secrets.token_urlsafe(32)
    reference, _ = store.begin('alpha', store.config.instances['alpha']['completion_url'],
                               broker.challenge(verifier), secrets.token_urlsafe(32))
    browser = secrets.token_urlsafe(32)
    store.bind_browser(reference, browser)
    _, code = store.authorize(reference, browser, {'tid': 'synthetic', 'oid': 'one'})
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
    assert store.redeem('alpha', reference, code, verifier)['identity']['oid'] == 'one'


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


def test_permission_denial_does_not_revoke_a_session_grant(config):
    config.instances['alpha']['scenario'] = 'access_denied'
    store = broker.BrokerStore(config)
    reference, code, verifier = prepared(store)
    grant = store.redeem('alpha', reference, code, verifier)['grant']
    with pytest.raises(broker.ProtocolError, match='access_denied'):
        store.grant('alpha', grant, 'token', 'ado')
    assert store.grant('alpha', grant, 'status')['status'] == 'active'


def test_store_is_encrypted_and_rejects_environment_key_or_generation_changes(config):
    store = broker.BrokerStore(config)
    reference, code, verifier = prepared(store)
    result = store.redeem('alpha', reference, code, verifier)
    raw = Path(config.store_path).read_bytes()
    for value in (reference, code, verifier, result['grant'], 'synthetic'):
        assert value.encode() not in raw
    for changed in (replace(config, environment_id='other'), replace(config, generation='test-2'),
                    replace(config, key=Fernet.generate_key().decode())):
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


@pytest.mark.parametrize('scenario,expected', [
    ('success', 'active'), ('revoked', 'revoked'), ('interaction_required', 'interaction_required'),
])
def test_scenario_status_and_token_decisions(config, scenario, expected):
    registration = {**config.instances['alpha'], 'scenario': scenario}
    configured = replace(config, instances={'alpha': registration})
    store = broker.BrokerStore(configured)
    grant = store.redeem('alpha', *prepared(store))['grant']
    assert store.grant('alpha', grant, 'status')['status'] == expected
    if expected != 'active':
        with pytest.raises(broker.ProtocolError, match='interaction_required'):
            store.grant('alpha', grant, 'token', 'ado')


def test_unavailable_fixture_cannot_begin(config):
    registration = {**config.instances['alpha'], 'scenario': 'unavailable'}
    store = broker.BrokerStore(replace(config, instances={'alpha': registration}))
    with pytest.raises(broker.ProtocolError, match='auth_unavailable'):
        prepared(store)


def test_sandbox_process_guard_blocks_dns_and_direct_external_ip():
    import subprocess

    result = subprocess.run([sys.executable, '-c', '''
import socket
from egress import install_sandbox_egress
install_sandbox_egress()
for host in ('login.microsoftonline.com', 'dev.azure.com'):
    try:
        socket.getaddrinfo(host, 443)
    except PermissionError:
        continue
    raise AssertionError('Forbidden DNS request was dispatched')
try:
    socket.socket().connect(('20.0.0.1', 443))
except PermissionError:
    pass
else:
    raise AssertionError('Forbidden external connection was dispatched')
'''], cwd=Path(__file__).parent, capture_output=True, text=True, timeout=5)
    assert result.returncode == 0, result.stderr


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
        'ENTRA_BROKER_PUBLIC_URL': config.public_url, 'ENTRA_BROKER_ENVIRONMENT': 'sandbox',
        'ENTRA_BROKER_GENERATION': 'test-1', 'ENTRA_BROKER_STORE': config.store_path,
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


def test_authenticated_http_browser_handoff_and_replay(config):
    sys.path.insert(0, str(Path(__file__).parent))
    from app import Settings, create_app
    from fastapi.testclient import TestClient
    from urllib.parse import parse_qs, urlsplit

    settings = Settings('11111111-1111-1111-1111-111111111111',
                        '22222222-2222-2222-2222-222222222222', 'synthetic', 'example',
                        'http://localhost:8080/auth/callback', auth_mode='mock', broker_config=config)
    app = create_app(settings)
    secret = Path(config.instances['alpha']['secret_file']).read_text()
    headers = {'X-Planner-Instance': 'alpha', 'Authorization': 'Bearer ' + secret}
    with TestClient(app, base_url='http://localhost:8080/auth/', follow_redirects=False) as client:
        metadata = client.get('/v1/readiness').json()
        envelope = {key: metadata[key] for key in app.state.broker_store.metadata()}
        verifier = secrets.token_urlsafe(32)
        body = {**envelope, 'completion_url': config.instances['alpha']['completion_url'],
                'challenge': broker.challenge(verifier), 'state': secrets.token_urlsafe(32)}
        assert client.post('/v1/transactions/begin', json=body).status_code == 403
        wrong_environment = {**body, 'environment_id': 'production'}
        assert client.post('/v1/transactions/begin', json=wrong_environment, headers=headers).status_code == 403
        begun = client.post('/v1/transactions/begin', json=body, headers=headers).json()
        page = client.get(begun['authorization_url'])
        assert page.status_code == 200
        assert secret not in page.text
        selected = client.post('/v1/browser/choose', data={'transaction': begun['transaction'], 'identity': '1'},
                               headers={'Origin': 'http://localhost:8080'})
        callback_url = 'http://localhost:8080' + selected.headers['location']
        callback = client.get(callback_url)
        assert callback.status_code == 303
        query = parse_qs(urlsplit(callback.headers['location']).query)
        assert set(query) == {'state', 'code'}
        body = {**envelope, 'transaction': begun['transaction'], 'code': query['code'][0], 'verifier': verifier}
        response = client.post('/v1/transactions/redeem', json=body, headers=headers)
        assert response.status_code == 200
        assert response.json()['identity']['name'] == 'Sam Sandbox'
        assert client.post('/v1/transactions/redeem', json=body, headers=headers).status_code == 400
        assert client.get(callback_url).status_code == 400