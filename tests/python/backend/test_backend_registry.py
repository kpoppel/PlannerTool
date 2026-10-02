"""Tests for the BackendRegistry module.

Verifies:
- Every backend is registered and resolvable via feature flags
- Priority order is correct (static > generator > fixture > azure default)
- get_merged_schema() includes all backend-specific feature flag keys
- build_active_backend() constructs the correct backend type
- Each backend's config_schema() has the correct shape
"""
import pytest

from planner_lib.backend.registry import (
    get_active_class,
    get_merged_schema,
    build_active_backend,
)


# ---------------------------------------------------------------------------
# get_active_class
# ---------------------------------------------------------------------------

def test_default_is_azure_devops():
    from planner_lib.backend.azure import AzureDevOpsBackend
    assert get_active_class({}) is AzureDevOpsBackend


def test_all_flags_false_gives_azure_default():
    from planner_lib.backend.azure import AzureDevOpsBackend
    flags = {
        'use_static_backend': False,
        'use_azure_mock_generator': False,
        'use_azure_mock': False,
    }
    assert get_active_class(flags) is AzureDevOpsBackend


def test_use_static_backend_selects_static():
    from planner_lib.backend.static import StaticBackend
    assert get_active_class({'use_static_backend': True}) is StaticBackend


def test_use_azure_mock_generator_selects_generator():
    from planner_lib.backend.mock import MockGeneratorBackend
    assert get_active_class({'use_azure_mock_generator': True}) is MockGeneratorBackend


def test_use_azure_mock_selects_fixture():
    from planner_lib.backend.mock import MockFixtureBackend
    assert get_active_class({'use_azure_mock': True}) is MockFixtureBackend


def test_static_takes_priority_over_generator():
    """use_static_backend beats use_azure_mock_generator."""
    from planner_lib.backend.static import StaticBackend
    flags = {'use_static_backend': True, 'use_azure_mock_generator': True}
    assert get_active_class(flags) is StaticBackend


def test_generator_takes_priority_over_fixture():
    """use_azure_mock_generator beats use_azure_mock."""
    from planner_lib.backend.mock import MockGeneratorBackend
    flags = {'use_azure_mock_generator': True, 'use_azure_mock': True}
    assert get_active_class(flags) is MockGeneratorBackend


# ---------------------------------------------------------------------------
# get_merged_schema
# ---------------------------------------------------------------------------

def test_merged_schema_contains_static_backend_flags():
    schema = get_merged_schema()
    assert 'use_static_backend' in schema, "use_static_backend missing from merged schema"
    assert 'static_data_path' in schema, "static_data_path missing from merged schema"


def test_merged_schema_contains_fixture_mock_flags():
    schema = get_merged_schema()
    assert 'use_azure_mock' in schema
    assert 'azure_mock_data_dir' in schema
    assert 'azure_mock_persist_enabled' in schema


def test_merged_schema_contains_generator_flags():
    schema = get_merged_schema()
    assert 'use_azure_mock_generator' in schema
    assert 'generator_persist_enabled' in schema
    assert 'generator_persist_dir' in schema
    assert 'generator_config' in schema


def test_merged_schema_excludes_non_backend_flags():
    """enable_cache and friends are not backend-specific; should not appear in backend schemas."""
    schema = get_merged_schema()
    assert 'enable_cache' not in schema
    assert 'enable_azure_cache' not in schema  # old name must not re-appear in schemas
    assert 'enable_memory_cache' not in schema
    assert 'enable_brotli_middleware' not in schema


# ---------------------------------------------------------------------------
# Per-class config_schema() shape
# ---------------------------------------------------------------------------

def test_static_backend_schema_shape():
    from planner_lib.backend.static import StaticBackend
    s = StaticBackend.config_schema()
    assert s['use_static_backend']['type'] == 'boolean'
    assert s['static_data_path']['type'] == 'string'
    assert s['static_data_path'].get('x-showWhen') == 'use_static_backend'


def test_fixture_mock_schema_shape():
    from planner_lib.backend.mock import MockFixtureBackend
    s = MockFixtureBackend.config_schema()
    assert s['use_azure_mock']['type'] == 'boolean'
    assert s['azure_mock_data_dir'].get('x-showWhen') == 'use_azure_mock'
    assert s['azure_mock_persist_enabled'].get('x-showWhen') == 'use_azure_mock'


def test_generator_mock_schema_shape():
    from planner_lib.backend.mock import MockGeneratorBackend
    s = MockGeneratorBackend.config_schema()
    assert s['use_azure_mock_generator']['type'] == 'boolean'
    assert s['generator_persist_dir'].get('x-showWhen') == 'generator_persist_enabled'
    assert s['generator_config']['type'] == 'object'
    assert s['generator_config'].get('x-showWhen') == 'use_azure_mock_generator'


def test_azure_devops_backend_schema_is_empty():
    """AzureDevOpsBackend is the default; it has no dedicated feature flag."""
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


def test_build_static_backend(tmp_path):
    data_file = tmp_path / 'tasks.yml'
    data_file.write_text('{}')

    from planner_lib.backend.static import StaticBackend
    backend = build_active_backend(
        {'use_static_backend': True, 'static_data_path': str(data_file)},
        org_url='',
        storage=_FakeStorage(),
    )
    assert isinstance(backend, StaticBackend)


def test_build_default_is_azure(monkeypatch):
    """build_active_backend with empty flags constructs AzureDevOpsBackend.

    We patch AzureClient to avoid real network setup.
    """
    import planner_lib.azure.AzureClient as _m

    class _FakeNative:
        def __init__(self, *a, **kw):
            pass

    monkeypatch.setattr(_m, 'AzureClient', _FakeNative)

    from planner_lib.backend.azure import AzureDevOpsBackend
    backend = build_active_backend(
        {},
        org_url='MyOrg',
        storage=_FakeStorage(),
    )
    assert isinstance(backend, AzureDevOpsBackend)
