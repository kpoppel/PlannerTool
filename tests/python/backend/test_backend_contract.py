"""BackendPort contract tests.

Every BackendPort implementation must satisfy the same contract.
This module uses pytest parametrization to run the same assertions
against every concrete backend registered in the BackendRegistry —
so adding a new backend to the registry automatically enrols it in
these tests.

The parametrization is driven by ``BACKEND_FIXTURES`` at the bottom of
this file.  Each entry is a ``(name, fixture_fn)`` pair where
``fixture_fn(tasks, tmp_path)`` returns a ready-to-use BackendPort
instance pre-loaded with ``tasks`` in the area ``AREA``.

Backends that cannot round-trip tasks (e.g. live AzureDevOpsBackend)
are excluded from the parametrization; they are covered by their own
integration tests and by ``test_backend_registry.py`` (construction only).
"""
from __future__ import annotations

import json
import pytest
from typing import get_protocol_members

from planner_lib.backend.port import BackendPort
from tests.python.azure.test_process_catalogue import catalogue_storage

# The area path used throughout all contract tests
AREA = 'MyOrg\\\\TeamA'

# Minimal task dicts that satisfy the DomainTask shape
_TASK_1: dict = {
    'id': '10',
    'title': 'Feature Alpha',
    'type': 'Feature',
    'state': 'Active',
    'project': 'project-team-a',
    'relations': [],
    'capacity': [],
}
_TASK_2: dict = {
    'id': '20',
    'title': 'Epic Beta',
    'type': 'Epic',
    'state': 'Resolved',
    'project': 'project-team-a',
    'relations': [],
    'capacity': [],
}
_TASKS = [_TASK_1, _TASK_2]


# ---------------------------------------------------------------------------
# Backend factories — produce a pre-loaded BackendPort instance.
# Each factory accepts (tasks, tmp_path) and returns a BackendPort.
# ---------------------------------------------------------------------------

def _make_fake_backend(tasks, tmp_path):
    from tests.fakes.fake_backend import FakeBackend
    b = FakeBackend()
    b.set_tasks(AREA, tasks)
    return b


def _make_static_backend_yaml(tasks, tmp_path):
    """StaticBackend loaded from a YAML file."""
    import yaml
    from planner_lib.backend.static import StaticBackend
    data = {AREA: tasks}
    p = tmp_path / 'tasks.yml'
    p.write_text(yaml.safe_dump(data))
    return StaticBackend(str(p), storage=catalogue_storage(['MyOrg', 'Unknown']))


def _make_static_backend_json(tasks, tmp_path):
    """StaticBackend loaded from a JSON file."""
    from planner_lib.backend.static import StaticBackend
    data = {AREA: tasks}
    p = tmp_path / 'tasks.json'
    p.write_text(json.dumps(data))
    return StaticBackend(str(p), storage=catalogue_storage(['MyOrg', 'Unknown']))


def _make_caching_backend(tasks, tmp_path):
    """CachingBackend wrapping a FakeBackend with transactional memory storage."""
    from tests.fakes.fake_backend import FakeBackend
    from planner_lib.backend.caching import CachingBackend
    from planner_lib.storage.memory_backend import MemoryStorage

    inner = FakeBackend()
    inner.set_tasks(AREA, tasks)

    return CachingBackend(inner=inner, storage=MemoryStorage())


# ---------------------------------------------------------------------------
# Contract test parametrisation
# ---------------------------------------------------------------------------

# Name → factory pairs.  Tests use the name as the parametrize ID.
BACKEND_FIXTURES = [
    ('FakeBackend',           _make_fake_backend),
    ('StaticBackend[yaml]',   _make_static_backend_yaml),
    ('StaticBackend[json]',   _make_static_backend_json),
    ('CachingBackend',        _make_caching_backend),
]


def pytest_generate_tests(metafunc):
    """Inject parametrization for tests that declare a ``backend`` fixture."""
    if 'backend' in metafunc.fixturenames:
        ids = [name for name, _ in BACKEND_FIXTURES]
        factories = [factory for _, factory in BACKEND_FIXTURES]
        metafunc.parametrize('backend_factory', factories, ids=ids, indirect=True)


@pytest.fixture
def backend_factory(request, tmp_path):
    """Resolved factory; returns a BackendPort pre-loaded with _TASKS."""
    factory = request.param
    return factory(list(_TASKS), tmp_path)


@pytest.fixture
def backend(backend_factory):
    return backend_factory


