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