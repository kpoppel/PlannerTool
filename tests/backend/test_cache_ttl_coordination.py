"""Tests for CachingBackend TTL coordination with diskcache.

Verifies that CachingBackend:
- Passes the correct ttl_seconds to storage.save() for each method
- Serves from cache on a second call (no inner call)
- Evicts fetch_tasks__* entries on write_task success
- Re-fetches from inner after invalidate_cache()
"""
import pytest
from datetime import timedelta
from unittest.mock import MagicMock

from planner_lib.backend.caching import CachingBackend, CacheTTLConfig
from planner_lib.storage.memory_backend import MemoryStorage


def _ttl_config(**overrides) -> CacheTTLConfig:
    """Build a CacheTTLConfig where every field is the given number of minutes."""
    minutes = overrides.pop('minutes', 30)
    td = timedelta(minutes=minutes)
    fields = {f: td for f in
              ['default', 'fetch_tasks', 'fetch_history', 'fetch_teams',
               'fetch_plans', 'fetch_markers', 'fetch_iterations', 'fetch_people']}
    fields.update(overrides)
    return CacheTTLConfig(**fields)


class _TrackingSave(MemoryStorage):
    """MemoryStorage that records the ttl_seconds passed to each save() call."""

    def __init__(self):
        super().__init__()
        self.saved_ttls: dict = {}  # key → ttl_seconds

    def save(self, namespace, key, value, ttl_seconds=None):
        self.saved_ttls[key] = ttl_seconds
        super().save(namespace, key, value, ttl_seconds=ttl_seconds)


AREA = 'MyOrg\\TeamA'
CRED = {'token': 'tok', 'user_id': 'u@example.com'}


def test_fetch_tasks_saved_with_correct_ttl():
    """fetch_tasks persists data without a hard TTL; freshness window lives in the sidecar.

    The single-copy design stores the task list with ``ttl_seconds=None`` so it is
    never silently deleted, and records the configured TTL as a ``fresh_until``
    timestamp in the ``taskmeta__`` sidecar instead.
    """
    import time
    storage = _TrackingSave()
    inner = MagicMock()
    inner.fetch_tasks.return_value = [{'id': '1'}]

    ttl = _ttl_config(minutes=15)
    backend = CachingBackend(inner=inner, storage=storage, ttl_config=ttl)
    before = time.time()
    backend.fetch_tasks(AREA)

    # Data key is persisted without a hard TTL (no shadow copy, never auto-purged).
    task_keys = [k for k in storage.saved_ttls if k.startswith('fetch_tasks__')]
    assert task_keys, "expected at least one fetch_tasks__ key to be written"
    assert storage.saved_ttls[task_keys[0]] is None

    # Freshness window is recorded in the sidecar ~15 minutes ahead.
    meta_keys = [k for k in storage.list_keys('backend_domain') if k.startswith('taskmeta__')]
    assert meta_keys, "expected a taskmeta__ sidecar to be written"
    fresh_until = storage.load('backend_domain', meta_keys[0])['fresh_until']
    assert fresh_until == pytest.approx(before + 15 * 60, abs=5)



def test_fetch_history_saved_with_correct_ttl():
    """storage.save() must receive ttl_seconds matching CacheTTLConfig.fetch_history."""
    storage = _TrackingSave()
    inner = MagicMock()
    inner.fetch_history.return_value = []

    ttl = _ttl_config()
    ttl.fetch_history = timedelta(hours=6)
    backend = CachingBackend(inner=inner, storage=storage, ttl_config=ttl)
    backend.fetch_history(42)

    hist_keys = [k for k in storage.saved_ttls if k.startswith('fetch_history__')]
    assert hist_keys
    assert storage.saved_ttls[hist_keys[0]] == pytest.approx(6 * 3600)


def test_second_call_is_cache_hit():
    """A second fetch_tasks call with the same args must NOT call the inner backend."""
    storage = MemoryStorage()
    inner = MagicMock()
    inner.fetch_tasks.return_value = [{'id': '1'}]

    backend = CachingBackend(inner=inner, storage=storage, ttl_config=_ttl_config())
    backend.fetch_tasks(AREA)
    backend.fetch_tasks(AREA)

    assert inner.fetch_tasks.call_count == 1


def test_different_args_are_separate_cache_keys():
    """Different task_types arguments produce different cache keys."""
    storage = MemoryStorage()
    inner = MagicMock()
    inner.fetch_tasks.return_value = []

    backend = CachingBackend(inner=inner, storage=storage, ttl_config=_ttl_config())
    backend.fetch_tasks(AREA, task_types=['Feature'])
    backend.fetch_tasks(AREA, task_types=['Epic'])

    assert inner.fetch_tasks.call_count == 2


def test_write_task_patches_cache_keeps_it_hot():
    """After write_task the cache stays warm; inner must NOT be called again."""
    storage = MemoryStorage()
    inner = MagicMock()
    inner.fetch_tasks.return_value = [{'id': '1', 'state': 'Active'}]
    inner.write_task.return_value = {'ok': True, 'updated': 1, 'errors': []}

    backend = CachingBackend(inner=inner, storage=storage, ttl_config=_ttl_config())
    backend.fetch_tasks(AREA)          # populate cache
    assert inner.fetch_tasks.call_count == 1

    backend.write_task(1, {'state': 'Closed'}, CRED)

    tasks = backend.fetch_tasks(AREA)  # must be a cache HIT
    assert inner.fetch_tasks.call_count == 1, "inner must not be called after write-through patch"
    patched = next((t for t in tasks if str(t.get('id')) == '1'), None)
    assert patched is not None
    assert patched['state'] == 'Closed'


def test_invalidate_cache_forces_refetch():
    """After invalidate_cache(), the next fetch must call the inner backend."""
    storage = MemoryStorage()
    inner = MagicMock()
    inner.fetch_tasks.return_value = [{'id': '1'}]

    backend = CachingBackend(inner=inner, storage=storage, ttl_config=_ttl_config())
    backend.fetch_tasks(AREA)
    assert inner.fetch_tasks.call_count == 1

    backend.invalidate_cache()

    backend.fetch_tasks(AREA)
    assert inner.fetch_tasks.call_count == 2
