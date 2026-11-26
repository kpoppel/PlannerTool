"""Local plans: area-path-free plan scope, validation against shared configuration."""
import copy
import json
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from threading import Barrier, Event
from time import perf_counter
from uuid import uuid4

import pytest

from planner_lib.admin.config_manager import ConfigManager
from planner_lib.backend.local import LocalTaskBackend
from planner_lib.database import SCHEMA_TARGET, PlannerDatabase, planner_database
from planner_lib.local.catalogue import LocalCatalogue, StaleRevisionError
from planner_lib.local.plans import LocalPlans, PlanInUseError
from planner_lib.local.tasks import LocalTasks
from planner_lib.migrations import coordinator
from planner_lib.migrations.contracts import SchemaError
from planner_lib.migrations.coordinator import Database
from planner_lib.migrations.revisions import initialize
from planner_lib.storage.memory_backend import MemoryStorage

PLAN_ID = '11111111-1111-4111-8111-111111111111'


def no_rules(originals, resulting):
    """Local storage tests compose no workforce validation."""


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


def _seed_operational_plan(handle):
    database, storage = handle.planner_database, handle.storage
    catalogue = LocalCatalogue(database).create_starter(0)
    LocalPlans(database, storage).save({'revision': 0, 'plans': [_plan(catalogue, iteration_uuid=None)]})
    return catalogue['processes'][0]['types']


def test_local_read_snapshot_during_concurrent_publication(tmp_path, monkeypatch):
    handle = Database(tmp_path).prepare()
    try:
        task_type = _seed_operational_plan(handle)[0]
        reader = LocalTasks(handle.planner_database, handle.storage)
        writer = LocalTasks(handle.planner_database, handle.storage)
        base = writer.create({'project': PLAN_ID, 'typeId': task_type['id'], 'title': 'Before'}, 'creator')
        snapshot_ready, release_reader = Event(), Event()
        start_writers = Barrier(2, timeout=10)
        read_tasks = reader._read

        def wait_in_snapshot(connection):
            snapshot_ready.set()
            assert release_reader.wait(timeout=10)
            return read_tasks(connection)

        def publish(actor, field, value):
            start_writers.wait()
            return writer.update_batch([{'id': base['id'], 'revision': base['revision'],
                                         'before': {field: base[field]}, 'fields': {field: value}}], actor, no_rules)[0]

        monkeypatch.setattr(reader, '_read', wait_in_snapshot)
        with ThreadPoolExecutor(max_workers=3) as pool:
            snapshot = pool.submit(reader.read_collection)
            try:
                assert snapshot_ready.wait(timeout=10)
                rename = pool.submit(publish, 'alice', 'title', 'After')
                schedule = pool.submit(publish, 'bob', 'start', '2026-12-01')
                assert {rename.result(timeout=10)['revision'], schedule.result(timeout=10)['revision']} == {2, 3}
            finally:
                release_reader.set()
            historical, selected = snapshot.result(timeout=10)

        assert historical == [base]
        assert PLAN_ID in selected
        [current] = writer.read()
        assert (current['title'], current['start'], current['revision']) == ('After', '2026-12-01', 3)
        assert [(entry['value'], entry['changed_by']) for entry in writer.fetch_history(base['id'])] == [
            ('2026-12-01', 'bob')]
    finally:
        handle.close()


