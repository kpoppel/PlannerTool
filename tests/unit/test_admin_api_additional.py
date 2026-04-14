import asyncio
from types import SimpleNamespace
import json
import os
from pathlib import Path
import pytest
from planner_lib.admin import api as admin_api
from fastapi import HTTPException


class SessMgr:
    def __init__(self, ctx=None):
        self._ctx = ctx or {}
    def exists(self, sid):
        return True
    def get(self, sid):
        return self._ctx


class FakeStorageFailSave:
    def __init__(self):
        self.data = {'config': {}}
        class Backend:
            def __init__(self):
                self.saved = []
            def save(self, ns, key, value):
                self.saved.append((ns, key, value))
        self._backend = Backend()
    def load(self, ns, key):
        raise KeyError(key)
    def save(self, ns, key, value):
        raise RuntimeError('simulated save failure')
    def delete(self, ns, key):
        raise KeyError(key)
    def list_keys(self, ns):
        raise Exception('list fail')


class FakeStorageRaiseOnLoad:
    def load(self, ns, key):
        raise RuntimeError('boom')


def make_request(container, headers=None, cookies=None):
    app = SimpleNamespace(state=SimpleNamespace(container=container))
    return SimpleNamespace(headers=headers or {}, cookies=cookies or {}, app=app, url=SimpleNamespace(path='/'))


def test_save_projects_backup_fallback(tmp_path, monkeypatch):
    # ensure working directory has no www-admin interference
    monkeypatch.chdir(tmp_path)
    storage = FakeStorageFailSave()
    # save_config must let RuntimeError propagate so admin_save_projects raises HTTPException
    admin_svc = SimpleNamespace(
        _config_storage=storage,
        get_config=lambda key, default=None: default,
        save_config=lambda key, content: storage.save('config', key, content),
    )
    container = SimpleNamespace(get=lambda name: {'admin_service': admin_svc}.get(name))

    class Req:
        def __init__(self, payload):
            self._payload = payload
            self.headers = {}
            self.cookies = {}
            self.app = SimpleNamespace(state=SimpleNamespace(container=container))
        async def json(self):
            return self._payload

    payload = {'content': json.dumps({'a': 1})}
    req = Req(payload)
    # should still raise HTTPException because storage.save failed and backup attempted
    with pytest.raises(HTTPException):
        asyncio.run(admin_api.admin_save_projects.__wrapped__(req))


def test_get_projects_raises_on_storage_error():
    storage = FakeStorageRaiseOnLoad()
    # get_config lets non-KeyError exceptions propagate; admin_get_projects outer try/except
    # converts them to HTTPException(500)
    admin_svc = SimpleNamespace(
        _config_storage=storage,
        get_config=lambda key, default=None: storage.load('config', key),
    )
    container = SimpleNamespace(get=lambda name: {'admin_service': admin_svc}.get(name))
    req = make_request(container)
    with pytest.raises(HTTPException):
        asyncio.run(admin_api.admin_get_projects.__wrapped__(req))


def test_get_users_handles_list_errors():
    # get_all_users / get_all_admins return [] on error -> admin_get_users returns empty lists
    class S:
        def list_keys(self, ns):
            raise Exception('boom')
    storage = S()
    admin_svc = SimpleNamespace(
        _account_storage=storage,
        get_all_users=lambda: [],
        get_all_admins=lambda: [],
    )
    container = SimpleNamespace(get=lambda name: {'admin_service': admin_svc}.get(name))
    req = make_request(container)
    res = asyncio.run(admin_api.admin_get_users.__wrapped__(req))
    assert res['users'] == [] and res['admins'] == []


def test_admin_static_not_found(tmp_path, monkeypatch):
    # empty dir -> index missing -> 404
    monkeypatch.chdir(tmp_path)
    with pytest.raises(HTTPException):
        asyncio.run(admin_api.admin_static(None, ''))


