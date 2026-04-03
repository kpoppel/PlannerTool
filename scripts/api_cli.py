#!/usr/bin/env python3
"""Small CLI to interact with the PlannerTool server API.

Usage examples:
  scripts/api_cli.py health
  scripts/api_cli.py create-session user@example.com
  scripts/api_cli.py get /api/health
  scripts/api_cli.py post /api/some -d '{"key":"value"}'

Configure base URL with `API_BASE` environment variable (default: http://localhost:8000).
Session id can be provided with `--session` or `SESSION_ID` env var.
"""

import os
import sys
import argparse
import json

import requests


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


def cmd_create_session(args):
    base = os.environ.get('API_BASE', 'http://localhost:8000')
    url = build_url(base, '/api/session')
    payload = {"email": args.email}
    r = requests.post(url, json=payload, timeout=10)
    try:
        data = r.json()
    except Exception:
        print(r.text)
        sys.exit(2)
    if r.ok:
        sid = data.get('sessionId') or data.get('session_id') or data.get('sessionId')
        if sid:
            print(sid)
            return
    print(json.dumps(data, indent=2))
    sys.exit(2)


def cmd_get(args):
    base = os.environ.get('API_BASE', 'http://localhost:8000')
    url = build_url(base, args.path)
    headers = {}
    sid = args.session or os.environ.get('SESSION_ID') or os.environ.get('X_SESSION_ID') or os.environ.get('X-Session-Id')
    if sid:
        headers['X-Session-Id'] = sid
    r = requests.get(url, headers=headers, timeout=30)
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
    sid = args.session or os.environ.get('SESSION_ID') or os.environ.get('X_SESSION_ID') or os.environ.get('X-Session-Id')
    if sid:
        headers['X-Session-Id'] = sid
    data = None
    if args.data:
        try:
            data = load_json_arg(args.data)
        except Exception as e:
            print('Failed to parse --data:', e)
            sys.exit(2)
    r = requests.post(url, json=data, headers=headers, timeout=30)
    print_response(r)


def main():
    p = argparse.ArgumentParser(description='PlannerTool API CLI')
    sub = p.add_subparsers(dest='cmd')

    sp = sub.add_parser('health', help='GET /api/health')
    sp.set_defaults(func=cmd_health)

    sp = sub.add_parser('create-session', help='POST /api/session {"email":...}')
    sp.add_argument('email', help='email address')
    sp.set_defaults(func=cmd_create_session)

    sp = sub.add_parser('get', help='GET path or full URL')
    sp.add_argument('path', help='Path (e.g. /api/health) or full URL')
    sp.add_argument('--session', '-s', help='Session id header')
    sp.set_defaults(func=cmd_get)

    sp = sub.add_parser('post', help='POST JSON to path or URL')
    sp.add_argument('path', help='Path or full URL')
    sp.add_argument('--data', '-d', help='JSON string or @file')
    sp.add_argument('--session', '-s', help='Session id header')
    sp.set_defaults(func=cmd_post)

    args = p.parse_args()
    if not getattr(args, 'func', None):
        p.print_help()
        sys.exit(1)
    try:
        args.func(args)
    except requests.RequestException as e:
        print('Request failed:', e)
        sys.exit(2)


if __name__ == '__main__':
    main()
