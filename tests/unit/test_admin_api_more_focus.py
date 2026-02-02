import asyncio
from types import SimpleNamespace
import json
import pytest
from planner_lib.admin import api as admin_api
from fastapi import HTTPException


class FakeStorageBase:
    def __init__(self):
        self.data = {'config': {}, 'accounts': {}, 'accounts_admin': {}}
        self._backend = None
    def load(self, ns, key):
        if ns == 'config' and key in self.data['config']:
            return self.data['config'][key]
        if ns == 'accounts' and key in self.data['accounts']:
            return self.data['accounts'][key]
        if ns == 'accounts_admin' and key in self.data['accounts_admin']:
            return self.data['accounts_admin'][key]
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


class FakeStorageFailSave(FakeStorageBase):
    def __init__(self):
        super().__init__()
        class Backend:
            def __init__(self):
                self.saved = []
            def save(self, ns, key, value):
                self.saved.append((ns, key, value))
        self._backend = Backend()
    def save(self, ns, key, value):
        raise RuntimeError('simulated save failure')


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
        return True
    def get(self, sid):
        return self._ctx


def make_request(container, headers=None, cookies=None):
    app = SimpleNamespace(state=SimpleNamespace(container=container))
    return SimpleNamespace(headers=headers or {}, cookies=cookies or {}, app=app, url=SimpleNamespace(path='/'))


def test_backup_existing_fallback_uses_backend():
    storage = FakeStorageFailSave()
    # populate existing key so _backup_existing will attempt to backup
    storage.data['config']['projects'] = b'rawbytes'
    # call the internal helper
    admin_api._backup_existing(storage, 'projects', 'projects')
    # backend.save should have been called with the backup key
    assert storage._backend.saved, 'backend.save was not called as fallback'
    ns, key, val = storage._backend.saved[0]
    assert ns == 'config'
    assert key.startswith('projects_backup_')


def test_admin_save_users_forbidden_removal_of_current_admin():
    storage = FakeStorageBase()
    storage.save('accounts', 'admin1@admin', {'email': 'admin1@admin'})
    storage.save('accounts_admin', 'admin1@admin', {'email': 'admin1@admin'})

    admin_svc = FakeAdminService(storage)
    session_mgr = SessMgr({'email': 'admin1@admin'})
    container = SimpleNamespace(get=lambda name: {'admin_service': admin_svc, 'session_manager': session_mgr}.get(name))

    class Req:
        def __init__(self, payload):
            self._payload = payload
            self.headers = {'X-Session-Id': 's1'}
            self.cookies = {}
            self.app = SimpleNamespace(state=SimpleNamespace(container=container))
        async def json(self):
            return self._payload

    # attempt to remove current admin from admins list
    payload = {'users': ['admin1@admin'], 'admins': []}
    req = Req(payload)
    with pytest.raises(HTTPException) as ei:
        asyncio.run(admin_api.admin_save_users.__wrapped__(req))
    assert ei.value.status_code == 400


def test_admin_save_users_add_and_remove_users_and_admins():
    storage = FakeStorageBase()
    storage.save('accounts', 'u1', {'email': 'u1'})
    storage.save('accounts_admin', 'admin1@admin', {'email': 'admin1@admin'})

    admin_svc = FakeAdminService(storage)
    session_mgr = SessMgr({'email': 'admin1@admin'})
    container = SimpleNamespace(get=lambda name: {'admin_service': admin_svc, 'session_manager': session_mgr}.get(name))

    class Req:
        def __init__(self, payload):
            self._payload = payload
            self.headers = {'X-Session-Id': 's1'}
            self.cookies = {}
            self.app = SimpleNamespace(state=SimpleNamespace(container=container))
        async def json(self):
            return self._payload

    # Add u2 and admin2, remove nothing else
    payload = {'users': ['u1', 'u2'], 'admins': ['admin1@admin', 'admin2@admin']}
    req = Req(payload)
    res = asyncio.run(admin_api.admin_save_users.__wrapped__(req))
    assert res['ok']
    assert 'u2' in storage.data['accounts']
    assert 'admin2@admin' in storage.data['accounts_admin']


def test_admin_save_users_invalid_payload_types():
    storage = FakeStorageBase()
    admin_svc = FakeAdminService(storage)
    session_mgr = SessMgr({'email': 'admin1@admin'})
    container = SimpleNamespace(get=lambda name: {'admin_service': admin_svc, 'session_manager': session_mgr}.get(name))

    class ReqBad:
        def __init__(self, payload):
            self._payload = payload
            self.headers = {'X-Session-Id': 's1'}
            self.cookies = {}
            self.app = SimpleNamespace(state=SimpleNamespace(container=container))
        async def json(self):
            return self._payload

    # Non-dict payload
    req1 = ReqBad(['not', 'a', 'dict'])
    with pytest.raises(HTTPException):
        asyncio.run(admin_api.admin_save_users.__wrapped__(req1))

    # users/admins not lists
    req2 = ReqBad({'users': 'string', 'admins': 'string'})
    with pytest.raises(HTTPException):
        asyncio.run(admin_api.admin_save_users.__wrapped__(req2))
