import pytest
from contextlib import closing

from planner_lib.accounts.config import AccountManager, AccountCredentialsPayload
from planner_lib.middleware.session import SessionManager
from planner_lib.session.auth import AuthManager
from planner_lib.storage.diskcache_backend import DiskCacheStorage




def test_live_ado_enrollment_requires_pat_without_creating_account(client, app):
    storage = app.state.container.get('storage')
    first = client.post('/api/auth/enroll', json={
        'email': 'existing@example.com', 'name': 'Existing',
    }).json()
    storage.save('config', 'ado_config', {'organization_url': 'example', 'feature_flags': {}})

    status = client.post('/api/auth/enrollment-status', json={
        'email': 'existing@example.com',
    })
    assert status.json() == {'requiresKey': True, 'requiresPat': False}
    existing = client.post('/api/auth/enroll', json={
        'email': 'existing@example.com', 'accountKey': first['accountKey'],
    })
    assert existing.status_code == 200

    status = client.post('/api/auth/enrollment-status', json={'email': 'new@example.com'})
    assert status.json() == {'requiresKey': False, 'requiresPat': True}
    response = client.post('/api/auth/enroll', json={'email': 'new@example.com', 'name': 'New'})

    assert response.status_code == 400
    assert response.json()['error'] == 'pat_required'
    assert not storage.exists('accounts', 'new@example.com')


def test_live_backend_switch_gates_apis_but_allows_pat_repair(client, app, monkeypatch):
    from planner_lib.azure.AzureClient import AzureClient
    from fastapi.testclient import TestClient
    monkeypatch.setattr(AzureClient, 'get_projects', lambda self: [])
    response = client.post('/api/auth/enroll', json={'email': 'admin@example.com', 'name': 'Admin'})
    assert response.status_code == 200
    storage = app.state.container.get('storage')
    storage.save('config', 'ado_config', {'organization_url': 'example', 'feature_flags': {}})

    for path in ('/api/azure/area-paths?project=Example',):
        response = client.get(path)
        assert response.status_code == 403
        assert response.json()['error'] == 'pat_required'
    assert client.get('/admin/v1/projects').status_code == 200
    assert client.get('/admin/v1/ado-processes').status_code == 200
    assert client.get('/admin/check').json() == {'ok': True, 'permissions': ['admin']}
    for path in ('/admin/v1/ado', '/admin/v1/events-config',
                 '/admin/v1/groups-config', '/admin/v1/system'):
        assert client.get(path).status_code == 200
    for path, content in (
        ('/admin/v1/ado', {'organization_url': 'example', 'feature_flags': {}}),
        ('/admin/v1/events-config', {'event_backend': 'local'}),
        ('/admin/v1/groups-config', {'groups_backend': 'local'}),
        ('/admin/v1/system', {'feature_flags': {}, 'cache': {'ttls': {}}}),
    ):
        assert client.post(path, json={'content': content}).status_code == 200

    accounts = app.state.container.get('account_manager')
    delegate = TestClient(app)
    enrollment = delegate.post('/api/auth/enroll', json={
        'email': 'delegate@example.com', 'name': 'Delegate', 'pat': 'delegate-pat',
    })
    assert enrollment.status_code == 200
    accounts.reject_pat('delegate@example.com', 'delegate-pat')
    assert delegate.get('/admin/check').status_code == 401
    assert delegate.get('/admin/v1/ado').status_code == 401

    assert client.get('/api/auth/me').status_code == 200
    assert client.post('/api/session').status_code == 200
    response = client.post('/api/config', json={'email': 'admin@example.com', 'pat': 'fixture-pat'})
    assert response.status_code == 200
    assert response.json()['ok'] is True
    assert client.get('/admin/check').status_code == 200
    rejected = client.post('/admin/v1/users', json={'email': 'new@example.com', 'permissions': []})
    assert rejected.status_code == 400
    assert rejected.json()['error'] == 'pat_required'
    created = client.post('/admin/v1/users', json={
        'email': 'new@example.com', 'permissions': [], 'pat': 'new-user-fixture-pat',
    })
    assert created.status_code == 200
    assert storage.exists('accounts', 'new@example.com')


