import os
import subprocess
import sys
from http.cookiejar import MozillaCookieJar
from pathlib import Path
from urllib.parse import urlsplit
from unittest.mock import MagicMock

import pytest

from scripts import api_cli, enroll_account

EMAIL = 'user@example.com'
BASE = 'http://localhost:8001'
SCRIPT = Path(__file__).resolve().parents[3] / 'scripts' / 'enroll_account.py'


def test_script_runs_when_invoked_by_path():
    result = subprocess.run(
        [sys.executable, str(SCRIPT), '--help'], capture_output=True, text=True, timeout=30
    )
    assert result.returncode == 0, result.stderr
    assert '--check' in result.stdout


def _response(status, body=None):
    response = MagicMock()
    response.status_code = status
    response.ok = status < 400
    response.json.return_value = body if body is not None else {}
    if status >= 400:
        response.raise_for_status.side_effect = api_cli.requests.HTTPError(f'{status}')
    return response


class FakeSession:
    """Serves queued responses per method and path; records every request."""

    def __init__(self, responses):
        self.responses = responses
        self.calls = []
        self.cookies = None

    def get(self, url, **kwargs):
        return self._next('GET', url, kwargs)

    def post(self, url, **kwargs):
        return self._next('POST', url, kwargs)

    def _next(self, method, url, kwargs):
        path = urlsplit(url).path
        self.calls.append((method, path, kwargs))
        return self.responses[(method, path)].pop(0)

    def paths(self):
        return [(method, path) for method, path, _ in self.calls]


@pytest.fixture
def cookies(tmp_path):
    path = tmp_path / 'cookies.txt'
    path.touch(mode=0o600)
    MozillaCookieJar(str(path)).save(ignore_discard=True, ignore_expires=True)
    return path


@pytest.fixture
def key_file(tmp_path):
    path = tmp_path / 'account-key.txt'
    path.write_text('old-secret\n')
    path.chmod(0o600)
    return path


def _use(monkeypatch, responses):
    session = FakeSession(responses)
    monkeypatch.setattr(api_cli.requests, 'Session', lambda: session)
    return session


def test_valid_session_skips_enrollment(monkeypatch, cookies, key_file):
    session = _use(monkeypatch, {
        ('GET', '/api/auth/me'): [_response(200, {'email': EMAIL, 'name': 'User'})] * 2,
    })
    assert enroll_account.session_is_valid(BASE, str(cookies), EMAIL) is True
    assert ('POST', '/api/auth/enroll') not in session.paths()


def test_expired_session_is_renewed_without_enrolling(monkeypatch, cookies):
    session = _use(monkeypatch, {
        ('GET', '/api/auth/me'): [_response(401), _response(200, {'email': EMAIL})],
        ('POST', '/api/session'): [_response(200, {'email': EMAIL})],
    })
    assert enroll_account.session_is_valid(BASE, str(cookies), EMAIL) is True
    assert ('POST', '/api/auth/enroll') not in session.paths()


def test_revoked_device_reports_expired_so_enrollment_runs(monkeypatch, cookies):
    _use(monkeypatch, {
        ('GET', '/api/auth/me'): [_response(401)],
        ('POST', '/api/session'): [_response(401)],
    })
    assert enroll_account.session_is_valid(BASE, str(cookies), EMAIL) is False


def test_session_for_other_account_is_not_reused(monkeypatch, cookies):
    session = _use(monkeypatch, {
        ('GET', '/api/auth/me'): [_response(200, {'email': 'other@example.com'})],
    })
    assert enroll_account.session_is_valid(BASE, str(cookies), EMAIL) is False
    assert ('POST', '/api/session') not in session.paths()


def test_enrollment_sends_stored_key_and_rotates_key_file(monkeypatch, cookies, key_file, capsys):
    session = _use(monkeypatch, {
        ('POST', '/api/auth/enroll'): [_response(200, {'accountKey': 'new-secret'})],
        ('GET', '/api/auth/me'): [_response(200, {'email': EMAIL})],
    })
    enroll_account.enroll(BASE, str(cookies), str(key_file), EMAIL, '')
    payload = session.calls[0][2]['json']
    assert payload == {'email': EMAIL, 'name': '', 'accountKey': 'old-secret'}
    assert key_file.read_text() == 'new-secret\n'
    assert key_file.stat().st_mode & 0o077 == 0
    assert 'new-secret' not in capsys.readouterr().out


