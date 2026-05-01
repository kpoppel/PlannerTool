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
    return StaticBackend(str(p))


def _make_static_backend_json(tasks, tmp_path):
    """StaticBackend loaded from a JSON file."""
    from planner_lib.backend.static import StaticBackend
    data = {AREA: tasks}
    p = tmp_path / 'tasks.json'
    p.write_text(json.dumps(data))
    return StaticBackend(str(p))


def _make_caching_backend(tasks, tmp_path):
    """CachingBackend wrapping a FakeBackend (disk storage is an in-memory stub)."""
    from tests.fakes.fake_backend import FakeBackend
    from planner_lib.backend.caching import CachingBackend

    inner = FakeBackend()
    inner.set_tasks(AREA, tasks)

    class _MemStorage:
        """Minimal in-memory storage stub for CachingBackend's disk cache."""
        def __init__(self):
            self._store = {}
            self._index = {}

        def load(self, ns, key):
            try:
                return self._store[ns][key]
            except KeyError:
                raise KeyError(key)

        def save(self, ns, key, val, ttl_seconds=None):
            self._store.setdefault(ns, {})[key] = val

        def exists(self, ns, key):
            return ns in self._store and key in self._store[ns]

        def delete(self, ns, key):
            self._store.get(ns, {}).pop(key, None)

        def list_keys(self, ns):
            return list(self._store.get(ns, {}).keys())

    return CachingBackend(inner=inner, storage=_MemStorage())


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
    result = backend.fetch_tasks(AREA)
    assert isinstance(result, list)


def test_fetch_tasks_returns_both_tasks(backend):
    result = backend.fetch_tasks(AREA)
    ids = {t['id'] for t in result}
    assert ids == {'10', '20'}


def test_fetch_tasks_unknown_area_returns_empty(backend):
    result = backend.fetch_tasks('Unknown\\\\Area')
    assert result == []


def test_fetch_tasks_filter_by_type(backend):
    result = backend.fetch_tasks(AREA, task_types=['Feature'])
    assert all(t['type'] == 'Feature' for t in result)
    assert len(result) == 1
    assert result[0]['id'] == '10'


def test_fetch_tasks_filter_by_type_case_insensitive(backend):
    result = backend.fetch_tasks(AREA, task_types=['feature'])
    assert len(result) == 1


def test_fetch_tasks_filter_by_state(backend):
    result = backend.fetch_tasks(AREA, include_states=['Active'])
    assert all(t['state'] == 'Active' for t in result)
    assert len(result) == 1


def test_fetch_tasks_filter_by_state_case_insensitive(backend):
    result = backend.fetch_tasks(AREA, include_states=['active'])
    assert len(result) == 1


def test_fetch_tasks_filter_type_and_state_combined(backend):
    """Both filters applied together — only items matching both survive."""
    result = backend.fetch_tasks(AREA, task_types=['Feature'], include_states=['Active'])
    assert len(result) == 1
    assert result[0]['id'] == '10'


def test_fetch_tasks_filter_no_match_returns_empty(backend):
    result = backend.fetch_tasks(AREA, task_types=['UserStory'])
    assert result == []


def test_fetch_tasks_each_item_has_required_keys(backend):
    result = backend.fetch_tasks(AREA)
    required = {'id', 'title', 'type', 'state', 'project'}
    for item in result:
        missing = required - item.keys()
        assert not missing, f"Item {item.get('id')} missing keys: {missing}"


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
    result = backend.fetch_tasks(AREA)
    assert len(result) == 2
