import json
from http.cookiejar import MozillaCookieJar
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from scripts import api_cli, server_backup_restore


def test_authenticated_session_renews_from_protected_cookie_jar(tmp_path, monkeypatch):
    cookies = tmp_path / 'cookies.txt'
    cookies.touch(mode=0o600)
    MozillaCookieJar(str(cookies)).save(ignore_discard=True, ignore_expires=True)
    session = MagicMock()
    monkeypatch.setattr(api_cli.requests, 'Session', lambda: session)
    result = api_cli.authenticated_session('http://localhost:8001', str(cookies))
    assert result is session
    assert isinstance(session.cookies, MozillaCookieJar)
    session.post.assert_called_once_with(
        'http://localhost:8001/api/session', headers={'Accept': 'application/json'}, timeout=30,
    )
    assert cookies.stat().st_mode & 0o077 == 0


def test_cookie_authentication_rejects_public_permissions(tmp_path):
    cookies = tmp_path / 'cookies.txt'
    cookies.touch(mode=0o644)
    with pytest.raises(ValueError, match='permissions'):
        api_cli.authenticated_session('http://localhost:8001', str(cookies))


def test_cli_enrollment_saves_rotated_key_without_printing_it(tmp_path, monkeypatch, capsys):
    session = MagicMock()
    response = session.post.return_value
    response.json.return_value = {'accountKey': 'replacement-secret', 'email': 'user@example.com'}
    session.cookies = MozillaCookieJar(str(tmp_path / 'cookies.txt'))
    monkeypatch.setattr(api_cli.requests, 'Session', lambda: session)
    monkeypatch.setattr(api_cli, 'getpass', lambda prompt: 'current-secret')
    args = SimpleNamespace(email='user@example.com', name='', cookies=str(tmp_path / 'cookies.txt'),
                           key_output=str(tmp_path / 'account-key.txt'))
    api_cli.cmd_enroll(args)
    assert (tmp_path / 'account-key.txt').read_text().strip() == 'replacement-secret'
    assert (tmp_path / 'account-key.txt').stat().st_mode & 0o077 == 0
    assert 'replacement-secret' not in capsys.readouterr().out
    assert 'current-secret' not in capsys.readouterr().out
    assert session.post.call_args.kwargs['json']['accountKey'] == 'current-secret'


def test_backup_restore_can_skip_accounts_and_authentication(tmp_path):
    snapshot = tmp_path / 'backup.json'
    snapshot.write_text(json.dumps({
        'accounts': {'users': {}}, 'authentication': {'account_auth': {}, 'auth_control': {}},
        'config': {'server_config': {}},
    }))
    session = MagicMock()
    server_backup_restore.api_restore(session, 'http://localhost:8001', str(snapshot), restore_accounts=False)
    assert session.post.call_args.kwargs['json'] == {'config': {'server_config': {}}}
    assert 'X-Session-Id' not in session.post.call_args.kwargs


def test_account_restore_requires_consequences_confirmation(tmp_path, monkeypatch, capsys):
    snapshot = tmp_path / 'backup.json'
    snapshot.write_text(json.dumps({'accounts': {'users': {}}, 'authentication': {}}))
    session = MagicMock()
    monkeypatch.setattr('builtins.input', lambda prompt: 'cancel')
    server_backup_restore.api_restore(session, 'http://localhost:8001', str(snapshot))
    session.post.assert_not_called()
    warning = capsys.readouterr().out
    assert 'older' in warning
    assert 'Reset access' in warning