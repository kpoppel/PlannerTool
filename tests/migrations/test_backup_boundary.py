import pytest

from planner_lib.admin.config_manager import ConfigManager
from planner_lib.migrations.contracts import TARGET_REVISION
from planner_lib.migrations.revisions import initialize
from planner_lib.storage.memory_backend import MemoryStorage


@pytest.fixture
def manager():
    storage = MemoryStorage()
    initialize(storage)
    return ConfigManager(storage)


def test_logical_backup_exports_revision_without_recovery_metadata(manager):
    manager._storage.save('external_identities', 'synthetic-link', {'account_id': 'synthetic-uuid'})
    manager._storage.save('auth_grants', 'synthetic-binding', {'grant': 'protected-grant'})
    backup = manager.get_backup()
    assert backup['schema_revision'] == TARGET_REVISION
    assert 'system' not in backup
    assert 'active-generation' not in backup
    assert 'external_identities' not in backup
    assert 'auth_grants' not in backup


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