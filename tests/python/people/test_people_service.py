"""Tests for ConfigBackend.fetch_people() — reads from diskcache after migration 0022."""
import pytest
from planner_lib.backend.config import ConfigBackend
from planner_lib.storage.base import StorageBackend


class InMemoryBackend(StorageBackend):
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


def _backend_with_people(people_list):
    """Return a ConfigBackend whose diskcache already contains the given people list."""
    storage = InMemoryBackend()
    storage.save('config', 'people', {'database': {'people': people_list}})
    return ConfigBackend(storage=storage)


def test_fetch_people_inline_only():
    """ConfigBackend returns people stored in diskcache."""
    lcb = _backend_with_people([
        {'name': 'John Doe', 'team_name': 'Architecture', 'site': 'LY', 'external': False},
        {'name': 'Jane Smith', 'team_name': 'System', 'site': 'ERL', 'external': True},
    ])
    people = lcb.fetch_people()
    assert len(people) == 2
    assert people[0]['name'] == 'John Doe'
    assert people[1]['external'] is True


def test_fetch_people_missing_config():
    """ConfigBackend returns empty list when config::people is absent from diskcache."""
    lcb = ConfigBackend(storage=InMemoryBackend())
    assert lcb.fetch_people() == []


def test_fetch_people_overrides_merge():
    """People records stored in diskcache are returned as-is."""
    lcb = _backend_with_people([
        {'name': 'John Doe', 'team_name': 'New Team'},
    ])
    people = lcb.fetch_people()
    assert len(people) == 1
    assert people[0]['team_name'] == 'New Team'

