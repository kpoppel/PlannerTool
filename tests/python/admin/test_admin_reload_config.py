import pytest


pytestmark = pytest.mark.real_auth


def test_reload_config_endpoint_sets_ok(client):
    assert client.post('/api/auth/enroll', json={
        'email': 'test@example.com', 'name': 'Reload Administrator',
    }).status_code == 200
    acct = {"email": "test@example.com", "pat": "token"}
    r_acct = client.post('/api/config', json=acct)
    assert r_acct.status_code in (200, 201)
    r_sess = client.post('/api/session')
    assert r_sess.status_code == 200
    accounts = client.app.state.container.get('account_manager')
    accounts.set_permissions(accounts.get_account_id(acct['email']), ['admin'])
    resp = client.post('/admin/v1/reload-config')
    assert resp.status_code == 200
    assert resp.json().get('ok') is True