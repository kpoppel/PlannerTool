from fastapi.testclient import TestClient

from planner_lib.main import create_app, Config
from planner_lib.middleware.session import SessionManager


REAL_CREATE = SessionManager.create
REAL_GET = SessionManager.get


def test_post_config_and_persistence(client, app, monkeypatch):
    monkeypatch.setattr(SessionManager, 'create', REAL_CREATE)
    monkeypatch.setattr(SessionManager, 'get', REAL_GET)
    assert client.post('/api/auth/enroll', json={
        'email': 'test@example.com', 'name': 'Test User',
    }).status_code == 200
    payload = {'email': 'test@example.com', 'pat': 'secrettoken'}
    resp = client.post('/api/config', json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body.get('ok') is True

    # verify config can be loaded via the app's account manager storage.
    # PATs are encrypted at rest; use AccountManager.get() to decrypt and
    # verify the round-trip value equals the original plaintext.
    result = app.state.container.get('account_manager').load('test@example.com')
    assert result['email'] == payload['email']
    assert result['pat'] == payload['pat']
