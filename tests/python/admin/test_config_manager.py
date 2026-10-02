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
from planner_lib.middleware.session import SessionManager
from planner_lib.migrations.contracts import TARGET_REVISION, schema_state
from planner_lib.migrations.revisions import initialize

ACCOUNT_ID = '11111111-1111-4111-8111-111111111111'


# ---------------------------------------------------------------------------
# Storage stub
# ---------------------------------------------------------------------------


class _Store:
    """In-memory storage stub that implements the StorageBackend interface."""

    def __init__(self):
        self._data = {'system': {'schema_state': schema_state(TARGET_REVISION, initialized=True)}}

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

    def delete(self, ns, key):
        del self._data[ns][key]


# ---------------------------------------------------------------------------
# ConfigManager unit tests
# ---------------------------------------------------------------------------


def test_get_config_returns_value():
    from planner_lib.admin.config_manager import ConfigManager
    store = _Store()
    store.save('config', 'server_config', {'org': 'test-org'})
    cm = ConfigManager(storage=store)
    assert cm.get_config('server_config') == {'org': 'test-org'}


def test_get_config_returns_default_when_missing():
    from planner_lib.admin.config_manager import ConfigManager
    cm = ConfigManager(storage=_Store())
    assert cm.get_config('nonexistent') is None
    assert cm.get_config('nonexistent', default={'x': 1}) == {'x': 1}


def test_get_config_decodes_bytes():
    from planner_lib.admin.config_manager import ConfigManager
    store = _Store()
    store.save('config', 'raw_key', b'hello bytes')
    cm = ConfigManager(storage=store)
    assert cm.get_config('raw_key') == 'hello bytes'


def test_save_config_creates_backup_then_saves():
    from planner_lib.admin.config_manager import ConfigManager
    store = _Store()
    store.save('config', 'server_config', {'version': 1, 'feature_flags': {'manage_backup_snapshots': True}})
    cm = ConfigManager(storage=store)
    cm.save_config('server_config', {'version': 2})

    # New value persisted (feature_flags preserved from prior server_config)
    saved = store.load('config', 'server_config')
    assert saved['version'] == 2
    assert saved.get('feature_flags', {}).get('manage_backup_snapshots') is True
    # Backup key created — find it
    backup_keys = [k for k in store.list_keys('config') if 'backup' in k]
    assert len(backup_keys) == 1
    assert 'server_config' in backup_keys[0]
    assert store.load('config', backup_keys[0]) == {'version': 1, 'feature_flags': {'manage_backup_snapshots': True}}


def test_save_config_no_backup_when_key_absent():
    from planner_lib.admin.config_manager import ConfigManager
    store = _Store()
    cm = ConfigManager(storage=store)
    cm.save_config('new_key', {'x': 1})
    keys = store.list_keys('config')
    assert keys == ['new_key']  # no backup key created


def test_save_config_no_backup_when_feature_flag_false():
    """When manage_backup_snapshots is False, save_config must not create ghost backups."""
    from planner_lib.admin.config_manager import ConfigManager
    store = _Store()
    store.save('config', 'server_config', {'feature_flags': {'manage_backup_snapshots': False}})
    store.save('config', 'projects', {'old': True})
    cm = ConfigManager(storage=store)
    cm.save_config('projects', {'new': True})
    assert store.load('config', 'projects') == {'new': True}
    backup_keys = [k for k in store.list_keys('config') if 'backup' in k]
    assert len(backup_keys) == 0


