"""Session creation rejects unknown accounts rather than granting implicit access."""

import pytest

from planner_lib.accounts.config import AccountManager
from planner_lib.middleware.session import SessionManager
from planner_lib.storage.memory_backend import MemoryStorage

pytestmark = pytest.mark.real_auth


def test_unknown_account_cannot_create_session():
    storage = MemoryStorage()
    sessions = SessionManager(AccountManager(storage), storage)

    with pytest.raises(KeyError):
        sessions.create('unknown@example.com')