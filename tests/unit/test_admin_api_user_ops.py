import asyncio
from types import SimpleNamespace
import pytest
from planner_lib.admin import api as admin_api


class RecordingStorage:
    """In-memory storage that records all mutations.

    Accounts are stored in a single 'accounts' namespace; admin status is
    tracked via the 'permissions' field in each record rather than a separate
    'accounts_admin' namespace.
    """
    def __init__(self):
        self.data = {'accounts': {}}
        self.saved = []
        self.deleted = []

    def load(self, ns, key):
        if ns == 'accounts' and key in self.data['accounts']:
            return self.data['accounts'][key]
        raise KeyError(key)

    def save(self, ns, key, value):
        self.saved.append((ns, key, value))
        if ns == 'accounts':
            self.data['accounts'][key] = value

    def delete(self, ns, key):
        self.deleted.append((ns, key))
        if ns == 'accounts' and key in self.data['accounts']:
            del self.data['accounts'][key]
        else:
            raise KeyError(key)

    def list_keys(self, ns):
        if ns == 'accounts':
            return list(self.data['accounts'].keys())
        return []

    def exists(self, ns, key):
        return (ns == 'accounts') and (key in self.data['accounts'])


def _do_sync(storage, users, admins):
    """Simple sync helper that mirrors AccountAdminService.sync_accounts_full logic."""
    if isinstance(users, list):
        users = {e: {'email': e} for e in users}
    if isinstance(admins, list):
        admins_set = set(admins)
    else:
        admins_set = set(admins.keys())

    current_users = set(storage.list_keys('accounts'))
    for k, v in users.items():
        record = dict(v) if v else {'email': k}
        permissions = list(record.get('permissions') or [])
        if k in admins_set:
            if 'admin' not in permissions:
                permissions.append('admin')
        else:
            permissions = [p for p in permissions if p != 'admin']
        record['permissions'] = permissions
        storage.save('accounts', k, record)
    for k in current_users - set(users):
        try:
            storage.delete('accounts', k)
        except KeyError:
            pass


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
    # existing accounts: u1. existing admin: admin_old (has 'admin' permission)
    storage.save('accounts', 'u1', {'email': 'u1', 'permissions': []})
    storage.save('accounts', 'admin_old', {'email': 'admin_old', 'permissions': ['admin']})

    admin_svc = SimpleNamespace(
        _account_storage=storage,
        get_all_users=lambda: list(storage.list_keys('accounts')),
        get_all_admins=lambda: [k for k, v in storage.data['accounts'].items()
                                if 'admin' in (v.get('permissions') or [])],
        sync_accounts_full=lambda users, admins: _do_sync(storage, users, admins),
    )
    session_mgr = SessMgr({'email': 'admin_old'})
    container = SimpleNamespace(get=lambda name: {'admin_service': admin_svc, 'session_manager': session_mgr}.get(name))

    # incoming: add admin_new (should be given admin permission), remove nothing
    payload = {'users': ['u1', 'u2', 'admin_old', 'admin_new'], 'admins': ['admin_old', 'admin_new']}
    req = make_request(container, payload, session_email='admin_old')
    res = asyncio.run(admin_api.admin_save_users.__wrapped__(req))
    assert res['ok']
    # admin_new should have been saved to 'accounts' with 'admin' permission
    assert any(ns == 'accounts' and key == 'admin_new' for (ns, key, _) in storage.saved)
    saved_admin_new = storage.data['accounts'].get('admin_new', {})
    assert 'admin' in (saved_admin_new.get('permissions') or [])


def test_remove_user_also_removes_account():
    storage = RecordingStorage()
    storage.save('accounts', 'remove_me', {'email': 'remove_me', 'permissions': ['admin']})

    admin_svc = SimpleNamespace(
        _account_storage=storage,
        get_all_users=lambda: list(storage.list_keys('accounts')),
        get_all_admins=lambda: [k for k, v in storage.data['accounts'].items()
                                if 'admin' in (v.get('permissions') or [])],
        sync_accounts_full=lambda users, admins: _do_sync(storage, users, admins),
    )
    session_mgr = SessMgr({'email': 'someone@admin'})
    container = SimpleNamespace(get=lambda name: {'admin_service': admin_svc, 'session_manager': session_mgr}.get(name))

    payload = {'users': [], 'admins': []}
    req = make_request(container, payload, session_email='someone@admin')
    res = asyncio.run(admin_api.admin_save_users.__wrapped__(req))
    assert res['ok']
    # deletion should have been attempted for the accounts record
    assert ('accounts', 'remove_me') in storage.deleted
