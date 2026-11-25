"""Local catalogue: validation, relational round trip, starter, references and display."""
import copy

import pytest

from planner_lib.backend.port import CatalogueBackend
from planner_lib.database import PlannerDatabase
from planner_lib.local.catalogue import (
    CatalogueInUseError, LocalCatalogue, StaleRevisionError, starter_catalogue,
)


@pytest.fixture
def database():
    database = PlannerDatabase.in_memory()
    yield database
    database.close()


@pytest.fixture
def catalogue(database):
    return LocalCatalogue(database)


def _starter(catalogue):
    return catalogue.create_starter(0)


def test_empty_catalogue_reads_as_revision_zero(catalogue):
    assert catalogue.read() == {'revision': 0, 'states': [], 'fields': [], 'field_schemas': [],
                                'workflows': [], 'processes': []}
    assert catalogue.work_item_display() == []
    assert isinstance(catalogue, CatalogueBackend)


def test_starter_catalogue_round_trips_and_displays_three_tiers(catalogue):
    saved = _starter(catalogue)
    expected = starter_catalogue()
    assert saved['revision'] == 1
    assert [state['name'] for state in saved['states']] == [
        'Open', 'Refine', 'Ready', 'In Progress', 'Waiting', 'Review', 'Closed']
    [workflow] = saved['workflows']
    names = {state['id']: state['name'] for state in saved['states']}
    assert names[workflow['initial']] == 'Open'
    assert [names[state] for state in workflow['from_any']] == ['Closed']
    assert {(names[t['from']], names[t['to']]) for t in workflow['transitions']} >= {
        ('Ready', 'In Progress'), ('Review', 'Closed'), ('Closed', 'Open')}
    [process] = saved['processes']
    assert [(t['name'], t['tier']) for t in process['types']] == [('Epic', 0), ('Feature', 1), ('User Story', 2)]
    assert len(process['parent_rules']) == 2
    assert set(expected) == set(saved)
    [display] = catalogue.work_item_display()
    assert display['process_id'] == process['id']
    assert [[item['name'] for item in tier] for tier in display['tiers']] == [['Epic'], ['Feature'], ['User Story']]
    assert display['tiers'][0][0]['states'][0] == {'name': 'Open', 'category': 'Proposed'}
    assert display['tiers'][0][0]['state_transitions']['Open'] == ['Refine', 'Closed']


def test_starter_requires_an_empty_catalogue_and_current_revision(catalogue):
    with pytest.raises(StaleRevisionError):
        catalogue.create_starter(5)
    _starter(catalogue)
    with pytest.raises(ValueError, match='empty'):
        catalogue.create_starter(1)


def test_stale_revision_is_rejected_without_writing(catalogue):
    saved = _starter(catalogue)
    stale = {**copy.deepcopy(saved), 'revision': 0}
    stale['states'][0]['name'] = 'Changed'
    with pytest.raises(StaleRevisionError):
        catalogue.save(stale)
    assert catalogue.read() == saved


def test_renames_reorders_and_typed_fields_round_trip(catalogue):
    document = copy.deepcopy(_starter(catalogue))
    document['states'][0]['name'], document['states'][1]['name'] = 'Refine', 'Open'
    document['states'].reverse()
    document['fields'] = [
        {'id': 'f-priority', 'key': 'priority', 'label': 'Priority', 'type': 'enum', 'options': ['High', 'Low']},
        {'id': 'f-points', 'key': 'points', 'label': 'Points', 'type': 'number', 'options': []},
        {'id': 'f-blocked', 'key': 'blocked', 'label': 'Blocked', 'type': 'boolean', 'options': []},
    ]
    document['field_schemas'][0]['fields'] = [
        {'field_id': 'f-priority', 'required': True, 'default': 'Low', 'min': None, 'max': None, 'max_length': None},
        {'field_id': 'f-points', 'required': False, 'default': 2.5, 'min': 0, 'max': 100, 'max_length': None},
        {'field_id': 'f-blocked', 'required': False, 'default': False, 'min': None, 'max': None, 'max_length': None},
    ]
    saved = catalogue.save(document)
    assert saved == {**document, 'revision': document['revision'] + 1}


@pytest.mark.parametrize('mutate, message', [
    (lambda d: d['states'].append({**d['states'][0], 'id': 'other'}), 'Duplicate state names'),
    (lambda d: d['states'][0].update(category='Done'), 'category'),
    (lambda d: d['workflows'][0].update(initial='missing'), 'initial'),
    (lambda d: d['workflows'][0]['transitions'].append({'from': 'missing', 'to': d['states'][0]['id']}),
     'transitions'),
    (lambda d: d['workflows'][0]['from_any'].append('missing'), 'from any'),
    (lambda d: d['processes'][0]['types'][0].update(workflow_id='missing'), 'workflow'),
    (lambda d: d['processes'][0]['types'][0].update(field_schema_id='missing'), 'field schema'),
    (lambda d: d['processes'][0]['parent_rules'].append({'parent': 'x', 'child': 'y'}), 'Parent rules'),
    (lambda d: d['fields'].append({'id': 'f', 'key': 'Bad Key', 'label': 'x', 'type': 'string', 'options': []}),
     'Field keys'),
    (lambda d: d['fields'].append({'id': 'f', 'key': 'choice', 'label': 'x', 'type': 'enum', 'options': []}),
     'enum'),
    (lambda d: d.update(extra=True), 'exactly'),
])
def test_invalid_documents_are_rejected_without_writing(catalogue, mutate, message):
    saved = _starter(catalogue)
    document = copy.deepcopy(saved)
    mutate(document)
    with pytest.raises(ValueError, match=message):
        catalogue.save(document)
    assert catalogue.read() == saved


def test_definitions_used_by_tasks_cannot_be_removed(catalogue, database):
    saved = _starter(catalogue)
    story = saved['processes'][0]['types'][2]
    with database.write() as connection:
        connection.execute("INSERT INTO plan_definitions (plan_id, backend_id, name, kind, display_order) "
                           "VALUES ('p', 'local', 'Plan', 'project', 0)")
        connection.execute(
            "INSERT INTO tasks (task_id, plan_id, type_id, state_id, title, revision, created_at, created_by, "
            "updated_at, updated_by) VALUES ('t', 'p', ?, ?, 'Task', 1, 'now', 'a', 'now', 'a')",
            (story['id'], saved['states'][0]['id']))
    without_type = copy.deepcopy(saved)
    without_type['processes'][0]['types'].pop(2)
    without_type['processes'][0]['parent_rules'].pop(1)
    with pytest.raises(CatalogueInUseError):
        catalogue.save(without_type)
    without_state = copy.deepcopy(saved)
    removed = without_state['states'].pop(0)['id']
    workflow = without_state['workflows'][0]
    workflow['states'].remove(removed)
    workflow['initial'] = workflow['states'][0]
    workflow['transitions'] = [t for t in workflow['transitions'] if removed not in (t['from'], t['to'])]
    with pytest.raises(CatalogueInUseError):
        catalogue.save(without_state)
    assert catalogue.read() == saved


def test_unused_definitions_can_be_removed(catalogue):
    saved = _starter(catalogue)
    document = copy.deepcopy(saved)
    document['processes'][0]['types'].pop(2)
    document['processes'][0]['parent_rules'].pop(1)
    assert [t['name'] for t in catalogue.save(document)['processes'][0]['types']] == ['Epic', 'Feature']
