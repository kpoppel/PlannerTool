import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from app import Settings, create_app


TENANT = '11111111-1111-1111-1111-111111111111'
CLIENT = '22222222-2222-2222-2222-222222222222'


def test_service_requires_broker_configuration():
    with pytest.raises(ValueError, match='Broker registration'):
        create_app(Settings(TENANT, CLIENT, 'secret', 'example'))


def test_mock_authentication_cannot_be_exposed_remotely():
    with pytest.raises(ValueError, match='localhost'):
        Settings(TENANT, CLIENT, 'secret', 'example', 'https://auth.example.test/auth/callback',
                 listen_host='0.0.0.0', auth_mode='mock')


@pytest.mark.parametrize('redirect', [
    'http://public.example/auth/callback',
    'http://localhost:8765/other',
    'https://public.example/auth/callback?next=evil',
    'https://public.example/../auth/callback',
    'https://public.example/nested/auth/callback',
    'https://user:password@public.example/auth/callback',
])
def test_insecure_or_wrong_callback_rejected(redirect):
    with pytest.raises(ValueError):
        Settings(TENANT, CLIENT, 'secret', 'example', redirect)


def test_secret_file_is_read_without_exposing_secret(monkeypatch, tmp_path):
    from types import SimpleNamespace
    from unittest.mock import patch

    secret_file = tmp_path / 'secret'
    secret_file.write_text('file-secret\n')
    secret_file.chmod(0o600)
    monkeypatch.delenv('ENTRA_CLIENT_SECRET', raising=False)
    monkeypatch.setenv('ENTRA_CLIENT_SECRET_FILE', str(secret_file))
    monkeypatch.setenv('ENTRA_REDIRECT_URI', 'https://auth.example.test/auth/callback')
    monkeypatch.setenv('ENTRA_LISTEN_HOST', '0.0.0.0')
    monkeypatch.setenv('ENTRA_LISTEN_PORT', '8000')
    with patch('broker.BrokerConfig.from_env', return_value=SimpleNamespace(
            public_url='https://auth.example.test/auth/')):
        settings = Settings.from_env()
    assert settings.client_secret == 'file-secret'
    assert 'file-secret' not in repr(settings)
    assert settings.listen_port == 8000
    monkeypatch.setenv('ENTRA_CLIENT_SECRET', 'env-secret')
    with pytest.raises(ValueError, match='not both'):
        Settings.from_env()


def test_certificate_file_is_used_by_msal_without_a_secret(monkeypatch, tmp_path):
    from types import SimpleNamespace
    from unittest.mock import Mock, patch
    from upstream import EntraUpstream

    private_key = 'private-key-pem'
    key_file = tmp_path / 'private-key.pem'
    key_file.write_text(private_key)
    key_file.chmod(0o600)
    certificate = 'public-certificate-pem'
    certificate_file = tmp_path / 'certificate.pem'
    certificate_file.write_text(certificate)
    certificate_file.chmod(0o600)
    monkeypatch.delenv('ENTRA_CLIENT_SECRET', raising=False)
    monkeypatch.delenv('ENTRA_CLIENT_SECRET_FILE', raising=False)
    monkeypatch.setenv('ENTRA_CLIENT_CERTIFICATE_KEY_FILE', str(key_file))
    monkeypatch.setenv('ENTRA_CLIENT_CERTIFICATE_FILE', str(certificate_file))
    monkeypatch.setenv('ENTRA_TENANT_ID', TENANT)
    monkeypatch.setenv('ENTRA_CLIENT_ID', CLIENT)
    monkeypatch.setenv('ADO_ORGANIZATION', 'example')
    monkeypatch.setenv('ENTRA_REDIRECT_URI', 'https://auth.example.test/auth/callback')
    with patch('broker.BrokerConfig.from_env', return_value=SimpleNamespace(
            public_url='https://auth.example.test/auth/')):
        settings = Settings.from_env()
    assert settings.missing == []
    factory = Mock()
    EntraUpstream(settings, factory).client('')
    assert factory.call_args.kwargs['client_credential'] == {
        'private_key': private_key, 'public_certificate': certificate,
    }
    assert private_key not in repr(settings)


@pytest.mark.parametrize('key,certificate,secret', [
    ('private-key-pem', '', ''),
    ('', 'public-certificate-pem', ''),
    ('private-key-pem', '   ', ''),
    ('private-key-pem', 'public-certificate-pem', 'secret'),
])
def test_incomplete_or_conflicting_certificate_credentials_rejected(key, certificate, secret):
    with pytest.raises(ValueError, match='certificate|Certificate'):
        Settings(TENANT, CLIENT, secret, 'example',
                 client_certificate_key=key, client_certificate=certificate)


