"""Admin UI access follows cookie authentication and current permissions."""

import pytest

pytestmark = pytest.mark.real_auth


def test_admin_access_requires_enrollment_and_admin_permission(client, tmp_path, monkeypatch):
    static_dir = tmp_path / 'static'
    admin_dir = static_dir / 'admin'
    admin_dir.mkdir(parents=True)
    (admin_dir / 'login.html').write_text('<head></head><body>Admin Login</body>')
    (admin_dir / 'index.html').write_text('<head></head><body>Admin Workspace</body>')
    monkeypatch.setattr(client.app.state, 'static_dir', str(static_dir))

    anonymous = client.get('/admin/')
    assert anonymous.status_code == 200
    assert 'Admin Login' in anonymous.text
    assert client.post('/api/session', json={'email': 'owner@example.com'}).status_code == 401

    assert client.post('/api/auth/enroll', json={
        'email': 'owner@example.com', 'name': 'Admin Access Contract',
    }).status_code == 200
    accounts = client.app.state.container.get('account_manager')
    account_id = accounts.get_account_id('owner@example.com')
    accounts.set_permissions(account_id, [])

    denied = client.get('/admin/', follow_redirects=False)
    assert denied.status_code == 302
    assert denied.headers['location'] == '/admin/login?error=not_admin'

    accounts.set_permissions(account_id, ['admin'])
    assert client.post('/api/session').status_code == 200
    authorized = client.get('/admin/')
    assert authorized.status_code == 200
    assert 'Admin Workspace' in authorized.text
    assert client.get('/admin/check').json() == {'ok': True}