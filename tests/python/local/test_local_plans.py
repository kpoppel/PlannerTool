"""Local plans: area-path-free plan scope, validation against shared configuration."""
import copy

import pytest

from planner_lib.database import PlannerDatabase
from planner_lib.local.catalogue import LocalCatalogue, StaleRevisionError
from planner_lib.local.plans import LocalPlans, PlanInUseError
from planner_lib.migrations.revisions import initialize
from planner_lib.storage.memory_backend import MemoryStorage

PLAN_ID = '11111111-1111-4111-8111-111111111111'


@pytest.fixture
def setup():
    database = PlannerDatabase.in_memory()
    storage = MemoryStorage()
    initialize(storage)
    storage.save('config', 'iterations', {'iteration_sets': [{'id': 'set-1'}]})
    catalogue = LocalCatalogue(database).create_starter(0)
    yield LocalPlans(database, storage), catalogue, database
    database.close()


def _plan(catalogue, **overrides):
    types = catalogue['processes'][0]['types']
    plan = {'id': PLAN_ID, 'name': 'Platform', 'type': 'project', 'archived': False,
            'task_types': [types[0]['id'], types[1]['id']], 'closed_history_days': 30,
            'iteration_uuid': 'set-1',
            'markers': [{'id': 'm1', 'label': 'Release', 'date': '2026-12-01', 'color': '#f00'}]}
    plan.update(overrides)
    return plan


def test_local_plans_round_trip_without_area_path(setup):
    plans, catalogue, database = setup
    assert plans.read() == {'revision': 0, 'plans': []}
    saved = plans.save({'revision': 0, 'plans': [_plan(catalogue, allocatable_ids=[])]})
    assert saved == {'revision': 1, 'plans': [_plan(catalogue, allocatable_ids=[])]}
    with database.connect() as connection:
        assert connection.execute('SELECT area_path FROM plan_definitions').fetchone()[0] is None


def test_allocation_override_is_distinct_from_defaults(setup):
    plans, catalogue, _ = setup
    saved = plans.save({'revision': 0, 'plans': [_plan(catalogue)]})
    assert 'allocatable_ids' not in saved['plans'][0]


@pytest.mark.parametrize('overrides, message', [
    ({'id': 'not-a-uuid'}, 'UUID'),
    ({'type': 'portfolio'}, 'level'),
    ({'task_types': ['unknown']}, 'unknown or task-level'),
    ({'iteration_uuid': 'missing'}, 'iteration set'),
    ({'allocatable_ids': ['missing-team']}, 'Unknown allocation'),
    ({'markers': [{'id': 'm', 'label': 'x', 'date': '2026-13-01', 'color': None}]}, 'YYYY-MM-DD'),
    ({'area_path': 'Project\\Area'}, 'exactly'),
])
def test_invalid_plans_are_rejected(setup, overrides, message):
    plans, catalogue, _ = setup
    with pytest.raises(ValueError, match=message):
        plans.save({'revision': 0, 'plans': [_plan(catalogue, **overrides)]})
    assert plans.read() == {'revision': 0, 'plans': []}


def test_stale_plans_revision_is_rejected(setup):
    plans, catalogue, _ = setup
    plans.save({'revision': 0, 'plans': [_plan(catalogue)]})
    with pytest.raises(StaleRevisionError):
        plans.save({'revision': 0, 'plans': []})


def test_reordering_and_removal_of_unused_plans(setup):
    plans, catalogue, _ = setup
    second = '22222222-2222-4222-8222-222222222222'
    plans.save({'revision': 0, 'plans': [_plan(catalogue), _plan(catalogue, id=second, name='Second', markers=[])]})
    saved = plans.save({'revision': 1, 'plans': [_plan(catalogue, id=second, name='Second', markers=[])]})
    assert [plan['id'] for plan in saved['plans']] == [second]


def test_plans_owning_tasks_cannot_be_removed(setup):
    plans, catalogue, database = setup
    plans.save({'revision': 0, 'plans': [_plan(catalogue)]})
    with database.write() as connection:
        connection.execute(
            "INSERT INTO tasks (task_id, plan_id, type_id, state_id, title, revision, created_at, created_by, "
            "updated_at, updated_by) VALUES ('t', ?, ?, ?, 'Task', 1, 'now', 'a', 'now', 'a')",
            (PLAN_ID, catalogue['processes'][0]['types'][0]['id'], catalogue['states'][0]['id']))
    with pytest.raises(PlanInUseError):
        plans.save({'revision': 1, 'plans': []})
    assert len(plans.read()['plans']) == 1


def test_catalogue_types_used_by_plans_cannot_be_removed(setup):
    plans, catalogue, database = setup
    plans.save({'revision': 0, 'plans': [_plan(catalogue)]})
    document = copy.deepcopy(catalogue)
    document['processes'][0]['types'].pop(0)
    document['processes'][0]['parent_rules'].pop(0)
    from planner_lib.local.catalogue import CatalogueInUseError
    with pytest.raises(CatalogueInUseError):
        LocalCatalogue(database).save(document)


