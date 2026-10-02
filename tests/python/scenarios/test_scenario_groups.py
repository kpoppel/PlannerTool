"""Scenario-local groups and baseline group overrides round-trip through the API."""

import pytest

pytestmark = pytest.mark.real_auth

SCENARIO_GROUP = {
    'id': 'tmp_abc123', 'plan_id': 'plan-1', 'name': 'Q3 Themes',
    'color': '#4c8ef5', 'rank': 0, 'members': ['task-100', 'task-200'],
}


@pytest.fixture(autouse=True)
def enroll_scenario_owner(client, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    response = client.post('/api/auth/enroll', json={
        'email': 'scenario-groups@example.com', 'name': 'Scenario Groups',
    })
    assert response.status_code == 200


def save_scenario(client, scenario):
    return client.post('/api/scenario', json={'op': 'save', 'data': scenario})


def load_scenario(client, scenario_id):
    response = client.get('/api/scenario', params={'id': scenario_id})
    assert response.status_code == 200
    return response.json()


def test_scenario_with_scenario_groups_saves_and_loads(client):
    response = save_scenario(client, {
        'name': 'Test scenario', 'overrides': {}, 'scenarioGroups': [SCENARIO_GROUP],
    })
    assert response.status_code == 200
    loaded = load_scenario(client, response.json()['id'])
    assert loaded['scenarioGroups'] == [SCENARIO_GROUP]


def test_scenario_without_scenario_groups_is_normalized_by_server(client):
    response = save_scenario(client, {'name': 'No groups', 'overrides': {}})
    assert response.status_code == 200
    loaded = load_scenario(client, response.json()['id'])
    assert loaded['groupOverrides'] == {}
    assert loaded['scenarioGroups'] == []
    assert loaded['filters'] == {}
    assert loaded['view'] == {}


def test_scenario_can_update_scenario_groups(client):
    response = save_scenario(client, {
        'name': 'My scenario', 'overrides': {}, 'scenarioGroups': [SCENARIO_GROUP],
    })
    assert response.status_code == 200
    scenario_id = response.json()['id']
    new_group = {**SCENARIO_GROUP, 'id': 'tmp_xyz999', 'name': 'H2 Initiatives'}
    updated = save_scenario(client, {
        'id': scenario_id, 'name': 'My scenario', 'overrides': {},
        'scenarioGroups': [new_group],
    })
    assert updated.status_code == 200
    assert updated.json()['id'] == scenario_id
    assert load_scenario(client, scenario_id)['scenarioGroups'] == [new_group]


def test_scenario_group_override_for_baseline_group_members(client):
    overrides = {'group-baseline-1': {'members': ['task-1', 'task-3']}}
    response = save_scenario(client, {
        'name': 'Override members', 'overrides': {},
        'groupOverrides': overrides, 'scenarioGroups': [],
    })
    assert response.status_code == 200
    assert load_scenario(client, response.json()['id'])['groupOverrides'] == overrides


def test_scenario_groups_empty_list_round_trips(client):
    response = save_scenario(client, {
        'name': 'Empty groups', 'overrides': {}, 'scenarioGroups': [],
    })
    assert response.status_code == 200
    assert load_scenario(client, response.json()['id'])['scenarioGroups'] == []


def test_legacy_scenario_is_normalized_on_load_and_update(client):
    response = save_scenario(client, {'name': 'Legacy scenario', 'overrides': {}})
    assert response.status_code == 200
    scenario_id = response.json()['id']
    loaded = load_scenario(client, scenario_id)
    assert loaded['groupOverrides'] == {}
    assert loaded['scenarioGroups'] == []
    assert loaded['filters'] == {}
    assert loaded['view'] == {}
    updated = save_scenario(client, {
        'id': scenario_id, 'name': 'Legacy scenario', 'overrides': {},
        'groupOverrides': {}, 'scenarioGroups': [],
    })
    assert updated.status_code == 200
    assert updated.json()['id'] == scenario_id
    reloaded = load_scenario(client, scenario_id)
    assert reloaded['groupOverrides'] == {}
    assert reloaded['scenarioGroups'] == []


def test_scenario_rejects_blank_name_and_empty_group_metadata(client):
    assert save_scenario(client, {'name': '   ', 'overrides': {}}).status_code == 400
    assert save_scenario(client, {
        'name': 'Bad metadata', 'overrides': {},
        'groupOverrides': [], 'scenarioGroups': {'bad': 'shape'},
    }).status_code == 400