def test_existing_account_enrollment_does_not_revalidate_or_replace_pat(client, app, monkeypatch):
    from planner_lib.azure.AzureClient import AzureClient
    first = client.post('/api/auth/enroll', json={'email': 'owner@example.com', 'name': 'Owner'}).json()
    storage = app.state.container.get('storage')
    storage.save('config', 'ado_config', {'organization_url': 'example', 'feature_flags': {}})
    monkeypatch.setattr(AzureClient, 'get_projects', lambda client: [])
    configured = client.post('/api/config', json={
        'email': 'owner@example.com', 'pat': 'active-pat',
    })
    assert configured.status_code == 200

    def reject(client):
        raise RuntimeError('401 Unauthorized')

    monkeypatch.setattr(AzureClient, 'get_projects', reject)
    response = client.post('/api/auth/enroll', json={
        'email': 'owner@example.com', 'accountKey': first['accountKey'],
    })
    assert response.status_code == 200
    assert app.state.container.get('account_manager').load('owner@example.com')['pat'] == 'active-pat'
    assert response.json()['accountKey'] != first['accountKey']


@pytest.mark.parametrize('operation', ['tasks', 'azure_browse', 'admin_iterations'])
def test_ado_auth_failure_routes_to_pat_repair_not_enrollment(client, app, monkeypatch, operation):
    from contextlib import nullcontext
    from types import SimpleNamespace
    from planner_lib.azure.AzureClient import AzureClient
    from planner_lib.backend.errors import BackendAuthError
    monkeypatch.setattr(AzureClient, 'get_projects', lambda client: [])
    client.post('/api/auth/enroll', json={'email': 'owner@example.com', 'name': 'Owner'})
    storage = app.state.container.get('storage')
    storage.save('config', 'ado_config', {'organization_url': 'example', 'feature_flags': {}})
    client.post('/api/config', json={'email': 'owner@example.com', 'pat': 'valid-pat'})
    repository = app.state.container.get('task_repository')

    def reject(*args, **kwargs):
        raise BackendAuthError('401 Unauthorized')

    monkeypatch.setattr(repository, 'read', reject)
    azure = app.state.container.get('azure_client')
    monkeypatch.setattr(azure, 'connect', lambda credential: nullcontext(SimpleNamespace(
        get_area_paths=reject, get_iterations=reject,
    )))
    if operation == 'tasks':
        response = client.get('/api/tasks', headers={'Accept': 'application/json'})
    elif operation == 'azure_browse':
        response = client.get('/api/azure/area-paths?project=Example')
    else:
        response = client.post('/admin/v1/iterations/browse', json={'project': 'Example'})
    assert response.status_code == 403
    assert response.json()['error'] == 'pat_invalid'
    assert client.get('/admin/check').status_code == 200
    assert client.post('/api/config', json={'email': 'owner@example.com', 'pat': 'new-pat'}).status_code == 200
    assert client.get('/admin/check').status_code == 200


