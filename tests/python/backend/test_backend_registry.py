"""Tests for the BackendRegistry module.

Verifies:
- task_backend_id selects the backend family; ado_config.transport selects the ADO class
- unavailable or unknown selections fail instead of falling back
- transport settings schemas and backend identity metadata
- build_active_backend() constructs the selected class
"""
import pytest

from planner_lib.backend.registry import (
    available_backend_ids,
    build_active_backend,
    describe_backends,
    get_active_class,
    get_ado_schema,
    get_merged_schema,
)


def _server(backend_id='ado', **flags):
    return {'task_backend_id': backend_id, 'feature_flags': flags}


def _ado(transport='live', **flags):
    return {'organization_url': 'MyOrg', 'transport': transport, 'feature_flags': flags}


# ---------------------------------------------------------------------------
# get_active_class
# ---------------------------------------------------------------------------

@pytest.mark.parametrize('transport, module, name', [
    ('live', 'planner_lib.backend.azure', 'AzureDevOpsBackend'),
    ('mock_generator', 'planner_lib.backend.mock', 'MockGeneratorBackend'),
    ('mock_fixture', 'planner_lib.backend.mock', 'MockFixtureBackend'),
    ('static', 'planner_lib.backend.static', 'StaticBackend'),
])
def test_transport_selects_ado_class(transport, module, name):
    import importlib
    cls = getattr(importlib.import_module(module), name)
    assert get_active_class(_server(), _ado(transport)) is cls
    assert cls.BACKEND_ID == 'ado'
    assert cls.TRANSPORT == transport


def test_retired_selector_flags_do_not_affect_selection():
    from planner_lib.backend.azure import AzureDevOpsBackend
    server = _server(use_static_backend=True)
    assert get_active_class(server, _ado('live', use_azure_mock=True)) is AzureDevOpsBackend


@pytest.mark.parametrize('server, ado', [
    (_server('jira'), _ado()),
    (_server(), _ado('mock')),
    ({'feature_flags': {}}, _ado()),
    (_server(), {'feature_flags': {}}),
])
def test_unknown_selection_is_rejected(server, ado):
    with pytest.raises((ValueError, KeyError)):
        get_active_class(server, ado)


def test_local_backend_is_not_available_yet():
    assert available_backend_ids() == ('ado',)
    with pytest.raises(ValueError, match='not available'):
        get_active_class(_server('local'), _ado())


def test_describe_backends_reports_identity_and_capabilities():
    from planner_lib.backend.port import TASK_CAPABILITIES
    [ado] = describe_backends()
    assert ado['id'] == 'ado'
    assert ado['transports'] == ['live', 'mock_generator', 'mock_fixture', 'static']
    assert set(ado['capabilities']) <= TASK_CAPABILITIES
    assert 'task_create' not in ado['capabilities']


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

def test_merged_schema_contains_transport_settings_only():
    schema = get_merged_schema()
    for key in ('static_data_path', 'azure_mock_data_dir', 'azure_mock_persist_enabled',
                'generator_persist_enabled', 'generator_persist_dir', 'generator_config'):
        assert key in schema
    for key in ('use_static_backend', 'use_azure_mock', 'use_azure_mock_generator',
                'enable_cache', 'enable_azure_cache', 'enable_brotli_middleware'):
        assert key not in schema


def test_transport_settings_name_their_transport():
    schema = get_merged_schema()
    assert schema['static_data_path']['x-transport'] == 'static'
    assert schema['azure_mock_data_dir']['x-transport'] == 'mock_fixture'
    assert schema['generator_config']['x-transport'] == 'mock_generator'


def test_ado_schema_declares_transport_enum():
    schema = get_ado_schema()
    assert schema['properties']['transport']['enum'] == [
        'live', 'mock_generator', 'mock_fixture', 'static']
    assert 'transport' in schema['required']


def test_azure_devops_backend_schema_is_empty():
    from planner_lib.backend.azure import AzureDevOpsBackend
    assert AzureDevOpsBackend.config_schema() == {}


# ---------------------------------------------------------------------------
# build_active_backend
# ---------------------------------------------------------------------------

class _FakeStorage:
    """Minimal stub that satisfies the storage interface used during backend construction."""
    def load(self, ns, key):
        raise KeyError(key)

    def save(self, ns, key, val):
        pass


def test_build_static_backend_uses_ado_settings(tmp_path):
    data_file = tmp_path / 'tasks.yml'
    data_file.write_text('{}')

    from planner_lib.backend.static import StaticBackend
    backend = build_active_backend(
        _server(), _ado('static', static_data_path=str(data_file)),
        org_url='', storage=_FakeStorage(),
    )
    assert isinstance(backend, StaticBackend)
    assert backend._data_path == data_file


def test_build_live_is_azure(monkeypatch):
    import planner_lib.azure.AzureClient as _m

    class _FakeNative:
        def __init__(self, *a, **kw):
            pass

    monkeypatch.setattr(_m, 'AzureClient', _FakeNative)

    from planner_lib.backend.azure import AzureDevOpsBackend
    backend = build_active_backend(_server(), _ado('live'), org_url='MyOrg', storage=_FakeStorage())
    assert isinstance(backend, AzureDevOpsBackend)
