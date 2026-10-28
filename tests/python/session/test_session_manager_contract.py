"""Session creation rejects unknown accounts rather than granting implicit access."""

import pytest

from planner_lib.accounts.config import AccountCredentialsPayload, AccountManager
from planner_lib.middleware.session import SessionManager
from planner_lib.storage.memory_backend import MemoryStorage

pytestmark = pytest.mark.real_auth


def test_session_manager_exposes_only_persisted_identity_contract():
    from planner_lib.middleware.interfaces import SessionManagerProtocol

    storage = MemoryStorage()
    sessions = SessionManager(AccountManager(storage), storage)

    assert isinstance(sessions, SessionManagerProtocol)
    assert not hasattr(sessions, '_store')
    assert not hasattr(sessions, 'get_val')
    assert not hasattr(sessions, 'exists')


def test_unknown_account_cannot_create_session():
    storage = MemoryStorage()
    sessions = SessionManager(AccountManager(storage), storage)

    with pytest.raises(KeyError):
        sessions.create('unknown@example.com')


def test_session_binding_can_validate_without_enrollment_storage(monkeypatch):
    from unittest.mock import Mock

    storage = MemoryStorage()
    accounts = AccountManager(storage)
    account_id = accounts.create_account(AccountCredentialsPayload(email='bound@example.com'))['id']
    storage.delete('account_auth', account_id)
    binding = Mock()
    binding.validate.return_value = True
    factory = Mock(return_value=binding)
    sessions = SessionManager(accounts, storage, session_binding_factory=factory)
    monkeypatch.setattr('planner_lib.middleware.session.time.time', lambda: 1000.0)
    session_id = sessions.create('bound@example.com', 'binding-id')

    assert sessions.get(session_id) == {
        'account_id': account_id, 'email': 'bound@example.com', 'device_id': 'binding-id',
    }
    factory.assert_called_once_with(storage)
    binding.validate.assert_called_once_with(account_id, 'binding-id', 1000.0, refresh=True)
    assert sessions.is_valid(session_id)
    binding.validate.assert_called_with(account_id, 'binding-id', 1000.0, refresh=False)

    binding.validate.return_value = False
    assert sessions.get(session_id) is None
    assert not sessions.is_valid(session_id)


def test_unbound_session_validates_its_enrollment_binding():
    from unittest.mock import Mock

    storage = MemoryStorage()
    accounts = AccountManager(storage)
    account_id = accounts.create_account(AccountCredentialsPayload(email='local@example.com'))['id']
    storage.delete('account_auth', account_id)
    binding = Mock()
    binding.validate.return_value = True
    sessions = SessionManager(accounts, storage, session_binding_factory=Mock(return_value=binding))
    session_id = sessions.create('local@example.com')

    assert sessions.get(session_id)['account_id'] == account_id
    assert sessions.is_valid(session_id)
    assert binding.validate.call_count == 2
    assert binding.validate.call_args.args[:2] == (account_id, None)
    binding.validate.return_value = False
    assert sessions.get(session_id) is None


def test_source_and_epoch_mismatches_fail_closed():
    from planner_lib.session.policy import SessionPolicy, initial_authentication

    storage = MemoryStorage()
    accounts = AccountManager(storage)
    accounts.create_account(AccountCredentialsPayload(email='epoch@example.test'))
    settings = initial_authentication()
    storage.save('config', 'authentication', settings)
    sessions = SessionManager(accounts, storage, auth_policy=SessionPolicy(storage))
    sid = sessions.create('epoch@example.test')
    assert sessions.is_valid(sid)
    storage.save('config', 'authentication', {**settings, 'epoch': 2})
    assert not sessions.is_valid(sid)
    with pytest.raises(PermissionError, match='Inactive'):
        sessions.create('epoch@example.test', source='entra')


def test_revision_44_invalidates_sessions_but_preserves_accounts():
    from planner_lib.migrations.revisions import upgrade_44

    storage = MemoryStorage()
    accounts = AccountManager(storage)
    account = accounts.create_account(AccountCredentialsPayload(email='upgrade@example.test'))
    sid = SessionManager(accounts, storage).create('upgrade@example.test')
    assert sid
    upgrade_44(storage)
    assert list(storage.list_keys('auth_sessions')) == []
    assert accounts.get_account_id('upgrade@example.test') == account['id']
    assert storage.load('config', 'authentication')['active'] == 'enrollment'


def test_last_active_survives_session_expiration_and_is_not_updated_by_validity_checks(monkeypatch):
    storage = MemoryStorage()
    accounts = AccountManager(storage)
    account_id = accounts.create_account(AccountCredentialsPayload(email='active@example.com'))['id']
    sessions = SessionManager(accounts, storage)
    monkeypatch.setattr('planner_lib.middleware.session.time.time', lambda: 1000.0)
    session_id = sessions.create('active@example.com')
    assert accounts.list_accounts()[0]['lastActive'] == 1000.0

    monkeypatch.setattr('planner_lib.middleware.session.time.time', lambda: 1065.0)
    assert sessions.is_valid(session_id)
    assert accounts.list_accounts()[0]['lastActive'] == 1000.0
    assert sessions.get(session_id)['account_id'] == account_id
    assert accounts.list_accounts()[0]['lastActive'] == 1065.0

    monkeypatch.setattr('planner_lib.middleware.session.time.time', lambda: 40 * 86400.0)
    assert sessions.get(session_id) is None
    assert accounts.list_accounts()[0]['lastActive'] == 1065.0
    sessions.delete_by_account_id(account_id)
    assert accounts.list_accounts()[0]['lastActive'] == 1065.0
    accounts.delete_account(account_id)
    assert not storage.exists('account_activity', account_id)


def test_activity_updates_are_coalesced_without_losing_later_activity(monkeypatch):
    storage = MemoryStorage()
    accounts = AccountManager(storage)
    accounts.create_account(AccountCredentialsPayload(email='active@example.com'))
    sessions = SessionManager(accounts, storage)
    monkeypatch.setattr('planner_lib.middleware.session.time.time', lambda: 1000.0)
    session_id = sessions.create('active@example.com')
    monkeypatch.setattr('planner_lib.middleware.session.time.time', lambda: 1010.0)
    sessions.get(session_id)
    assert accounts.list_accounts()[0]['lastActive'] == 1000.0
    monkeypatch.setattr('planner_lib.middleware.session.time.time', lambda: 1060.0)
    sessions.get(session_id)
    assert accounts.list_accounts()[0]['lastActive'] == 1060.0