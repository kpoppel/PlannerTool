"""Tests for the ADO save → cache eviction behaviour.

After a scenario push (POST /api/tasks), the server must NOT call
coordinator.invalidate_all().  CachingBackend.write_task evicts only the
affected fetch_tasks__* keys, so a full cache flush is unnecessary.
"""
import pytest
from unittest.mock import MagicMock
from starlette.testclient import TestClient


def _make_task_repository(updated=2, errors=None):
    repo = MagicMock()
    repo.write.return_value = {
        'ok': not errors,
        'updated': updated,
        'errors': errors or [],
    }
    return repo


def _make_session_mgr():
    mgr = MagicMock()
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
    """POST /api/tasks must NOT call coordinator.invalidate_all() after a write."""
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
    """Cache must NOT be fully invalidated even when some items have errors."""
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
    """If no items were actually updated, cache invalidation must not be called."""
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