def test_invalid_pat_keeps_local_admin_and_cached_task_reads_available(
    client, app, monkeypatch,
):
    from planner_lib.azure.AzureClient import AzureClient

    monkeypatch.setattr(AzureClient, 'get_projects', lambda client: [])
    client.post('/api/auth/enroll', json={'email': 'reader@example.com', 'name': 'Reader'})
    storage = app.state.container.get('storage')
    storage.save('config', 'ado_config', {'organization_url': 'example', 'feature_flags': {}})
    client.post('/api/config', json={'email': 'reader@example.com', 'pat': 'valid-pat'})
    app.state.container.get('account_manager').reject_pat('reader@example.com', 'valid-pat')

    task_repository = app.state.container.get('task_repository')
    monkeypatch.setattr(task_repository, 'read', lambda **kwargs: [{'id': 'cached-task'}])
    monkeypatch.setattr(task_repository, 'snapshot_diagnostics', lambda: [])

    assert client.get('/admin/v1/projects').status_code == 200
    response = client.get('/api/tasks')
    assert response.status_code == 200
    assert response.json() == [{'id': 'cached-task'}]

    rejected_refresh = client.post('/api/tasks/refresh')
    assert rejected_refresh.status_code == 403
    assert rejected_refresh.json()['error'] == 'pat_invalid'
    rejected_browse = client.get('/api/azure/area-paths?project=Example')
    assert rejected_browse.status_code == 403
    assert rejected_browse.json()['error'] == 'pat_invalid'


@pytest.mark.parametrize('pat_state', ['missing', 'invalid'])
@pytest.mark.parametrize('endpoint', ['view', 'scenario', 'groups', 'events', 'event-categories'])
def test_local_record_mutations_do_not_require_pat(client, app, monkeypatch, endpoint, pat_state):
    from unittest.mock import Mock
    from planner_lib.azure.AzureClient import AzureClient

    monkeypatch.setattr(AzureClient, 'get_projects', lambda client: [])
    assert client.post('/api/auth/enroll', json={
        'email': 'local-writer@example.com', 'name': 'Local Writer',
    }).status_code == 200
    container = app.state.container
    accounts = container.get('account_manager')
    accounts.set_permissions(accounts.get_account_id('local-writer@example.com'), [])
    container.get('storage').save('config', 'ado_config', {
        'organization_url': 'example', 'feature_flags': {},
    })
    if pat_state == 'invalid':
        assert client.post('/api/config', json={
            'email': 'local-writer@example.com', 'pat': 'rejected-pat',
        }).status_code == 200
        accounts.reject_pat('local-writer@example.com', 'rejected-pat')
    load = Mock(side_effect=AssertionError('Local records must not load a PAT'))
    acquire = Mock(side_effect=AssertionError('Local records must not acquire credentials'))
    with monkeypatch.context() as local:
        local.setattr(accounts, 'load', load)
        local.setattr(container.get('credential_provider'), 'get_credential', acquire)
        path = '/api/' + endpoint
        resource_route = endpoint not in {'view', 'scenario'}
        data = {'name': 'Local record', 'plan_id': 'example-plan'}
        label_field = 'title' if endpoint == 'events' else 'name'
        if endpoint == 'events':
            data = {'title': 'Local record', 'plan_id': 'example-plan', 'date': '2026-10-27'}
        payload = data if resource_route else {'op': 'save', 'data': data}
        saved = client.post(path, json=payload)
        assert saved.status_code == (201 if resource_route else 200), saved.text
        item_id = saved.json()['id']
        data.update({'id': item_id, label_field: 'Updated local record'})
        if resource_route:
            item_path = path + '/' + item_id
            updated = client.put(item_path, json={label_field: data[label_field]})
            assert updated.status_code == 200, updated.text
            if endpoint == 'event-categories':
                assert any(item['id'] == item_id and item['name'] == data['name']
                           for item in client.get(path).json())
            else:
                assert client.get(item_path).json()[label_field] == data[label_field]
            deleted = client.delete(item_path)
            assert deleted.status_code == 200, deleted.text
            if endpoint == 'event-categories':
                assert all(item['id'] != item_id for item in client.get(path).json())
            else:
                assert client.get(item_path).status_code == 404
        else:
            updated = client.post(path, json={'op': 'save', 'data': data})
            assert updated.status_code == 200, updated.text
            assert client.get(path, params={'id': item_id}).json()['name'] == data['name']
            deleted = client.post(path, json={'op': 'delete', 'data': {'id': item_id}})
            assert deleted.status_code == 200, deleted.text
            assert client.get(path, params={'id': item_id}).status_code == 404
        load.assert_not_called()
        acquire.assert_not_called()

    remote = client.post('/api/tasks/refresh')
    assert remote.status_code == 403
    assert remote.json()['error'] == ('pat_invalid' if pat_state == 'invalid' else 'pat_required')
    client.cookies.clear()
    assert client.post(path, json=payload).status_code == 401


