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
    def get_config(self, key, default=None):
        try:
            data = self._config_storage.load('config', key)
            if isinstance(data, (bytes, bytearray)):
                return data.decode('utf-8')
            return data
        except Exception:
            return default
    def save_config(self, key, content):
        try:
            existing = self._config_storage.load('config', key)
            from datetime import datetime, timezone
            ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
            self._config_storage.save('config', f'{key}_backup_{ts}', existing)
        except Exception:
            pass
        self._config_storage.save('config', key, content)
    def save_config_raw(self, key, content):
        self._config_storage.save('config', key, content)
    def get_all_users(self):
        try:
            return list(self._account_storage.list_keys('accounts'))
        except Exception:
            return []
    def get_all_admins(self):
        try:
            return list(self._account_storage.list_keys('accounts_admin'))
        except Exception:
            return []
    def admin_count(self):
        return len(self.get_all_admins())
    def create_admin_account(self, email, pat):
        try:
            user = self._account_storage.load('accounts', email)
            user['pat'] = pat
        except Exception:
            user = {'email': email, 'pat': pat}
        self._account_storage.save('accounts', email, user)
        self._account_storage.save('accounts_admin', email, user)
    def sync_accounts_full(self, users, admins):
        if isinstance(users, list):
            users = {e: {'email': e} for e in users}
        if isinstance(admins, list):
            admins = {e: {'email': e} for e in admins}
        current_users = set(self._account_storage.list_keys('accounts') or [])
        current_admins = set(self._account_storage.list_keys('accounts_admin') or [])
        for k, v in users.items():
            self._account_storage.save('accounts', k, v)
        for k in current_users - set(users):
            self._account_storage.delete('accounts', k)
        for k, v in admins.items():
            self._account_storage.save('accounts_admin', k, v)
        for k in current_admins - set(admins):
            self._account_storage.delete('accounts_admin', k)


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