def test_local_task_history_survives_checkpoint_rotation_and_full_restore(tmp_path, monkeypatch):
    root = tmp_path / 'installation'
    with closing(Database(root).prepare()) as handle:
        task_type = _seed_operational_plan(handle)[0]
        database, storage = handle.planner_database, handle.storage
        original_path = database.path
        tasks = LocalTasks(database, storage)
        created = tasks.create({'project': PLAN_ID, 'typeId': task_type['id'], 'title': 'Task',
                                'start': '2026-12-01'}, 'creator')
        task_id = created['id']
        with database.connect() as reader:
            reader.execute('BEGIN')
            assert reader.execute('SELECT revision FROM tasks').fetchone()[0] == 1
            [published] = tasks.update_batch([{'id': task_id, 'revision': 1,
                                              'before': {'start': created['start']},
                                              'fields': {'start': '2026-12-02'}}], 'publisher', no_rules)
            assert reader.execute('SELECT revision FROM tasks').fetchone()[0] == 1
            manager = ConfigManager(storage, planner_database=database)
            logical = manager.get_backup()['planner_database']['tables']
            assert [(row['task_id'], row['revision']) for row in logical['tasks']] == [(task_id, 2)]
            assert {row['revision'] for row in logical['task_history']} == {1, 2}
            monkeypatch.setattr(planner_database, 'BUSY_TIMEOUT_MS', 100)
            with pytest.raises(SchemaError, match='checkpoint is blocked'):
                database.checkpoint()
        database.checkpoint()
        expected_history = tasks.fetch_history(task_id)
        assert [(entry['value'], entry['changed_by']) for entry in expected_history] == [
            ('2026-12-01', 'creator'), ('2026-12-02', 'publisher')]

    backup = Database(root).export_legacy(tmp_path / 'full-backup')
    next_schema = SCHEMA_TARGET + 1
    monkeypatch.setattr(planner_database, 'MIGRATIONS', planner_database.MIGRATIONS + (
        (next_schema, '9999.phase-six-probe', 'CREATE TABLE phase_six_probe (id INTEGER PRIMARY KEY);'),))
    monkeypatch.setattr(planner_database, 'SCHEMA_TARGET', next_schema)
    monkeypatch.setattr(coordinator, 'DATABASE_SCHEMA_TARGET', next_schema)
    installation = Database(root, build='phase-six-test')
    with closing(installation.prepare()) as handle:
        rotated_path = handle.planner_database.path
        assert rotated_path != original_path
    with closing(installation.prepare()) as handle:
        assert handle.planner_database.path == rotated_path
        tasks = LocalTasks(handle.planner_database, handle.storage)
        assert tasks.read() == [published]
        assert tasks.fetch_history(task_id) == expected_history
        tasks.delete(task_id, published['revision'], 'deleter')
        assert tasks.read() == []

    installation.restore(backup, confirmed=True)
    with closing(installation.prepare()) as handle:
        database = handle.planner_database
        assert database.path != rotated_path
        assert database.validate() == next_schema
        tasks = LocalTasks(database, handle.storage)
        assert tasks.read() == [published]
        assert tasks.fetch_history(task_id) == expected_history


