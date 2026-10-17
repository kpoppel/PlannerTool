#!/usr/bin/env python3
"""Enroll or reuse this CLI browser for one account; the rotated key is saved privately.

Run as `python3 -m scripts.enroll_account`. Set API_BASE to the server URL.
"""

import argparse
import os
import sys
from datetime import datetime
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts import api_cli  # noqa: E402

DEFAULT_EMAIL = 'user@example.com'
DEFAULT_NAME = 'Example User'
DEFAULT_COOKIES = Path.home() / 'planner-cookies.txt'
DEFAULT_KEY_FILE = Path.home() / 'planner-account-key.txt'
JSON_HEADERS = {'Accept': 'application/json'}


class EnrollmentError(Exception):
    """Enrollment was refused or the saved session does not authenticate."""


def _read_key(path):
    key_path = Path(path)
    if not key_path.exists():
        return ''
    if key_path.stat().st_mode & 0o077:
        raise ValueError('Account key file permissions must be 0600')
    return key_path.read_text().strip()


def _write_private(path, text):
    target = Path(path)
    temporary = target.with_name(target.name + '.tmp')
    temporary.unlink(missing_ok=True)
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as handle:
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, target)


def _me(base, session):
    response = session.get(api_cli.build_url(base, '/api/auth/me'), headers=JSON_HEADERS, timeout=30)
    if response.status_code == 401:
        return None
    response.raise_for_status()
    return response.json()


def session_state(base, cookies):
    """Return the saved session's account record, renewing it from the device cookie if expired."""
    session = api_cli._cookie_session(cookies, required=False)
    me = _me(base, session)
    if me is None:
        renewal = session.post(api_cli.build_url(base, '/api/session'), headers=JSON_HEADERS, timeout=30)
        if renewal.status_code == 401:
            return None
        renewal.raise_for_status()
        api_cli._save_cookies(session)
        me = _me(base, session)
    return me


def session_is_valid(base, cookies, email):
    """Return True when the saved session, or one renewed from the device cookie, is for email."""
    me = session_state(base, cookies)
    return me is not None and me['email'] == email


def enroll(base, cookies, key_file, email, name):
    session = api_cli._cookie_session(cookies, required=False)
    response = api_cli.post_enrollment(session, base, {
        'email': email, 'name': name, 'accountKey': _read_key(key_file),
    })
    if response.status_code == 409:
        raise EnrollmentError('Account key required; restore the saved key file or ask an administrator to reset access')
    if response.status_code == 401:
        raise EnrollmentError('Saved account key was rejected; the key file was not changed')
    response.raise_for_status()
    _write_private(key_file, response.json()['accountKey'] + '\n')
    api_cli._save_cookies(session)


def verify_session(base, cookies, email):
    session = api_cli._cookie_session(cookies)
    me = _me(base, session)
    if me is None or me['email'] != email:
        raise EnrollmentError('Saved session does not authenticate as the account')


def report_session(base, cookies, key_file, email):
    """Print cookie, key, and session status; return True only when the session is for email."""
    print(f'Cookies: {cookies} ({"present" if Path(cookies).exists() else "missing"})')
    print(f'Key file: {key_file} ({"present" if Path(key_file).exists() else "missing"})')
    me = session_state(base, cookies)
    if me is None:
        print('Session: expired or revoked; enrollment required')
        return False
    if me['email'] != email:
        print(f'Session: authenticated as {me["email"]}, not {email}')
        return False
    print(f'Session: valid for {email}')
    for device in me['devices']:
        if device['id'] == me['currentDeviceId']:
            expires = datetime.fromtimestamp(device['expires']).isoformat(timespec='seconds')
            print(f'Device expires: {expires}')
    return True


def build_parser():
    parser = argparse.ArgumentParser(description='Enroll or reuse a CLI browser session for one account')
    parser.add_argument('--email', default=DEFAULT_EMAIL, help='Account email')
    parser.add_argument('--name', default=DEFAULT_NAME, help='Real name, used only for first enrollment')
    parser.add_argument('--cookies', default=str(DEFAULT_COOKIES), help='Private cookie jar outside the repository')
    parser.add_argument('--key-file', default=str(DEFAULT_KEY_FILE), help='Private account key file, replaced on enrollment')
    parser.add_argument('--check', action='store_true', help='Report session and key status without enrolling')
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    base = os.environ.get('API_BASE', 'http://localhost:8001')
    try:
        if args.check:
            if not report_session(base, args.cookies, args.key_file, args.email):
                sys.exit(2)
            return
        if session_is_valid(base, args.cookies, args.email):
            print('Session is still valid; enrollment skipped.')
        else:
            enroll(base, args.cookies, args.key_file, args.email, args.name)
            print(f'Enrolled. Replacement account key saved to {args.key_file}.')
        verify_session(base, args.cookies, args.email)
        print('Session verified.')
    except (requests.RequestException, ValueError, OSError, EnrollmentError) as error:
        print('Enrollment failed:', error)
        sys.exit(2)


if __name__ == '__main__':
    main()
