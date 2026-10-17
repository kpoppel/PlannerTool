from fastapi.testclient import TestClient


def test_release_status_requires_authentication(client):
    response = client.get('/api/auth/release-notes', headers={'Accept': 'application/json'})
    assert response.status_code == 401


def test_release_acknowledgement_is_shared_between_devices_and_account_isolated(client, app):
    first = client.post('/api/auth/enroll', json={
        'email': 'reader@example.test', 'name': 'Release Reader',
    })
    assert first.status_code == 200
    assert client.get('/api/auth/release-notes').json() == {
        'releaseId': 'v5.0.0', 'acknowledged': False,
    }
    response = client.post('/api/auth/release-notes', json={'releaseId': 'v5.0.0'})
    assert response.status_code == 200
    assert response.json() == {'releaseId': 'v5.0.0', 'acknowledged': True}
    assert client.post('/api/auth/release-notes', json={'releaseId': 'v5.0.0'}).status_code == 200

    second = TestClient(app)
    assert second.post('/api/auth/enroll', json={
        'email': 'reader@example.test', 'accountKey': first.json()['accountKey'],
    }).status_code == 200
    assert second.get('/api/auth/release-notes').json()['acknowledged'] is True
    assert second.post('/api/auth/enroll', json={
        'email': 'other@example.test', 'name': 'Other Reader',
    }).status_code == 200
    assert second.get('/api/auth/release-notes').json()['acknowledged'] is False


def test_release_acknowledgement_rejects_unknown_release(authenticated_client):
    response = authenticated_client.post('/api/auth/release-notes', json={'releaseId': 'v999.0.0'})
    assert response.status_code == 400
    assert authenticated_client.get('/api/auth/release-notes').json()['acknowledged'] is False


def test_release_acknowledgement_deleted_with_account(authenticated_client):
    client = authenticated_client
    enrollment = client.post('/api/auth/enroll', json={
        'email': 'departing@example.test', 'name': 'Departing Reader',
    })
    assert enrollment.status_code == 200
    account_id = client.app.state.container.get('account_manager').get_account_id('departing@example.test')
    assert client.post('/api/auth/release-notes', json={'releaseId': 'v5.0.0'}).status_code == 200
    response = client.post('/api/auth/delete-account', json={
        'email': 'departing@example.test', 'accountKey': enrollment.json()['accountKey'], 'confirm': True,
    })
    assert response.status_code == 200
    assert not client.app.state.container.get('storage').exists('release_acknowledgements', account_id)