import pytest


pytestmark = pytest.mark.real_auth


def test_reload_config_raises_500(client, monkeypatch):
    assert client.post('/api/auth/enroll', json={
        'email': 'reload-error@example.com', 'name': 'Reload Error Administrator',
    }).status_code == 200
    response = client.post('/api/config', json={
        'email': 'reload-error@example.com', 'pat': 'token',
    })
    assert response.status_code in (200, 201)
    assert client.post('/api/session').status_code == 200

    accounts = client.app.state.container.get('account_manager')
    account_id = accounts.get_account_id('reload-error@example.com')
    accounts.set_permissions(account_id, ['admin'])

    admin_service = client.app.state.container.get('admin_service')

    def fail_reload():
        raise RuntimeError('fail')

    monkeypatch.setattr(admin_service, 'reload_config', fail_reload)

    response = client.post('/admin/v1/reload-config')
    assert response.status_code == 500
