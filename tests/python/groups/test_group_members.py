"""Tests for group members field — groups can own task IDs as members.

This is a TDD test file written before the implementation.  Membership is
stored on the group object as ``members: list[str]``, not on the feature.

The tests cover:
  - group_store: create/update with members, members returned in list/get
  - local_backend: members passed through
  - api: members accepted in POST/PUT, returned in GET
"""
from __future__ import annotations

import pytest
from typing import Any, Dict, Iterable


# ---------------------------------------------------------------------------
# In-memory storage stub (copy from test_group_store.py pattern)
# ---------------------------------------------------------------------------

class _Store:
    def __init__(self):
        self._data: Dict[str, Dict[str, Any]] = {}

    def load(self, ns: str, key: str) -> Any:
        try:
            return self._data[ns][key]
        except KeyError:
            raise KeyError(f"{ns}/{key}")

    def save(self, ns: str, key: str, val: Any) -> None:
        self._data.setdefault(ns, {})[key] = val

    def delete(self, ns: str, key: str) -> None:
        try:
            del self._data[ns][key]
        except KeyError:
            raise KeyError(key)

    def exists(self, ns: str, key: str) -> bool:
        return key in self._data.get(ns, {})

    def list_keys(self, ns: str) -> Iterable[str]:
        return list(self._data.get(ns, {}).keys())

    def configure(self, **options) -> None:
        pass


@pytest.fixture()
def store():
    return _Store()


# ---------------------------------------------------------------------------
# group_store: create with members
# ---------------------------------------------------------------------------

def test_create_group_without_members_has_no_members_key(store):
    """Groups created without members should not include the 'members' key."""
    from planner_lib.groups.group_store import create_group
    group = create_group(store, plan_id='plan-1', name='No members')
    assert 'members' not in group


def test_create_group_with_empty_members(store):
    """Explicitly passing members=[] should store an empty list."""
    from planner_lib.groups.group_store import create_group
    group = create_group(store, plan_id='plan-1', name='Empty members', members=[])
    assert group['members'] == []


def test_create_group_with_members(store):
    """Members list is persisted and returned on creation."""
    from planner_lib.groups.group_store import create_group
    group = create_group(
        store, plan_id='plan-1', name='Theme A',
        members=['task-1', 'task-2'],
    )
    assert group['members'] == ['task-1', 'task-2']


def test_list_groups_returns_members(store):
    """list_groups returns the members list for each group."""
    from planner_lib.groups.group_store import create_group, list_groups
    create_group(store, plan_id='p', name='G1', members=['t1'])
    create_group(store, plan_id='p', name='G2', members=['t2', 't3'])
    groups = list_groups(store, plan_id='p')
    member_sets = {g['name']: g.get('members') for g in groups}
    assert member_sets['G1'] == ['t1']
    assert member_sets['G2'] == ['t2', 't3']


def test_get_group_returns_members(store):
    """get_group returns the members list."""
    from planner_lib.groups.group_store import create_group, get_group
    created = create_group(store, plan_id='p', name='G', members=['x'])
    fetched = get_group(store, created['id'])
    assert fetched['members'] == ['x']


# ---------------------------------------------------------------------------
# group_store: update members
# ---------------------------------------------------------------------------

def test_update_group_adds_members(store):
    """update_group can set a members list on an existing group."""
    from planner_lib.groups.group_store import create_group, update_group
    group = create_group(store, plan_id='p', name='G')
    updated = update_group(store, group['id'], members=['task-1'])
    assert updated['members'] == ['task-1']


def test_update_group_replaces_members(store):
    """update_group replaces the existing members list."""
    from planner_lib.groups.group_store import create_group, update_group
    group = create_group(store, plan_id='p', name='G', members=['task-1'])
    updated = update_group(store, group['id'], members=['task-2', 'task-3'])
    assert updated['members'] == ['task-2', 'task-3']


def test_update_group_clears_members_with_empty_list(store):
    """Passing members=[] clears the members list."""
    from planner_lib.groups.group_store import create_group, update_group
    group = create_group(store, plan_id='p', name='G', members=['task-1'])
    updated = update_group(store, group['id'], members=[])
    assert updated['members'] == []


def test_update_group_without_members_does_not_change_existing(store):
    """Passing members=None leaves the existing members list unchanged."""
    from planner_lib.groups.group_store import create_group, update_group
    group = create_group(store, plan_id='p', name='G', members=['task-1'])
    updated = update_group(store, group['id'], name='G renamed')
    assert updated['members'] == ['task-1']


# ---------------------------------------------------------------------------
# REST API integration: members field accepted and returned
# (uses the shared client fixture from conftest.py)
# ---------------------------------------------------------------------------

_HEADERS = {'X-Session-Id': 'test-session'}


def test_api_create_group_with_members(client):
    """POST /api/groups with members persists and returns the members list."""
    payload = {'plan_id': 'plan-1', 'name': 'G', 'members': ['task-1', 'task-2']}
    resp = client.post('/api/groups', json=payload, headers=_HEADERS)
    assert resp.status_code == 201
    body = resp.json()
    assert body['members'] == ['task-1', 'task-2']


def test_api_create_group_without_members_returns_no_members_key(client):
    """POST /api/groups without members should not include 'members' in response."""
    payload = {'plan_id': 'plan-1', 'name': 'G'}
    resp = client.post('/api/groups', json=payload, headers=_HEADERS)
    assert resp.status_code == 201
    body = resp.json()
    assert 'members' not in body


def test_api_update_group_members(client):
    """PUT /api/groups/{id} with members updates the members list."""
    created = client.post(
        '/api/groups', json={'plan_id': 'plan-1', 'name': 'G'}, headers=_HEADERS
    ).json()
    resp = client.put(
        f'/api/groups/{created["id"]}',
        json={'members': ['task-3']},
        headers=_HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json()['members'] == ['task-3']


def test_api_get_group_returns_members(client):
    """GET /api/groups/{id} returns the members list."""
    created = client.post(
        '/api/groups',
        json={'plan_id': 'plan-1', 'name': 'G', 'members': ['task-1']},
        headers=_HEADERS,
    ).json()
    resp = client.get(f'/api/groups/{created["id"]}', headers=_HEADERS)
    assert resp.status_code == 200
    assert resp.json()['members'] == ['task-1']


def test_api_list_groups_returns_members(client):
    """GET /api/groups returns members for all groups."""
    client.post('/api/groups', json={'plan_id': 'p', 'name': 'A', 'members': ['t1']}, headers=_HEADERS)
    client.post('/api/groups', json={'plan_id': 'p', 'name': 'B', 'members': []}, headers=_HEADERS)
    resp = client.get('/api/groups?plan_id=p', headers=_HEADERS)
    assert resp.status_code == 200
    groups = {g['name']: g for g in resp.json()}
    assert groups['A']['members'] == ['t1']
    assert groups['B']['members'] == []
