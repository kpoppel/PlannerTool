"""Unit tests for planner_lib/projects/closed_tasks.py.

These tests exercise the pure filtering functions without any live Azure
connection.  A simple ``fetch_by_ids_fn`` stub stands in for the real client.
"""
import pytest

from planner_lib.projects.closed_tasks import (
    COMPLETED_CATEGORY,
    get_completed_states,
    get_non_completed_states,
    filter_completed_with_open_ancestors,
)

# ---------------------------------------------------------------------------
# Shared fixtures / helpers
# ---------------------------------------------------------------------------

STATE_CATEGORIES = {
    'New': 'Proposed',
    'Active': 'InProgress',
    'Resolved': 'Resolved',
    'Closed': 'Completed',
    'Done': 'Completed',
    'Removed': 'Removed',
}

INCLUDE_STATES = ['New', 'Active', 'Resolved', 'Closed', 'Done']


def _task(id_, state, parent_id=None, extra_parents=None):
    """Build a minimal task dict for testing."""
    relations = []
    if parent_id is not None:
        relations.append({'type': 'Parent', 'id': str(parent_id)})
    for pid in (extra_parents or []):
        relations.append({'type': 'Parent', 'id': str(pid)})
    return {'id': str(id_), 'type': 'Feature', 'state': state, 'relations': relations}


def _no_fetch(ids):
    """Fetch stub that always returns empty — tests that don't need Azure lookups."""
    return []


def _make_fetch(items_by_id):
    """Fetch stub that returns items from a pre-built dict."""
    def _fetch(ids):
        return [items_by_id[str(i)] for i in ids if str(i) in items_by_id]
    return _fetch


# ---------------------------------------------------------------------------
# get_completed_states / get_non_completed_states
# ---------------------------------------------------------------------------

def test_get_completed_states_returns_only_completed():
    result = get_completed_states(INCLUDE_STATES, STATE_CATEGORIES)
    assert set(result) == {'Closed', 'Done'}


def test_get_completed_states_empty_when_no_completed():
    result = get_completed_states(['New', 'Active'], STATE_CATEGORIES)
    assert result == []


def test_get_non_completed_states_excludes_completed():
    result = get_non_completed_states(INCLUDE_STATES, STATE_CATEGORIES)
    assert set(result) == {'New', 'Active', 'Resolved'}
    assert 'Closed' not in result
    assert 'Done' not in result


def test_get_non_completed_states_empty_input():
    assert get_non_completed_states([], STATE_CATEGORIES) == []


def test_split_covers_full_input():
    """Completed + non-completed should partition include_states exactly."""
    completed = get_completed_states(INCLUDE_STATES, STATE_CATEGORIES)
    non_completed = get_non_completed_states(INCLUDE_STATES, STATE_CATEGORIES)
    assert set(completed + non_completed) == set(INCLUDE_STATES)


# ---------------------------------------------------------------------------
# filter_completed_with_open_ancestors — basic inclusion / exclusion
# ---------------------------------------------------------------------------

def test_closed_task_with_active_parent_is_included():
    """Closed feature whose parent Epic is Active → include."""
    epic = _task(1, 'Active')           # open ancestor
    feature = _task(2, 'Closed', parent_id=1)

    all_by_id = {epic['id']: epic, feature['id']: feature}
    result = filter_completed_with_open_ancestors(
        [feature], all_by_id, STATE_CATEGORIES, _no_fetch
    )
    assert len(result) == 1
    assert result[0]['id'] == '2'


def test_closed_task_with_closed_parent_is_excluded():
    """Closed feature whose parent Epic is also Closed → exclude."""
    epic = _task(1, 'Closed')           # also completed
    feature = _task(2, 'Closed', parent_id=1)

    all_by_id = {epic['id']: epic, feature['id']: feature}
    result = filter_completed_with_open_ancestors(
        [feature], all_by_id, STATE_CATEGORIES, _no_fetch
    )
    assert result == []


def test_root_closed_task_no_parent_is_excluded():
    """Closed item with no parent → exclude (per requirement 3)."""
    feature = _task(10, 'Closed')  # no parent

    all_by_id = {feature['id']: feature}
    result = filter_completed_with_open_ancestors(
        [feature], all_by_id, STATE_CATEGORIES, _no_fetch
    )
    assert result == []


def test_closed_task_active_grandparent_is_included():
    """Closed US → Closed Feature → Active Epic: US qualifies."""
    epic = _task(1, 'Active')
    feature = _task(2, 'Closed', parent_id=1)
    user_story = _task(3, 'Closed', parent_id=2)

    all_by_id = {t['id']: t for t in [epic, feature, user_story]}
    result = filter_completed_with_open_ancestors(
        [user_story], all_by_id, STATE_CATEGORIES, _no_fetch
    )
    assert len(result) == 1


def test_full_closed_tree_none_included():
    """Epic Closed → Feature Closed → US Closed → none qualify."""
    epic = _task(1, 'Closed')
    feature = _task(2, 'Closed', parent_id=1)
    user_story = _task(3, 'Closed', parent_id=2)

    all_by_id = {t['id']: t for t in [epic, feature, user_story]}
    result = filter_completed_with_open_ancestors(
        [feature, user_story], all_by_id, STATE_CATEGORIES, _no_fetch
    )
    assert result == []


# ---------------------------------------------------------------------------
# Example scenarios from the requirements
# ---------------------------------------------------------------------------