def test_create_local_task_and_read_schedule_history(setup):
    from uuid import UUID

    from planner_lib.backend.adapter import AzureAdapter
    from planner_lib.local.tasks import LocalTasks

    plans, catalogue, database = setup
    field_id = '33333333-3333-4333-8333-333333333333'
    catalogue['fields'].append({'id': field_id, 'key': 'estimate', 'label': 'Estimate',
                                'type': 'integer', 'options': []})
    catalogue['field_schemas'][0]['fields'].append({
        'field_id': field_id, 'required': True, 'default': None,
        'min': 1, 'max': 10, 'max_length': None,
    })
    LocalCatalogue(database).save(catalogue)
    plans.save({'revision': 0, 'plans': [_plan(catalogue)]})
    task_type = catalogue['processes'][0]['types'][0]
    tasks = LocalTasks(database, plans._storage)
    payload = {'project': PLAN_ID, 'typeId': task_type['id'], 'title': 'First local task',
               'start': '2026-12-01', 'end': '2026-12-04'}

    with pytest.raises(ValueError, match='estimate'):
        tasks.create(payload, 'actor')
    assert tasks.read() == []

    created = tasks.create({**payload, 'customFields': {'estimate': 3}}, 'actor')
    assert UUID(created['id']).version == 4
    assert created['revision'] == 1
    assert created['state'] == 'Open'
    assert created['type'] == task_type['name']
    assert created['project'] == PLAN_ID
    assert created['customFields'] == {'estimate': 3}
    assert tasks.read() == [created]
    ado = AzureAdapter().to_domain({
        'id': 42, 'title': payload['title'], 'type': task_type['name'], 'state': 'Open', 'rev': 1,
        'startDate': payload['start'], 'finishDate': payload['end'],
    }, PLAN_ID, None, {}, {})
    common = set(ado) - {'id', 'url', 'areaPath', 'backendData'}
    assert {key: created[key] for key in common} == {key: ado[key] for key in common}
    assert 'backendData' not in created
    history = tasks.fetch_history(created['id'])
    assert {entry['field']: entry['value'] for entry in history} == {
        'start': '2026-12-01', 'end': '2026-12-04',
    }
    assert {entry['changed_by'] for entry in history} == {'actor'}


def test_local_backend_reads_cross_plan_context_and_markers(setup):
    from planner_lib.backend.registry import build_active_backend
    from planner_lib.repository import PlanRepository, ProjectRepository, TaskRepository

    plans, catalogue, database = setup
    second = '22222222-2222-4222-8222-222222222222'
    plans.save({'revision': 0, 'plans': [_plan(catalogue), _plan(catalogue, id=second, markers=[])]})
    storage = plans._storage
    server = storage.load('config', 'server_config')
    backend = build_active_backend({**server, 'task_backend_id': 'local'}, storage.load('config', 'ado_config'),
                                   planner_database=database, storage=storage)
    projects = ProjectRepository(backend)
    repository = TaskRepository(backend, projects, None)
    task_types = catalogue['processes'][0]['types']
    parent = backend.create_task({'project': PLAN_ID, 'typeId': task_types[0]['id'], 'title': 'Parent'}, 'actor')
    child = backend.create_task({'project': second, 'typeId': task_types[1]['id'], 'title': 'Child'}, 'actor')
    with database.write() as connection:
        connection.execute('INSERT INTO task_relations VALUES (?, ?, ?)', (parent['id'], child['id'], 'parent'))
        connection.execute('INSERT INTO task_allocations VALUES (?, ?, ?)', (child['id'], 'team-id', 15.5))

    scoped = {task['id']: task for task in repository.read(project_id=PLAN_ID)}
    assert set(scoped) == {parent['id'], child['id']}
    actual = scoped[child['id']]
    assert actual['project'] == second
    assert actual['parentId'] == parent['id']
    assert actual['relations'] == [{'type': 'Parent', 'id': parent['id']}]
    assert actual['sourcePlanIds'] == [PLAN_ID, second]
    assert actual['presentationPlanIds'] == [PLAN_ID, second]
    assert actual['capacity'] == [{'team': 'team-id', 'capacity': 15.5}]
    assert {'id', 'title', 'type', 'state', 'project', 'process_id', 'sourcePlanIds',
            'presentationPlanIds', 'start', 'end', 'capacity', 'relations', 'url'} <= set(actual)
    assert 'backendData' not in actual
    assert projects.list_projects()[0]['task_types'] == [entry['name'] for entry in task_types[:2]]
    markers = PlanRepository(backend, projects, None, None).list_markers()
    assert markers[0]['marker']['label'] == 'Release'
    assert markers[0]['project'] == PLAN_ID
