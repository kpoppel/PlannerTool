from uuid import UUID

from planner_lib.migrations.revisions import upgrade_37
from planner_lib.storage.memory_backend import MemoryStorage


def test_upgrade_37_assigns_unique_team_ids_and_remaps_application_references(monkeypatch):
    identities = iter((
        UUID('11111111-1111-4111-8111-111111111111'),
        UUID('22222222-2222-4222-8222-222222222222'),
    ))
    monkeypatch.setattr('planner_lib.migrations.revisions.uuid4', lambda: next(identities))
    storage = MemoryStorage()
    storage.save('config', 'projects', {
        'schema_version': 4,
        'container_types': ['project', 'team'],
        'allocation_defaults': {
            'project': ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
            'team': ['team-alpha', 'team-beta', 'group-id'],
        },
        'project_map': [{
            'id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'name': 'Project',
            'allocatable_ids': ['team-alpha', 'team-beta', 'group-id'],
        }],
    })
    storage.save('config', 'teams', {
        'schema_version': 3,
        'teams': [
            {'id': 'team-alpha', 'allocation_token': 'ALPHA', 'name': 'Alpha',
             'short_name': 'Alpha', 'archived': False, 'group_id': None},
            {'id': 'team-beta', 'allocation_token': 'BETA', 'name': 'Beta',
             'short_name': 'Beta', 'archived': True, 'group_id': 'group-id'},
        ],
        'groups': [
            {'id': 'group-id', 'allocation_token': 'GROUP', 'name': 'Group',
             'short_name': 'Group', 'archived': False},
        ],
    })
    storage.save('config', 'workforce', {
        'schema_version': 2,
        'suppliers': [],
        'staffing': [
            {'id': 'row-alpha', 'team_id': 'team-alpha', 'supplier_id': 's',
             'profile_id': 'p', 'fte': 1},
        ],
    })
    storage.save('views', 'owner_view-1', {
        'selectedTeams': {'team-alpha': True, 'team-beta': False},
    })
    storage.save('scenarios', 'owner_scenario-1', {
        'filters': {'teams': ['team-alpha']},
        'overrides': {'task-1': {'capacity': [{'team': 'team-beta', 'capacity': 20}]}},
    })
    storage.save('backend_domain', 'tasks', {'team': 'team-alpha'})
    storage.save('cost_cache', 'costs', {'team': 'team-beta'})
    storage.save('config', 'event_config', {
        'event_backend': 'ado_wiki',
        'ado_wiki': {'project': 'ADO project', 'wiki_id': 'events.wiki'},
    })
    storage.save('events', 'event_register', {'event-1': {'plan_id': 'ado-plan-id'}})

    upgrade_37(storage)

    alpha_id = '11111111-1111-4111-8111-111111111111'
    beta_id = '22222222-2222-4222-8222-222222222222'
    teams = storage.load('config', 'teams')
    assert [team['id'] for team in teams['teams']] == [alpha_id, beta_id]
    assert [team['allocation_token'] for team in teams['teams']] == ['ALPHA', 'BETA']
    assert storage.load('config', 'workforce')['staffing'][0]['team_id'] == alpha_id
    assert storage.load('config', 'projects')['allocation_defaults'] == {
        'project': ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
        'team': [alpha_id, beta_id, 'group-id'],
    }
    assert storage.load('config', 'projects')['project_map'][0]['allocatable_ids'] == [
        alpha_id, beta_id, 'group-id',
    ]
    assert storage.load('views', 'owner_view-1')['selectedTeams'] == {
        alpha_id: True, beta_id: False,
    }
    assert storage.load('scenarios', 'owner_scenario-1') == {
        'filters': {'teams': [alpha_id]},
        'overrides': {'task-1': {'capacity': [{'team': beta_id, 'capacity': 20}]}},
    }
    assert list(storage.list_keys('backend_domain')) == []
    assert list(storage.list_keys('cost_cache')) == []
    assert not storage.exists('config', 'event_config')
    assert storage.load('events', 'event_register') == {
        'event-1': {'plan_id': 'ado-plan-id'},
    }