def test_requirement_example_1():
    """Initiative New → Epic Active → Feature Resolved → User Story Closed.
    User Story included (Epic and Initiative are open above it).
    """
    initiative = _task(1, 'New')
    epic = _task(2, 'Active', parent_id=1)
    feature = _task(3, 'Resolved', parent_id=2)
    user_story = _task(4, 'Closed', parent_id=3)

    all_by_id = {t['id']: t for t in [initiative, epic, feature, user_story]}
    result = filter_completed_with_open_ancestors(
        [user_story], all_by_id, STATE_CATEGORIES, _no_fetch
    )
    assert [r['id'] for r in result] == ['4']


def test_requirement_example_2():
    """Initiative Active → Epic Closed → Feature Resolved → User Story Closed.
    Both Epic and User Story are included (Initiative is open above Epic).
    """
    initiative = _task(1, 'Active')
    epic = _task(2, 'Closed', parent_id=1)
    feature = _task(3, 'Resolved', parent_id=2)
    user_story = _task(4, 'Closed', parent_id=3)

    all_by_id = {t['id']: t for t in [initiative, epic, feature, user_story]}
    result = filter_completed_with_open_ancestors(
        [epic, user_story], all_by_id, STATE_CATEGORIES, _no_fetch
    )
    assert set(r['id'] for r in result) == {'2', '4'}


def test_requirement_example_3():
    """Epic Closed → Feature Closed → User Story Closed → none included."""
    epic = _task(1, 'Closed')
    feature = _task(2, 'Closed', parent_id=1)
    user_story = _task(3, 'Closed', parent_id=2)

    all_by_id = {t['id']: t for t in [epic, feature, user_story]}
    result = filter_completed_with_open_ancestors(
        [epic, feature, user_story], all_by_id, STATE_CATEGORIES, _no_fetch
    )
    assert result == []


# ---------------------------------------------------------------------------
# Parent fetching (parent lives outside area_path query result)
# ---------------------------------------------------------------------------

def test_parent_fetched_from_azure_when_not_in_known_map():
    """Closed feature whose parent is fetched on-demand (not in primary query)."""
    # The regular query only returned the feature; parent Epic is fetched via the fn
    feature = _task(2, 'Closed', parent_id=1)
    epic = _task(1, 'Active')  # open, fetched on demand

    all_by_id = {feature['id']: feature}  # epic NOT in initial map
    result = filter_completed_with_open_ancestors(
        [feature], all_by_id, STATE_CATEGORIES,
        _make_fetch({'1': epic}),
    )
    assert len(result) == 1


def test_closed_parent_fetched_then_grandparent_checked():
    """Closed US → Closed Feature (fetched) → Active Epic (fetched) → US included."""
    user_story = _task(3, 'Closed', parent_id=2)
    feature = _task(2, 'Closed', parent_id=1)
    epic = _task(1, 'Active')

    all_by_id = {user_story['id']: user_story}  # only US in primary result
    extra_items = {'1': epic, '2': feature}

    result = filter_completed_with_open_ancestors(
        [user_story], all_by_id, STATE_CATEGORIES,
        _make_fetch(extra_items),
    )
    assert len(result) == 1
    assert result[0]['id'] == '3'


def test_unreachable_parent_treated_as_excluded():
    """If a parent cannot be resolved via fetch, the branch is skipped."""
    feature = _task(2, 'Closed', parent_id=999)  # parent 999 doesn't exist

    all_by_id = {feature['id']: feature}
    result = filter_completed_with_open_ancestors(
        [feature], all_by_id, STATE_CATEGORIES, _no_fetch  # returns nothing
    )
    # Parent unreachable → no open ancestor found → excluded
    assert result == []


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

def test_empty_completed_tasks_returns_empty():
    result = filter_completed_with_open_ancestors([], {}, STATE_CATEGORIES, _no_fetch)
    assert result == []


def test_unknown_state_treated_as_non_completed():
    """A state not in state_categories defaults to non-Completed (open)."""
    custom_categories = {}  # no mapping → default behavior
    epic = _task(1, 'SomeCustomState')  # not in categories → not Completed
    feature = _task(2, 'Closed', parent_id=1)

    all_by_id = {t['id']: t for t in [epic, feature]}
    result = filter_completed_with_open_ancestors(
        [feature], all_by_id, custom_categories, _no_fetch
    )
    # 'SomeCustomState' not in categories, not 'Completed' → feature included
    assert len(result) == 1


def test_cycle_in_relations_does_not_infinite_loop():
    """Malformed data with a Parent cycle must not loop forever."""
    a = _task(1, 'Closed', parent_id=2)
    b = _task(2, 'Closed', parent_id=1)  # A→B→A cycle

    all_by_id = {a['id']: a, b['id']: b}
    # Should terminate without recursion error
    result = filter_completed_with_open_ancestors(
        [a, b], all_by_id, STATE_CATEGORIES, _no_fetch
    )
    assert result == []


def test_multiple_parents_one_open_includes_task():
    """If an item has two Parent relations and one is open, it qualifies."""
    open_parent = _task(1, 'Active')
    closed_parent = _task(2, 'Closed')
    feature = _task(3, 'Closed', extra_parents=[1, 2])

    all_by_id = {t['id']: t for t in [open_parent, closed_parent, feature]}
    result = filter_completed_with_open_ancestors(
        [feature], all_by_id, STATE_CATEGORIES, _no_fetch
    )
    assert len(result) == 1


def test_parent_fetch_failure_skips_branch():
    """If the fetch callback raises, the branch is skipped gracefully."""
    feature = _task(2, 'Closed', parent_id=1)
    all_by_id = {feature['id']: feature}

    def _raising_fetch(ids):
        raise ConnectionError("Azure unreachable")

    result = filter_completed_with_open_ancestors(
        [feature], all_by_id, STATE_CATEGORIES, _raising_fetch
    )
    assert result == []