def test_local_workload_query_and_time_budgets(tmp_path, monkeypatch, record_property):
    with closing(Database(tmp_path).prepare()) as handle:
        parent_type, child_type, *_ = _seed_operational_plan(handle)
        database, storage = handle.planner_database, handle.storage
        backend = LocalTaskBackend(database, storage, LocalCatalogue(database), LocalPlans(database, storage))
        parents = [backend.create_task({'project': PLAN_ID, 'typeId': parent_type['id'],
                                        'title': f'Parent {index}'}, 'seed', None) for index in range(12)]
        children = []
        links = []
        for parent in parents:
            for index in range(99):
                identity = str(uuid4())
                children.append((identity, PLAN_ID, child_type['id'], f'Child {index}'))
                links.append((parent['id'], identity))
        with database.write() as connection:
            state = connection.execute('SELECT state_id FROM tasks WHERE task_id = ?',
                                       (parents[0]['id'],)).fetchone()[0]
            connection.executemany('''
                INSERT INTO tasks (task_id, plan_id, type_id, title, state_id, revision,
                                   created_at, created_by, updated_at, updated_by)
                VALUES (?, ?, ?, ?, ?, 1, '2026-11-25', 'seed', '2026-11-25', 'seed')
            ''', [(*child, state) for child in children])
            connection.executemany("INSERT INTO task_relations VALUES (?, ?, 'parent')", links)
            connection.executemany('''
                INSERT INTO task_history (task_id, revision, field_key, new_value, actor_id, changed_at, batch_id)
                VALUES (?, 1, 'title', ?, 'seed', '2026-11-25', 'seed')
            ''', [(identity, json.dumps(title)) for identity, _, _, title in children])

        statements = []
        open_connection = database._open

        def traced_connection():
            connection = open_connection()
            connection.set_trace_callback(statements.append)
            return connection

        def measure(operation, action, query_budget):
            statements.clear()
            started = perf_counter()
            result = action()
            elapsed = perf_counter() - started
            record_property(f'{operation}_ms', round(elapsed * 1000, 2))
            record_property(f'{operation}_statements', len(statements))
            assert elapsed < 5, f'{operation} took {elapsed:.2f}s'
            assert len(statements) <= query_budget, f'{operation} ran {len(statements)} SQL statements'
            return result

        monkeypatch.setattr(database, '_open', traced_connection)
        collection = measure('tree_read', backend.fetch_task_collection, 8)
        assert len(collection) == 1_200
        by_id = {task['id']: task for task in collection}
        assert all(by_id[child]['parentId'] == parent for parent, child in links)
        edits = [{'id': identity, 'base': {'revision': 1, 'fields': {'start': None}},
                  'start': '2026-12-01'} for _, identity in links[:60]]
        result = measure('publish_60', lambda: backend.write_tasks(edits, None, actor_id='publisher', validate=no_rules),
                 15 + 5 * len(edits))
        assert result == {'ok': True, 'updated': 60, 'errors': [], 'conflicts': []}

        history = measure('task_history', lambda: backend.fetch_history(edits[0]['id']), 1)
        assert [(entry['field'], entry['value'], entry['changed_by']) for entry in history] == [
            ('start', '2026-12-01', 'publisher')]
        with closing(open_connection()) as connection:
            query_plan = [row['detail'] for row in connection.execute('EXPLAIN QUERY PLAN ' + statements[0])]
        assert any('SEARCH task_history USING INDEX task_history_task (task_id=?)' in step for step in query_plan)


def test_local_plans_round_trip_without_area_path(setup):
    plans, catalogue, database = setup
    assert plans.read() == {'revision': 0, 'plans': []}
    saved = plans.save({'revision': 0, 'plans': [_plan(catalogue, allocatable_ids=[])]})
    assert saved == {'revision': 1, 'plans': [_plan(catalogue, allocatable_ids=[])]}
    with database.connect() as connection:
        assert connection.execute('SELECT area_path FROM plan_definitions').fetchone()[0] is None


def test_plan_task_types_and_same_day_markers_keep_document_order(setup):
    plans, catalogue, _ = setup
    markers = [{'id': f'm{n}', 'label': f'Marker {n}', 'date': '2026-12-01', 'color': None} for n in range(3)]
    saved = plans.save({'revision': 0, 'plans': [_plan(catalogue, markers=markers)]})
    plan = copy.deepcopy(saved['plans'][0])
    plan['task_types'].reverse()
    plan['markers'].reverse()
    assert plans.save({'revision': 1, 'plans': [plan]})['plans'] == [plan]


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
                                   local_catalogue=LocalCatalogue(database), local_plans=plans,
                                   planner_database=database, storage=storage)
    projects = ProjectRepository(backend)
    repository = TaskRepository(backend, projects, None)
    task_types = catalogue['processes'][0]['types']
    parent = backend.create_task({'project': PLAN_ID, 'typeId': task_types[0]['id'], 'title': 'Parent'}, 'actor', None)
    child = backend.create_task({'project': second, 'typeId': task_types[1]['id'], 'title': 'Child'}, 'actor', None)
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