# ---------------------------------------------------------------------------
# BackendPort protocol compliance
# ---------------------------------------------------------------------------

def test_backend_satisfies_protocol(backend):
    """Every remote-data backend must implement all BackendPort methods.

    We use structural checking (hasattr per method) rather than isinstance
    because CachingBackend provides methods dynamically via __getattribute__,
    which Python 3.12+ runtime_checkable Protocols do not see.
    """
    missing = [
        m for m in get_protocol_members(BackendPort)
        if not hasattr(backend, m)
    ]
    assert not missing, (
        f"{type(backend).__name__} is missing BackendPort methods: {missing}"
    )


# ---------------------------------------------------------------------------
# fetch_tasks contract
# ---------------------------------------------------------------------------

def test_fetch_tasks_returns_list(backend):
    result = backend.fetch_tasks(AREA, task_types=["Feature", "Epic"])
    assert isinstance(result, list)


@pytest.mark.parametrize('kind', ['static', 'fixture', 'generator'])
@pytest.mark.parametrize('days,expected', [(0, {'1'}), (90, {'1', '2'})])
def test_catalogue_type_and_history_contract_across_local_backends(kind, days, expected, tmp_path):
    from datetime import datetime, timedelta, timezone
    from types import SimpleNamespace
    from unittest.mock import MagicMock
    from planner_lib.backend.static import StaticBackend
    from planner_lib.backend.mock import MockFixtureBackend, MockGeneratorBackend, _MockBackendBase
    from planner_lib.storage.memory_backend import MemoryStorage
    from tests.python.azure.test_process_catalogue import catalogue
    from tests.python.azure.test_azure_clients import _linked_client, _linked_item

    stored = catalogue()
    stored['processes'][0]['projects'] = ['A']
    stored['processes'][0]['types'][1]['states'] = [
        {'name': 'Active', 'category': 'InProgress', 'order': 1},
        {'name': 'Closed', 'category': 'Completed', 'order': 2},
        {'name': 'Removed', 'category': 'Removed', 'order': 3},
    ]
    recent = (datetime.now(timezone.utc).date() - timedelta(days=30)).isoformat()
    items = {identity: _linked_item(identity, item_type) for identity, item_type in
             ((1, 'Feature'), (2, 'Feature'), (3, 'Bug'), (4, 'Feature'))}
    items[2].fields.update({'System.State': 'Closed',
                            'Microsoft.VSTS.Common.StateChangeDate': recent})
    items[4].fields['System.State'] = 'Removed'
    storage = MemoryStorage()
    storage.save('config', 'ado_processes', stored)
    plan = {'id': 'plan', 'name': 'Plan', 'type': 'project', 'area_path': 'A\\WrongArea',
            'task_types': ['Feature'], 'closed_history_days': days}
    if kind == 'static':
        path = tmp_path / 'tasks.json'
        path.write_text(json.dumps({plan['area_path']: [
            {'id': str(item.id), 'type': item.fields['System.WorkItemType'],
             'state': item.fields['System.State'], 'stateChangeDate': recent}
            for item in items.values()
        ]}))
        local = StaticBackend(str(path), storage=storage)
    else:
        cls = MockFixtureBackend if kind == 'fixture' else MockGeneratorBackend
        local = cls.__new__(cls)
        _MockBackendBase.__init__(local, 'org', storage, capacity_service=MagicMock(),
                                  team_repository=MagicMock())
        client, wit = _linked_client(items)
        wit.get_work_items.side_effect = lambda ids, **kwargs: [items[identity] for identity in ids]
        wit.query_by_wiql = MagicMock(return_value=SimpleNamespace(
            work_items=[SimpleNamespace(id=identity) for identity in items]))
        client.get_iterations = MagicMock(return_value=[])
        local._client = MagicMock()
        local._client.connect.return_value.__enter__.return_value = client

    tasks = local.fetch_plan_tasks(plan)

    assert {task['id'] for task in tasks} == expected
    assert all(task['process_id'] == 'agile' for task in tasks)


def test_mock_enrichment_failure_aborts_instead_of_returning_partial_results():
    from unittest.mock import MagicMock
    from planner_lib.backend.mock import _MockBackendBase
    backend = _MockBackendBase('org', catalogue_storage(['A']))
    backend._adapter = MagicMock()
    backend._adapter.to_domain.side_effect = ValueError('invalid source payload')
    with pytest.raises(ValueError, match='invalid source payload'):
        backend._enrich([{'id': '1', 'adoProject': 'A', 'type': 'Feature'}],
                        'A\\Team', {}, project_id='plan')


