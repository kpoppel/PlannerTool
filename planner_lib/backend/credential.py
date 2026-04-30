"""AccountManagerCredentialProvider: CredentialProvider backed by AccountManager.

Wraps the existing AccountManager (which stores per-user PATs in encrypted
storage) and exposes the CredentialProvider protocol so backends can call
get_credential(user_id) without holding a direct reference to AccountManager.

No PAT strings are stored in the provider itself — they are fetched on
demand from AccountManager.load() and returned inside a BackendCredential
TypedDict for immediate use by the caller.
"""
from __future__ import annotations

import logging
from typing import Optional

from planner_lib.backend.port import BackendCredential, CredentialProvider

logger = logging.getLogger(__name__)


class AccountManagerCredentialProvider:
    """CredentialProvider implementation backed by AccountManager.

    Parameters
    ----------
    account_manager:
        An AccountManager instance (see planner_lib/accounts/).
        Must expose a ``load(user_id: str)`` method that returns an object
        with a ``.pat`` attribute (or None if no credential is stored).
    """

    def __init__(self, account_manager) -> None:
        self._account_manager = account_manager

    def get_credential(self, user_id: str) -> Optional[BackendCredential]:
        """Return a BackendCredential for *user_id*, or None if no PAT is stored.

        Parameters
        ----------
        user_id:
            Session-level user identifier (typically the email address or
            the session-owner identifier used by AccountManager).

        Returns
        -------
        BackendCredential | None
            A TypedDict with ``token`` (the PAT) and ``user_id`` when a
            PAT is found, otherwise None.
        """
        try:
            account = self._account_manager.load(user_id)
        except Exception as exc:
            logger.warning("CredentialProvider: failed to load account for '%s': %s", user_id, exc)
            return None

        if account is None:
            return None

        # account_manager.load() returns a plain dict with a 'pat' key.
        # Support both dict and object (attribute) access for forward compat.
        if isinstance(account, dict):
            token = account.get('pat') or account.get('token')
        else:
            token = getattr(account, 'pat', None) or getattr(account, 'token', None)
        if not token:
            return None

        return BackendCredential(token=token, user_id=user_id)