@pytest.fixture
def certificate_material():
    from datetime import datetime, timedelta, timezone
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = datetime.now(timezone.utc)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'broker-test')])
    certificate = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject)
                   .public_key(key.public_key()).serial_number(x509.random_serial_number())
                   .not_valid_before(now - timedelta(minutes=1))
                   .not_valid_after(now + timedelta(days=1)).sign(key, hashes.SHA256()))
    private_pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                    serialization.NoEncryption()).decode()
    settings = Settings(TENANT, CLIENT, '', 'example', client_certificate_key=private_pem,
                        client_certificate=certificate.public_bytes(serialization.Encoding.PEM).decode())
    return settings, key, certificate


def test_real_msal_signs_certificate_assertion_without_sending_private_key(certificate_material):
    import base64
    from datetime import datetime, timezone
    from unittest.mock import Mock
    import httpx
    import jwt
    import msal
    from cryptography.hazmat.primitives import hashes
    from broker import ProtocolError
    from upstream import EntraUpstream

    settings, key, certificate = certificate_material
    private_pem = settings.client_certificate_key
    now = datetime.now(timezone.utc)
    assert settings.validate_credentials() == 'Entra certificate (SHA-256 assertions)'
    authority = f'https://login.microsoftonline.com/{TENANT}/oauth2/v2.0'
    transport = Mock()
    transport.get.return_value = httpx.Response(200, json={
        'authorization_endpoint': authority + '/authorize', 'token_endpoint': authority + '/token',
        'issuer': f'https://login.microsoftonline.com/{TENANT}/v2.0',
    })
    transport.post.return_value = httpx.Response(400, json={'error': 'invalid_grant'})

    def factory(*args, **kwargs):
        return msal.ConfidentialClientApplication(
            *args, **kwargs, http_client=transport, instance_discovery=False)

    upstream = EntraUpstream(settings, factory)
    flow, cache = upstream.begin('bound-state')
    with pytest.raises(ProtocolError, match='interaction_required'):
        upstream.complete(flow, cache, {'state': 'bound-state', 'code': 'synthetic-code'})
    data = transport.post.call_args.kwargs['data']
    assertion = data['client_assertion']
    claims = jwt.decode(assertion, key.public_key(), algorithms=['PS256', 'RS256'],
                        audience=authority + '/token', issuer=CLIENT)
    assert claims['sub'] == CLIENT
    assert now.timestamp() < claims['exp'] <= now.timestamp() + 601
    assert base64.urlsafe_b64decode(jwt.get_unverified_header(assertion)['x5t#S256']) == (
        certificate.fingerprint(hashes.SHA256()))
    assert data['client_assertion_type'] == 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'
    assert 'client_secret' not in data
    assert private_pem not in repr(data)


@pytest.mark.parametrize('field,setting', [
    ('client_certificate', 'ENTRA_CLIENT_CERTIFICATE_FILE'),
    ('client_certificate_key', 'ENTRA_CLIENT_CERTIFICATE_KEY_FILE'),
])
def test_certificate_preflight_rejects_invalid_pem_without_exposing_material(
        certificate_material, field, setting):
    from dataclasses import replace

    settings = replace(certificate_material[0], **{field: 'invalid-private-marker'})
    with pytest.raises(ValueError, match=setting) as error:
        settings.validate_credentials()
    assert 'invalid-private-marker' not in str(error.value)


@pytest.mark.parametrize('defect,expected', [
    ('mismatch', 'matching'), ('expired', 'expired'), ('future', 'not yet valid'),
])
def test_certificate_preflight_rejects_wrong_keys_and_dates(certificate_material, defect, expected):
    from dataclasses import replace
    from datetime import datetime, timedelta, timezone
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    settings, key, certificate = certificate_material
    if defect == 'mismatch':
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = datetime.now(timezone.utc)
    before = now + timedelta(days=1) if defect == 'future' else now - timedelta(days=2)
    after = now - timedelta(days=1) if defect == 'expired' else now + timedelta(days=2)
    replacement = (x509.CertificateBuilder().subject_name(certificate.subject)
                   .issuer_name(certificate.issuer).public_key(key.public_key())
                   .serial_number(x509.random_serial_number()).not_valid_before(before)
                   .not_valid_after(after).sign(key, hashes.SHA256()))
    with pytest.raises(ValueError, match=expected):
        replace(settings, client_certificate=replacement.public_bytes(
            serialization.Encoding.PEM).decode()).validate_credentials()