def test_save_config_raw_no_backup():
    from planner_lib.admin.config_manager import ConfigManager
    store = _Store()
    store.save('config', 'computed', {'a': 1})
    cm = ConfigManager(storage=store)
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
    store.save('config', 'global_settings', {
        'task_type_hierarchy': [],
        'state_display_sequence': [],
    })
    store.save('config', 'plugin_runtime_config', {
        'schema_version': 1,
        'plugins': [{'id': 'portfolio', 'enabled': True, 'activated': True, 'order': 0, 'custom_config': {}}],
    })
    cm = ConfigManager(storage=store)
    bk = cm.get_backup()
    assert bk['config']['projects'] == [{'id': 'p1'}]
    assert bk['config']['teams'] == [{'id': 't1'}]
    assert bk['config']['global_settings'] == {
        'task_type_hierarchy': [],
        'state_display_sequence': [],
    }
    assert bk['config']['plugin_runtime_config'] == {
        'schema_version': 1,
        'plugins': [{'id': 'portfolio', 'enabled': True, 'activated': True, 'order': 0, 'custom_config': {}}],
    }
    # Missing keys are stored as None
    assert bk['config']['people'] is None


def test_get_backup_covers_all_live_config_keys():
    """Every key in CONFIG_KEYS must appear in the backup output (regression guard)."""
    from planner_lib.admin.config_manager import ConfigManager
    expected = {
        "projects", "teams", "people", "cost_config",
        "area_plan_map", "iterations", "global_settings", "ado_config", "plugin_runtime_config", "server_config",
    }
    assert set(ConfigManager.CONFIG_KEYS) == expected, (
        f"CONFIG_KEYS mismatch — backup would silently omit: "
        f"{expected - set(ConfigManager.CONFIG_KEYS)}"
    )


def test_restore_backup_writes_global_settings():
    """Restore must write global_settings back to diskcache."""
    from planner_lib.admin.config_manager import ConfigManager
    store = _Store()
    cm = ConfigManager(storage=store)
    data = {
        'config': {
            'global_settings': {
                'task_type_hierarchy': [{'level': 0}],
                'state_display_sequence': [{'level': 1}],
            }
        }
    }
    result = cm.restore_backup(data)
    assert result['ok'] is True
    assert store.load('config', 'global_settings') == {
        'task_type_hierarchy': [{'level': 0}],
        'state_display_sequence': [{'level': 1}],
    }


def test_get_backup_includes_accounts():
    from planner_lib.admin.config_manager import ConfigManager
    acct = _Store()
    # Admin account: has 'admin' in permissions (no separate accounts_admin namespace)
    acct.save('accounts', 'a@b.com', {'account_id': ACCOUNT_ID, 'email': 'a@b.com', 'permissions': ['admin']})
    cm = ConfigManager(storage=acct)
    bk = cm.get_backup()
    assert 'a@b.com' in bk['accounts']['users']
    # Permissions should be preserved in the backup record
    assert 'admin' in (bk['accounts']['users']['a@b.com'].get('permissions') or [])
    # No separate 'admins' key in new backup format
    assert 'admins' not in bk['accounts']


def test_restore_backup_writes_config():
    from planner_lib.admin.config_manager import ConfigManager
    store = _Store()
    cm = ConfigManager(storage=store)
    data = {'config': {'server_config': {'org': 'restored-org'}}}
    result = cm.restore_backup(data)
    assert result['ok'] is True
    assert store.load('config', 'server_config') == {'org': 'restored-org'}


def test_restore_backup_calls_sync_accounts_fn():
    from planner_lib.admin.config_manager import ConfigManager
    called = {}
    account_id = '11111111-1111-4111-8111-111111111111'

    def sync(users, admins):
        called['users'] = users
        called['admins'] = admins

    cm = ConfigManager(storage=_Store())
    # New backup format: admin status in permissions field, no separate 'admins' dict
    data = {'accounts': {'users': {'u@x.com': {
        'account_id': account_id,
        'email': 'u@x.com',
        'permissions': ['admin'],
    }}}}
    data['authentication'] = {'account_auth': {account_id: {'enrolled': False}}, 'auth_control': {}}
    cm.restore_backup(data, sync_accounts_fn=sync)
    assert 'u@x.com' in called['users']
    assert called['users']['u@x.com']['account_id'] == account_id
    # sync is called with the admin email list derived from permissions
    assert 'u@x.com' in called['admins']

