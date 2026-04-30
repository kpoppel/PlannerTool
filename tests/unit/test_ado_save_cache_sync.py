"""Tests for the ADO save → cache sync behaviour.

After a scenario push (POST /api/tasks), the server must NOT invalidate the
entire cache.  Instead, CachingBackend.write_task patches only the affected
DomainTask entries in-place (write-through patch).  A full cache invalidation
is only warranted when the user explicitly requests a baseline refresh via
the admin UI (POST /api/cache/invalidate).

Concerns covered here:
1. POST /api/tasks does NOT call coordinator.invalidate_all() after a write.
   The CachingBackend handles the targeted patch internally.
2. MemoryCacheManager has a clear() method (bug fix retained).
"""
import pytest
from unittest.mock import MagicMock, patch
from starlette.testclient import TestClient

from planner_lib.storage.memory_backend import MemoryStorage
from planner_lib.storage.memory_cache_manager import MemoryCacheManager


# ---------------------------------------------------------------------------
# Bug 2: MemoryCacheManager.clear(namespace)
# ---------------------------------------------------------------------------

def _make_memory_cache():
    return MemoryCacheManager(size_limit_mb=10)


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


# ---------------------------------------------------------------------------
# Bug 1: POST /tasks must invalidate server-side cache
# ---------------------------------------------------------------------------

def _make_task_repository(updated=2, errors=None):
    """Lightweight TaskRepository stub that mimics write() return shape."""
    from unittest.mock import MagicMock
    repo = MagicMock()
    repo.write.return_value = {
        'ok': not errors,
        'updated': updated,
        'errors': errors or [],
    }
    return repo


def _make_session_mgr():
    mgr = MagicMock()
    # get_val returns 'fake-pat' for 'pat' and 'test@example.com' for 'email'
    def _get_val(sid, key):
        if key == 'email':
            return 'test@example.com'
        return 'fake-pat'
    mgr.get_val.side_effect = _get_val
    return mgr


def _make_cache_coordinator(ok=True):
    coordinator = MagicMock()
    coordinator.invalidate_all.return_value = {
        'ok': ok,
        'invalidated': ['azure_client'],
        'errors': [],
    }
    return coordinator


def test_tasks_update_does_not_invalidate_cache_on_success(client):
    """POST /api/tasks must NOT call coordinator.invalidate_all() after a write.

    The CachingBackend.write_task implementation patches the affected task
    entries in-place, so a full cache flush is unnecessary and wasteful.
    """
    from tests.helpers import register_service_on_client

    task_repo = _make_task_repository(updated=1)
    coordinator = _make_cache_coordinator()
    session_mgr = _make_session_mgr()

    register_service_on_client(client, 'task_repository', task_repo)
    register_service_on_client(client, 'cache_coordinator', coordinator)
    register_service_on_client(client, 'session_manager', session_mgr)

    payload = [{'id': 42, 'start': '2026-01-01', 'end': '2026-03-31'}]
    r = client.post('/api/tasks', json=payload, headers={'X-Session-Id': 'test-session'})

    assert r.status_code == 200
    assert r.json().get('ok') is True
    coordinator.invalidate_all.assert_not_called()


def test_tasks_update_does_not_invalidate_cache_with_partial_errors(client):
    """Cache must NOT be fully invalidated even when some items have errors.
    The write-through patch in CachingBackend handles already-successful items.
    """
    from tests.helpers import register_service_on_client

    task_repo = _make_task_repository(updated=1, errors=['99: bad state'])
    coordinator = _make_cache_coordinator()
    session_mgr = _make_session_mgr()

    register_service_on_client(client, 'task_repository', task_repo)
    register_service_on_client(client, 'cache_coordinator', coordinator)
    register_service_on_client(client, 'session_manager', session_mgr)

    payload = [{'id': 42}, {'id': 99}]
    r = client.post('/api/tasks', json=payload, headers={'X-Session-Id': 'test-session'})

    assert r.status_code == 200
    coordinator.invalidate_all.assert_not_called()


def test_tasks_update_skips_cache_invalidation_when_nothing_updated(client):
    """If no items were actually updated (e.g. empty payload), cache
    invalidation should NOT be called — no point in a no-op round-trip."""
    from tests.helpers import register_service_on_client

    task_repo = _make_task_repository(updated=0)
    coordinator = _make_cache_coordinator()
    session_mgr = _make_session_mgr()

    register_service_on_client(client, 'task_repository', task_repo)
    register_service_on_client(client, 'cache_coordinator', coordinator)
    register_service_on_client(client, 'session_manager', session_mgr)

    r = client.post('/api/tasks', json=[], headers={'X-Session-Id': 'test-session'})

    assert r.status_code == 200
    coordinator.invalidate_all.assert_not_called()
