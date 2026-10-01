import pytest


pytestmark = pytest.mark.real_auth


def test_save_config_requires_session(client):
    response = client.post('/api/config', json={'email': 'someone@example.com', 'pat': 'x'},
                           headers={'Accept': 'application/json'})
    assert response.status_code == 401


def test_save_config_cannot_update_another_account(client):
    assert client.post('/api/auth/enroll', json={
        'email': 'owner@example.com', 'name': 'Account Owner',
    }).status_code == 200
    response = client.post('/api/config', json={'email': 'someone@example.com', 'pat': 'x'})
    assert response.status_code == 403
