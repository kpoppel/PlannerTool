"""Integration tests for the /api/groups REST endpoints.

Uses the shared ``client`` and ``app`` fixtures from tests/conftest.py.
Session auth is handled by the autouse ``ensure_test_sessions`` fixture.
Storage is cleared between tests by the autouse ``isolate_storage`` fixture.
"""
from __future__ import annotations

import pytest

_HEADERS = {'X-Session-Id': 'test-session'}
_VALID_GROUP = {'plan_id': 'plan-42', 'name': 'Before June'}


# ---------------------------------------------------------------------------
# CRUD happy path
# ---------------------------------------------------------------------------

def test_list_groups_empty_initially(client):
    resp = client.get('/api/groups', headers=_HEADERS)
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_group_returns_201_with_id(client):
    resp = client.post('/api/groups', json=_VALID_GROUP, headers=_HEADERS)
    assert resp.status_code == 201
    body = resp.json()
    assert body['plan_id'] == 'plan-42'
    assert body['name'] == 'Before June'
    assert 'id' in body


def test_created_group_appears_in_list(client):
    client.post('/api/groups', json=_VALID_GROUP, headers=_HEADERS)
    resp = client.get('/api/groups', headers=_HEADERS)
    assert resp.status_code == 200
    groups = resp.json()
    assert len(groups) == 1
    assert groups[0]['name'] == 'Before June'


def test_get_group_by_id(client):
    created = client.post('/api/groups', json=_VALID_GROUP, headers=_HEADERS).json()
    resp = client.get(f'/api/groups/{created["id"]}', headers=_HEADERS)
    assert resp.status_code == 200
    assert resp.json() == created


def test_get_missing_group_returns_404(client):
    resp = client.get('/api/groups/no-such-id', headers=_HEADERS)
    assert resp.status_code == 404


def test_update_group_name(client):
    created = client.post('/api/groups', json=_VALID_GROUP, headers=_HEADERS).json()
    resp = client.put(
        f'/api/groups/{created["id"]}',
        json={'name': 'After July'},
        headers=_HEADERS,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body['name'] == 'After July'
    assert body['plan_id'] == 'plan-42'  # unchanged


def test_update_group_color(client):
    created = client.post('/api/groups', json=_VALID_GROUP, headers=_HEADERS).json()
    resp = client.put(
        f'/api/groups/{created["id"]}',
        json={'color': '#3b82f6'},
        headers=_HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json()['color'] == '#3b82f6'


def test_update_missing_group_returns_404(client):
    resp = client.put('/api/groups/no-such-id', json={'name': 'X'}, headers=_HEADERS)
    assert resp.status_code == 404


def test_delete_group(client):
    created = client.post('/api/groups', json=_VALID_GROUP, headers=_HEADERS).json()
    resp = client.delete(f'/api/groups/{created["id"]}', headers=_HEADERS)
    assert resp.status_code == 200
    assert resp.json() == {'ok': True, 'id': created['id']}

    list_resp = client.get('/api/groups', headers=_HEADERS)
    assert list_resp.json() == []


def test_delete_missing_group_returns_404(client):
    from fastapi.exceptions import HTTPException
    with pytest.raises(HTTPException) as exc_info:
        client.delete('/api/groups/no-such-id', headers=_HEADERS)
    assert exc_info.value.status_code == 404


# ---------------------------------------------------------------------------
# plan_id filter
# ---------------------------------------------------------------------------

def test_list_groups_filtered_by_plan_id(client):
    client.post('/api/groups', json={**_VALID_GROUP, 'plan_id': 'plan-A'}, headers=_HEADERS)
    client.post('/api/groups', json={**_VALID_GROUP, 'plan_id': 'plan-A'}, headers=_HEADERS)
    client.post('/api/groups', json={**_VALID_GROUP, 'plan_id': 'plan-B'}, headers=_HEADERS)

    resp_a = client.get('/api/groups?plan_id=plan-A', headers=_HEADERS)
    assert resp_a.status_code == 200
    assert len(resp_a.json()) == 2

    resp_b = client.get('/api/groups?plan_id=plan-B', headers=_HEADERS)
    assert resp_b.status_code == 200
    assert len(resp_b.json()) == 1

    resp_all = client.get('/api/groups', headers=_HEADERS)
    assert len(resp_all.json()) == 3


# ---------------------------------------------------------------------------
# Sub-group support
# ---------------------------------------------------------------------------

def test_create_subgroup(client):
    parent = client.post('/api/groups', json=_VALID_GROUP, headers=_HEADERS).json()
    sub = client.post(
        '/api/groups',
        json={**_VALID_GROUP, 'name': 'Sub-group', 'parent_id': parent['id']},
        headers=_HEADERS,
    ).json()
    assert sub['parent_id'] == parent['id']


def test_delete_parent_cascades_subgroups(client):
    parent = client.post('/api/groups', json=_VALID_GROUP, headers=_HEADERS).json()
    client.post(
        '/api/groups',
        json={**_VALID_GROUP, 'name': 'Sub1', 'parent_id': parent['id']},
        headers=_HEADERS,
    )
    client.post(
        '/api/groups',
        json={**_VALID_GROUP, 'name': 'Sub2', 'parent_id': parent['id']},
        headers=_HEADERS,
    )
    # 3 groups total before delete
    assert len(client.get('/api/groups', headers=_HEADERS).json()) == 3

    resp = client.delete(f'/api/groups/{parent["id"]}', headers=_HEADERS)
    assert resp.status_code == 200
    # All 3 should be gone
    assert client.get('/api/groups', headers=_HEADERS).json() == []


# ---------------------------------------------------------------------------
# Input validation (create)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize('payload,expected_status', [
    ({'plan_id': '', 'name': 'G'}, 422),        # empty plan_id
    ({'plan_id': 'p', 'name': ''}, 422),         # empty name
    ({'plan_id': 'p', 'name': 'G', 'color': 'red'}, 422),  # color without #
    ({'name': 'G'}, 422),                        # missing plan_id
    ({}, 422),
])
def test_create_group_invalid_payload(client, payload, expected_status):
    resp = client.post('/api/groups', json=payload, headers=_HEADERS)
    assert resp.status_code == expected_status


# ---------------------------------------------------------------------------
# Input validation (update)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize('patch', [
    {'name': ''},
    {'name': '   '},
    {'color': 'notahex'},
])
def test_update_group_invalid_payload(client, patch):
    created = client.post('/api/groups', json=_VALID_GROUP, headers=_HEADERS).json()
    resp = client.put(f'/api/groups/{created["id"]}', json=patch, headers=_HEADERS)
    assert resp.status_code == 422