@pytest.mark.parametrize('defect', ['missing', 'permissions', 'empty'])
def test_credential_file_errors_provide_setup_guidance_without_disclosure(tmp_path, defect):
    from app import read_credential_file

    source = tmp_path / 'credential'
    if defect != 'missing':
        source.write_text('' if defect == 'empty' else 'private-marker')
        source.chmod(0o644 if defect == 'permissions' else 0o600)
    with pytest.raises(ValueError, match='ENTRA_CLIENT_SECRET_FILE') as error:
        read_credential_file('ENTRA_CLIENT_SECRET_FILE', source)
    assert 'private-marker' not in str(error.value)


def test_broker_check_mode_neither_starts_server_nor_opens_store(monkeypatch, capsys):
    from unittest.mock import Mock
    import app

    settings = Settings(TENANT, CLIENT, 'secret', 'example')
    monkeypatch.setattr(Settings, 'from_env', lambda: settings)
    create = Mock(side_effect=AssertionError('Must not create a store'))
    monkeypatch.setattr(app, 'create_app', create)
    app.main(['--check'])
    assert 'Entra application secret' in capsys.readouterr().out
    create.assert_not_called()


@pytest.mark.parametrize('arguments', [[], ['--check']])
def test_broker_startup_errors_are_actionable_and_do_not_print_credentials(monkeypatch, capsys, arguments):
    import app

    monkeypatch.setattr(Settings, 'from_env', lambda: Settings(
        TENANT, CLIENT, '', 'example', client_certificate_key='private-marker',
        client_certificate='public-marker'))
    with pytest.raises(SystemExit) as result:
        app.main(arguments)
    assert result.value.code == 2
    output = capsys.readouterr().err
    assert 'docs/DEPLOYMENT.md' in output
    assert 'ENTRA_CLIENT_CERTIFICATE_FILE' in output
    assert 'private-marker' not in output
    assert 'Traceback' not in output


@pytest.mark.skipif('PLANNER_AUTH_IMAGE' not in os.environ, reason='requires a built broker image')
@pytest.mark.parametrize('credential', ['certificate', 'secret'])
def test_broker_container_preflight_is_offline_and_read_only(tmp_path, certificate_material, credential):
    import json
    import secrets
    import subprocess
    from cryptography.fernet import Fernet

    settings = certificate_material[0]
    files = {
        'broker-key': Fernet.generate_key().decode(),
        'instance-secret': secrets.token_urlsafe(32),
        'certificate.pem': settings.client_certificate,
        'private-key.pem': settings.client_certificate_key,
        'client-secret': 'synthetic-app-secret',
        'instances.json': json.dumps({'version': 1, 'mock_registration': None, 'instances': {
            'dev': {'completion_url': 'https://planner.example.test/dev/api/auth/login/callback',
                    'secret_file': '/config/instance-secret'},
        }}),
    }
    for name, value in files.items():
        source = tmp_path / name
        source.write_text(value)
        source.chmod(0o600)
    environment = {
        'ENTRA_TENANT_ID': TENANT, 'ENTRA_CLIENT_ID': CLIENT, 'ADO_ORGANIZATION': 'example',
        'ENTRA_AUTH_MODE': 'entra', 'ENTRA_ADO_TRANSPORT': 'live',
        'ENTRA_REDIRECT_URI': 'https://planner.example.test/auth/callback',
        'ENTRA_BROKER_PUBLIC_URL': 'https://planner.example.test/auth/',
        'ENTRA_BROKER_KEY_FILE': '/config/broker-key',
        'ENTRA_BROKER_REGISTRY_FILE': '/config/instances.json',
        'ENTRA_BROKER_STORE': '/unwritable/broker.sqlite',
    }
    if credential == 'certificate':
        environment.update(ENTRA_CLIENT_CERTIFICATE_FILE='/config/certificate.pem',
                           ENTRA_CLIENT_CERTIFICATE_KEY_FILE='/config/private-key.pem')
    else:
        environment['ENTRA_CLIENT_SECRET_FILE'] = '/config/client-secret'
    command = ['docker', 'run', '--rm', '--network', 'none', '--read-only',
               '--mount', f'type=bind,src={tmp_path},dst=/config,readonly']
    for name, value in environment.items():
        command.extend(['-e', name + '=' + value])
    command.extend([os.environ['PLANNER_AUTH_IMAGE'], 'python', 'app.py', '--check'])
    result = subprocess.run(command, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
    expected = 'certificate' if credential == 'certificate' else 'application secret'
    assert 'Broker configuration valid: Entra ' + expected in result.stdout
    assert settings.client_certificate_key not in result.stdout + result.stderr
    assert not (tmp_path / 'broker.sqlite').exists()