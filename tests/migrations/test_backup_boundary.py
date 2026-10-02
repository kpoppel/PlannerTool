import pytest

from planner_lib.admin.config_manager import ConfigManager
from planner_lib.migrations.revisions import initialize
from planner_lib.storage.memory_backend import MemoryStorage


@pytest.fixture
def manager():
    storage = MemoryStorage()
    initialize(storage)
    return ConfigManager(storage)


def test_logical_backup_exports_revision_without_recovery_metadata(manager):
    backup = manager.get_backup()
    assert backup['schema_revision'] == 33
    assert 'system' not in backup
    assert 'active-generation' not in backup


@pytest.mark.parametrize('payload', [
    {'schema_revision': 32, 'config': {'server_config': {'feature_flags': {}}}},
    {'schema_revision': 34, 'config': {}},
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
    assert manager._storage.load('system', 'schema_state')['schema_revision'] == 33


def test_unversioned_current_selective_backup_is_admitted(manager):
    manager.restore_backup({'config': {'projects': {
        'schema_version': 3, 'project_map': [], 'container_types': ['project', 'team'],
    }}})
    assert manager._storage.load('system', 'schema_state')['initialized_at_revision'] == 33