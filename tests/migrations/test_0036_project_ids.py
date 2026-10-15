import pytest

from planner_lib.migrations.contracts import SchemaError
from planner_lib.migrations.revisions import upgrade_36
from planner_lib.storage.memory_backend import MemoryStorage


def test_upgrade_36_assigns_unique_project_ids_and_remaps_references(monkeypatch):
    from uuid import UUID

    identities = iter((
        UUID('11111111-1111-4111-8111-111111111111'),
        UUID('22222222-2222-4222-8222-222222222222'),
    ))
    monkeypatch.setattr('planner_lib.migrations.revisions.uuid4', lambda: next(identities))
    storage = MemoryStorage()
    old_id = 'project-release-projects'
    storage.save('config', 'projects', {
        'schema_version': 4,
        'container_types': ['project', 'team'],
        'project_map': [
            {'name': 'Release Projects', 'type': 'project', 'area_path': 'Alpha\\Team'},
            {'name': 'Release Projects', 'type': 'project', 'area_path': 'Beta\\Team'},
        ],
    })
    storage.save('config', 'area_plan_map', {
        old_id: {
            'areas': {
                'Alpha\\Team': {'plans': {'1': {'name': 'Alpha plan', 'enabled': True}}},
                'Beta\\Team': {'plans': {'2': {'name': 'Beta plan', 'enabled': False}}},
            },
        },
        'last_update': '2026-01-01T00:00:00+00:00',
    })
    storage.save('views', 'owner_view-1', {
        'selectedProjects': {old_id: True},
    })
    storage.save('scenarios', 'owner_scenario-1', {
        'filters': {'projects': [old_id]},
        'view': {'selectedProjects': {old_id: False}},
    })
    storage.save('backend_domain', 'fetch_tasks__old', [{'project': old_id}])

    upgrade_36(storage)

    projects = storage.load('config', 'projects')['project_map']
    assert [project['id'] for project in projects] == [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
    ]
    assert storage.load('config', 'area_plan_map') == {
        projects[0]['id']: {
            'areas': {'Alpha\\Team': {'plans': {'1': {'name': 'Alpha plan', 'enabled': True}}}},
        },
        projects[1]['id']: {
            'areas': {'Beta\\Team': {'plans': {'2': {'name': 'Beta plan', 'enabled': False}}}},
        },
        'last_update': '2026-01-01T00:00:00+00:00',
    }
    assert storage.load('views', 'owner_view-1')['selectedProjects'] == {
        projects[0]['id']: True,
        projects[1]['id']: True,
    }
    assert storage.load('scenarios', 'owner_scenario-1')['view']['selectedProjects'] == {
        projects[0]['id']: False,
        projects[1]['id']: False,
    }
    assert storage.load('scenarios', 'owner_scenario-1')['filters']['projects'] == [
        projects[0]['id'],
        projects[1]['id'],
    ]
    assert list(storage.list_keys('backend_domain')) == []


def test_upgrade_36_rejects_ambiguous_area_mapping_without_partial_writes(monkeypatch):
    from uuid import UUID

    identities = iter((
        UUID('11111111-1111-4111-8111-111111111111'),
        UUID('22222222-2222-4222-8222-222222222222'),
    ))
    monkeypatch.setattr('planner_lib.migrations.revisions.uuid4', lambda: next(identities))
    storage = MemoryStorage()
    storage.save('config', 'projects', {
        'schema_version': 4,
        'container_types': ['project'],
        'project_map': [
            {'name': 'Duplicate', 'type': 'project', 'area_path': 'Root\\Team'},
            {'name': 'Duplicate', 'type': 'project', 'area_path': 'Root\\Team'},
        ],
    })
    old_id = 'project-duplicate'
    storage.save('config', 'area_plan_map', {
        old_id: {'areas': {'Root\\Team': {'plans': {}}}},
    })
    original_projects = storage.load('config', 'projects')

    with pytest.raises(SchemaError, match='Ambiguous project area mapping'):
        upgrade_36(storage)

    assert storage.load('config', 'projects') == original_projects
    assert storage.load('config', 'area_plan_map') == {
        old_id: {'areas': {'Root\\Team': {'plans': {}}}},
    }