def test_local_updates_merge_by_verified_field_and_rollback_on_conflict(setup):
    from planner_lib.domain.tasks import TaskConflictError
    plans, catalogue, database = setup
    plans.save({'revision': 0, 'plans': [_plan(catalogue)]})
    tasks = LocalTasks(database, plans._storage)
    payload = {'project': PLAN_ID, 'typeId': catalogue['processes'][0]['types'][0]['id']}
    first = tasks.create({**payload, 'title': 'First'}, 'creator')
    second = tasks.create({**payload, 'title': 'Second'}, 'creator')

    def edit(task, field, before, value):
        return {'id': task['id'], 'revision': task['revision'], 'before': {field: before},
                'fields': {field: value}}

    def update_batch(edits, actor):
        return tasks.update_batch(edits, actor, no_rules)

    update_batch([edit(first, 'title', 'First', 'Renamed')], 'alice')
    update_batch([edit(first, 'start', None, '2026-12-01')], 'bob')
    with pytest.raises(TaskConflictError) as failed:
        update_batch([edit(second, 'title', 'Second', 'Not committed'),
                      edit(first, 'title', 'First', 'Overlapping')], 'bob')
    assert failed.value.conflicts == [{'taskId': first['id'], 'field': 'title', 'reason': 'overlap',
                                       'base': 'First', 'current': 'Renamed', 'proposed': 'Overlapping',
                                       'revision': 3}]
    with pytest.raises(TaskConflictError) as unverified:
        update_batch([edit(first, 'end', '2026-12-04', '2026-12-05')], 'bob')
    assert unverified.value.conflicts[0]['reason'] == 'unverified_base'
    with pytest.raises(ValueError, match='Invalid workflow transition'):
        update_batch([edit(second, 'title', 'Second', 'Not committed'),
                      edit(first, 'state', 'Open', 'Review')], 'bob')
    actual = {task['id']: task for task in tasks.read()}
    assert (actual[first['id']]['title'], actual[first['id']]['start'], actual[first['id']]['revision']) == (
        'Renamed', '2026-12-01', 3)
    assert actual[second['id']] == second
    assert [(entry['value'], entry['changed_by']) for entry in tasks.fetch_history(first['id'])] == [
        ('2026-12-01', 'bob')]


def test_local_custom_fields_merge_independently_and_validate_required_values(setup):
    from planner_lib.domain.tasks import TaskConflictError

    plans, catalogue, database = setup
    for key in ('estimate', 'effort'):
        field_id = str(uuid4())
        catalogue['fields'].append({'id': field_id, 'key': key, 'label': key, 'type': 'integer', 'options': []})
        catalogue['field_schemas'][0]['fields'].append({
            'field_id': field_id, 'required': True, 'default': None, 'min': 1, 'max': 10, 'max_length': None,
        })
    LocalCatalogue(database).save(catalogue)
    plans.save({'revision': 0, 'plans': [_plan(catalogue)]})
    tasks = LocalTasks(database, plans._storage)
    task = tasks.create({'project': PLAN_ID, 'typeId': catalogue['processes'][0]['types'][0]['id'],
                         'title': 'Task', 'customFields': {'estimate': 2, 'effort': 4}}, 'creator')

    def edit(source, proposed):
        return tasks.update_batch([{'id': task['id'], 'revision': source['revision'],
                                    'before': {'customFields': source['customFields']},
                                    'fields': {'customFields': proposed}}], 'editor', no_rules)[0]

    edit(task, {'estimate': 5, 'effort': 4})
    merged = edit(task, {'estimate': 2, 'effort': 6})
    assert merged['customFields'] == {'estimate': 5, 'effort': 6}
    with pytest.raises(TaskConflictError) as failed:
        edit(task, {'estimate': 7, 'effort': 4})
    assert failed.value.conflicts[0]['field'] == 'customFields.estimate'
    with pytest.raises(ValueError, match='estimate is required'):
        edit(merged, {'effort': 6})
    with database.connect() as connection:
        history = connection.execute('''
            SELECT revision, field_key, old_value, new_value FROM task_history WHERE task_id = ? AND revision > 1
            ORDER BY revision
        ''', (task['id'],)).fetchall()
    assert list(map(tuple, history)) == [(2, 'customFields.estimate', '2', '5'), (3, 'customFields.effort', '4', '6')]
