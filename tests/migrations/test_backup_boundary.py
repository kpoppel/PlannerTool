import pytest

from planner_lib.admin.config_manager import ConfigManager
from planner_lib.database import SCHEMA_TARGET, PlannerDatabase
from planner_lib.migrations.contracts import TARGET_REVISION
from planner_lib.migrations.revisions import initialize
from planner_lib.storage.memory_backend import MemoryStorage


@pytest.fixture
def manager():
    storage = MemoryStorage()
    initialize(storage)
    database = PlannerDatabase.in_memory()
    yield ConfigManager(storage, planner_database=database)
    database.close()


def _kinds(manager):
    with manager._planner_database.connect() as connection:
        return [row[0] for row in connection.execute('SELECT flag_name FROM server_feature_flags')]


def test_logical_backup_includes_versioned_planner_database_rows(manager):
    with manager._planner_database.write() as connection:
        connection.execute("INSERT INTO server_feature_flags VALUES ('project', 1)")
    backup = manager.get_backup()
    section = backup['planner_database']
    assert section['version'] == 1
    assert section['schema_version'] == SCHEMA_TARGET
    assert section['tables']['server_feature_flags'] == [{'flag_name': 'project', 'enabled': 1}]
    assert 'schema_migrations' not in section['tables']


def test_logical_restore_replaces_planner_database_rows_atomically(manager):
    with manager._planner_database.write() as connection:
        connection.execute("INSERT INTO server_feature_flags VALUES ('restored', 1)")
    backup = manager.get_backup()
    with manager._planner_database.write() as connection:
        connection.execute("UPDATE server_feature_flags SET flag_name = 'current'")
    manager.restore_backup({'schema_revision': TARGET_REVISION,
                            'planner_database': backup['planner_database']})
    assert _kinds(manager) == ['restored']


@pytest.mark.parametrize('section', [
    {'version': 2, 'schema_version': SCHEMA_TARGET, 'tables': {}},
    {'version': 1, 'schema_version': SCHEMA_TARGET + 1, 'tables': {}},
    {'version': 1, 'schema_version': SCHEMA_TARGET, 'tables': {'tasks': []}},
])
def test_invalid_planner_database_section_is_rejected_before_mutation(manager, section):
    with manager._planner_database.write() as connection:
        connection.execute("INSERT INTO server_feature_flags VALUES ('current', 1)")
    original = manager._storage.load('config', 'server_config')
    with pytest.raises(ValueError):
        manager.restore_backup({'schema_revision': TARGET_REVISION,
                                'config': {'server_config': {**original, 'server_name': 'changed'}},
                                'planner_database': section})
    assert manager._storage.load('config', 'server_config') == original
    assert _kinds(manager) == ['current']


def test_logical_backup_exports_revision_without_recovery_metadata(manager):
    manager._storage.save('external_identities', 'synthetic-link', {'account_id': 'synthetic-uuid'})
    manager._storage.save('auth_grants', 'synthetic-binding', {'grant': 'protected-grant'})
    backup = manager.get_backup()
    assert backup['schema_revision'] == TARGET_REVISION
    assert 'system' not in backup
    assert 'active-generation' not in backup
    assert 'external_identities' not in backup
    assert 'auth_grants' not in backup
    assert 'authentication' not in backup['config']


def test_logical_backup_exports_account_contract_and_strips_enrollment_authority(manager):
    account_id = '11111111-1111-4111-8111-111111111111'
    account = {'email': 'alex@example.test', 'account_id': account_id, 'permissions': ['admin']}
    manager._storage.save('accounts', 'alex@example.test', account)
    manager._storage.save('account_auth', account_id, {
        'enrolled': True, 'account_key_hash': 'must-not-export', 'devices': {'secret': 'binding'}})
    backup = manager.get_backup()
    assert backup['accounts']['users']['alex@example.test'] == account
    assert backup['authentication']['account_auth'] == {account_id: {'enrolled': False}}
    assert 'must-not-export' not in str(backup)


@pytest.mark.parametrize('payload', [
    {'schema_revision': TARGET_REVISION, 'external_identities': {'imported': {}}},
    {'schema_revision': 32, 'config': {'server_config': {'feature_flags': {}}}},
    {'schema_revision': TARGET_REVISION + 1, 'config': {}},
    {'config': {'schema_state': {'schema_revision': 34}}},
    {'system': {'schema_state': {'schema_revision': 34}}},
    {'active-generation': {'generation': 'not-a-generation'}},
    {'config': {'plugin_runtime_config': {'schema_version': 1, 'plugins': []}}},
    {'config': {'projects': {'schema_version': 3, 'project_map': []}}},
])
def test_incompatible_backup_rejected_before_mutation(manager, payload):
    original = manager._storage.load('config', 'server_config')
    with pytest.raises(ValueError):
        manager.restore_backup(payload)
    assert manager._storage.load('config', 'server_config') == original
    assert manager._storage.load('system', 'schema_state')['schema_revision'] == TARGET_REVISION


def test_unversioned_current_selective_backup_is_rejected(manager):
    with pytest.raises(ValueError, match='schema revision'):
        manager.restore_backup({'config': {'projects': {
            'schema_version': 4, 'project_map': [], 'container_types': ['project', 'team'],
            'allocation_defaults': {'project': [], 'team': []},
        }}})


def test_current_versioned_selective_backup_is_admitted(manager):
    manager.restore_backup({'schema_revision': TARGET_REVISION, 'config': {'projects': {
        'schema_version': 4, 'project_map': [], 'container_types': ['project', 'team'],
        'allocation_defaults': {'project': [], 'team': []},
    }}})
    assert manager._storage.load('system', 'schema_state')['initialized_at_revision'] == TARGET_REVISION


def test_saved_view_backup_requires_packed_mode_preference(manager):
    with pytest.raises(ValueError, match='packed-mode preference'):
        manager.restore_backup({'schema_revision': TARGET_REVISION, 'views': {
            '11111111-1111-4111-8111-111111111111_view': {'viewOptions': {}},
        }})