@pytest.mark.parametrize('endpoint', ['events', 'event-categories'])
def test_wiki_event_mutations_still_require_pat(client, app, endpoint):
    from unittest.mock import Mock
    from planner_lib.repository.event_repository import EventRepository
    from tests.helpers import register_service_on_client

    assert client.post('/api/auth/enroll', json={
        'email': 'wiki-writer@example.com', 'name': 'Wiki Writer',
    }).status_code == 200
    container = app.state.container
    container.get('storage').save('config', 'ado_config', {
        'organization_url': 'example', 'feature_flags': {},
    })
    backend = Mock()
    repository = EventRepository(backend, container.get('credential_provider'))
    register_service_on_client(client, 'event_repository', repository)

    response = client.post('/api/' + endpoint, json={})

    assert response.status_code == 403
    assert response.json()['error'] == 'pat_required'
    assert backend.mock_calls == []


@pytest.mark.parametrize('status_code', [401, 403])
@pytest.mark.parametrize('acquisition', ['request', 'operation'])
def test_auth_rejection_preserves_replacement_pat(
    client, app, monkeypatch, status_code, acquisition,
):
    from fastapi import Request
    from unittest.mock import Mock
    from planner_lib.accounts.config import AccountCredentialsPayload
    from planner_lib.azure.AzureClient import AzureClient
    from planner_lib.backend.errors import BackendAuthError
    from planner_lib.middleware.session import get_session_credential_from_request

    monkeypatch.setattr(AzureClient, 'get_projects', lambda client: [])
    client.post('/api/auth/enroll', json={'email': 'owner@example.com', 'name': 'Owner'})
    storage = app.state.container.get('storage')
    storage.save('config', 'ado_config', {'organization_url': 'example', 'feature_flags': {}})
    accounts = app.state.container.get('account_manager')
    client.post('/api/config', json={'email': 'owner@example.com', 'pat': 'original-pat'})
    provider = app.state.container.get('credential_provider')
    acquire = Mock(wraps=provider.get_credential)
    monkeypatch.setattr(provider, 'get_credential', acquire)

    @app.get('/api/test-auth-rejection')
    async def reject_original(request: Request):
        if acquisition == 'request':
            credential = get_session_credential_from_request(request)
        else:
            credential = provider.get_credential(accounts.get_account_id('owner@example.com'))
        assert credential['token'] == 'original-pat'
        accounts.update_credentials(AccountCredentialsPayload(
            email='owner@example.com', pat='replacement-pat',
        ))
        raise BackendAuthError(
            'ADO rejected the operation', status_code=status_code,
            credential=credential if acquisition == 'operation' else None,
        )

    response = client.get('/api/test-auth-rejection')

    assert response.status_code == 403
    assert response.json() == {'error': 'pat_invalid'}
    acquire.assert_called_once_with(accounts.get_account_id('owner@example.com'))
    assert accounts.load('owner@example.com')['pat'] == 'replacement-pat'
    assert accounts.pat_error('owner@example.com') is None


