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
