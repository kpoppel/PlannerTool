"""Unit tests specific to CachingBackend.

Contract behaviour (fetch_tasks returns correct items etc.) is covered by
test_backend_contract.py.  These tests focus on caching semantics:

- Cache miss delegates to inner backend
- Cache hit does NOT call inner backend again
- write_task invalidates the cache (next fetch re-queries inner)
- invalidate_cache clears all entries; next fetch re-queries inner
- Memory cache layer is populated on miss and consulted on subsequent reads
- CachingBackend wraps any inner BackendPort (structural tests)
"""
from __future__ import annotations

import pytest
from datetime import timedelta

from tests.fakes.fake_backend import FakeBackend

AREA = 'MyOrg\\\\TeamA'
AREA_B = 'MyOrg\\\\TeamB'
CRED = {'token': 'tok', 'user_id': 'u@example.com'}

_TASK = {'id': '1', 'title': 'T', 'type': 'Feature', 'state': 'Active',
         'project': 'p', 'relations': [], 'capacity': []}


# ---------------------------------------------------------------------------
# Minimal in-memory storage stub
# ---------------------------------------------------------------------------

class _InMemStorage:
    """Disk-cache stub — stores entries in a plain dict."""

    def __init__(self):
        self._store: dict = {}
        # Timestamps stored separately (CacheManager uses a dedicated key)

    def load(self, ns, key):
        try:
            return self._store[ns][key]
        except KeyError:
            raise KeyError(key)

    def save(self, ns, key, val):
        self._store.setdefault(ns, {})[key] = val

    def exists(self, ns, key):
        return ns in self._store and key in self._store[ns]

    def delete(self, ns, key):
        self._store.get(ns, {}).pop(key, None)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def inner():
    b = FakeBackend()
    b.set_tasks(AREA, [dict(_TASK)])
    b.set_tasks(AREA_B, [dict(_TASK, id='2', title='T2')])
    return b


@pytest.fixture
def storage():
    return _InMemStorage()


@pytest.fixture
def caching(inner, storage):
    from planner_lib.backend.caching import CachingBackend, CacheTTLConfig
    # Long TTL so items are never stale during a single test run
    ttl = CacheTTLConfig(default=timedelta(hours=1), fetch_tasks=timedelta(hours=1),
                         fetch_history=timedelta(hours=1), fetch_teams=timedelta(hours=1),
                         fetch_plans=timedelta(hours=1), fetch_markers=timedelta(hours=1),
                         fetch_iterations=timedelta(hours=1))
    return CachingBackend(inner=inner, storage=storage, ttl_config=ttl)


# ---------------------------------------------------------------------------
# Cache miss / hit semantics
# ---------------------------------------------------------------------------

def test_first_fetch_delegates_to_inner(caching, inner):
    result = caching.fetch_tasks(AREA)
    assert len(result) == 1
    assert len(inner.fetch_tasks_calls) == 1


def test_second_fetch_served_from_cache(caching, inner):
    caching.fetch_tasks(AREA)          # miss → populates cache
    caching.fetch_tasks(AREA)          # hit  → no new inner call
    assert len(inner.fetch_tasks_calls) == 1


def test_different_type_filter_is_separate_cache_key(caching, inner):
    caching.fetch_tasks(AREA, task_types=['Feature'])
    caching.fetch_tasks(AREA, task_types=['Epic'])
    # Both are misses because the key includes the type filter
    assert len(inner.fetch_tasks_calls) == 2


def test_different_state_filter_is_separate_cache_key(caching, inner):
    caching.fetch_tasks(AREA, include_states=['Active'])
    caching.fetch_tasks(AREA, include_states=['Closed'])
    assert len(inner.fetch_tasks_calls) == 2


def test_different_area_is_separate_cache_key(caching, inner):
    caching.fetch_tasks(AREA)
    caching.fetch_tasks(AREA_B)
    assert len(inner.fetch_tasks_calls) == 2


# ---------------------------------------------------------------------------
# Write-through: cache patch (not invalidation)
# ---------------------------------------------------------------------------

def test_write_task_patches_cache_in_place(caching, inner):
    """After a successful write, the cached task list is updated immediately.

    The subsequent fetch_tasks call must be served from cache (inner is NOT
    called again) and the returned task must reflect the written state.
    """
    caching.fetch_tasks(AREA)          # populate cache
    assert len(inner.fetch_tasks_calls) == 1

    caching.write_task(1, {'state': 'Closed'}, CRED)

    # Cache should be HIT — inner must NOT be called a second time
    tasks = caching.fetch_tasks(AREA)
    assert len(inner.fetch_tasks_calls) == 1, \
        "fetch_tasks should be a cache hit after a write-through patch"

    # The patched task must reflect the update
    patched = next((t for t in tasks if str(t.get('id')) == '1'), None)
    assert patched is not None, "task 1 should still be in the cached list"
    assert patched['state'] == 'Closed', "patched task must carry the new state"


def test_write_task_unknown_id_does_not_crash(caching, inner):
    """Writing an ID that is not cached is silently a no-op for the cache."""
    caching.fetch_tasks(AREA)
    caching.write_task(9999, {'state': 'Closed'}, CRED)  # ID not in cache
    tasks = caching.fetch_tasks(AREA)
    assert len(inner.fetch_tasks_calls) == 1  # still a cache hit