def test_restore_backup_guards_current_admin():
    from planner_lib.admin.config_manager import ConfigManager
    cm = ConfigManager(storage=_Store())
    data = {'accounts': {'users': {}, 'admins': {}}}
    data['authentication'] = {'account_auth': {}, 'auth_control': {}}
    with pytest.raises(ValueError, match="Cannot remove the current admin"):
        cm.restore_backup(
            data,
            current_admins=['admin@example.com'],
            current_user_email='admin@example.com',
            sync_accounts_fn=lambda u, a: None,
        )


@pytest.mark.parametrize('destination_enrolled', [False, True])
def test_backup_restore_preserves_auth_and_clears_temporary_credentials(tmp_path, monkeypatch, destination_enrolled):
    import json
    from planner_lib.accounts.config import AccountManager, AccountCredentialsPayload
    from planner_lib.admin.config_manager import ConfigManager
    from planner_lib.session.auth import AuthManager
    from planner_lib.storage.diskcache_backend import DiskCacheStorage

    source = DiskCacheStorage(tmp_path / 'source')
    target = DiskCacheStorage(tmp_path / 'target')
    initialize(source)
    initialize(target)
    try:
        source_accounts = AccountManager(source)
        source_auth = AuthManager(source, source_accounts, SessionManager(source_accounts, source))
        device, recovery, _ = source_auth.enroll('admin@example.com', 'Administrator')
        source_accounts.update_credentials(AccountCredentialsPayload(email='admin@example.com', pat='azure-pat'))
        backup = json.loads(json.dumps(ConfigManager(source).get_backup()))

        assert set(backup['authentication']) == {'account_auth', 'auth_control'}
        assert 'auth_sessions' not in backup['authentication']
        assert 'auth_pairing' not in backup['authentication']
        target_accounts = AccountManager(target)
        target_sessions = SessionManager(target_accounts, target)
        target_auth = AuthManager(target, target_accounts, target_sessions)
        if destination_enrolled:
            old_device, _, old_session = target_auth.enroll('admin@example.com', 'Old Identity')
            obsolete_id = target_accounts.get_account_id('admin@example.com')
            target.save('views', obsolete_id + '_old', {'private': True})
            target.save('views', 'view_register', {
                obsolete_id + '_old': {'user': obsolete_id, 'id': 'old'},
            })
        monkeypatch.setenv('PLANNER_SECRET_KEY', 'different-restore-key')
        ConfigManager(target).restore_backup(
            backup, current_admins=['admin@example.com'], current_user_email='admin@example.com',
            sync_accounts_fn=target_accounts.sync_accounts_full,
        )

        if destination_enrolled:
            assert not target.exists('account_auth', obsolete_id)
            assert not target.exists('views', obsolete_id + '_old')
            assert obsolete_id + '_old' not in target.load('views', 'view_register')
            assert not target_sessions.is_valid(old_session)
            with pytest.raises(PermissionError):
                target_auth.authenticate_device(old_device)
        assert list(target.list_keys('auth_sessions')) == []
        assert list(target.list_keys('auth_pairing')) == []
        assert target.load('auth_control', 'bootstrap_claimed') is True
        account_id = target_accounts.get_account_id('admin@example.com')
        assert target.load('account_auth', account_id) == backup['authentication']['account_auth'][account_id]
        assert backup['accounts']['users']['admin@example.com']['pat'] == 'azure-pat'
        assert target_accounts.load('admin@example.com')['pat'] == 'azure-pat'
        assert target_auth.authenticate_device(device)[0] == 'admin@example.com'
        assert target_auth.enroll('admin@example.com', account_key=recovery)[1]
        with pytest.raises(PermissionError):
            target_auth.enroll('admin@example.com', 'Impersonator')
    finally:
        source.close()
        target.close()


