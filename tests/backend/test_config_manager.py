"""Tests for ConfigManager extracted from AdminService.

Covers:
- get_config / save_config / save_config_raw
- _backup_config creates timestamped copies
- get_backup snapshots all known config keys + accounts + views + scenarios
- restore_backup writes back and calls sync_accounts_fn
- restore_backup guards against removing the current admin
- AdminService delegates config operations to its ConfigManager
"""
import pytest
from unittest.mock import MagicMock


# ---------------------------------------------------------------------------
# Storage stub
# ---------------------------------------------------------------------------


class _Store:
    """In-memory storage stub that implements the StorageBackend interface."""

    def __init__(self):
        self._data = {}

    def load(self, ns, key):
        try:
            return self._data[ns][key]
        except KeyError:
            raise KeyError(f"{ns}/{key}")

    def save(self, ns, key, val):
        self._data.setdefault(ns, {})[key] = val

    def exists(self, ns, key):
        return ns in self._data and key in self._data[ns]

    def list_keys(self, ns):
        return list(self._data.get(ns, {}).keys())


# ---------------------------------------------------------------------------
# ConfigManager unit tests
# ---------------------------------------------------------------------------


def test_get_config_returns_value():
    from planner_lib.admin.config_manager import ConfigManager
    store = _Store()
    store.save('config', 'server_config', {'org': 'test-org'})
    cm = ConfigManager(config_storage=store, account_storage=_Store())
    assert cm.get_config('server_config') == {'org': 'test-org'}


def test_get_config_returns_default_when_missing():
    from planner_lib.admin.config_manager import ConfigManager
    cm = ConfigManager(config_storage=_Store(), account_storage=_Store())
    assert cm.get_config('nonexistent') is None
    assert cm.get_config('nonexistent', default={'x': 1}) == {'x': 1}


def test_get_config_decodes_bytes():
    from planner_lib.admin.config_manager import ConfigManager
    store = _Store()
    store.save('config', 'raw_key', b'hello bytes')
    cm = ConfigManager(config_storage=store, account_storage=_Store())
    assert cm.get_config('raw_key') == 'hello bytes'


def test_save_config_creates_backup_then_saves():
    from planner_lib.admin.config_manager import ConfigManager
    store = _Store()
    store.save('config', 'server_config', {'version': 1})
    cm = ConfigManager(config_storage=store, account_storage=_Store())
    cm.save_config('server_config', {'version': 2})

    # New value persisted
    assert store.load('config', 'server_config') == {'version': 2}
    # Backup key created — find it
    backup_keys = [k for k in store.list_keys('config') if 'backup' in k]
    assert len(backup_keys) == 1
    assert 'server_config' in backup_keys[0]
    assert store.load('config', backup_keys[0]) == {'version': 1}


def test_save_config_no_backup_when_key_absent():
    from planner_lib.admin.config_manager import ConfigManager
    store = _Store()
    cm = ConfigManager(config_storage=store, account_storage=_Store())
    cm.save_config('new_key', {'x': 1})
    keys = store.list_keys('config')
    assert keys == ['new_key']  # no backup key created


def test_save_config_raw_no_backup():
    from planner_lib.admin.config_manager import ConfigManager
    store = _Store()
    store.save('config', 'computed', {'a': 1})
    cm = ConfigManager(config_storage=store, account_storage=_Store())
    cm.save_config_raw('computed', {'a': 2})

    assert store.load('config', 'computed') == {'a': 2}
    # No backup created
    backup_keys = [k for k in store.list_keys('config') if 'backup' in k]
    assert backup_keys == []


def test_get_backup_includes_config_keys():
    from planner_lib.admin.config_manager import ConfigManager
    store = _Store()
    store.save('config', 'projects', [{'id': 'p1'}])
    store.save('config', 'teams', [{'id': 't1'}])
    cm = ConfigManager(config_storage=store, account_storage=_Store())
    bk = cm.get_backup()
    assert bk['config']['projects'] == [{'id': 'p1'}]
    assert bk['config']['teams'] == [{'id': 't1'}]
    # Missing keys are stored as None
    assert bk['config']['people'] is None


