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