def test_account_restore_reinstates_older_key_and_admin_reset_recovers_access(tmp_path, monkeypatch):
    from planner_lib.accounts.config import AccountManager
    from planner_lib.admin.config_manager import ConfigManager
    from planner_lib.session.auth import AuthManager
    from planner_lib.storage.diskcache_backend import DiskCacheStorage

    storage = DiskCacheStorage(tmp_path)
    initialize(storage)
    try:
        accounts = AccountManager(storage)
        auth = AuthManager(storage, accounts, SessionManager(accounts, storage))
        auth.enroll('admin@example.com', 'Admin')
        snapshot_device, snapshot_key, _ = auth.enroll('owner@example.com', 'Owner')
        manager = ConfigManager(storage)
        backup = manager.get_backup()
        newer_device, newer_key, _ = auth.enroll('owner@example.com', account_key=snapshot_key)
        result = manager.restore_backup(
            backup, current_admins=['admin@example.com'], current_user_email='admin@example.com',
            sync_accounts_fn=accounts.sync_accounts_full,
        )
        assert 'older' in result['warning']
        assert 'Reset access' in result['warning']
        assert auth.authenticate_device(snapshot_device)[0] == 'owner@example.com'
        with pytest.raises(PermissionError):
            auth.authenticate_device(newer_device)
        with pytest.raises(PermissionError):
            auth.enroll('owner@example.com', account_key=newer_key)
        with pytest.raises(PermissionError):
            auth.delete_account('owner@example.com', newer_key)
        reset_key = auth.reset('owner@example.com')
        with pytest.raises(PermissionError):
            auth.enroll('owner@example.com', account_key=snapshot_key)
        assert auth.enroll('owner@example.com', account_key=reset_key)[1] != reset_key
    finally:
        storage.close()


def test_account_restore_without_authentication_is_rejected_before_writes():
    from planner_lib.admin.config_manager import ConfigManager
    store = _Store()
    store.save('config', 'server_config', {'version': 'current'})
    with pytest.raises(ValueError, match='authentication'):
        ConfigManager(store).restore_backup({
            'config': {'server_config': {'version': 'old'}},
            'accounts': {'users': {}},
        }, sync_accounts_fn=lambda users, admins: None)
    assert store.load('config', 'server_config') == {'version': 'current'}


@pytest.mark.parametrize('namespace, register_key', [
    ('views', 'view_register'), ('scenarios', 'scenario_register'),
])
def test_restore_rejects_email_owned_data_before_writes(namespace, register_key):
    from planner_lib.admin.config_manager import ConfigManager
    store = _Store()
    store.save('config', 'server_config', {'version': 'current'})
    backup = {
        'config': {'server_config': {'version': 'restored'}},
        namespace: {
            'owner@example.com_item': {'name': 'Private data'},
            register_key: {'owner@example.com_item': {'id': 'item', 'user': 'owner@example.com'}},
        },
    }
    with pytest.raises(ValueError, match='account ID'):
        ConfigManager(store).restore_backup(backup)
    assert store.load('config', 'server_config') == {'version': 'current'}


@pytest.mark.parametrize('invalid_part', ['account_ids', 'bootstrap', 'key', 'legacy_key', 'expiry', 'accounts'])
def test_invalid_authentication_backup_is_rejected_before_writes(invalid_part):
    from planner_lib.admin.config_manager import ConfigManager
    record = {
        'enrolled': True, 'name': 'Administrator', 'account_key_hash': 'a' * 64,
        'devices': {'b' * 32: {'hash': 'c' * 64, 'expires': 2000000000}},
    }
    backup = {
        'config': {'server_config': {'version': 'restored'}},
        'accounts': {'users': {'admin@example.com': {'account_id': ACCOUNT_ID, 'email': 'admin@example.com'}}},
        'authentication': {'account_auth': {ACCOUNT_ID: record}, 'auth_control': {'bootstrap_claimed': True}},
    }
    if invalid_part == 'account_ids':
        backup['authentication']['account_auth'] = {}
    elif invalid_part == 'bootstrap':
        backup['authentication']['auth_control']['bootstrap_claimed'] = 1
    elif invalid_part == 'key':
        record['account_key_hash'] = 'plaintext-account-key'
    elif invalid_part == 'legacy_key':
        record['recovery_hash'] = record['account_key_hash']
    elif invalid_part == 'expiry':
        record['devices']['b' * 32]['expires'] = float('nan')
    elif invalid_part == 'accounts':
        backup['accounts']['users']['admin@example.com'] = None
    store = _Store()
    store.save('config', 'server_config', {'version': 'current'})
    with pytest.raises(ValueError):
        ConfigManager(store).restore_backup(backup, sync_accounts_fn=lambda users, admins: None)
    assert store.load('config', 'server_config') == {'version': 'current'}


