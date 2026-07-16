"""Tests for AdoConfigBackend: fetch_ado_config and save_ado_config on ConfigBackend."""
import pytest
from planner_lib.backend.config import ConfigBackend
from planner_lib.storage.base import StorageBackend


class _MemStore(StorageBackend):
    def __init__(self):
        self._data = {}

    def save(self, namespace, key, value, ttl_seconds=None):
        self._data.setdefault(namespace, {})[key] = value

    def load(self, namespace, key):
        try:
            return self._data[namespace][key]
        except KeyError:
            raise KeyError(key)

    def delete(self, namespace, key):
        del self._data[namespace][key]

    def list_keys(self, namespace):
        return list(self._data.get(namespace, {}).keys())

    def exists(self, namespace, key):
        return key in self._data.get(namespace, {})

    def configure(self, **options):
        return None


def test_fetch_ado_config_missing_returns_empty():
    """fetch_ado_config returns {} when no ado_config has been saved."""
    cb = ConfigBackend(storage=_MemStore())
    assert cb.fetch_ado_config() == {}


def test_fetch_ado_config_returns_stored():
    """fetch_ado_config returns the stored ado_config dict."""
    storage = _MemStore()
    cb = ConfigBackend(storage=storage)
    cfg = {'organization_url': 'MyOrg', 'feature_flags': {'use_azure_mock': True}}
    cb.save_ado_config(cfg)
    result = cb.fetch_ado_config()
    assert result['organization_url'] == 'MyOrg'
    assert result['feature_flags']['use_azure_mock'] is True


def test_save_ado_config_overwrites():
    """save_ado_config overwrites previous value."""
    storage = _MemStore()
    cb = ConfigBackend(storage=storage)
    cb.save_ado_config({'organization_url': 'OldOrg'})
    cb.save_ado_config({'organization_url': 'NewOrg', 'feature_flags': {}})
    assert cb.fetch_ado_config()['organization_url'] == 'NewOrg'


def test_save_config_writes_to_diskcache():
    """save_config writes to the storage under the config namespace."""
    storage = _MemStore()
    cb = ConfigBackend(storage=storage)
    cb.save_config('projects', {'project_map': [{'name': 'P1'}]})
    assert storage.exists('config', 'projects')
    assert storage.load('config', 'projects')['project_map'][0]['name'] == 'P1'


def test_save_config_raw_writes_to_diskcache():
    """save_config_raw writes without backup (same underlying effect)."""
    storage = _MemStore()
    cb = ConfigBackend(storage=storage)
    cb.save_config_raw('area_plan_map', {'proj': {}})
    assert storage.exists('config', 'area_plan_map')


def test_invalidate_cache_returns_ok():
    """invalidate_cache is a no-op that returns a status dict."""
    cb = ConfigBackend(storage=_MemStore())
    result = cb.invalidate_cache()
    assert result['ok'] is True
    assert result['invalidated'] == []


def test_fetch_projects_reads_from_storage():
    """fetch_projects returns projects from diskcache storage."""
    storage = _MemStore()
    storage.save('config', 'projects', {
        'project_map': [
            {'name': 'Alpha', 'area_path': 'Org\\Alpha', 'task_types': ['Feature']}
        ]
    })
    storage.save('config', 'global_settings', {
        'task_type_hierarchy': [],
        'state_display_sequence': ['New', 'Active', 'Closed'],
    })
    cb = ConfigBackend(storage=storage)
    projects = cb.fetch_projects()
    assert len(projects) == 1
    assert projects[0]['name'] == 'Alpha'
    assert projects[0]['state_display_sequence'] == ['New', 'Active', 'Closed']


def test_fetch_projects_missing_returns_empty():
    """fetch_projects returns an empty list when projects config is absent."""
    cb = ConfigBackend(storage=_MemStore())
    assert cb.fetch_projects() == []


def test_fetch_project_map_missing_returns_empty():
    """fetch_project_map returns an empty list when projects config is absent."""
    cb = ConfigBackend(storage=_MemStore())
    assert cb.fetch_project_map() == []


def test_fetch_config_teams_reads_from_storage():
    """fetch_config_teams returns non-excluded teams."""
    storage = _MemStore()
    storage.save('config', 'teams', {
        'teams': [
            {'name': 'Alpha', 'short_name': 'ALP'},
            {'name': 'Beta', 'short_name': 'BET', 'exclude': True},
        ]
    })
    cb = ConfigBackend(storage=storage)
    teams = cb.fetch_config_teams()
    assert len(teams) == 1
    assert teams[0]['name'] == 'Alpha'


def test_fetch_config_teams_missing_returns_empty():
    """fetch_config_teams returns an empty list when teams config is absent."""
    cb = ConfigBackend(storage=_MemStore())
    assert cb.fetch_config_teams() == []
