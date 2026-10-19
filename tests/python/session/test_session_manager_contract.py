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