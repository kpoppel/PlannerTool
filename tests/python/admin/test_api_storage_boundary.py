"""Admin storage failures map to explicit HTTP errors without leaking details."""

import asyncio
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from planner_lib.accounts.config import AccountCredentialsPayload
from planner_lib.admin import api as admin_api


def make_request(services, payload=None, cookies=None):
    async def read_payload():
        return payload

    return SimpleNamespace(
        scope={'root_path': ''}, headers={}, cookies={} if cookies is None else cookies,
        app=SimpleNamespace(state=SimpleNamespace(
            container=SimpleNamespace(get=lambda name: services[name]), static_dir='dist',
        )),
        url=SimpleNamespace(path='/'), json=read_payload,
    )


def test_save_projects_storage_failure_returns_500():
    service = SimpleNamespace(
        get_config=Mock(return_value=None),
        save_config=Mock(side_effect=RuntimeError('private-storage-error')),
    )
    request = make_request({'admin_service': service}, {
        'content': {'container_types': ['project', 'team'], 'project_map': []},
    })
    with pytest.raises(HTTPException) as error:
        asyncio.run(admin_api.admin_save_projects.__wrapped__(request))
    assert error.value.status_code == 500
    assert error.value.detail == 'Internal server error'
    service.save_config.assert_called_once()


def test_get_projects_storage_failure_returns_500():
    service = SimpleNamespace(get_config=Mock(side_effect=RuntimeError('private-storage-error')))
    with pytest.raises(HTTPException) as error:
        asyncio.run(admin_api.admin_get_projects.__wrapped__(make_request({'admin_service': service})))
    assert error.value.status_code == 500
    assert error.value.detail == 'Internal server error'


@pytest.mark.real_auth
def test_user_listing_storage_failure_returns_generic_500(client, monkeypatch):
    assert client.post('/api/auth/enroll', json={
        'email': 'listing@example.com', 'name': 'User Listing Contract',
    }).status_code == 200
    accounts = client.app.state.container.get('account_manager')
    accounts.set_permissions(accounts.get_account_id('listing@example.com'), ['admin'])
    failed_list = Mock(side_effect=RuntimeError('private-storage-error'))
    monkeypatch.setattr(accounts, 'list_accounts', failed_list)

    response = client.get('/admin/v1/users')

    failed_list.assert_called_once()
    assert response.status_code == 500
    assert response.json() == 'Internal server error'
    assert 'private-storage-error' not in response.text


def test_admin_root_files_missing_raises_404(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    with pytest.raises(HTTPException) as error:
        asyncio.run(admin_api.admin_root(make_request({})))
    assert error.value.status_code == 404


def test_reload_missing_service_returns_500():
    with pytest.raises(HTTPException) as error:
        asyncio.run(admin_api.api_admin_reload_config.__wrapped__(make_request({})))
    assert error.value.status_code == 500
    assert error.value.detail == 'Internal server error'


@pytest.mark.real_auth
def test_admin_delete_user_returns_not_found_for_missing_storage_key(client, monkeypatch):
    assert client.post('/api/auth/enroll', json={
        'email': 'deletion@example.com', 'name': 'Admin Deletion Contract',
    }).status_code == 200
    accounts = client.app.state.container.get('account_manager')
    accounts.set_permissions(accounts.get_account_id('deletion@example.com'), ['admin'])
    target = accounts.create_account(AccountCredentialsPayload(email='target@example.com'))
    failed_delete = Mock(side_effect=KeyError(target['id']))
    monkeypatch.setattr(accounts, 'delete_account', failed_delete)

    response = client.delete(f"/admin/v1/users/{target['id']}")

    failed_delete.assert_called_once_with(target['id'])
    assert response.status_code == 404
    assert response.json()['error'] == 'account_not_found'


def test_admin_root_missing_account_manager_returns_500(monkeypatch):
    request = make_request({}, cookies={'sessionId': 'test-session'})
    monkeypatch.setattr(
        'planner_lib.admin.setup_routes.get_session_context_from_request',
        lambda request: {'email': 'admin@example.com'},
    )
    with pytest.raises(HTTPException) as error:
        asyncio.run(admin_api.admin_root(request))
    assert error.value.status_code == 500
    assert error.value.detail == 'Internal server error'