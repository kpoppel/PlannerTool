"""Integration tests for the /api/groups REST endpoints.

Uses the shared ``authenticated_client`` and ``app`` fixtures from tests/conftest.py.
Session cookies are issued through real enrollment; each app owns isolated storage.
"""
from __future__ import annotations

import pytest

_VALID_GROUP = {'plan_id': 'plan-42', 'name': 'Before June'}


# ---------------------------------------------------------------------------
# CRUD happy path
# ---------------------------------------------------------------------------

def test_list_groups_empty_initially(authenticated_client):
    resp = authenticated_client.get('/api/groups')
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_group_returns_201_with_id(authenticated_client):
    resp = authenticated_client.post('/api/groups', json=_VALID_GROUP)
    assert resp.status_code == 201
    body = resp.json()
    assert body['plan_id'] == 'plan-42'
    assert body['name'] == 'Before June'
    assert 'id' in body


def test_created_group_appears_in_list(authenticated_client):
    authenticated_client.post('/api/groups', json=_VALID_GROUP)
    resp = authenticated_client.get('/api/groups')
    assert resp.status_code == 200
    groups = resp.json()
    assert len(groups) == 1
    assert groups[0]['name'] == 'Before June'


def test_get_group_by_id(authenticated_client):
    created = authenticated_client.post('/api/groups', json=_VALID_GROUP).json()
    resp = authenticated_client.get(f'/api/groups/{created["id"]}')
    assert resp.status_code == 200
    assert resp.json() == created


def test_get_missing_group_returns_404(authenticated_client):
    resp = authenticated_client.get('/api/groups/no-such-id')
    assert resp.status_code == 404


def test_update_group_name(authenticated_client):
    created = authenticated_client.post('/api/groups', json=_VALID_GROUP).json()
    resp = authenticated_client.put(
        f'/api/groups/{created["id"]}',
        json={'name': 'After July'},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body['name'] == 'After July'
    assert body['plan_id'] == 'plan-42'  # unchanged


def test_update_group_color(authenticated_client):
    created = authenticated_client.post('/api/groups', json=_VALID_GROUP).json()
    resp = authenticated_client.put(
        f'/api/groups/{created["id"]}',
        json={'color': '#3b82f6'},
    )
    assert resp.status_code == 200
    assert resp.json()['color'] == '#3b82f6'


def test_update_missing_group_returns_404(authenticated_client):
    resp = authenticated_client.put('/api/groups/no-such-id', json={'name': 'X'})
    assert resp.status_code == 404


def test_delete_group(authenticated_client):
    created = authenticated_client.post('/api/groups', json=_VALID_GROUP).json()
    resp = authenticated_client.delete(f'/api/groups/{created["id"]}')
    assert resp.status_code == 200
    assert resp.json() == {'ok': True, 'id': created['id']}

    list_resp = authenticated_client.get('/api/groups')
    assert list_resp.json() == []


def test_delete_missing_group_returns_404(authenticated_client):
    resp = authenticated_client.delete('/api/groups/no-such-id')
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# plan_id filter
# ---------------------------------------------------------------------------

def test_list_groups_filtered_by_plan_id(authenticated_client):
    authenticated_client.post('/api/groups', json={**_VALID_GROUP, 'plan_id': 'plan-A'})
    authenticated_client.post('/api/groups', json={**_VALID_GROUP, 'plan_id': 'plan-A'})
    authenticated_client.post('/api/groups', json={**_VALID_GROUP, 'plan_id': 'plan-B'})

    resp_a = authenticated_client.get('/api/groups?plan_id=plan-A')
    assert resp_a.status_code == 200
    assert len(resp_a.json()) == 2

    resp_b = authenticated_client.get('/api/groups?plan_id=plan-B')
    assert resp_b.status_code == 200
    assert len(resp_b.json()) == 1

    resp_all = authenticated_client.get('/api/groups')
    assert len(resp_all.json()) == 3


# ---------------------------------------------------------------------------
# Sub-group support
# ---------------------------------------------------------------------------

def test_create_subgroup(authenticated_client):
    parent = authenticated_client.post('/api/groups', json=_VALID_GROUP).json()
    sub = authenticated_client.post(
        '/api/groups',
        json={**_VALID_GROUP, 'name': 'Sub-group', 'parent_id': parent['id']},
    ).json()
    assert sub['parent_id'] == parent['id']


def test_delete_parent_cascades_subgroups(authenticated_client):
    parent = authenticated_client.post('/api/groups', json=_VALID_GROUP).json()
    authenticated_client.post(
        '/api/groups',
        json={**_VALID_GROUP, 'name': 'Sub1', 'parent_id': parent['id']},
    )
    authenticated_client.post(
        '/api/groups',
        json={**_VALID_GROUP, 'name': 'Sub2', 'parent_id': parent['id']},
    )
    # 3 groups total before delete
    assert len(authenticated_client.get('/api/groups').json()) == 3

    resp = authenticated_client.delete(f'/api/groups/{parent["id"]}')
    assert resp.status_code == 200
    # All 3 should be gone
    assert authenticated_client.get('/api/groups').json() == []


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
def test_create_group_invalid_payload(authenticated_client, payload, expected_status):
    resp = authenticated_client.post('/api/groups', json=payload)
    assert resp.status_code == expected_status


# ---------------------------------------------------------------------------
# Input validation (update)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize('patch', [
    {'name': ''},
    {'name': '   '},
    {'color': 'notahex'},
])
def test_update_group_invalid_payload(authenticated_client, patch):
    created = authenticated_client.post('/api/groups', json=_VALID_GROUP).json()
    resp = authenticated_client.put(f'/api/groups/{created["id"]}', json=patch)
    assert resp.status_code == 422
