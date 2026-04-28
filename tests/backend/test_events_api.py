"""Integration tests for the /api/events REST endpoints.

Uses the shared `client` and `app` fixtures from tests/conftest.py.
The events_storage is backed by the same in-memory backend used across
the test session, which is cleared between tests by the autouse
`isolate_storage` fixture.

All endpoints require an active session; a `session_headers` fixture
creates a minimal account + session before each test.
"""
from __future__ import annotations

import pytest
from contextlib import contextmanager


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

@contextmanager
def _noop_lock(*args, **kwargs):
    yield


@pytest.fixture(autouse=True)
def patch_lock(monkeypatch):
    """Patch file-based locking to a no-op for in-memory test runs."""
    monkeypatch.setattr('planner_lib.events.event_store._register_lock', _noop_lock)


@pytest.fixture()
def session_headers(client):
    """Create a minimal account + session and return the required headers."""
    email = 'events-tester@example.com'
    client.post('/api/account', json={'email': email, 'pat': 'test-token'})
    resp = client.post('/api/session', json={'email': email})
    assert resp.status_code == 200
    sid = resp.json()['sessionId']
    # Inject session into the session manager's in-memory store
    try:
        session_mgr = client.app.state.container.get('session_manager')
        session_mgr._store[sid] = {'email': email, 'pat': 'test-token'}
    except Exception:
        pass
    return {'X-Session-Id': sid}


_VALID_EVENT = {'date': '2026-05-01', 'title': 'Sprint Demo', 'plan_id': 'plan-42'}


# ---------------------------------------------------------------------------
# CRUD happy path
# ---------------------------------------------------------------------------

def test_list_events_empty_initially(client, session_headers):
    resp = client.get('/api/events', headers=session_headers)
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_event_returns_201_with_id(client, session_headers):
    resp = client.post('/api/events', json=_VALID_EVENT, headers=session_headers)
    assert resp.status_code == 201
    body = resp.json()
    assert body['date'] == '2026-05-01'
    assert body['title'] == 'Sprint Demo'
    assert body['plan_id'] == 'plan-42'
    assert 'id' in body


def test_created_event_appears_in_list(client, session_headers):
    client.post('/api/events', json=_VALID_EVENT, headers=session_headers)
    resp = client.get('/api/events', headers=session_headers)
    assert resp.status_code == 200
    events = resp.json()
    assert len(events) == 1
    assert events[0]['title'] == 'Sprint Demo'


def test_get_event_by_id(client, session_headers):
    created = client.post('/api/events', json=_VALID_EVENT, headers=session_headers).json()
    resp = client.get(f'/api/events/{created["id"]}', headers=session_headers)
    assert resp.status_code == 200
    assert resp.json() == created


def test_get_missing_event_returns_error(app, session_headers):
    from fastapi.testclient import TestClient
    c = TestClient(app, raise_server_exceptions=False)
    resp = c.get('/api/events/no-such-id', headers=session_headers)
    assert resp.status_code >= 400


def test_update_event_date(client, session_headers):
    created = client.post('/api/events', json=_VALID_EVENT, headers=session_headers).json()
    resp = client.put(
        f'/api/events/{created["id"]}',
        json={'date': '2026-09-15'},
        headers=session_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body['date'] == '2026-09-15'
    assert body['title'] == 'Sprint Demo'   # unchanged
    assert body['plan_id'] == 'plan-42'     # unchanged


def test_update_event_title(client, session_headers):
    created = client.post('/api/events', json=_VALID_EVENT, headers=session_headers).json()
    resp = client.put(
        f'/api/events/{created["id"]}',
        json={'title': 'New Title'},
        headers=session_headers,
    )
    assert resp.status_code == 200
    assert resp.json()['title'] == 'New Title'


def test_update_event_plan_id(client, session_headers):
    created = client.post('/api/events', json=_VALID_EVENT, headers=session_headers).json()
    resp = client.put(
        f'/api/events/{created["id"]}',
        json={'plan_id': 'plan-99'},
        headers=session_headers,
    )
    assert resp.status_code == 200
    assert resp.json()['plan_id'] == 'plan-99'


def test_update_missing_event_returns_error(app, session_headers):
    from fastapi.testclient import TestClient
    c = TestClient(app, raise_server_exceptions=False)
    resp = c.put('/api/events/no-such-id', json={'title': 'X'}, headers=session_headers)
    assert resp.status_code >= 400


def test_delete_event(client, session_headers):
    created = client.post('/api/events', json=_VALID_EVENT, headers=session_headers).json()
    resp = client.delete(f'/api/events/{created["id"]}', headers=session_headers)
    assert resp.status_code == 200
    assert resp.json() == {'ok': True, 'id': created['id']}

    # Should no longer appear in list
    list_resp = client.get('/api/events', headers=session_headers)
    assert list_resp.json() == []


def test_delete_missing_event_returns_error(app, session_headers):
    from fastapi.testclient import TestClient
    c = TestClient(app, raise_server_exceptions=False)
    resp = c.delete('/api/events/no-such-id', headers=session_headers)
    assert resp.status_code >= 400


# ---------------------------------------------------------------------------
# plan_id filter
# ---------------------------------------------------------------------------

def test_list_events_filtered_by_plan_id(client, session_headers):
    client.post('/api/events', json={**_VALID_EVENT, 'plan_id': 'plan-A'}, headers=session_headers)
    client.post('/api/events', json={**_VALID_EVENT, 'plan_id': 'plan-A'}, headers=session_headers)
    client.post('/api/events', json={**_VALID_EVENT, 'plan_id': 'plan-B'}, headers=session_headers)

    resp_a = client.get('/api/events?plan_id=plan-A', headers=session_headers)
    assert resp_a.status_code == 200
    assert len(resp_a.json()) == 2

    resp_b = client.get('/api/events?plan_id=plan-B', headers=session_headers)
    assert resp_b.status_code == 200
    assert len(resp_b.json()) == 1

    resp_all = client.get('/api/events', headers=session_headers)
    assert len(resp_all.json()) == 3


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------

@pytest.mark.parametrize('payload,expected_status', [
    ({'date': 'not-a-date', 'title': 'T', 'plan_id': 'p'}, 422),
    ({'date': '2026-05-01', 'title': '', 'plan_id': 'p'}, 422),
    ({'date': '2026-05-01', 'title': 'T', 'plan_id': ''}, 422),
    ({'date': '2026-05-01', 'title': 'T'}, 422),           # missing plan_id
    ({'title': 'T', 'plan_id': 'p'}, 422),                 # missing date
    ({}, 422),
])
def test_create_event_invalid_payload(client, session_headers, payload, expected_status):
    resp = client.post('/api/events', json=payload, headers=session_headers)
    assert resp.status_code == expected_status


@pytest.mark.parametrize('payload', [
    {'date': 'bad-date'},
    {'title': ''},
    {'title': '   '},
    {'plan_id': ''},
    {'plan_id': '   '},
])
def test_update_event_invalid_payload(client, session_headers, payload):
    created = client.post('/api/events', json=_VALID_EVENT, headers=session_headers).json()
    resp = client.put(f'/api/events/{created["id"]}', json=payload, headers=session_headers)
    assert resp.status_code == 422
