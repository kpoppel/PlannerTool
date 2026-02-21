"""Tests for PeopleService"""
import pytest
from pathlib import Path
from planner_lib.people import PeopleService
from planner_lib.storage.base import StorageBackend, SerializerBackend
from planner_lib.storage.serializer import YAMLSerializer


class InMemoryBackend(StorageBackend):
    """In-memory storage backend for testing"""
    def __init__(self):
        self._data = {}

    def save(self, namespace: str, key: str, value):
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


def test_people_service_with_inline_only():
    """Test PeopleService with only inline entries (no database_file)"""
    backend = InMemoryBackend()
    storage = SerializerBackend(backend, YAMLSerializer())
    
    # Create people config with inline entries only
    people_config = {
        'schema_version': 1,
        'database_file': '',  # Empty database_file
        'database': {
            'people': [
                {
                    'name': 'John Doe',
                    'team_name': 'Architecture',
                    'site': 'LY',
                    'external': False
                },
                {
                    'name': 'Jane Smith',
                    'team_name': 'System',
                    'site': 'ERL',
                    'external': True
                }
            ]
        }
    }
    storage.save('config', 'people', people_config)
    
    # Create service
    service = PeopleService(storage=storage, data_dir='data')
    
    # Test get_people
    people = service.get_people()
    assert len(people) == 2
    assert people[0]['name'] == 'John Doe'
    assert people[0]['team_name'] == 'Architecture'
    assert people[1]['name'] == 'Jane Smith'
    assert people[1]['external'] is True
    
    # Test get_people_by_team
    arch_people = service.get_people_by_team('Architecture')
    assert len(arch_people) == 1
    assert arch_people[0]['name'] == 'John Doe'
    
    system_people = service.get_people_by_team('System')
    assert len(system_people) == 1
    assert system_people[0]['name'] == 'Jane Smith'


def test_people_service_get_config():
    """Test that PeopleService returns config correctly"""
    backend = InMemoryBackend()
    storage = SerializerBackend(backend, YAMLSerializer())
    
    people_config = {
        'schema_version': 1,
        'database_file': 'config/database.yaml',
        'database': {'people': []}
    }
    storage.save('config', 'people', people_config)
    
    service = PeopleService(storage=storage, data_dir='data')
    
    config = service.get_config()
    assert config['schema_version'] == 1
    assert config['database_file'] == 'config/database.yaml'


def test_people_service_reload():
    """Test that PeopleService reload works"""
    backend = InMemoryBackend()
    storage = SerializerBackend(backend, YAMLSerializer())
    
    # Initial config
    people_config = {
        'schema_version': 1,
        'database_file': '',
        'database': {
            'people': [
                {'name': 'Person A', 'team_name': 'Team A', 'site': 'LY', 'external': False}
            ]
        }
    }
    storage.save('config', 'people', people_config)
    
    service = PeopleService(storage=storage, data_dir='data')
    assert len(service.get_people()) == 1
    assert service.get_people()[0]['name'] == 'Person A'
    
    # Update config
    people_config['database']['people'].append(
        {'name': 'Person B', 'team_name': 'Team B', 'site': 'ERL', 'external': True}
    )
    storage.save('config', 'people', people_config)
    
    # Before reload, should still have 1 person
    assert len(service.get_people()) == 1
    
    # After reload, should have 2 people
    service.reload()
    assert len(service.get_people()) == 2
    assert service.get_people()[1]['name'] == 'Person B'


def test_people_service_missing_config():
    """Test PeopleService handles missing config gracefully"""
    backend = InMemoryBackend()
    storage = SerializerBackend(backend, YAMLSerializer())
    
    # Don't save any config - PeopleService should handle this
    service = PeopleService(storage=storage, data_dir='data')
    
    # Should return empty list
    people = service.get_people()
    assert len(people) == 0


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
