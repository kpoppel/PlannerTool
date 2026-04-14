from fastapi.testclient import TestClient

from planner_lib.main import create_app, Config


def test_post_config_and_persistence(client, app):
    payload = {'email': 'tester@example.com', 'pat': 'secrettoken'}
    resp = client.post('/api/account', json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body.get('ok') is True

    # verify config can be loaded via the app's account manager storage.
    # PATs are encrypted at rest; use AccountManager.get() to decrypt and
    # verify the round-trip value equals the original plaintext.
    result = app.state.container.get('account_manager').load('tester@example.com')
    assert result['email'] == payload['email']
    assert result['pat'] == payload['pat']
