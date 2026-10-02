"""Unit tests for planner_lib.events.event_store.

Uses a lightweight in-memory storage stub so no file system I/O is needed.
Concurrent-write safety is handled by diskcache in production; the unit
tests use a single-threaded in-memory stub where no locking is needed.
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
# Tests
# ---------------------------------------------------------------------------

def test_list_events_empty_initially(store):
    from planner_lib.events.event_store import list_events
    assert list_events(store) == []


def test_create_event_returns_event_with_id(store):
    from planner_lib.events.event_store import create_event
    event = create_event(store, date='2026-05-01', title='Sprint Demo', plan_id='plan-1')
    assert event['date'] == '2026-05-01'
    assert event['title'] == 'Sprint Demo'
    assert event['plan_id'] == 'plan-1'
    assert 'id' in event
    assert len(event['id']) == 32  # uuid4 hex


def test_create_event_default_category_is_empty(store):
    from planner_lib.events.event_store import create_event
    event = create_event(store, date='2026-05-01', title='Demo', plan_id='plan-1')
    assert event['category'] == ''


def test_create_event_with_explicit_category(store):
    from planner_lib.events.event_store import create_event
    for cat in ('Q', 'Bundle', 'Other', 'MyCustomCat'):
        event = create_event(store, date='2026-05-01', title=cat, plan_id='plan-1', category=cat)
        assert event['category'] == cat


def test_update_event_changes_category(store):
    from planner_lib.events.event_store import create_event, update_event
    event = create_event(store, date='2026-05-01', title='T', plan_id='plan-1', category='Other')
    updated = update_event(store, event['id'], category='Q')
    assert updated['category'] == 'Q'


def test_list_events_returns_all(store):
    from planner_lib.events.event_store import create_event, list_events
    create_event(store, date='2026-05-01', title='A', plan_id='plan-1')
    create_event(store, date='2026-06-01', title='B', plan_id='plan-2')
    events = list_events(store)
    assert len(events) == 2
    titles = {e['title'] for e in events}
    assert titles == {'A', 'B'}


def test_list_events_filters_by_plan_id(store):
    from planner_lib.events.event_store import create_event, list_events
    create_event(store, date='2026-05-01', title='A', plan_id='plan-1')
    create_event(store, date='2026-06-01', title='B', plan_id='plan-2')
    create_event(store, date='2026-07-01', title='C', plan_id='plan-1')

    plan1_events = list_events(store, plan_id='plan-1')
    assert len(plan1_events) == 2
    assert all(e['plan_id'] == 'plan-1' for e in plan1_events)

    plan2_events = list_events(store, plan_id='plan-2')
    assert len(plan2_events) == 1
    assert plan2_events[0]['title'] == 'B'


def test_list_events_unknown_plan_id_returns_empty(store):
    from planner_lib.events.event_store import create_event, list_events
    create_event(store, date='2026-05-01', title='A', plan_id='plan-1')
    assert list_events(store, plan_id='no-such-plan') == []


def test_get_event_returns_event(store):
    from planner_lib.events.event_store import create_event, get_event
    created = create_event(store, date='2026-05-01', title='PI Planning', plan_id='plan-3')
    fetched = get_event(store, created['id'])
    assert fetched == created


def test_get_event_raises_key_error_when_missing(store):
    from planner_lib.events.event_store import get_event
    with pytest.raises(KeyError):
        get_event(store, 'nonexistent-id')


def test_update_event_changes_date(store):
    from planner_lib.events.event_store import create_event, update_event
    event = create_event(store, date='2026-05-01', title='Old', plan_id='plan-1')
    updated = update_event(store, event['id'], date='2026-06-15')
    assert updated['date'] == '2026-06-15'
    assert updated['title'] == 'Old'
    assert updated['plan_id'] == 'plan-1'


def test_update_event_changes_title(store):
    from planner_lib.events.event_store import create_event, update_event
    event = create_event(store, date='2026-05-01', title='Old Title', plan_id='plan-1')
    updated = update_event(store, event['id'], title='New Title')
    assert updated['title'] == 'New Title'
    assert updated['date'] == '2026-05-01'


def test_update_event_changes_plan_id(store):
    from planner_lib.events.event_store import create_event, update_event
    event = create_event(store, date='2026-05-01', title='T', plan_id='plan-1')
    updated = update_event(store, event['id'], plan_id='plan-99')
    assert updated['plan_id'] == 'plan-99'


def test_update_event_partial_update_does_not_touch_omitted_fields(store):
    from planner_lib.events.event_store import create_event, update_event
    event = create_event(store, date='2026-05-01', title='Stable', plan_id='plan-5')
    updated = update_event(store, event['id'], date='2026-09-01')
    assert updated['title'] == 'Stable'
    assert updated['plan_id'] == 'plan-5'


def test_update_event_raises_key_error_when_missing(store):
    from planner_lib.events.event_store import update_event
    with pytest.raises(KeyError):
        update_event(store, 'no-such-id', title='X')


def test_delete_event_returns_true(store):
    from planner_lib.events.event_store import create_event, delete_event, list_events
    event = create_event(store, date='2026-05-01', title='To Delete', plan_id='plan-1')
    result = delete_event(store, event['id'])
    assert result is True
    assert list_events(store) == []


def test_delete_event_returns_false_when_missing(store):
    from planner_lib.events.event_store import delete_event
    assert delete_event(store, 'no-such-id') is False


def test_create_multiple_events_have_unique_ids(store):
    from planner_lib.events.event_store import create_event
    ids = [create_event(store, date='2026-05-01', title=f'E{i}', plan_id='p')['id'] for i in range(10)]
    assert len(set(ids)) == 10