def test_auth_restore_rolls_back_failed_account_sync(tmp_path):
    from planner_lib.admin.config_manager import ConfigManager
    from planner_lib.storage.diskcache_backend import DiskCacheStorage
    store = DiskCacheStorage(tmp_path)
    initialize(store)
    try:
        store.save('config', 'server_config', {'version': 'current'})
        store.save('auth_control', 'bootstrap_claimed', True)
        store.save('auth_sessions', 'active-session', {'email': 'admin@example.com'})
        backup = ConfigManager(store).get_backup()
        backup['config']['server_config'] = {'version': 'restored'}

        def failing_sync(users, admins):
            store.save('accounts', 'partial@example.com', {'account_id': ACCOUNT_ID})
            raise ValueError('Account sync failed')

        with pytest.raises(ValueError, match='Account sync failed'):
            ConfigManager(store).restore_backup(backup, sync_accounts_fn=failing_sync)
        assert store.load('config', 'server_config') == {'version': 'current'}
        assert not store.exists('accounts', 'partial@example.com')
        assert store.exists('auth_sessions', 'active-session')
        assert store.load('auth_control', 'bootstrap_claimed') is True
    finally:
        store.close()


def test_selective_restore_without_accounts_preserves_current_credentials(tmp_path, monkeypatch):
    from planner_lib.accounts.config import AccountManager, AccountCredentialsPayload
    from planner_lib.admin.config_manager import ConfigManager
    from planner_lib.session.auth import AuthManager
    from planner_lib.storage.diskcache_backend import DiskCacheStorage
    storage = DiskCacheStorage(tmp_path)
    try:
        accounts = AccountManager(storage)
        sessions = SessionManager(accounts, storage)
        auth = AuthManager(storage, accounts, sessions)
        device, key, session = auth.enroll('owner@example.com', 'Owner')
        accounts.update_credentials(AccountCredentialsPayload(email='owner@example.com', pat='azure-pat'))
        account_id = accounts.get_account_id('owner@example.com')
        original = storage.load('account_auth', account_id)
        ConfigManager(storage).restore_backup({'config': {'server_config': {'version': 'restored'}}})
        assert storage.load('account_auth', account_id) == original
        assert accounts.load('owner@example.com')['pat'] == 'azure-pat'
        assert not sessions.is_valid(session)
        assert auth.authenticate_device(device)[0] == 'owner@example.com'
        assert auth.enroll('owner@example.com', account_key=key)[1] != key
    finally:
        storage.close()


# ---------------------------------------------------------------------------
# PAT plaintext backup / re-encryption on restore
# ---------------------------------------------------------------------------


def test_get_backup_decrypts_pats_to_plaintext(monkeypatch):
    """get_backup must store PATs as plaintext in the JSON, not the Fernet ciphertext."""
    monkeypatch.setenv('PLANNER_SECRET_KEY', 'testsecretkey_32_chars_000000000')
    from planner_lib.accounts.config import AccountManager, AccountCredentialsPayload
    from planner_lib.admin.config_manager import ConfigManager

    acct = _Store()
    # Save a user with a properly encrypted PAT via AccountManager
    mgr = AccountManager(storage=acct)
    mgr.update_credentials(
        AccountCredentialsPayload(email='user@example.com', pat='my-azure-pat-abc123')
    )

    cm = ConfigManager(storage=acct)
    bk = cm.get_backup()

    assert '_meta' not in bk, 'Backup should not include redundant metadata for PAT format'
    user_record = bk['accounts']['users'].get('user@example.com', {})
    assert user_record.get('pat') == 'my-azure-pat-abc123', \
        "PAT in backup must be plaintext, not the Fernet ciphertext"


