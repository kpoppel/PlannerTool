"""Integration tests for the /api/events REST endpoints.

Uses the shared ``client`` and ``app`` fixtures from tests/conftest.py.
Session auth is handled by the autouse ``ensure_test_sessions`` fixture which
makes any session ID valid — tests just pass ``{'X-Session-Id': 'test'}``.
Storage is cleared between tests by the autouse ``isolate_storage`` fixture.
"""
from __future__ import annotations

import pytest

_HEADERS = {'X-Session-Id': 'test-session'}
_VALID_EVENT = {'date': '2026-05-01', 'title': 'Sprint Demo', 'plan_id': 'plan-42'}


# ---------------------------------------------------------------------------
# CRUD happy path
# ---------------------------------------------------------------------------

def test_list_events_empty_initially(client):
    resp = client.get('/api/events', headers=_HEADERS)
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_event_returns_201_with_id(client):
    resp = client.post('/api/events', json=_VALID_EVENT, headers=_HEADERS)
    assert resp.status_code == 201
    body = resp.json()
    assert body['date'] == '2026-05-01'
    assert body['title'] == 'Sprint Demo'
    assert body['plan_id'] == 'plan-42'
    assert 'id' in body


def test_created_event_appears_in_list(client):
    client.post('/api/events', json=_VALID_EVENT, headers=_HEADERS)
    resp = client.get('/api/events', headers=_HEADERS)
    assert resp.status_code == 200
    events = resp.json()
    assert len(events) == 1
    assert events[0]['title'] == 'Sprint Demo'


def test_get_event_by_id(client):
    created = client.post('/api/events', json=_VALID_EVENT, headers=_HEADERS).json()
    resp = client.get(f'/api/events/{created["id"]}', headers=_HEADERS)
    assert resp.status_code == 200
    assert resp.json() == created


def test_get_missing_event_returns_404(client):
    resp = client.get('/api/events/no-such-id', headers=_HEADERS)
    assert resp.status_code == 404


def test_update_event_date(client):
    created = client.post('/api/events', json=_VALID_EVENT, headers=_HEADERS).json()
    resp = client.put(
        f'/api/events/{created["id"]}',
        json={'date': '2026-09-15'},
        headers=_HEADERS,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body['date'] == '2026-09-15'
    assert body['title'] == 'Sprint Demo'   # unchanged
    assert body['plan_id'] == 'plan-42'     # unchanged


def test_update_event_title(client):
    created = client.post('/api/events', json=_VALID_EVENT, headers=_HEADERS).json()
    resp = client.put(
        f'/api/events/{created["id"]}',
        json={'title': 'New Title'},
        headers=_HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json()['title'] == 'New Title'


def test_update_event_plan_id(client):
    created = client.post('/api/events', json=_VALID_EVENT, headers=_HEADERS).json()
    resp = client.put(
        f'/api/events/{created["id"]}',
        json={'plan_id': 'plan-99'},
        headers=_HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json()['plan_id'] == 'plan-99'


def test_update_missing_event_returns_404(client):
    created = client.post('/api/events', json=_VALID_EVENT, headers=_HEADERS).json()
    # Delete it first so the ID is gone, then try to update
    client.delete(f'/api/events/{created["id"]}', headers=_HEADERS)
    resp = client.put(f'/api/events/{created["id"]}', json={'title': 'X'}, headers=_HEADERS)
    assert resp.status_code == 404


def test_delete_event(client):
    created = client.post('/api/events', json=_VALID_EVENT, headers=_HEADERS).json()
    resp = client.delete(f'/api/events/{created["id"]}', headers=_HEADERS)
    assert resp.status_code == 200
    assert resp.json() == {'ok': True, 'id': created['id']}

    list_resp = client.get('/api/events', headers=_HEADERS)
    assert list_resp.json() == []


def test_delete_missing_event_returns_404(client):
    resp = client.delete('/api/events/no-such-id', headers=_HEADERS)
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# plan_id filter
# ---------------------------------------------------------------------------

def test_list_events_filtered_by_plan_id(client):
    client.post('/api/events', json={**_VALID_EVENT, 'plan_id': 'plan-A'}, headers=_HEADERS)
    client.post('/api/events', json={**_VALID_EVENT, 'plan_id': 'plan-A'}, headers=_HEADERS)
    client.post('/api/events', json={**_VALID_EVENT, 'plan_id': 'plan-B'}, headers=_HEADERS)

    resp_a = client.get('/api/events?plan_id=plan-A', headers=_HEADERS)
    assert resp_a.status_code == 200
    assert len(resp_a.json()) == 2

    resp_b = client.get('/api/events?plan_id=plan-B', headers=_HEADERS)
    assert resp_b.status_code == 200
    assert len(resp_b.json()) == 1

    resp_all = client.get('/api/events', headers=_HEADERS)
    assert len(resp_all.json()) == 3


# ---------------------------------------------------------------------------
# Input validation (create)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize('payload,expected_status', [
    ({'date': 'not-a-date', 'title': 'T', 'plan_id': 'p'}, 422),
    ({'date': '2026-05-01', 'title': '', 'plan_id': 'p'}, 422),
    ({'date': '2026-05-01', 'title': 'T', 'plan_id': ''}, 422),
    ({'date': '2026-05-01', 'title': 'T'}, 422),           # missing plan_id
    ({'title': 'T', 'plan_id': 'p'}, 422),                 # missing date
    ({}, 422),
])
def test_create_event_invalid_payload(client, payload, expected_status):
    resp = client.post('/api/events', json=payload, headers=_HEADERS)
    assert resp.status_code == expected_status


# ---------------------------------------------------------------------------
# Category field
# ---------------------------------------------------------------------------

def test_create_event_default_category_is_empty(client):
    resp = client.post('/api/events', json=_VALID_EVENT, headers=_HEADERS)
    assert resp.status_code == 201
    assert resp.json()['category'] == ''


@pytest.mark.parametrize('category', ['Q', 'Bundle', 'Other', 'MyCustomCat'])
def test_create_event_valid_categories(client, category):
    payload = {**_VALID_EVENT, 'category': category}
    resp = client.post('/api/events', json=payload, headers=_HEADERS)
    assert resp.status_code == 201
    assert resp.json()['category'] == category


def test_update_event_category(client):
    created = client.post('/api/events', json={**_VALID_EVENT, 'category': 'Other'}, headers=_HEADERS).json()
    resp = client.put(f'/api/events/{created["id"]}', json={'category': 'Q'}, headers=_HEADERS)
    assert resp.status_code == 200
    assert resp.json()['category'] == 'Q'


# ---------------------------------------------------------------------------
# Input validation (update)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize('patch', [
    {'date': 'bad-date'},
    {'title': ''},
    {'title': '   '},
    {'plan_id': ''},
    {'plan_id': '   '},
])
def test_update_event_invalid_payload(client, patch):
    created = client.post('/api/events', json=_VALID_EVENT, headers=_HEADERS).json()
    resp = client.put(f'/api/events/{created["id"]}', json=patch, headers=_HEADERS)
    assert resp.status_code == 422