def test_write_task_result_is_forwarded(caching, inner):
    result = caching.write_task(1, {'state': 'Closed'}, CRED)
    assert result['ok'] is True
    assert result['updated'] == 1


def test_write_task_error_propagates(inner, storage):
    """CachingBackend does not swallow exceptions from the inner backend."""
    from planner_lib.backend.caching import CachingBackend
    bad_inner = FakeBackend(raise_on_write=True)
    caching = CachingBackend(inner=bad_inner, storage=storage)
    with pytest.raises(RuntimeError):
        caching.write_task(1, {}, CRED)


# ---------------------------------------------------------------------------
# invalidate_cache
# ---------------------------------------------------------------------------

def test_invalidate_cache_forces_fresh_fetch(caching, inner):
    caching.fetch_tasks(AREA)          # populate
    assert len(inner.fetch_tasks_calls) == 1

    caching.invalidate_cache()

    caching.fetch_tasks(AREA)          # must miss again
    assert len(inner.fetch_tasks_calls) == 2


def test_invalidate_cache_returns_expected_shape(caching):
    result = caching.invalidate_cache()
    assert 'ok' in result
    assert 'invalidated' in result
    assert 'errors' in result


# ---------------------------------------------------------------------------
# Delegation of non-cached methods
# ---------------------------------------------------------------------------

def test_fetch_history_delegated_to_inner(caching, inner):
    from planner_lib.domain.history import DomainHistoryEntry
    entry = DomainHistoryEntry(field='start', value='2026-01-01',
                               changed_at='2026-01-02', changed_by='u')
    inner.set_history(42, [entry])
    result = caching.fetch_history(42)
    assert len(result) == 1
    assert result[0]['field'] == 'start'


def test_fetch_teams_delegated_to_inner(caching, inner):
    inner.set_teams('ProjectX', [{'id': 't1', 'name': 'Arch'}])
    result = caching.fetch_teams('ProjectX')
    assert result == [{'id': 't1', 'name': 'Arch'}]


def test_fetch_plans_delegated_to_inner(caching, inner):
    inner.set_plans('ProjectX', [{'id': 'p1', 'name': 'Q1'}])
    result = caching.fetch_plans('ProjectX')
    assert result == [{'id': 'p1', 'name': 'Q1'}]


def test_fetch_markers_delegated_to_inner(caching, inner):
    # FakeBackend always returns [] for markers; just confirm no exception
    result = caching.fetch_markers(AREA)
    assert isinstance(result, list)


def test_fetch_iterations_delegated_to_inner(caching, inner):
    inner.set_iterations('ProjectX', {'S1': {'startDate': '2026-01-01'}})
    result = caching.fetch_iterations('ProjectX')
    assert 'S1' in result


# ---------------------------------------------------------------------------
# Memory cache layer
# ---------------------------------------------------------------------------

class _RecordingMemCache:
    """Records read/write calls; delegates reads to an internal dict."""

    def __init__(self):
        self._store: dict = {}
        self.reads: int = 0
        self.writes: int = 0

    def read(self, ns, key):
        self.reads += 1
        return self._store.get(ns, {}).get(key)

    def write(self, ns, key, val):
        self.writes += 1
        self._store.setdefault(ns, {})[key] = val

    def delete(self, ns, key):
        self._store.get(ns, {}).pop(key, None)


def test_memory_cache_populated_on_miss(inner, storage):
    from planner_lib.backend.caching import CachingBackend
    from planner_lib.backend.caching import CacheTTLConfig
    mem = _RecordingMemCache()
    ttl = CacheTTLConfig(default=timedelta(hours=1), fetch_tasks=timedelta(hours=1),
                         fetch_history=timedelta(hours=1), fetch_teams=timedelta(hours=1),
                         fetch_plans=timedelta(hours=1), fetch_markers=timedelta(hours=1),
                         fetch_iterations=timedelta(hours=1))
    caching = CachingBackend(inner=inner, storage=storage, memory_cache=mem,
                             ttl_config=ttl)

    caching.fetch_tasks(AREA)
    # After a miss, result is written to memory cache
    assert mem.writes > 0


def test_memory_cache_hit_skips_disk_and_inner(inner, storage):
    from planner_lib.backend.caching import CachingBackend
    from planner_lib.backend.caching import CacheTTLConfig
    mem = _RecordingMemCache()
    ttl = CacheTTLConfig(default=timedelta(hours=1), fetch_tasks=timedelta(hours=1),
                         fetch_history=timedelta(hours=1), fetch_teams=timedelta(hours=1),
                         fetch_plans=timedelta(hours=1), fetch_markers=timedelta(hours=1),
                         fetch_iterations=timedelta(hours=1))
    caching = CachingBackend(inner=inner, storage=storage, memory_cache=mem,
                             ttl_config=ttl)

    caching.fetch_tasks(AREA)   # miss → populate both disk and memory
    inner_calls_after_first = len(inner.fetch_tasks_calls)

    caching.fetch_tasks(AREA)   # should serve from memory, inner NOT called
    assert len(inner.fetch_tasks_calls) == inner_calls_after_first
