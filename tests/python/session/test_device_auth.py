import pytest
from contextlib import closing

from planner_lib.accounts.config import AccountManager, AccountCredentialsPayload
from planner_lib.middleware.session import SessionManager
from planner_lib.session.auth import AuthManager
from planner_lib.storage.diskcache_backend import DiskCacheStorage


REAL_CREATE = SessionManager.create
REAL_GET = SessionManager.get


def test_account_key_enrollment_rotates_and_preserves_other_browsers(tmp_path, monkeypatch):
    monkeypatch.setattr(SessionManager, 'create', REAL_CREATE)
    monkeypatch.setattr(SessionManager, 'get', REAL_GET)
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
    monkeypatch.setattr(SessionManager, 'create', REAL_CREATE)
    monkeypatch.setattr(SessionManager, 'get', REAL_GET)
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
    monkeypatch.setattr(SessionManager, 'create', REAL_CREATE)
    monkeypatch.setattr(SessionManager, 'get', REAL_GET)
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
    monkeypatch.setattr(SessionManager, 'create', REAL_CREATE)
    monkeypatch.setattr(SessionManager, 'get', REAL_GET)
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
    monkeypatch.setattr(SessionManager, 'create', REAL_CREATE)
    monkeypatch.setattr(SessionManager, 'get', REAL_GET)
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
    monkeypatch.setattr(SessionManager, 'create', REAL_CREATE)
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
    monkeypatch.setattr(SessionManager, 'create', REAL_CREATE)
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
    monkeypatch.setattr(SessionManager, 'create', REAL_CREATE)
    monkeypatch.setattr(SessionManager, 'get', REAL_GET)
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
        assert provider.get_credential(account_id) == {'token': 'azure-pat', 'user_id': account_id}
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
    monkeypatch.setattr(SessionManager, 'create', REAL_CREATE)
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
    monkeypatch.setattr(SessionManager, 'create', REAL_CREATE)
    with closing(DiskCacheStorage(tmp_path)) as storage:
        accounts = AccountManager(storage)
        auth = AuthManager(storage, accounts, SessionManager(accounts, storage))
        _, key, _ = auth.enroll('admin@example.com', 'Admin')
        with pytest.raises(ValueError, match='final admin'):
            auth.delete_account('admin@example.com', key)
        assert auth.enroll('admin@example.com', account_key=key)[1] != key


def test_enrollment_racing_deletion_has_one_winner(tmp_path, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    monkeypatch.setattr(SessionManager, 'create', REAL_CREATE)
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
    monkeypatch.setattr(SessionManager, 'create', REAL_CREATE)
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
    monkeypatch.setattr(SessionManager, 'create', REAL_CREATE)
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