@pytest.mark.parametrize('operation', ['repair', 'create'])
def test_pat_validation_outage_preserves_credentials_and_returns_503(client, app, monkeypatch, operation):
    from planner_lib.azure.AzureClient import AzureClient
    from planner_lib.backend.errors import BackendUnavailableError
    monkeypatch.setattr(AzureClient, 'get_projects', lambda client: [])
    client.post('/api/auth/enroll', json={'email': 'owner@example.com', 'name': 'Owner'})
    storage = app.state.container.get('storage')
    storage.save('config', 'ado_config', {'organization_url': 'example', 'feature_flags': {}})
    client.post('/api/config', json={'email': 'owner@example.com', 'pat': 'valid-pat'})

    def unavailable(client):
        raise BackendUnavailableError('Fixture outage')

    monkeypatch.setattr(AzureClient, 'get_projects', unavailable)
    path, payload = ('/api/config', {'email': 'owner@example.com', 'pat': 'replacement-pat'})
    if operation == 'create':
        path, payload = ('/admin/v1/users', {'email': 'new@example.com', 'pat': 'new-user-pat'})
    response = client.post(path, json=payload)

    assert response.status_code == 503
    assert response.json() == {'error': 'backend_unavailable'}
    assert app.state.container.get('account_manager').load('owner@example.com')['pat'] == 'valid-pat'
    assert client.get('/admin/check').status_code == 200
    assert not storage.exists('accounts', 'new@example.com')


def test_account_key_enrollment_rotates_and_preserves_other_browsers(tmp_path, monkeypatch):
    with closing(DiskCacheStorage(tmp_path)) as storage:
        accounts = AccountManager(storage)
        sessions = SessionManager(accounts, storage)
        auth = AuthManager(storage, accounts, sessions)
        device, key, _ = auth.enroll('owner@example.com', 'Original Name')
        second, next_key, _ = auth.enroll('owner@example.com', account_key=key)
        account_id = accounts.get_account_id('owner@example.com')
        record = storage.load('account_auth', account_id)
        assert set(record) == {'enrolled', 'name', 'account_key_hash', 'devices'}
        assert record['name'] == 'Original Name'
        assert next_key != key
        assert auth.authenticate_device(device)[0] == 'owner@example.com'
        assert auth.authenticate_device(second)[0] == 'owner@example.com'
        with pytest.raises(PermissionError):
            auth.enroll('owner@example.com', account_key=key)
        with pytest.raises(PermissionError):
            auth.enroll('unknown@example.com', 'Unknown', account_key=next_key)
        assert len(accounts.list_accounts()) == 1


def test_key_authorized_deletion_removes_owned_data_and_preserves_other_accounts(tmp_path, monkeypatch):
    with closing(DiskCacheStorage(tmp_path)) as storage:
        accounts = AccountManager(storage)
        sessions = SessionManager(accounts, storage)
        auth = AuthManager(storage, accounts, sessions)
        admin_device, _, _ = auth.enroll('admin@example.com', 'Admin')
        device, key, session = auth.enroll('owner@example.com', 'Owner')
        owner_id = accounts.get_account_id('owner@example.com')
        admin_id = accounts.get_account_id('admin@example.com')
        accounts.update_credentials(AccountCredentialsPayload(email='owner@example.com', pat='azure-pat'))
        for namespace, register in [('views', 'view_register'), ('scenarios', 'scenario_register')]:
            storage.save(namespace, owner_id + '_saved', {'private': True})
            storage.save(namespace, owner_id + '_orphan', {'private': True})
            storage.save(namespace, admin_id + '_saved', {'keep': True})
            storage.save(namespace, register, {
                owner_id + '_saved': {'user': owner_id, 'id': 'saved'},
                owner_id + '_missing': {'user': owner_id, 'id': 'missing'},
                admin_id + '_saved': {'user': admin_id, 'id': 'saved'},
            })
        with pytest.raises(PermissionError):
            auth.delete_account('owner@example.com', 'wrong-key')
        auth.delete_account('owner@example.com', key)
        assert not storage.exists('accounts', 'owner@example.com')
        assert not storage.exists('account_auth', owner_id)
        assert sessions.get(session) is None
        with pytest.raises(PermissionError):
            auth.authenticate_device(device)
        assert auth.authenticate_device(admin_device)[0] == 'admin@example.com'
        for namespace, register in [('views', 'view_register'), ('scenarios', 'scenario_register')]:
            assert set(storage.list_keys(namespace)) == {register, admin_id + '_saved'}
            assert set(storage.load(namespace, register)) == {admin_id + '_saved'}
        auth.enroll('owner@example.com', 'New Owner')
        assert accounts.get_account_id('owner@example.com') != owner_id