def test_get_backup_includes_accounts():
    from planner_lib.admin.config_manager import ConfigManager
    acct = _Store()
    acct.save('accounts', 'a@b.com', {'email': 'a@b.com'})
    acct.save('accounts_admin', 'a@b.com', {'email': 'a@b.com'})
    cm = ConfigManager(config_storage=_Store(), account_storage=acct)
    bk = cm.get_backup()
    assert 'a@b.com' in bk['accounts']['users']
    assert 'a@b.com' in bk['accounts']['admins']


def test_restore_backup_writes_config():
    from planner_lib.admin.config_manager import ConfigManager
    store = _Store()
    cm = ConfigManager(config_storage=store, account_storage=_Store())
    data = {'config': {'server_config': {'org': 'restored-org'}}}
    result = cm.restore_backup(data)
    assert result['ok'] is True
    assert store.load('config', 'server_config') == {'org': 'restored-org'}


def test_restore_backup_calls_sync_accounts_fn():
    from planner_lib.admin.config_manager import ConfigManager
    called = {}

    def sync(users, admins):
        called['users'] = users
        called['admins'] = admins

    cm = ConfigManager(config_storage=_Store(), account_storage=_Store())
    data = {'accounts': {'users': {'u@x.com': {}}, 'admins': {'u@x.com': {}}}}
    cm.restore_backup(data, sync_accounts_fn=sync)
    assert 'u@x.com' in called['users']
    assert 'u@x.com' in called['admins']


def test_restore_backup_guards_current_admin():
    from planner_lib.admin.config_manager import ConfigManager
    cm = ConfigManager(config_storage=_Store(), account_storage=_Store())
    data = {'accounts': {'users': {}, 'admins': {}}}
    with pytest.raises(ValueError, match="Cannot remove the current admin"):
        cm.restore_backup(
            data,
            current_admins=['admin@example.com'],
            current_user_email='admin@example.com',
            sync_accounts_fn=lambda u, a: None,
        )


# ---------------------------------------------------------------------------
# AdminService delegation tests
# ---------------------------------------------------------------------------


def test_admin_service_delegates_get_config():
    """AdminService.get_config returns result from its ConfigManager."""
    from planner_lib.admin.service import AdminService
    store = _Store()
    store.save('config', 'k', {'v': 1})
    svc = AdminService(
        account_storage=_Store(),
        config_storage=store,
        project_service=MagicMock(),
        account_manager=MagicMock(),
        azure_client=MagicMock(),
    )
    assert svc.get_config('k') == {'v': 1}


def test_admin_service_delegates_save_config():
    """AdminService.save_config creates a backup via ConfigManager."""
    from planner_lib.admin.service import AdminService
    store = _Store()
    store.save('config', 'cfg', {'old': True})
    svc = AdminService(
        account_storage=_Store(),
        config_storage=store,
        project_service=MagicMock(),
        account_manager=MagicMock(),
        azure_client=MagicMock(),
    )
    svc.save_config('cfg', {'new': True})
    assert store.load('config', 'cfg') == {'new': True}
    backup_keys = [k for k in store.list_keys('config') if 'backup' in k]
    assert len(backup_keys) == 1


def test_admin_service_config_manager_is_instance():
    """AdminService._config_manager must be a ConfigManager."""
    from planner_lib.admin.service import AdminService
    from planner_lib.admin.config_manager import ConfigManager
    svc = AdminService(
        account_storage=_Store(),
        config_storage=_Store(),
        project_service=MagicMock(),
        account_manager=MagicMock(),
        azure_client=MagicMock(),
    )
    assert isinstance(svc._config_manager, ConfigManager)
