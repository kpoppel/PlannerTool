"""Tests for the ADO save → cache invalidation → baseline sync bug fix.

Three bugs:
1. POST /tasks did not invalidate server-side cache after writing to ADO.
2. MemoryCacheManager had no clear() method, so invalidate_all_caches() raised
   AttributeError when memory cache was enabled, leaving stale data in memory.
3. Client _onSaveToAzure did not trigger a baseline refresh after publishing.

These tests cover bugs 1 and 2 (server-side, Python).  Bug 3 is covered by
the JavaScript test suite (tests/services/ScenarioMenu.test.js).
"""
import pytest
from unittest.mock import MagicMock, patch
from starlette.testclient import TestClient

from planner_lib.storage.memory_backend import MemoryStorage
from planner_lib.storage.memory_cache_manager import MemoryCacheManager


# ---------------------------------------------------------------------------
# Bug 2: MemoryCacheManager.clear(namespace)
# ---------------------------------------------------------------------------

class _FakeDiskCache:
    """Minimal disk-cache stub for MemoryCacheManager constructor."""

    def __init__(self):
        self._store = {}

    def save(self, ns, key, val):
        self._store.setdefault(ns, {})[key] = val

    def load(self, ns, key):
        return self._store.get(ns, {}).get(key)

    def exists(self, ns, key):
        return ns in self._store and key in self._store[ns]

    def delete(self, ns, key):
        self._store.get(ns, {}).pop(key, None)


def _make_memory_cache():
    return MemoryCacheManager(disk_cache=_FakeDiskCache(), size_limit_mb=10, staleness_seconds=300)


def test_memory_cache_clear_removes_all_namespace_entries():
    """clear(namespace) must remove every entry in the given namespace."""
    mc = _make_memory_cache()
    mc.write('ns_a', 'key1', [1, 2, 3])
    mc.write('ns_a', 'key2', {'x': 1})
    mc.write('ns_b', 'other', 'keep_me')

    count = mc.clear('ns_a')

    assert mc.read('ns_a', 'key1') is None
    assert mc.read('ns_a', 'key2') is None
    assert count == 2, f"expected 2 items cleared, got {count}"


def test_memory_cache_clear_preserves_other_namespaces():
    """clear(namespace) must NOT touch entries in other namespaces."""
    mc = _make_memory_cache()
    mc.write('ns_a', 'key1', 'data')
    mc.write('ns_b', 'key2', 'keep')

    mc.clear('ns_a')

    assert mc.read('ns_b', 'key2') == 'keep'


def test_memory_cache_clear_empty_namespace_returns_zero():
    """Clearing an empty namespace should return 0 without error."""
    mc = _make_memory_cache()
    count = mc.clear('nonexistent')
    assert count == 0


def test_invalidate_all_caches_succeeds_with_memory_cache():
    """AzureCachingClient.invalidate_all_caches() must not raise when memory
    cache is present – verifies that clear() is callable."""
    from planner_lib.azure.AzureCachingClient import AzureCachingClient

    storage = MemoryStorage()
    mc = _make_memory_cache()

    client = AzureCachingClient('https://dev.azure.com/org', storage, memory_cache=mc)

    # Pre-populate some entries so there is something to clear
    mc.write('azure_workitems', 'some_area', [{'id': '1'}])
    client._cache.write('some_area', [{'id': '1'}])
    client._cache.update_timestamp('some_area')

    # Should not raise AttributeError
    result = client.invalidate_all_caches()

    assert result.get('ok') is True
    # memory_cleared should be non-negative (at least 1 item was present)
    assert result.get('memory_cleared', -1) >= 0


# ---------------------------------------------------------------------------
# Bug 1: POST /tasks must invalidate server-side cache
# ---------------------------------------------------------------------------

def _make_task_update_svc(updated=2, errors=None):
    svc = MagicMock()
    svc.update_tasks.return_value = {
        'ok': not errors,
        'updated': updated,
        'errors': errors or [],
    }
    return svc


def _make_session_mgr():
    mgr = MagicMock()
    mgr.get_val.return_value = 'fake-pat'
    return mgr


def _make_cache_coordinator(ok=True):
    coordinator = MagicMock()
    coordinator.invalidate_all.return_value = {
        'ok': ok,
        'invalidated': ['azure_client'],
        'errors': [],
    }
    return coordinator


def test_tasks_update_invalidates_cache_on_success(client):
    """POST /api/tasks must call coordinator.invalidate_all() after a
    successful task update so the server cache stays in sync with ADO."""
    from tests.helpers import register_service_on_client

    task_svc = _make_task_update_svc(updated=1)
    coordinator = _make_cache_coordinator()
    session_mgr = _make_session_mgr()

    register_service_on_client(client, 'task_update_service', task_svc)
    register_service_on_client(client, 'cache_coordinator', coordinator)
    register_service_on_client(client, 'session_manager', session_mgr)

    payload = [{'id': 42, 'start': '2026-01-01', 'end': '2026-03-31'}]
    r = client.post('/api/tasks', json=payload, headers={'X-Session-Id': 'test-session'})

    assert r.status_code == 200
    assert r.json().get('ok') is True
    coordinator.invalidate_all.assert_called_once()


def test_tasks_update_invalidates_cache_even_with_partial_errors(client):
    """Cache must be invalidated even when some items returned errors, because
    the successful items were already written to ADO."""
    from tests.helpers import register_service_on_client

    task_svc = _make_task_update_svc(updated=1, errors=['99: bad state'])
    coordinator = _make_cache_coordinator()
    session_mgr = _make_session_mgr()

    register_service_on_client(client, 'task_update_service', task_svc)
    register_service_on_client(client, 'cache_coordinator', coordinator)
    register_service_on_client(client, 'session_manager', session_mgr)

    payload = [{'id': 42}, {'id': 99}]
    r = client.post('/api/tasks', json=payload, headers={'X-Session-Id': 'test-session'})

    assert r.status_code == 200
    # Cache should still have been invalidated because item 42 was updated
    coordinator.invalidate_all.assert_called_once()


def test_tasks_update_skips_cache_invalidation_when_nothing_updated(client):
    """If no items were actually updated (e.g. empty payload), cache
    invalidation should NOT be called — no point in a no-op round-trip."""
    from tests.helpers import register_service_on_client

    task_svc = _make_task_update_svc(updated=0)
    coordinator = _make_cache_coordinator()
    session_mgr = _make_session_mgr()

    register_service_on_client(client, 'task_update_service', task_svc)
    register_service_on_client(client, 'cache_coordinator', coordinator)
    register_service_on_client(client, 'session_manager', session_mgr)

    r = client.post('/api/tasks', json=[], headers={'X-Session-Id': 'test-session'})

    assert r.status_code == 200
    coordinator.invalidate_all.assert_not_called()