def test_rejected_key_leaves_key_file_unchanged(monkeypatch, cookies, key_file):
    _use(monkeypatch, {('POST', '/api/auth/enroll'): [_response(401)]})
    with pytest.raises(enroll_account.EnrollmentError, match='rejected'):
        enroll_account.enroll(BASE, str(cookies), str(key_file), EMAIL, '')
    assert key_file.read_text() == 'old-secret\n'


def test_missing_key_for_enrolled_account_explains_recovery(monkeypatch, cookies, tmp_path):
    _use(monkeypatch, {('POST', '/api/auth/enroll'): [_response(409, {'error': 'account_key_required'})]})
    with pytest.raises(enroll_account.EnrollmentError, match='administrator'):
        enroll_account.enroll(BASE, str(cookies), str(tmp_path / 'absent.txt'), EMAIL, '')
    assert not (tmp_path / 'absent.txt').exists()


def test_key_file_with_public_permissions_is_refused(cookies, tmp_path):
    key = tmp_path / 'key.txt'
    key.write_text('secret')
    key.chmod(0o644)
    with pytest.raises(ValueError, match='0600'):
        enroll_account._read_key(str(key))


def test_verification_fails_when_saved_session_does_not_authenticate(monkeypatch, cookies):
    _use(monkeypatch, {('GET', '/api/auth/me'): [_response(401)]})
    with pytest.raises(enroll_account.EnrollmentError, match='does not authenticate'):
        enroll_account.verify_session(BASE, str(cookies), EMAIL)


def test_main_enrolls_only_when_session_expired(monkeypatch, cookies, key_file, capsys):
    session = _use(monkeypatch, {
        ('GET', '/api/auth/me'): [_response(401), _response(200, {'email': EMAIL})],
        ('POST', '/api/session'): [_response(401)],
        ('POST', '/api/auth/enroll'): [_response(200, {'accountKey': 'new-secret'})],
    })
    monkeypatch.setenv('API_BASE', BASE)
    enroll_account.main(['--cookies', str(cookies), '--key-file', str(key_file)])
    assert ('POST', '/api/auth/enroll') in session.paths()
    assert key_file.read_text() == 'new-secret\n'
    out = capsys.readouterr().out
    assert 'Session verified' in out
    assert 'new-secret' not in out


ME = {'email': EMAIL, 'name': 'User', 'currentDeviceId': 'dev-1',
      'devices': [{'id': 'dev-1', 'expires': 1893456000.0}]}


def test_check_reports_valid_session_without_enrolling(monkeypatch, cookies, key_file, capsys):
    session = _use(monkeypatch, {('GET', '/api/auth/me'): [_response(200, ME)]})
    monkeypatch.setenv('API_BASE', BASE)
    enroll_account.main(['--check', '--cookies', str(cookies), '--key-file', str(key_file)])
    out = capsys.readouterr().out
    assert f'Session: valid for {EMAIL}' in out
    assert 'Device expires' in out
    assert ('POST', '/api/auth/enroll') not in session.paths()
    assert key_file.read_text() == 'old-secret\n'


def test_check_reports_expired_session_and_exits_nonzero(monkeypatch, cookies, key_file, capsys):
    session = _use(monkeypatch, {
        ('GET', '/api/auth/me'): [_response(401)],
        ('POST', '/api/session'): [_response(401)],
    })
    monkeypatch.setenv('API_BASE', BASE)
    with pytest.raises(SystemExit) as exit_info:
        enroll_account.main(['--check', '--cookies', str(cookies), '--key-file', str(key_file)])
    assert exit_info.value.code == 2
    assert 'enrollment required' in capsys.readouterr().out
    assert ('POST', '/api/auth/enroll') not in session.paths()
    assert key_file.read_text() == 'old-secret\n'


def test_defaults_cover_cookies_key_file_email_and_name():
    args = enroll_account.build_parser().parse_args([])
    assert args.email == EMAIL
    assert args.name == 'Example User'
    assert args.cookies == str(enroll_account.DEFAULT_COOKIES)
    assert args.key_file == str(enroll_account.DEFAULT_KEY_FILE)
    assert args.check is False
