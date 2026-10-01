#!/usr/bin/env python3
"""Cookie-authenticated CLI; account keys are entered privately and saved to files."""

import os
import sys
import argparse
import json
from getpass import getpass
from http.cookiejar import MozillaCookieJar
from pathlib import Path

import requests


def _cookie_session(cookie_file, *, required=True):
    path = Path(cookie_file)
    jar = MozillaCookieJar(str(path))
    if path.exists():
        if path.stat().st_mode & 0o077:
            raise ValueError('Cookie file permissions must be 0600')
        jar.load(ignore_discard=True, ignore_expires=True)
    elif required:
        raise ValueError('Cookie file missing; enroll this CLI browser first')
    session = requests.Session()
    session.cookies = jar
    return session


def _save_cookies(session):
    descriptor = os.open(session.cookies.filename, os.O_WRONLY | os.O_CREAT, 0o600)
    os.close(descriptor)
    session.cookies.save(ignore_discard=True, ignore_expires=True)


def authenticated_session(base, cookie_file):
    """Renew a session from a protected remembered-browser cookie jar."""
    session = _cookie_session(cookie_file)
    response = session.post(build_url(base, '/api/session'),
                            headers={'Accept': 'application/json'}, timeout=30)
    response.raise_for_status()
    _save_cookies(session)
    return session


def build_url(base, path):
    if path.startswith('http://') or path.startswith('https://'):
        return path
    if not path.startswith('/'):
        path = '/' + path
    return base.rstrip('/') + path


def print_response(r):
    try:
        data = r.json()
        print(json.dumps(data, indent=2))
    except Exception:
        print(r.text)
    if not r.ok:
        sys.exit(2)


def cmd_health(args):
    base = os.environ.get('API_BASE', 'http://localhost:8000')
    url = build_url(base, '/api/health')
    r = requests.get(url, timeout=10)
    print_response(r)


def cmd_enroll(args):
    base = os.environ.get('API_BASE', 'http://localhost:8000')
    session = _cookie_session(args.cookies, required=False)
    account_key = getpass('Current account key (blank for first enrollment): ')
    descriptor = os.open(args.key_output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as key_file:
        response = session.post(build_url(base, '/api/auth/enroll'),
                                json={'email': args.email, 'name': args.name, 'accountKey': account_key},
                                headers={'Accept': 'application/json'}, timeout=30)
        response.raise_for_status()
        key_file.write(response.json()['accountKey'] + '\n')
        key_file.flush()
        os.fsync(key_file.fileno())
    _save_cookies(session)
    print(f'Enrolled. Replacement account key saved to {args.key_output}; save it before continuing.')


def cmd_get(args):
    base = os.environ.get('API_BASE', 'http://localhost:8000')
    url = build_url(base, args.path)
    session = authenticated_session(base, args.cookies)
    r = session.get(url, headers={'Accept': 'application/json'}, timeout=30)
    print_response(r)


def load_json_arg(s):
    if s.startswith('@'):
        path = s[1:]
        with open(path, 'r') as f:
            return json.load(f)
    return json.loads(s)


def cmd_post(args):
    base = os.environ.get('API_BASE', 'http://localhost:8000')
    url = build_url(base, args.path)
    headers = {'Content-Type': 'application/json'}
    if '/auth/' in args.path:
        raise ValueError('Use the account UI or enroll command for account actions')
    session = authenticated_session(base, args.cookies)
    data = None
    if args.data:
        try:
            data = load_json_arg(args.data)
        except Exception as e:
            print('Failed to parse --data:', e)
            sys.exit(2)
    r = session.post(url, json=data, headers=headers, timeout=30)
    print_response(r)


def main():
    p = argparse.ArgumentParser(description='PlannerTool API CLI')
    sub = p.add_subparsers(dest='cmd')

    sp = sub.add_parser('health', help='GET /api/health')
    sp.set_defaults(func=cmd_health)

    sp = sub.add_parser('enroll', help='Enroll this CLI browser and save a replacement account key')
    sp.add_argument('email', help='email address')
    sp.add_argument('--name', default='', help='Real name for first enrollment')
    sp.add_argument('--cookies', required=True, help='Private cookie jar outside the repository')
    sp.add_argument('--key-output', required=True, help='New private file for the replacement account key')
    sp.set_defaults(func=cmd_enroll)

    sp = sub.add_parser('get', help='GET path or full URL')
    sp.add_argument('path', help='Path (e.g. /api/health) or full URL')
    sp.add_argument('--cookies', required=True, help='Private enrolled cookie jar')
    sp.set_defaults(func=cmd_get)

    sp = sub.add_parser('post', help='POST JSON to path or URL')
    sp.add_argument('path', help='Path or full URL')
    sp.add_argument('--data', '-d', help='JSON string or @file')
    sp.add_argument('--cookies', required=True, help='Private enrolled cookie jar')
    sp.set_defaults(func=cmd_post)

    args = p.parse_args()
    if not getattr(args, 'func', None):
        p.print_help()
        sys.exit(1)
    try:
        args.func(args)
    except (requests.RequestException, ValueError, OSError) as e:
        print('Request failed:', e)
        sys.exit(2)


if __name__ == '__main__':
    main()
