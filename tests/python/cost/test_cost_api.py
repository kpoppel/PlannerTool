from types import SimpleNamespace

import pytest
from starlette.exceptions import HTTPException


def test_legacy_cost_post_is_not_registered(authenticated_client):
    with pytest.raises(HTTPException) as error:
        authenticated_client.post('/api/cost', json={'features': []})

    assert error.value.status_code == 405


def test_cost_get_remains_available(authenticated_client):
    container = authenticated_client.app.state.container
    container.register_singleton('task_repository', SimpleNamespace(read=lambda credential=None: []))

    response = authenticated_client.get('/api/cost')

    assert response.status_code == 200
    assert 'projects' in response.json()


def test_cost_get_requires_authentication(client):
    response = client.get('/api/cost')

    assert response.status_code == 401


def test_cost_teams_aggregates(authenticated_client):
    cost_config = {
        'working_hours': {'HQ': {'internal': 10}},
        'internal_cost': {'default_hourly_rate': 20},
        'external_cost': {
            'external': {'Eve': 50},
            'default_hourly_rate': 30,
        },
    }
    container = authenticated_client.app.state.container
    container.register_singleton(
        'cost_service', SimpleNamespace(get_cost_config=lambda: cost_config)
    )
    container.register_singleton(
        'people_repository',
        SimpleNamespace(list_people=lambda: [
            {'name': 'Alice', 'team_name': 'Dev', 'site': 'HQ', 'external': False},
            {'name': 'Eve', 'team': 'Dev', 'site': 'HQ', 'external': True},
        ]),
    )

    response = authenticated_client.get('/api/cost/teams')

    assert response.status_code == 200
    team = response.json()['teams'][0]
    assert team['totals']['internal_count'] == 1
    assert team['totals']['external_count'] == 1
