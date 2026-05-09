"""Tests for scenarioGroups round-trip in scenario save/load.

Scenario data is stored as arbitrary JSON via the scenario repository, so
``scenarioGroups`` is preserved by the existing storage layer without changes.
These tests verify that the field is accepted, stored and returned correctly.

The ``scenarioGroups`` field holds scenario-local group objects that have not
yet been promoted to the baseline (the ``/api/groups`` store).  They live
inside the scenario JSON until the user publishes them.
"""
from __future__ import annotations

import pytest

_HEADERS = {'X-Session-Id': 'test-session'}

# A minimal group object that could appear in scenarioGroups.
_SCENARIO_GROUP = {
    'id': 'tmp_abc123',
    'plan_id': 'plan-1',
    'name': 'Q3 Themes',
    'color': '#4c8ef5',
    'rank': 0,
    'members': ['task-100', 'task-200'],
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _save_scenario(client, scenario: dict):
    return client.post('/api/scenario', json={'op': 'save', 'data': scenario}, headers=_HEADERS)


def _load_scenario(client, scenario_id: str):
    return client.get(f'/api/scenario?id={scenario_id}', headers=_HEADERS)


# ---------------------------------------------------------------------------
# scenarioGroups round-trip
# ---------------------------------------------------------------------------

def test_scenario_with_scenario_groups_saves_and_loads(client):
    """A scenario containing scenarioGroups round-trips correctly."""
    scenario = {
        'name': 'Test scenario',
        'overrides': {},
        'scenarioGroups': [_SCENARIO_GROUP],
    }
    saved = _save_scenario(client, scenario).json()
    scenario_id = saved['id']

    loaded = _load_scenario(client, scenario_id).json()
    assert 'scenarioGroups' in loaded
    assert len(loaded['scenarioGroups']) == 1
    sg = loaded['scenarioGroups'][0]
    assert sg['id'] == 'tmp_abc123'
    assert sg['name'] == 'Q3 Themes'
    assert sg['members'] == ['task-100', 'task-200']


def test_scenario_without_scenario_groups_is_unaffected(client):
    """Scenarios without scenarioGroups are not modified."""
    scenario = {'name': 'No groups', 'overrides': {}}
    saved = _save_scenario(client, scenario).json()
    loaded = _load_scenario(client, saved['id']).json()
    assert loaded.get('scenarioGroups') is None or 'scenarioGroups' not in loaded


def test_scenario_can_update_scenario_groups(client):
    """Updating a scenario with new scenarioGroups replaces the old list."""
    # Save with one scenario group
    scenario = {
        'name': 'My scenario',
        'overrides': {},
        'scenarioGroups': [_SCENARIO_GROUP],
    }
    saved = _save_scenario(client, scenario).json()
    scenario_id = saved['id']

    # Update: different groups
    new_group = {**_SCENARIO_GROUP, 'id': 'tmp_xyz999', 'name': 'H2 Initiatives'}
    update_payload = {
        'id': scenario_id,
        'name': 'My scenario',
        'overrides': {},
        'scenarioGroups': [new_group],
    }
    _save_scenario(client, update_payload)

    loaded = _load_scenario(client, scenario_id).json()
    assert len(loaded['scenarioGroups']) == 1
    assert loaded['scenarioGroups'][0]['id'] == 'tmp_xyz999'


def test_scenario_group_override_for_baseline_group_members(client):
    """A scenario can override the members of a baseline group via groupOverrides."""
    # Group overrides are stored separately from feature overrides to avoid mixing
    # numeric feature IDs with hex group IDs in the same dict.
    scenario = {
        'name': 'Override members',
        'overrides': {},
        'groupOverrides': {
            'group-baseline-1': {'members': ['task-1', 'task-3']},
        },
        'scenarioGroups': [],
    }
    saved = _save_scenario(client, scenario).json()
    loaded = _load_scenario(client, saved['id']).json()
    assert loaded['groupOverrides']['group-baseline-1']['members'] == ['task-1', 'task-3']


def test_scenario_groups_empty_list_round_trips(client):
    """An empty scenarioGroups list round-trips correctly."""
    scenario = {'name': 'Empty groups', 'overrides': {}, 'scenarioGroups': []}
    saved = _save_scenario(client, scenario).json()
    loaded = _load_scenario(client, saved['id']).json()
    # Either not present or empty list is acceptable for empty []
    sg = loaded.get('scenarioGroups')
    assert sg is None or sg == []