def test_enrollment_and_account_keys_survive_restart(tmp_path, monkeypatch):
    storage = DiskCacheStorage(tmp_path)
    accounts = AccountManager(storage)
    sessions = SessionManager(accounts, storage)
    auth = AuthManager(storage, accounts, sessions)

    device, recovery, session = auth.enroll('first@example.com', 'First User')
    assert accounts.has_permission('first@example.com', 'admin')
    assert sessions.is_valid(session)
    assert SessionManager(accounts, storage).is_valid(session)
    with pytest.raises(PermissionError):
        auth.enroll('first@example.com', 'Impersonator')

    renewed_email, renewed_session = AuthManager(
        storage, accounts, SessionManager(accounts, storage)
    ).authenticate_device(device)
    assert renewed_email == 'first@example.com'
    assert renewed_session != session

    second_device, next_key, _ = auth.enroll('first@example.com', account_key=recovery)
    assert auth.authenticate_device(second_device)[0] == 'first@example.com'
    with pytest.raises(PermissionError):
        auth.enroll('first@example.com', account_key=recovery)

    third_device, next_recovery, _ = auth.enroll('first@example.com', account_key=next_key)
    assert auth.authenticate_device(third_device)[0] == 'first@example.com'
    with pytest.raises(PermissionError):
        auth.enroll('first@example.com', account_key=next_key)
    assert next_recovery != recovery
    auth.revoke('first@example.com', second_device.split('.')[1])
    with pytest.raises(PermissionError):
        auth.authenticate_device(second_device)
    storage.close()


def test_session_idle_and_absolute_expiry(tmp_path, monkeypatch):
    storage = DiskCacheStorage(tmp_path)
    accounts = AccountManager(storage)
    sessions = SessionManager(accounts, storage)
    auth = AuthManager(storage, accounts, sessions)
    device, _, session = auth.enroll('first@example.com', 'First User')
    import time
    now = time.time()
    monkeypatch.setattr('planner_lib.middleware.session.time.time', lambda: now + 15 * 86400)
    assert not sessions.is_valid(session)
    _, fresh_session = auth.authenticate_device(device)
    assert sessions.is_valid(fresh_session)
    auth.revoke('first@example.com', device.split('.')[1])
    assert not sessions.is_valid(fresh_session)
    storage.close()


def test_absolute_session_limit_is_not_extended_by_activity(tmp_path, monkeypatch):
    storage = DiskCacheStorage(tmp_path)
    accounts = AccountManager(storage)
    sessions = SessionManager(accounts, storage)
    _, _, session = AuthManager(storage, accounts, sessions).enroll('first@example.com', 'First User')
    import time
    now = time.time()
    for days in (10, 20, 29):
        monkeypatch.setattr('planner_lib.middleware.session.time.time', lambda: now + days * 86400)
        assert sessions.get(session) is not None
    monkeypatch.setattr('planner_lib.middleware.session.time.time', lambda: now + 31 * 86400)
    assert not sessions.is_valid(session)
    storage.close()