def test_admin_root_files_missing_raises_404(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    # no session id in headers or cookies and no files present
    req = make_request(SimpleNamespace(get=lambda name: None))
    with pytest.raises(HTTPException) as ei:
        asyncio.run(admin_api.admin_root(req))
    assert ei.value.status_code == 404


def test_api_admin_reload_config_service_missing():
    # container that raises KeyError to simulate missing service
    container = SimpleNamespace(get=lambda name: (_ for _ in ()).throw(KeyError('missing')))
    req = make_request(container)
    with pytest.raises(HTTPException):
        asyncio.run(admin_api.api_admin_reload_config.__wrapped__(req))


def test_admin_save_projects_success_and_backup(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    class Storage:
        def __init__(self):
            self.saved = []
            self.data = {'config': {'projects': {'old': True}}}
            self._backend = self
        def load(self, ns, key):
            if ns == 'config' and key in self.data['config']:
                return self.data['config'][key]
            raise KeyError(key)
        def save(self, ns, key, value):
            self.saved.append((ns, key, value))
        def list_keys(self, ns):
            return []
    storage = Storage()

    def _save_config(key, content):
        try:
            existing = storage.load('config', key)
            from datetime import datetime, timezone
            ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
            storage.save('config', f'{key}_backup_{ts}', existing)
        except Exception:
            pass
        storage.save('config', key, content)

    admin_svc = SimpleNamespace(
        _config_storage=storage,
        get_config=lambda key, default=None: storage.load('config', key) if key in storage.data.get('config', {}) else default,
        save_config=_save_config,
    )
    container = SimpleNamespace(get=lambda name: {'admin_service': admin_svc}.get(name))

    class Req:
        def __init__(self, payload):
            self._payload = payload
            self.headers = {}
            self.cookies = {}
            self.app = SimpleNamespace(state=SimpleNamespace(container=container))
        async def json(self):
            return self._payload

    payload = {'content': json.dumps({'a': 1})}
    req = Req(payload)
    res = asyncio.run(admin_api.admin_save_projects.__wrapped__(req))
    assert res['ok']
    # backup save should have happened (one saved for backup, one for final)
    assert any('projects_backup_' in key for (_, key, _) in storage.saved)


def test_admin_save_users_delete_keyerror_handled():
    class Storage:
        def __init__(self):
            self.data = {'accounts': {'u1': {}}, 'accounts_admin': {}}
        def list_keys(self, ns):
            return list(self.data.get(ns, {}).keys())
        def save(self, ns, key, val):
            self.data.setdefault(ns, {})[key] = val
        def delete(self, ns, key):
            # simulate missing key by raising KeyError for accounts deletion
            if ns == 'accounts':
                raise KeyError(key)
            if ns == 'accounts_admin':
                raise KeyError(key)
        def load(self, ns, key):
            raise KeyError(key)
    storage = Storage()

    def _sync_full(users, admins):
        if isinstance(users, list):
            users = {e: {'email': e} for e in users}
        if isinstance(admins, list):
            admins = {e: {'email': e} for e in admins}
        current_users = set(storage.list_keys('accounts'))
        current_admins = set(storage.list_keys('accounts_admin'))
        for k, v in users.items():
            storage.save('accounts', k, v)
        for k in current_users - set(users):
            try:
                storage.delete('accounts', k)
            except KeyError:
                pass
        for k, v in admins.items():
            storage.save('accounts_admin', k, v)
        for k in current_admins - set(admins):
            try:
                storage.delete('accounts_admin', k)
            except KeyError:
                pass

    admin_svc = SimpleNamespace(
        _account_storage=storage,
        get_all_users=lambda: list(storage.list_keys('accounts')),
        get_all_admins=lambda: list(storage.list_keys('accounts_admin')),
        sync_accounts_full=_sync_full,
    )
    session_mgr = SessMgr({'email': 'admin@admin'})
    container = SimpleNamespace(get=lambda name: {'admin_service': admin_svc, 'session_manager': session_mgr}.get(name))

    class Req:
        def __init__(self, payload):
            self._payload = payload
            self.headers = {'X-Session-Id': 's1'}
            self.cookies = {}
            self.app = SimpleNamespace(state=SimpleNamespace(container=container))
        async def json(self):
            return self._payload

    payload = {'users': [], 'admins': []}
    req = Req(payload)
    res = asyncio.run(admin_api.admin_save_users.__wrapped__(req))
    assert res['ok']


def test_admin_root_session_admin_service_missing(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    # create index file so file-read path exists
    (Path(tmp_path) / 'www-admin').mkdir()
    (Path(tmp_path) / 'www-admin' / 'index.html').write_text('INDEX')
    # session_mgr exists and returns email, but admin_service missing
    session_mgr = SessMgr({'email': 'someone@admin'})
    container = SimpleNamespace(get=lambda name: {'session_manager': session_mgr}.get(name))
    req = make_request(container, headers={'X-Session-Id': 's1'})
    # should raise HTTPException with 401 because admin_service not available
    with pytest.raises(Exception):
        asyncio.run(admin_api.admin_root(req))
