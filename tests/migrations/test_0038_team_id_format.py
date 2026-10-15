from planner_lib.migrations.revisions import upgrade_38
from planner_lib.storage.memory_backend import MemoryStorage


def test_upgrade_38_uses_workforce_id_format_and_remaps_all_team_references(monkeypatch):
    alpha_id = 'a' * 26
    beta_id = 'b' * 25 + 'a'
    identities = iter((alpha_id, beta_id))
    monkeypatch.setattr(
        'planner_lib.admin.workforce_config._timestamp_identity',
        lambda: next(identities),
    )
    storage = MemoryStorage()
    storage.save('config', 'projects', {
        'schema_version': 4,
        'container_types': ['project', 'team'],
        'allocation_defaults': {
            'project': ['project-id'],
            'team': ['11111111-1111-4111-8111-111111111111'],
        },
        'project_map': [{
            'id': 'project-id',
            'name': 'Project',
            'type': 'project',
            'allocatable_ids': ['22222222-2222-4222-8222-222222222222'],
        }],
    })
    storage.save('config', 'teams', {
        'schema_version': 3,
        'teams': [
            {'id': '11111111-1111-4111-8111-111111111111',
             'allocation_token': 'ALPHA', 'name': 'Alpha', 'short_name': 'Alpha',
             'archived': False, 'group_id': None},
            {'id': '22222222-2222-4222-8222-222222222222',
             'allocation_token': 'BETA', 'name': 'Beta', 'short_name': 'Beta',
             'archived': True, 'group_id': None},
        ],
        'groups': [],
    })
    storage.save('config', 'workforce', {
        'schema_version': 2,
        'suppliers': [],
        'staffing': [{
            'id': 'staffing-id',
            'team_id': '11111111-1111-4111-8111-111111111111',
            'supplier_id': 'supplier-id',
            'profile_id': 'profile-id',
            'fte': 1,
        }],
    })
    storage.save('views', 'owner_view-1', {
        'selectedTeams': {'11111111-1111-4111-8111-111111111111': True},
    })
    storage.save('scenarios', 'owner_scenario-1', {
        'filters': {'teams': ['22222222-2222-4222-8222-222222222222']},
        'overrides': {'task-1': {'capacity': [
            {'team': '11111111-1111-4111-8111-111111111111', 'capacity': 20},
        ]}},
    })

    upgrade_38(storage)

    assert [team['id'] for team in storage.load('config', 'teams')['teams']] == [
        alpha_id, beta_id,
    ]
    projects = storage.load('config', 'projects')
    assert projects['allocation_defaults']['team'] == [alpha_id]
    assert projects['project_map'][0]['allocatable_ids'] == [beta_id]
    assert storage.load('config', 'workforce')['staffing'][0]['team_id'] == alpha_id
    assert storage.load('views', 'owner_view-1')['selectedTeams'] == {alpha_id: True}
    assert storage.load('scenarios', 'owner_scenario-1') == {
        'filters': {'teams': [beta_id]},
        'overrides': {'task-1': {'capacity': [{'team': alpha_id, 'capacity': 20}]}},
    }
