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
    # Admin account: has 'admin' in permissions (no separate accounts_admin namespace)
    acct.save('accounts', 'a@b.com', {'email': 'a@b.com', 'permissions': ['admin']})
    cm = ConfigManager(config_storage=_Store(), account_storage=acct)
    bk = cm.get_backup()
    assert 'a@b.com' in bk['accounts']['users']
    # Permissions should be preserved in the backup record
    assert 'admin' in (bk['accounts']['users']['a@b.com'].get('permissions') or [])
    # No separate 'admins' key in new backup format
    assert 'admins' not in bk['accounts']


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
    # New backup format: admin status in permissions field, no separate 'admins' dict
    data = {'accounts': {'users': {'u@x.com': {'email': 'u@x.com', 'permissions': ['admin']}}}}
    cm.restore_backup(data, sync_accounts_fn=sync)
    assert 'u@x.com' in called['users']
    # sync is called with the admin email list derived from permissions
    assert 'u@x.com' in called['admins']


def test_restore_backup_calls_sync_accounts_fn_legacy_format():
    """Legacy backup with separate 'admins' dict is still handled correctly."""
    from planner_lib.admin.config_manager import ConfigManager
    called = {}

    def sync(users, admins):
        called['users'] = users
        called['admins'] = admins

    cm = ConfigManager(config_storage=_Store(), account_storage=_Store())
    # Old backup format: had a separate 'admins' key
    data = {'accounts': {'users': {'u@x.com': {'email': 'u@x.com'}}, 'admins': {'u@x.com': {}}}}
    cm.restore_backup(data, sync_accounts_fn=sync)
    assert 'u@x.com' in called['users']
    # Legacy admin entry should be promoted to permissions and included in admins list
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
# PAT plaintext backup / re-encryption on restore
# ---------------------------------------------------------------------------


def test_get_backup_decrypts_pats_to_plaintext(monkeypatch):
    """get_backup must store PATs as plaintext in the JSON, not the Fernet ciphertext."""
    monkeypatch.setenv('PLANNER_SECRET_KEY', 'testsecretkey_32_chars_000000000')
    from planner_lib.accounts.config import AccountManager, AccountPayload
    from planner_lib.admin.config_manager import ConfigManager

    acct = _Store()
    # Save a user with a properly encrypted PAT via AccountManager
    mgr = AccountManager(account_storage=acct)
    mgr.save(AccountPayload(email='user@example.com', pat='my-azure-pat-abc123'))

    cm = ConfigManager(config_storage=_Store(), account_storage=acct)
    bk = cm.get_backup()

    assert bk.get('_meta', {}).get('pat_format') == 'plaintext', \
        "Backup must declare pat_format=plaintext in _meta"
    user_record = bk['accounts']['users'].get('user@example.com', {})
    assert user_record.get('pat') == 'my-azure-pat-abc123', \
        "PAT in backup must be plaintext, not the Fernet ciphertext"


def test_restore_backup_reencrypts_plaintext_pats(monkeypatch):
    """restore_backup must encrypt plaintext PATs from a plaintext-format backup."""
    monkeypatch.setenv('PLANNER_SECRET_KEY', 'testsecretkey_32_chars_000000000')
    from planner_lib.accounts.config import _try_decrypt_pat
    from planner_lib.admin.config_manager import ConfigManager

    synced: dict = {}

    def sync(users, admins):
        synced['users'] = users
        synced['admins'] = admins

    cm = ConfigManager(config_storage=_Store(), account_storage=_Store())
    data = {
        '_meta': {'pat_format': 'plaintext'},
        'accounts': {
            'users': {'user@example.com': {'email': 'user@example.com', 'pat': 'plaintext-pat'}},
            'admins': {},
        },
    }
    cm.restore_backup(data, sync_accounts_fn=sync)

    stored_pat = synced['users']['user@example.com']['pat']
    assert stored_pat != 'plaintext-pat', "PAT must be encrypted in storage, not stored as plaintext"
    # Must be decryptable back to the original
    assert _try_decrypt_pat(stored_pat) == 'plaintext-pat'


def test_restore_backup_old_format_passed_through(monkeypatch):
    """Old encrypted backups (no _meta) must be stored as-is for backward compatibility."""
    monkeypatch.setenv('PLANNER_SECRET_KEY', 'testsecretkey_32_chars_000000000')
    from planner_lib.admin.config_manager import ConfigManager

    synced: dict = {}

    def sync(users, admins):
        synced['users'] = users

    # Old-style backup: no _meta field, PAT value is an opaque string (e.g. encrypted blob)
    fake_encrypted = 'some-old-encrypted-blob-value'
    cm = ConfigManager(config_storage=_Store(), account_storage=_Store())
    data = {
        'accounts': {
            'users': {'user@example.com': {'email': 'user@example.com', 'pat': fake_encrypted}},
            'admins': {},
        },
    }
    cm.restore_backup(data, sync_accounts_fn=sync)
    # Must be passed through unchanged
    assert synced['users']['user@example.com']['pat'] == fake_encrypted


def test_get_backup_corrupt_pat_becomes_none(monkeypatch):
    """If a stored PAT can't be decrypted (e.g. key rotation), backup includes pat=None."""
    monkeypatch.setenv('PLANNER_SECRET_KEY', 'testsecretkey_32_chars_000000000')
    from planner_lib.admin.config_manager import ConfigManager

    acct = _Store()
    # Inject a corrupt ciphertext directly into storage
    acct.save('accounts', 'bad@example.com', {'email': 'bad@example.com', 'pat': 'not-a-fernet-token'})

    cm = ConfigManager(config_storage=_Store(), account_storage=acct)
    bk = cm.get_backup()

    user_record = bk['accounts']['users'].get('bad@example.com', {})
    # Corrupt PAT should degrade to None, not crash backup
    assert user_record.get('pat') is None


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