def test_restore_backup_reencrypts_plaintext_pats(monkeypatch):
    """restore_backup must encrypt plaintext PATs from backup payloads."""
    monkeypatch.setenv('PLANNER_SECRET_KEY', 'testsecretkey_32_chars_000000000')
    from planner_lib.accounts.config import _try_decrypt_pat
    from planner_lib.admin.config_manager import ConfigManager

    synced: dict = {}

    def sync(users, admins):
        synced['users'] = users
        synced['admins'] = admins

    cm = ConfigManager(storage=_Store())
    data = {
        '_meta': {'pat_format': 'plaintext'},
        'accounts': {
            'users': {'user@example.com': {'account_id': ACCOUNT_ID, 'email': 'user@example.com', 'pat': 'plaintext-pat'}},
            'admins': {},
        },
        'authentication': {'account_auth': {ACCOUNT_ID: {'enrolled': False}}, 'auth_control': {}},
    }
    cm.restore_backup(data, sync_accounts_fn=sync)

    stored_pat = synced['users']['user@example.com']['pat']
    assert stored_pat != 'plaintext-pat', "PAT must be encrypted in storage, not stored as plaintext"
    # Must be decryptable back to the original
    assert _try_decrypt_pat(stored_pat) == 'plaintext-pat'


def test_restore_backup_encrypts_plaintext_pats_without_metadata(monkeypatch):
    """Restore must encrypt plaintext PATs even when backup metadata is missing."""
    monkeypatch.setenv('PLANNER_SECRET_KEY', 'testsecretkey_32_chars_000000000')
    from planner_lib.admin.config_manager import ConfigManager
    from planner_lib.accounts.config import _try_decrypt_pat

    synced: dict = {}

    def sync(users, admins):
        synced['users'] = users

    # Backup payload omits _meta but still carries plaintext PAT.
    cm = ConfigManager(storage=_Store())
    data = {
        'accounts': {
            'users': {'user@example.com': {'account_id': ACCOUNT_ID, 'email': 'user@example.com', 'pat': 'plaintext-pat'}},
            'admins': {},
        },
        'authentication': {'account_auth': {ACCOUNT_ID: {'enrolled': False}}, 'auth_control': {}},
    }
    cm.restore_backup(data, sync_accounts_fn=sync)
    stored_pat = synced['users']['user@example.com']['pat']
    assert stored_pat != 'plaintext-pat'
    assert _try_decrypt_pat(stored_pat) == 'plaintext-pat'


def test_get_backup_corrupt_pat_becomes_none(monkeypatch):
    """If a stored PAT can't be decrypted (e.g. key rotation), backup includes pat=None."""
    monkeypatch.setenv('PLANNER_SECRET_KEY', 'testsecretkey_32_chars_000000000')
    from planner_lib.admin.config_manager import ConfigManager

    acct = _Store()
    # Inject a corrupt ciphertext directly into storage
    acct.save('accounts', 'bad@example.com', {'account_id': ACCOUNT_ID, 'email': 'bad@example.com', 'pat': 'not-a-fernet-token'})

    cm = ConfigManager(storage=acct)
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
        storage=store,
        project_repository=MagicMock(),
        account_manager=MagicMock(),
        azure_client=MagicMock(),
    )
    assert svc.get_config('k') == {'v': 1}


def test_admin_service_delegates_save_config():
    """AdminService.save_config creates a backup via ConfigManager."""
    from planner_lib.admin.service import AdminService
    store = _Store()
    # server_config with feature flag enabled so backups are created
    store.save('config', 'server_config', {'feature_flags': {'manage_backup_snapshots': True}})
    store.save('config', 'cfg', {'old': True})
    svc = AdminService(
        storage=store,
        project_repository=MagicMock(),
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
        storage=_Store(),
        project_repository=MagicMock(),
        account_manager=MagicMock(),
        azure_client=MagicMock(),
    )
    assert isinstance(svc._config_manager, ConfigManager)
