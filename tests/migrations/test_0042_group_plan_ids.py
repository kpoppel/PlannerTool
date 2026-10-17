import pytest

from planner_lib.migrations.contracts import SchemaError
from planner_lib.migrations.revisions import upgrade_42
from planner_lib.storage.memory_backend import MemoryStorage


def test_upgrade_42_remaps_saved_group_owners_without_changing_current_groups():
    storage = MemoryStorage()
    project_id = '11111111-1111-4111-8111-111111111111'
    storage.save('config', 'projects', {
        'project_map': [{'id': project_id, 'name': 'Bluetooth'}],
    })
    scenario = {
        'overrides': {'123': {'project': 'project-bluetooth', 'title': 'Keep this title'}},
        'filters': {'projects': ['project-bluetooth']},
        'view': {'selectedProjects': {'project-bluetooth': True}},
        'scenarioGroups': [
            {'id': 'old', 'plan_id': 'project-bluetooth', 'members': ['123']},
            {'id': 'new', 'plan_id': project_id, 'members': []},
        ],
        'groupOverrides': {'baseline-group': {'plan_id': 'project-bluetooth'}},
    }
    storage.save('scenarios', 'owner_scenario', scenario)
    storage.save('scenarios', 'scenario_register', {'owner': ['scenario']})
    storage.save('views', 'owner_view', {
        'selectedProjects': {'project-bluetooth': True, 'removed-plan': False},
        'viewOptions': {'focusedPlanId': 'project-bluetooth'},
        'context': {'projectIds': ['project-bluetooth']},
    })

    upgrade_42(storage)

    migrated = storage.load('scenarios', 'owner_scenario')
    assert migrated['scenarioGroups'] == [
        {'id': 'old', 'plan_id': project_id, 'members': ['123']},
        scenario['scenarioGroups'][1],
    ]
    assert migrated['groupOverrides']['baseline-group']['plan_id'] == project_id
    assert migrated['overrides']['123'] == {'project': project_id, 'title': 'Keep this title'}
    assert migrated['filters']['projects'] == [project_id]
    assert migrated['view']['selectedProjects'] == {project_id: True}
    assert storage.load('views', 'owner_view') == {
        'selectedProjects': {project_id: True, 'removed-plan': False},
        'viewOptions': {'focusedPlanId': project_id},
        'context': {'projectIds': [project_id]},
    }
    assert storage.load('scenarios', 'scenario_register') == {'owner': ['scenario']}
    upgrade_42(storage)
    assert storage.load('scenarios', 'owner_scenario') == migrated


def test_upgrade_42_rejects_ambiguous_saved_group_owners_without_partial_writes():
    storage = MemoryStorage()
    storage.save('config', 'projects', {
        'project_map': [
            {'id': 'first', 'name': 'Bluetooth'},
            {'id': 'second', 'name': 'Bluetooth'},
        ],
    })
    scenario = {'scenarioGroups': [{'id': 'group', 'plan_id': 'project-bluetooth'}]}
    storage.save('scenarios', 'owner_scenario', scenario)

    with pytest.raises(SchemaError, match='Ambiguous.*group.*plan'):
        upgrade_42(storage)

    assert storage.load('scenarios', 'owner_scenario') == scenario