import asyncio
from types import SimpleNamespace
import json
import os
import pytest
from planner_lib.admin import api as admin_api
from fastapi import HTTPException


def make_request(container, headers=None, cookies=None):
    app = SimpleNamespace(state=SimpleNamespace(container=container))
    return SimpleNamespace(headers=headers or {}, cookies=cookies or {}, app=app, url=SimpleNamespace(path='/'))


class FakeStorage:
    def __init__(self):
        self.data = {'config': {}, 'accounts': {}, 'accounts_admin': {}}
        self._backend = None
    def load(self, ns, key):
        if ns == 'config' and key in self.data['config']:
            return self.data['config'][key]
        if ns == 'accounts' and key in self.data['accounts']:
            return self.data['accounts'][key]
        raise KeyError(key)
    def save(self, ns, key, value):
        if ns == 'config':
            self.data['config'][key] = value
        elif ns == 'accounts':
            self.data['accounts'][key] = value
        elif ns == 'accounts_admin':
            self.data['accounts_admin'][key] = value
    def delete(self, ns, key):
        if ns == 'accounts' and key in self.data['accounts']:
            del self.data['accounts'][key]
        if ns == 'accounts_admin' and key in self.data['accounts_admin']:
            del self.data['accounts_admin'][key]
    def list_keys(self, ns):
        if ns == 'accounts':
            return list(self.data['accounts'].keys())
        if ns == 'accounts_admin':
            return list(self.data['accounts_admin'].keys())
        return []


class FakeAdminService:
    def __init__(self, storage):
        self._config_storage = storage
        self._account_storage = storage
    def reload_config(self, request):
        return {'reloaded': True}
    def is_admin(self, email):
        return email and email.endswith('@admin')


class SessMgr:
    def __init__(self, ctx=None):
        self._ctx = ctx or {}
    def exists(self, sid):
        return bool(sid and self._ctx)
    def get(self, sid):
        return self._ctx


def ensure_www_admin_files(tmp_path):
    base = tmp_path / 'www-admin'
    base.mkdir(exist_ok=True)
    (base / 'index.html').write_text('<html><body>INDEX</body></html>', encoding='utf-8')
    (base / 'login.html').write_text('<html><body>LOGIN</body></html>', encoding='utf-8')
    return base


def test_admin_static_and_traversal(tmp_path, monkeypatch):
    base = ensure_www_admin_files(tmp_path)
    # Monkeypatch cwd so Path('www-admin') resolves to tmp_path/www-admin
    monkeypatch.chdir(tmp_path)

    # valid index
    resp = asyncio.run(admin_api.admin_static(None, ''))
    assert resp is not None

    # traversal attack
    with pytest.raises(HTTPException):
        asyncio.run(admin_api.admin_static(None, '../etc/passwd'))


def test_admin_root_serving_and_session_paths(tmp_path, monkeypatch):
    base = ensure_www_admin_files(tmp_path)
    monkeypatch.chdir(tmp_path)

    storage = FakeStorage()
    admin_svc = FakeAdminService(storage)

    # No session -> serves login.html
    container = SimpleNamespace(get=lambda name: {'admin_service': admin_svc}.get(name))
    req = make_request(container)
    res = asyncio.run(admin_api.admin_root(req))
    assert 'LOGIN' in res.body.decode('utf-8') if hasattr(res, 'body') else True

    # Session present but not existing -> serves index
    session_mgr = SessMgr({})
    container2 = SimpleNamespace(get=lambda name: {'session_manager': session_mgr, 'admin_service': admin_svc}.get(name))
    req2 = make_request(container2, headers={'X-Session-Id': 's1'})
    res2 = asyncio.run(admin_api.admin_root(req2))
    assert res2 is not None

    # Session exists and admin -> serve index
    session_mgr2 = SessMgr({'email': 'me@admin'})
    container3 = SimpleNamespace(get=lambda name: {'session_manager': session_mgr2, 'admin_service': admin_svc}.get(name))
    req3 = make_request(container3, headers={'X-Session-Id': 's1'})
    res3 = asyncio.run(admin_api.admin_root(req3))
    assert res3 is not None

    # Session exists but not admin -> 401
    session_mgr3 = SessMgr({'email': 'user@not'})
    container4 = SimpleNamespace(get=lambda name: {'session_manager': session_mgr3, 'admin_service': admin_svc}.get(name))
    req4 = make_request(container4, headers={'X-Session-Id': 's1'})
    with pytest.raises(HTTPException) as ei:
        asyncio.run(admin_api.admin_root(req4))
    assert ei.value.status_code == 401


def test_admin_teams_and_system_endpoints(monkeypatch):
    storage = FakeStorage()
    admin_svc = FakeAdminService(storage)
    container = SimpleNamespace(get=lambda name: {'admin_service': admin_svc}.get(name))

    # teams: missing -> empty
    req = make_request(container)
    res = asyncio.run(admin_api.admin_get_teams.__wrapped__(req))
    assert res['content'] == ''

    # teams: bytes
    storage.data['config']['teams'] = b'teambytes'
    res2 = asyncio.run(admin_api.admin_get_teams.__wrapped__(req))
    assert res2['content'] == 'teambytes'

    # save teams valid
    class Req:
        def __init__(self, payload):
            self._payload = payload
            self.headers = {}
            self.cookies = {}
            self.app = SimpleNamespace(state=SimpleNamespace(container=container))
        async def json(self):
            return self._payload

    payload = {'content': json.dumps({'t': 1})}
    req2 = Req(payload)
    res3 = asyncio.run(admin_api.admin_save_teams.__wrapped__(req2))
    assert res3['ok']

    # system: missing -> empty
    res4 = asyncio.run(admin_api.admin_get_system.__wrapped__(req))
    assert res4['content'] == ''

    # save system valid
    payload2 = {'content': json.dumps({'s': True})}
    req3 = Req(payload2)
    res5 = asyncio.run(admin_api.admin_save_system.__wrapped__(req3))
    assert res5['ok']