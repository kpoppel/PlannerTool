"""Tests for the new public methods added to AdminService.

Bug: admin/api.py accessed admin_svc._account_storage and admin_svc._config_storage
directly, bypassing the service layer. New public methods are added to service and
these tests verify they work correctly.
"""
import pytest
from planner_lib.admin.service import AdminService


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


def _make_service(**kwargs):
    storage = _FakeStorage()
    defaults = dict(
        account_storage=storage,
        config_storage=storage,
        project_service=None,
        account_manager=None,
        azure_client=None,
    )
    defaults.update(kwargs)
    return AdminService(**defaults), storage


# ---------------------------------------------------------------------------
# admin_count / create_admin_account
# ---------------------------------------------------------------------------

def test_admin_count_returns_zero_when_no_admins():
    svc, _ = _make_service()
    assert svc.admin_count() == 0


def test_admin_count_returns_correct_count():
    svc, store = _make_service()
    store.save('accounts_admin', 'a@example.com', {})
    store.save('accounts_admin', 'b@example.com', {})
    assert svc.admin_count() == 2


def test_create_admin_account_creates_user_and_admin_records():
    svc, store = _make_service()
    svc.create_admin_account('admin@example.com', 'mytoken')

    user = store.load('accounts', 'admin@example.com')
    assert user == {'email': 'admin@example.com', 'pat': 'mytoken'}

    admin = store.load('accounts_admin', 'admin@example.com')
    assert admin == {'email': 'admin@example.com', 'pat': 'mytoken'}


def test_create_admin_account_updates_pat_if_account_exists():
    svc, store = _make_service()
    store.save('accounts', 'admin@example.com', {'email': 'admin@example.com', 'pat': 'old'})

    svc.create_admin_account('admin@example.com', 'new_token')
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
