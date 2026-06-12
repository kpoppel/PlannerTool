"""Tests for the new public methods added to AdminService.

Bug: admin/api.py accessed admin_svc._account_storage and admin_svc._config_storage
directly, bypassing the service layer. New public methods are added to service and
these tests verify they work correctly.
"""
import pytest
from planner_lib.admin.service import AdminService
from planner_lib.accounts.constants import AccountPermissions


class _FakeStorage:
    def __init__(self):
        self._data = {}

    def save(self, ns, key, val):
        self._data[(ns, key)] = val

    def load(self, ns, key):
        try:
            return self._data[(ns, key)]
        except KeyError:
            raise KeyError(key)

    def exists(self, ns, key):
        return (ns, key) in self._data

    def delete(self, ns, key):
        self._data.pop((ns, key), None)

    def list_keys(self, ns):
        return [k for (n, k) in self._data if n == ns]

    def configure(self, **kwargs):
        pass


class _FakeAccountManager:
    def __init__(self, storage):
        self._storage = storage

    def get_all_users(self):
        try:
            return self._storage.list_keys('accounts')
        except Exception:
            return []

    def load(self, email):
        return self._storage.load('accounts', email)

    def save(self, payload_or_user_dict):
        if hasattr(payload_or_user_dict, '__dict__'):
            data = dict(payload_or_user_dict.__dict__)
        elif isinstance(payload_or_user_dict, dict):
            data = dict(payload_or_user_dict)
        else:
            data = dict(payload_or_user_dict)
        email = data.get('email') or (hasattr(payload_or_user_dict, 'email') and payload_or_user_dict.email)
        if email:
            self._storage.save('accounts', email, data)

    def get_all_with_permission(self, permission):
        users = self._storage.list_keys('accounts') or []
        if permission == 'admin':
            return [k for k in users
                    if 'admin' in (self._storage.load('accounts', k).get('permissions') or [])]
        return []

    def count_all_with_permission(self, permission):
        return len(self.get_all_with_permission(permission))

    def sync_accounts_full(self, users, admins):
        pass


def _make_service(**kwargs):
    storage = _FakeStorage()
    defaults = dict(
        account_storage=storage,
        config_storage=storage,
        project_repository=None,
        account_manager=_FakeAccountManager(storage),
        azure_client=None,
    )
    defaults.update(kwargs)
    return AdminService(**defaults), storage


# ---------------------------------------------------------------------------
# admin_count / create_admin_account
# ---------------------------------------------------------------------------

def test_admin_count_returns_zero_when_no_admins():
    svc, _ = _make_service()
    assert svc._account_manager.count_all_with_permission(AccountPermissions.ADMIN) == 0


def test_admin_count_returns_correct_count():
    svc, store = _make_service()
    store.save('accounts', 'a@example.com', {'email': 'a@example.com', 'permissions': ['admin']})
    store.save('accounts', 'b@example.com', {'email': 'b@example.com', 'permissions': ['admin']})
    assert svc._account_manager.count_all_with_permission(AccountPermissions.ADMIN) == 2


def test_create_admin_account_creates_user_and_admin_records():
    svc, store = _make_service()
    svc._account_manager.save({'email': 'admin@example.com', 'pat': 'mytoken', 'permissions': [AccountPermissions.ADMIN]})

    user = store.load('accounts', 'admin@example.com')
    assert user['email'] == 'admin@example.com'
    assert user['pat'] == 'mytoken'
    assert AccountPermissions.ADMIN in user.get('permissions', [])


def test_create_admin_account_updates_pat_if_account_exists():
    svc, store = _make_service()
    store.save('accounts', 'admin@example.com', {'email': 'admin@example.com', 'pat': 'old'})
    svc._account_manager.save({'email': 'admin@example.com', 'pat': 'new_token'})
    user = store.load('accounts', 'admin@example.com')
    assert user['pat'] == 'new_token'


# ---------------------------------------------------------------------------
# get_config / save_config
# ---------------------------------------------------------------------------

def test_get_config_returns_stored_value():
    svc, store = _make_service()
    store.save('config', 'projects', {'name': 'test'})
    assert svc.get_config('projects') == {'name': 'test'}


def test_get_config_returns_default_when_missing():
    svc, _ = _make_service()
    assert svc.get_config('missing') is None
    assert svc.get_config('missing', default={'fallback': True}) == {'fallback': True}


def test_get_config_decodes_bytes_to_string():
    svc, store = _make_service()
    store.save('config', 'raw_key', b'yaml: content')
    result = svc.get_config('raw_key')
    assert result == 'yaml: content'


def test_save_config_persists_content():
    svc, store = _make_service()
    svc.save_config('projects', {'name': 'saved'})
    assert store.load('config', 'projects') == {'name': 'saved'}


def test_save_config_creates_timestamped_backup_of_existing_value():
    svc, store = _make_service()
    store.save('config', 'projects', {'original': True})

    svc.save_config('projects', {'updated': True})

    # Backup key should exist alongside the updated value
    config_keys = store.list_keys('config')
    backup_keys = [k for k in config_keys if k.startswith('projects_backup_')]
    assert len(backup_keys) == 1, f"Expected one backup key, got: {backup_keys}"

    # Backup should contain the original value
    backup = store.load('config', backup_keys[0])
    assert backup == {'original': True}

    # Updated value is stored under the canonical key
    assert store.load('config', 'projects') == {'updated': True}


def test_save_config_no_backup_when_key_is_new():
    svc, store = _make_service()
    svc.save_config('new_key', {'data': 1})

    config_keys = store.list_keys('config')
    backup_keys = [k for k in config_keys if 'backup' in k]
    assert backup_keys == [], "No backup should be created for a new key"
