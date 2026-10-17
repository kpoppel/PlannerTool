import pytest

from planner_lib.migrations import revisions
from planner_lib.migrations.contracts import SchemaError
from planner_lib.storage.memory_backend import MemoryStorage
from planner_lib.azure.catalogue import sync_display


def seed_process_catalogue(storage):
    states = [{'name': 'New', 'category': 'Proposed', 'order': 1}]
    process_catalogue = {'schema_version': 1, 'processes': [{
        'id': 'agile', 'name': 'Agile', 'projects': ['Platform_Development'],
        'loaded_at': 'now', 'types': [
            {'reference_name': 'Feature', 'name': 'Feature', 'backlog': 'Features',
             'backlog_level': 'portfolio', 'imported': True, 'missing': False, 'states': states},
            {'reference_name': 'Bug', 'name': 'Bug', 'backlog': 'Stories',
             'backlog_level': 'requirement', 'imported': True, 'missing': False, 'states': states},
            {'reference_name': 'Task', 'name': 'Task', 'backlog': 'Tasks',
             'backlog_level': 'task', 'imported': False, 'missing': False, 'states': states},
        ],
    }]}
    storage.save('config', 'ado_processes', process_catalogue)
    storage.save('config', 'global_settings', sync_display(process_catalogue, {
        'schema_version': 2, 'process_order': [], 'type_tiers': {},
    }))


def test_upgrade_41_removes_task_level_selections_and_preserves_other_plan_types():
    storage = MemoryStorage()
    revisions.initialize(storage)
    projects = storage.load('config', 'projects')
    projects['project_map'] = [
        {'id': '11111111-1111-4111-8111-111111111111', 'name': 'OneWSA eSW',
         'type': 'project', 'area_path': 'Platform_Development\\eSW',
         'task_types': ['Feature', 'Task'], 'closed_history_days': 0},
        {'id': '22222222-2222-4222-8222-222222222222', 'name': 'Other plan',
         'type': 'project', 'area_path': 'Platform_Development\\Other',
         'task_types': ['Bug'], 'closed_history_days': 0},
    ]
    storage.save('config', 'projects', projects)
    seed_process_catalogue(storage)

    revisions.upgrade_41(storage)

    plans = storage.load('config', 'projects')['project_map']
    assert plans[0]['task_types'] == ['Feature']
    assert plans[1]['task_types'] == ['Bug']
    revisions.validate_records(storage, 41)


def test_upgrade_41_rejects_task_only_plan_without_mutating_candidate():
    storage = MemoryStorage()
    revisions.initialize(storage)
    projects = storage.load('config', 'projects')
    projects['project_map'] = [{
        'id': '11111111-1111-4111-8111-111111111111', 'name': 'Task-only plan',
        'type': 'project', 'area_path': 'Platform_Development\\Tasks',
        'task_types': ['Task'], 'closed_history_days': 0,
    }]
    storage.save('config', 'projects', projects)
    seed_process_catalogue(storage)
    before = storage.load('config', 'projects')

    with pytest.raises(SchemaError, match='eligible work item type'):
        revisions.upgrade_41(storage)

    assert storage.load('config', 'projects') == before