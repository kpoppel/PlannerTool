from fastapi.testclient import TestClient

from planner_lib.main import create_app, Config


def test_post_config_and_persistence(client, app):
    payload = {'email': 'tester@example.com', 'pat': 'secrettoken'}
    resp = client.post('/api/account', json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body.get('ok') is True

    # verify config can be loaded via the app's account manager storage
    stored = app.state.container.get('account_manager')._storage.load('accounts', 'tester@example.com')
    assert stored['email'] == payload['email']
    assert stored['pat'] == payload['pat']