def test_fetch_tasks_returns_both_tasks(backend):
    result = backend.fetch_tasks(AREA, task_types=["Feature", "Epic"])
    ids = {t['id'] for t in result}
    assert ids == {'10', '20'}


def test_fetch_tasks_unknown_area_returns_empty(backend):
    result = backend.fetch_tasks('Unknown\\\\Area', task_types=["Feature", "Epic"])
    assert result == []


def test_fetch_tasks_filter_by_type(backend):
    result = backend.fetch_tasks(AREA, task_types=['Feature'])
    assert all(t['type'] == 'Feature' for t in result)
    assert len(result) == 1
    assert result[0]['id'] == '10'


def test_fetch_tasks_filter_by_type_case_insensitive(backend):
    result = backend.fetch_tasks(AREA, task_types=['feature'])
    assert len(result) == 1


def test_fetch_tasks_active_categories_do_not_require_history(backend):
    result = backend.fetch_tasks(AREA, task_types=['Epic', 'Feature'], closed_history_days=0)
    assert {task['state'] for task in result} == {'Active', 'Resolved'}


def test_fetch_tasks_history_window_keeps_active_categories(backend):
    result = backend.fetch_tasks(AREA, task_types=['Epic', 'Feature'], closed_history_days=30)
    assert len(result) == 2


def test_fetch_tasks_type_filter_with_history_window(backend):
    result = backend.fetch_tasks(AREA, task_types=['Feature'], closed_history_days=30)
    assert len(result) == 1
    assert result[0]['id'] == '10'


def test_fetch_tasks_filter_no_match_returns_empty(backend):
    result = backend.fetch_tasks(AREA, task_types=['Bug'])
    assert result == []


def test_fetch_tasks_each_item_has_required_keys(backend):
    result = backend.fetch_tasks(AREA, task_types=["Feature", "Epic"])
    required = {'id', 'title', 'type', 'state', 'project'}
    for item in result:
        missing = required - item.keys()
        assert not missing, f"Item {item.get('id')} missing keys: {missing}"


def test_fetch_plan_tasks_associates_seeds_without_mutating_source_records(backend):
    plan = {'id': 'configured-plan', 'area_path': AREA,
            'task_types': ['Feature'], 'closed_history_days': 0}

    result = backend.fetch_plan_tasks(plan=plan)

    assert [task['id'] for task in result] == ['10']
    assert result[0]['project'] == 'configured-plan'
    original = backend.fetch_tasks(AREA, task_types=["Feature", "Epic"])
    assert all(task['project'] == 'project-team-a' for task in original)


# ---------------------------------------------------------------------------
# fetch_teams / fetch_plans / fetch_markers / fetch_iterations contract
# ---------------------------------------------------------------------------

def test_fetch_teams_returns_list(backend):
    result = backend.fetch_teams('MyOrg')
    assert isinstance(result, list)


def test_fetch_plans_returns_list(backend):
    result = backend.fetch_plans('MyOrg')
    assert isinstance(result, list)


def test_fetch_markers_returns_list(backend):
    result = backend.fetch_markers(AREA)
    assert isinstance(result, list)


def test_fetch_iterations_returns_dict(backend):
    result = backend.fetch_iterations('MyOrg')
    assert isinstance(result, dict)


# ---------------------------------------------------------------------------
# fetch_history contract
# ---------------------------------------------------------------------------

def test_fetch_history_returns_list(backend):
    result = backend.fetch_history(42)
    assert isinstance(result, list)


# ---------------------------------------------------------------------------
# invalidate_cache contract
# ---------------------------------------------------------------------------

def test_invalidate_cache_returns_dict_with_ok(backend):
    result = backend.invalidate_cache()
    assert isinstance(result, dict)
    assert 'ok' in result
    assert isinstance(result['ok'], bool)


def test_invalidate_cache_has_invalidated_and_errors_keys(backend):
    result = backend.invalidate_cache()
    assert 'invalidated' in result
    assert 'errors' in result
    assert isinstance(result['invalidated'], list)
    assert isinstance(result['errors'], list)


def test_fetch_tasks_still_works_after_invalidate(backend):
    """Invalidating the cache must not break subsequent reads."""
    backend.invalidate_cache()
    result = backend.fetch_tasks(AREA, task_types=["Feature", "Epic"])
    assert len(result) == 2
