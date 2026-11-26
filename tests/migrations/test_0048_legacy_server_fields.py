import pytest

from planner_lib.migrations import revisions
from planner_lib.migrations.contracts import SchemaError
from planner_lib.storage.memory_backend import MemoryStorage

SERVER = {'schema_version': 2, 'task_backend_id': 'ado', 'feature_flags': {}, 'log_level': 'INFO'}


def _storage(server, ado):
    storage = MemoryStorage()
    storage.save('config', 'server_config', server)
    storage.save('config', 'ado_config', ado)
    return storage


def test_upgrade_drops_superseded_legacy_organization_field():
    storage = _storage({**SERVER, 'azure_devops_organization': 'Legacy'},
                       {'organization_url': 'Current', 'feature_flags': {}, 'transport': 'live'})
    revisions.upgrade_48(storage)
    assert storage.load('config', 'server_config') == SERVER
    assert storage.load('config', 'ado_config')['organization_url'] == 'Current'


def test_upgrade_carries_legacy_organization_into_an_empty_ado_setting():
    storage = _storage({**SERVER, 'azure_devops_organization': 'Legacy'},
                       {'organization_url': '', 'feature_flags': {}, 'transport': 'live'})
    revisions.upgrade_48(storage)
    assert storage.load('config', 'server_config') == SERVER
    assert storage.load('config', 'ado_config') == {
        'organization_url': 'Legacy', 'feature_flags': {}, 'transport': 'live'}


def test_upgrade_leaves_current_server_configuration_unchanged():
    ado = {'feature_flags': {}, 'transport': 'mock_generator'}
    storage = _storage(SERVER, ado)
    revisions.upgrade_48(storage)
    assert storage.load('config', 'server_config') == SERVER
    assert storage.load('config', 'ado_config') == ado


def _catalogue(states):
    return {'schema_version': 1, 'processes': [{'id': 'p', 'types': [
        {'reference_name': 'Bug', 'states': states}]}]}


def test_upgrade_drops_hidden_duplicate_catalogue_states():
    storage = _storage(SERVER, {'feature_flags': {}, 'transport': 'live'})
    storage.save('config', 'ado_processes', _catalogue([
        {'name': 'New', 'category': 'Proposed', 'order': 1},
        {'name': 'Closed', 'category': 'Completed', 'order': 2},
        {'name': 'Closed', 'category': 'Completed', 'order': 7},
    ]))
    revisions.upgrade_48(storage)
    assert storage.load('config', 'ado_processes') == _catalogue([
        {'name': 'New', 'category': 'Proposed', 'order': 1},
        {'name': 'Closed', 'category': 'Completed', 'order': 2},
    ])


def test_upgrade_rejects_duplicate_states_with_conflicting_categories():
    storage = _storage(SERVER, {'feature_flags': {}, 'transport': 'live'})
    storage.save('config', 'ado_processes', _catalogue([
        {'name': 'Closed', 'category': 'Completed', 'order': 2},
        {'name': 'Closed', 'category': 'Removed', 'order': 7},
    ]))
    with pytest.raises(SchemaError):
        revisions.upgrade_48(storage)