def test_enrollment_race_has_one_winner(tmp_path, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    storage = DiskCacheStorage(tmp_path)
    accounts = AccountManager(storage)

    def enroll_once(index):
        auth = AuthManager(storage, accounts, SessionManager(accounts, storage))
        try:
            auth.enroll('shared@example.com', f'User {index}')
            return True
        except PermissionError:
            return False

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sum(executor.map(enroll_once, range(2))) == 1
    assert len(storage.load('account_auth', accounts.get_account_id('shared@example.com'))['devices']) == 1
    storage.close()


def test_reset_invalidates_only_the_accounts_key_and_devices(tmp_path, monkeypatch):
    storage = DiskCacheStorage(tmp_path)
    try:
        accounts = AccountManager(storage)
        auth = AuthManager(storage, accounts, SessionManager(accounts, storage))
        first_device, first_key, _ = auth.enroll('first@example.com', 'First User')
        other_device, other_key, _ = auth.enroll('other@example.com', 'Other User')
        reset_key = auth.reset('first@example.com')
        with pytest.raises(PermissionError):
            auth.enroll('first@example.com', account_key=first_key)
        with pytest.raises(PermissionError):
            auth.authenticate_device(first_device)
        assert auth.enroll('first@example.com', account_key=reset_key)[0]
        assert auth.enroll('other@example.com', account_key=other_key)[0]
        assert auth.authenticate_device(other_device)[0] == 'other@example.com'
    finally:
        storage.close()


def test_sessions_are_bound_to_account_id_not_reused_email(tmp_path, monkeypatch):
    storage = DiskCacheStorage(tmp_path)
    try:
        accounts = AccountManager(storage)
        sessions = SessionManager(accounts, storage)
        auth = AuthManager(storage, accounts, sessions)
        auth.enroll('admin@example.com', 'Admin')
        _, _, session = auth.enroll('owner@example.com', 'Original Owner')
        original_id = accounts.get_account_id('owner@example.com')
        assert sessions.get(session)['account_id'] == original_id
        accounts.delete_account(original_id)
        assert not storage.exists('account_auth', original_id)
        assert all(storage.load('auth_sessions', key)['account_id'] != original_id
               for key in storage.list_keys('auth_sessions'))
        auth.enroll('owner@example.com', 'New Owner')
        assert sessions.get(session) is None
    finally:
        storage.close()


def test_credential_provider_resolves_account_id(tmp_path):
    from planner_lib.accounts.config import AccountCredentialsPayload
    from planner_lib.backend.credential import AccountManagerCredentialProvider

    storage = DiskCacheStorage(tmp_path)
    try:
        accounts = AccountManager(storage)
        accounts.create_account(AccountCredentialsPayload(email='owner@example.com', pat='azure-pat'))
        account_id = accounts.get_account_id('owner@example.com')
        provider = AccountManagerCredentialProvider(accounts)
        assert provider.get_credential(account_id) == {'kind': 'pat', 'token': 'azure-pat', 'user_id': account_id}
        assert provider.get_credential('owner@example.com') is None
    finally:
        storage.close()


def test_attempt_throttle(tmp_path):
    storage = DiskCacheStorage(tmp_path)
    accounts = AccountManager(storage)
    auth = AuthManager(storage, accounts, SessionManager(accounts, storage))
    for _ in range(30):
        auth.throttle('test-device')
    with pytest.raises(PermissionError):
        auth.throttle('test-device')
    storage.close()


def test_account_key_race_has_one_winner(tmp_path, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    with closing(DiskCacheStorage(tmp_path)) as storage:
        accounts = AccountManager(storage)
        auth = AuthManager(storage, accounts, SessionManager(accounts, storage))
        _, key, _ = auth.enroll('owner@example.com', 'Owner')

        def enroll_once(index):
            manager = AuthManager(storage, accounts, SessionManager(accounts, storage))
            try:
                return manager.enroll('owner@example.com', account_key=key)[1]
            except PermissionError:
                return None

        with ThreadPoolExecutor(max_workers=2) as executor:
            keys = list(executor.map(enroll_once, range(2)))
        assert sum(value is not None for value in keys) == 1
        account_id = accounts.get_account_id('owner@example.com')
        assert len(storage.load('account_auth', account_id)['devices']) == 2


def test_final_admin_deletion_keeps_current_key(tmp_path, monkeypatch):
    with closing(DiskCacheStorage(tmp_path)) as storage:
        accounts = AccountManager(storage)
        auth = AuthManager(storage, accounts, SessionManager(accounts, storage))
        _, key, _ = auth.enroll('admin@example.com', 'Admin')
        with pytest.raises(ValueError, match='final admin'):
            auth.delete_account('admin@example.com', key)
        assert auth.enroll('admin@example.com', account_key=key)[1] != key


def test_enrollment_racing_deletion_has_one_winner(tmp_path, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    with closing(DiskCacheStorage(tmp_path)) as storage:
        accounts = AccountManager(storage)
        auth = AuthManager(storage, accounts, SessionManager(accounts, storage))
        auth.enroll('admin@example.com', 'Admin')
        _, key, _ = auth.enroll('owner@example.com', 'Owner')

        def consume_key(operation):
            manager = AuthManager(storage, accounts, SessionManager(accounts, storage))
            try:
                if operation == 'enroll':
                    manager.enroll('owner@example.com', account_key=key)
                else:
                    manager.delete_account('owner@example.com', key)
                return True
            except PermissionError:
                return False

        with ThreadPoolExecutor(max_workers=2) as executor:
            outcomes = list(executor.map(consume_key, ['enroll', 'delete']))
        assert sum(outcomes) == 1
        assert storage.exists('accounts', 'owner@example.com') == outcomes[0]


def test_concurrent_admin_deletion_preserves_a_final_admin(tmp_path, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    with closing(DiskCacheStorage(tmp_path)) as storage:
        accounts = AccountManager(storage)
        auth = AuthManager(storage, accounts, SessionManager(accounts, storage))
        _, first_key, _ = auth.enroll('first@example.com', 'First Admin')
        _, second_key, _ = auth.enroll('second@example.com', 'Second Admin')
        second = storage.load('accounts', 'second@example.com')
        second['permissions'] = ['admin']
        storage.save('accounts', 'second@example.com', second)

        def delete_once(credential):
            manager = AuthManager(storage, accounts, SessionManager(accounts, storage))
            try:
                manager.delete_account(*credential)
                return True
            except ValueError:
                return False

        credentials = [('first@example.com', first_key), ('second@example.com', second_key)]
        with ThreadPoolExecutor(max_workers=2) as executor:
            assert sum(executor.map(delete_once, credentials)) == 1
        assert len(accounts.list_accounts()) == 1
        for email, key in credentials:
            if storage.exists('accounts', email):
                assert auth.enroll(email, account_key=key)[1] != key


def test_failed_deletion_rolls_back_credentials_and_owned_data(tmp_path, monkeypatch):
    with closing(DiskCacheStorage(tmp_path)) as storage:
        accounts = AccountManager(storage)
        auth = AuthManager(storage, accounts, SessionManager(accounts, storage))
        auth.enroll('admin@example.com', 'Admin')
        _, key, _ = auth.enroll('owner@example.com', 'Owner')
        accounts.update_credentials(AccountCredentialsPayload(email='owner@example.com', pat='azure-pat'))
        owner_id = accounts.get_account_id('owner@example.com')
        storage.save('views', owner_id + '_saved', {'private': True})
        storage.save('views', 'view_register', {
            owner_id + '_saved': {'user': owner_id, 'id': 'saved'},
        })
        namespaces = ['accounts', 'account_auth', 'auth_sessions', 'views', 'scenarios']
        before = {
            namespace: {name: storage.load(namespace, name) for name in storage.list_keys(namespace)}
            for namespace in namespaces
        }
        original_delete = storage.delete

        def fail_account_delete(namespace, name):
            if namespace == 'accounts':
                raise OSError('Account storage failure')
            return original_delete(namespace, name)

        monkeypatch.setattr(storage, 'delete', fail_account_delete)
        with pytest.raises(OSError, match='Account storage failure'):
            auth.delete_account('owner@example.com', key)
        assert {
            namespace: {name: storage.load(namespace, name) for name in storage.list_keys(namespace)}
            for namespace in namespaces
        } == before
        assert auth.enroll('owner@example.com', account_key=key)[1] != key