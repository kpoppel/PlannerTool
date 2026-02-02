import asyncio
from types import SimpleNamespace
import pytest
from planner_lib.admin import api as admin_api


class RecordingStorage:
    def __init__(self):
        self.data = {'accounts': {}, 'accounts_admin': {}}
        self.saved = []
        self.deleted = []
    def load(self, ns, key):
        if ns == 'accounts' and key in self.data['accounts']:
            return self.data['accounts'][key]
        if ns == 'accounts_admin' and key in self.data['accounts_admin']:
            return self.data['accounts_admin'][key]
        raise KeyError(key)
    def save(self, ns, key, value):
        self.saved.append((ns, key, value))
        if ns == 'accounts':
            self.data['accounts'][key] = value
        elif ns == 'accounts_admin':
            self.data['accounts_admin'][key] = value
    def delete(self, ns, key):
        self.deleted.append((ns, key))
        if ns == 'accounts' and key in self.data['accounts']:
            del self.data['accounts'][key]
        elif ns == 'accounts_admin' and key in self.data['accounts_admin']:
            del self.data['accounts_admin'][key]
        else:
            raise KeyError(key)
    def list_keys(self, ns):
        if ns == 'accounts':
            return list(self.data['accounts'].keys())
        if ns == 'accounts_admin':
            return list(self.data['accounts_admin'].keys())
        return []


class SessMgr:
    def __init__(self, ctx=None):
        self._ctx = ctx or {}
    def exists(self, sid):
        return True
    def get(self, sid):
        return self._ctx


def make_request(container, payload, session_email=None):
    class Req:
        def __init__(self, payload, container, session_email):
            self._payload = payload
            self.headers = {'X-Session-Id': 's1'} if session_email else {}
            self.cookies = {}
            self.app = SimpleNamespace(state=SimpleNamespace(container=container))
        async def json(self):
            return self._payload
    return Req(payload, container, session_email)


def test_add_admin_copies_existing_account_and_removes_user_admin_marker():
    storage = RecordingStorage()
    # existing accounts: u1. existing admin: admin_old
    storage.save('accounts', 'u1', {'email': 'u1'})
    storage.save('accounts_admin', 'admin_old', {'email': 'admin_old'})

    admin_svc = SimpleNamespace(_account_storage=storage)
    session_mgr = SessMgr({'email': 'admin_old'})
    container = SimpleNamespace(get=lambda name: {'admin_service': admin_svc, 'session_manager': session_mgr}.get(name))

    # incoming: add admin_new (should copy payload if account exists), remove nothing
    payload = {'users': ['u1', 'u2'], 'admins': ['admin_old', 'admin_new']}
    req = make_request(container, payload, session_email='admin_old')
    res = asyncio.run(admin_api.admin_save_users.__wrapped__(req))
    assert res['ok']
    # admin_new should be created under accounts_admin (copied or minimal)
    assert any(ns == 'accounts_admin' and key == 'admin_new' for (ns, key, _) in storage.saved)


def test_remove_user_also_removes_admin_marker_if_present():
    storage = RecordingStorage()
    storage.save('accounts', 'remove_me', {'email': 'remove_me'})
    storage.save('accounts_admin', 'remove_me', {'email': 'remove_me'})

    admin_svc = SimpleNamespace(_account_storage=storage)
    session_mgr = SessMgr({'email': 'someone@admin'})
    container = SimpleNamespace(get=lambda name: {'admin_service': admin_svc, 'session_manager': session_mgr}.get(name))

    payload = {'users': [], 'admins': []}
    req = make_request(container, payload, session_email='someone@admin')
    res = asyncio.run(admin_api.admin_save_users.__wrapped__(req))
    assert res['ok']
    # deletion should have been attempted for accounts and accounts_admin
    assert ('accounts', 'remove_me') in storage.deleted
    assert ('accounts_admin', 'remove_me') in storage.deleted
