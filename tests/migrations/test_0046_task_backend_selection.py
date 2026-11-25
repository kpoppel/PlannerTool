import pytest

from planner_lib.migrations import revisions
from planner_lib.migrations.contracts import SchemaError
from planner_lib.migrations.coordinator import Database
from planner_lib.storage.memory_backend import MemoryStorage


def _storage(server_flags, ado_flags, *, ado=True):
    storage = MemoryStorage()
    storage.save('config', 'server_config', {
        'schema_version': 2, 'log_level': 'INFO', 'server_name': 'x',
        'feature_flags': {'enable_cache': True, **server_flags},
    })
    if ado:
        storage.save('config', 'ado_config', {
            'organization_url': 'Org',
            'feature_flags': {'azure_mock_data_dir': 'data/azure_mock', **ado_flags},
        })
    return storage


@pytest.mark.parametrize('server_flags, ado_flags, transport', [
    ({}, {}, 'live'),
    ({}, {'use_azure_mock': True}, 'mock_fixture'),
    ({}, {'use_azure_mock_generator': True}, 'mock_generator'),
    ({'use_static_backend': True}, {}, 'static'),
    # Registry priority: static > generator > fixture, across both configs.
    ({'use_azure_mock': True}, {'use_azure_mock_generator': True}, 'mock_generator'),
    ({}, {'use_azure_mock': True, 'use_static_backend': True}, 'static'),
    # ADO flags override server flags with the same key.
    ({'use_azure_mock': True}, {'use_azure_mock': False}, 'live'),
])
def test_upgrade_maps_selector_flags_to_backend_and_transport(server_flags, ado_flags, transport):
    storage = _storage(server_flags, ado_flags)
    revisions.upgrade_46(storage)
    server = storage.load('config', 'server_config')
    ado = storage.load('config', 'ado_config')
    assert server['task_backend_id'] == 'ado'
    assert ado['transport'] == transport
    assert server['feature_flags'] == {'enable_cache': True}
    assert ado['feature_flags'] == {'azure_mock_data_dir': 'data/azure_mock'}
    assert ado['organization_url'] == 'Org'
    revisions.upgrade_46(storage)
    assert storage.load('config', 'ado_config') == ado


def test_upgrade_creates_missing_ado_config_with_live_transport():
    storage = _storage({}, {}, ado=False)
    revisions.upgrade_46(storage)
    assert storage.load('config', 'ado_config') == {
        'organization_url': '', 'feature_flags': {}, 'transport': 'live'}


def _validate_selection(storage):
    revisions._validate_backend_selection(storage.load('config', 'server_config'),
                                          storage.load('config', 'ado_config'))


@pytest.mark.parametrize('mutate', [
    lambda s, a: s.pop('task_backend_id'),
    lambda s, a: s.update(task_backend_id='jira'),
    lambda s, a: a.pop('transport'),
    lambda s, a: a.update(transport='mock'),
    lambda s, a: s['feature_flags'].update(use_azure_mock=True),
    lambda s, a: a['feature_flags'].update(use_static_backend=False),
])
def test_revision_46_validation_rejects_noncanonical_selection(mutate):
    storage = _storage({}, {})
    revisions.upgrade_46(storage)
    _validate_selection(storage)
    server = storage.load('config', 'server_config')
    ado = storage.load('config', 'ado_config')
    mutate(server, ado)
    storage.save('config', 'server_config', server)
    storage.save('config', 'ado_config', ado)
    with pytest.raises(SchemaError):
        _validate_selection(storage)


def test_startup_upgrades_selector_flags_from_revision_45(tmp_path, pre_normalization_storage):
    handle = Database(tmp_path).prepare()
    server = handle.storage.load('config', 'server_config')
    ado = handle.storage.load('config', 'ado_config')
    del server['task_backend_id']
    del ado['transport']
    ado['feature_flags'] = {'use_azure_mock': True}
    raw = pre_normalization_storage(handle, 45)
    raw.save('config', 'server_config', server)
    raw.save('config', 'ado_config', ado)
    handle.close()
    upgraded = Database(tmp_path).prepare()
    try:
        assert upgraded.storage.load('config', 'server_config')['task_backend_id'] == 'ado'
        assert upgraded.storage.load('config', 'ado_config')['transport'] == 'mock_fixture'
        assert upgraded.storage.load('system', 'schema_state')['schema_revision'] >= 46
    finally:
        upgraded.close()


def test_initialize_selects_ado_generator_transport():
    storage = MemoryStorage()
    revisions.initialize(storage)
    assert storage.load('config', 'server_config')['task_backend_id'] == 'ado'
    ado = storage.load('config', 'ado_config')
    assert ado['transport'] == 'mock_generator'
    assert ado['feature_flags'] == {}
