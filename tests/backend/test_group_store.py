"""Unit tests for planner_lib.groups.group_store.

Uses a lightweight in-memory storage stub so no file system I/O is needed.
"""
from __future__ import annotations

import pytest
from typing import Any, Dict, Iterable


# ---------------------------------------------------------------------------
# In-memory storage stub
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
# Basic CRUD
# ---------------------------------------------------------------------------

def test_list_groups_empty_initially(store):
    from planner_lib.groups.group_store import list_groups
    assert list_groups(store) == []


def test_create_group_returns_group_with_id(store):
    from planner_lib.groups.group_store import create_group
    group = create_group(store, plan_id='plan-1', name='Before June')
    assert group['plan_id'] == 'plan-1'
    assert group['name'] == 'Before June'
    assert group['rank'] == 0
    assert 'id' in group
    assert len(group['id']) == 32  # uuid4 hex
    # Optional fields absent when not provided
    assert 'parent_id' not in group
    assert 'color' not in group


def test_create_group_with_optional_fields(store):
    from planner_lib.groups.group_store import create_group
    group = create_group(
        store,
        plan_id='plan-1',
        name='Theme A',
        parent_id='parent-id-xxx',
        color='#3b82f6',
        rank=5,
    )
    assert group['parent_id'] == 'parent-id-xxx'
    assert group['color'] == '#3b82f6'
    assert group['rank'] == 5


def test_list_groups_returns_all(store):
    from planner_lib.groups.group_store import create_group, list_groups
    create_group(store, plan_id='plan-1', name='Alpha')
    create_group(store, plan_id='plan-2', name='Beta')
    groups = list_groups(store)
    assert len(groups) == 2
    names = {g['name'] for g in groups}
    assert names == {'Alpha', 'Beta'}


def test_list_groups_filters_by_plan_id(store):
    from planner_lib.groups.group_store import create_group, list_groups
    create_group(store, plan_id='plan-1', name='Alpha')
    create_group(store, plan_id='plan-2', name='Beta')
    groups = list_groups(store, plan_id='plan-1')
    assert len(groups) == 1
    assert groups[0]['name'] == 'Alpha'


def test_list_groups_sorted_by_rank_then_name(store):
    from planner_lib.groups.group_store import create_group, list_groups
    create_group(store, plan_id='p', name='Zebra', rank=2)
    create_group(store, plan_id='p', name='Alpha', rank=2)
    create_group(store, plan_id='p', name='Middle', rank=1)
    groups = list_groups(store, plan_id='p')
    assert [g['name'] for g in groups] == ['Middle', 'Alpha', 'Zebra']


def test_get_group_returns_group(store):
    from planner_lib.groups.group_store import create_group, get_group
    created = create_group(store, plan_id='plan-1', name='My Group')
    fetched = get_group(store, created['id'])
    assert fetched == created


def test_get_group_raises_keyerror_when_missing(store):
    from planner_lib.groups.group_store import get_group
    with pytest.raises(KeyError):
        get_group(store, 'no-such-id')


def test_update_group_name(store):
    from planner_lib.groups.group_store import create_group, update_group
    created = create_group(store, plan_id='plan-1', name='Old Name')
    updated = update_group(store, created['id'], name='New Name')
    assert updated['name'] == 'New Name'
    assert updated['plan_id'] == 'plan-1'  # unchanged


def test_update_group_color(store):
    from planner_lib.groups.group_store import create_group, update_group
    created = create_group(store, plan_id='plan-1', name='G')
    updated = update_group(store, created['id'], color='#ff0000')
    assert updated['color'] == '#ff0000'


def test_update_group_clear_color(store):
    from planner_lib.groups.group_store import create_group, update_group
    created = create_group(store, plan_id='plan-1', name='G', color='#red')
    updated = update_group(store, created['id'], color='')
    assert updated['color'] is None


def test_update_group_raises_keyerror_when_missing(store):
    from planner_lib.groups.group_store import update_group
    with pytest.raises(KeyError):
        update_group(store, 'no-such-id', name='X')


def test_delete_group_returns_true(store):
    from planner_lib.groups.group_store import create_group, delete_group
    created = create_group(store, plan_id='plan-1', name='G')
    result = delete_group(store, created['id'])
    assert result is True


def test_delete_group_removes_from_list(store):
    from planner_lib.groups.group_store import create_group, delete_group, list_groups
    created = create_group(store, plan_id='plan-1', name='G')
    delete_group(store, created['id'])
    assert list_groups(store) == []


def test_delete_group_returns_false_when_missing(store):
    from planner_lib.groups.group_store import delete_group
    result = delete_group(store, 'no-such-id')
    assert result is False


# ---------------------------------------------------------------------------
# Cascade delete
# ---------------------------------------------------------------------------

def test_delete_parent_cascades_to_children(store):
    from planner_lib.groups.group_store import create_group, delete_group, list_groups
    parent = create_group(store, plan_id='p', name='Parent')
    child1 = create_group(store, plan_id='p', name='Child1', parent_id=parent['id'])
    child2 = create_group(store, plan_id='p', name='Child2', parent_id=parent['id'])
    unrelated = create_group(store, plan_id='p', name='Unrelated')

    delete_group(store, parent['id'])
    remaining = list_groups(store)
    remaining_ids = {g['id'] for g in remaining}

    assert parent['id'] not in remaining_ids
    assert child1['id'] not in remaining_ids
    assert child2['id'] not in remaining_ids
    assert unrelated['id'] in remaining_ids


def test_delete_child_does_not_affect_parent(store):
    from planner_lib.groups.group_store import create_group, delete_group, list_groups
    parent = create_group(store, plan_id='p', name='Parent')
    child = create_group(store, plan_id='p', name='Child', parent_id=parent['id'])

    delete_group(store, child['id'])
    remaining_ids = {g['id'] for g in list_groups(store)}
    assert parent['id'] in remaining_ids
    assert child['id'] not in remaining_ids
