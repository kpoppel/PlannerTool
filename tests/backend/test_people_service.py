"""Tests for ConfigBackend.fetch_people() — replaces the deleted LocalConfigBackend tests."""
import pytest
from planner_lib.backend.config import ConfigBackend
from planner_lib.storage.base import StorageBackend, SerializerBackend
from planner_lib.storage.serializer import YAMLSerializer


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


def _storage_with(people_config):
    backend = InMemoryBackend()
    storage = SerializerBackend(backend, YAMLSerializer())
    storage.save('config', 'people', people_config)
    return storage


def test_fetch_people_inline_only():
    """ConfigBackend returns inline people entries."""
    storage = _storage_with({
        'database': {
            'people': [
                {'name': 'John Doe', 'team_name': 'Architecture', 'site': 'LY', 'external': False},
                {'name': 'Jane Smith', 'team_name': 'System', 'site': 'ERL', 'external': True},
            ]
        }
    })
    lcb = ConfigBackend(storage=InMemoryBackend(), yaml_storage=storage)
    people = lcb.fetch_people()
    assert len(people) == 2
    assert people[0]['name'] == 'John Doe'
    assert people[1]['external'] is True


def test_fetch_people_missing_config():
    """ConfigBackend returns empty list when people.yml is absent."""
    backend = InMemoryBackend()
    storage = SerializerBackend(backend, YAMLSerializer())
    lcb = ConfigBackend(storage=InMemoryBackend(), yaml_storage=storage)
    assert lcb.fetch_people() == []


def test_fetch_people_overrides_merge():
    """Inline overrides take precedence over database_file entries by name."""
    storage = _storage_with({
        'database': {
            'people': [
                {'name': 'John Doe', 'team_name': 'New Team'},   # override
            ]
        }
        # no database_file — base entries are empty, override should appear once
    })
    lcb = ConfigBackend(storage=InMemoryBackend(), yaml_storage=storage)
    people = lcb.fetch_people()
    assert len(people) == 1
    assert people[0]['team_name'] == 'New Team'

from planner_lib.storage.base import StorageBackend, SerializerBackend
from planner_lib.storage.serializer import YAMLSerializer


class InMemoryBackend(StorageBackend):
    """In-memory storage backend for testing"""
    def __init__(self):
        self._data = {}

    def save(self, namespace: str, key: str, value, ttl_seconds=None):
        self._data.setdefault(namespace, {})[key] = value

    def load(self, namespace: str, key: str):
        try:
            return self._data[namespace][key]
        except KeyError:
            raise KeyError(key)

    def delete(self, namespace: str, key: str):
        try:
            del self._data[namespace][key]
        except KeyError:
            raise KeyError(key)

    def list_keys(self, namespace: str):
        return list(self._data.get(namespace, {}).keys())

    def exists(self, namespace: str, key: str) -> bool:
        return key in self._data.get(namespace, {})

    def configure(self, **options):
        return None


