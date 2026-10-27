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

from planner_lib.backend.port import BackendCredential

logger = logging.getLogger(__name__)


class PatCredentialPolicy:
    """Own the current PAT requirement and rejection semantics."""

    def __init__(self, account_manager) -> None:
        self._account_manager = account_manager

    @staticmethod
    def requires_credential(storage) -> bool:
        from planner_lib.backend.azure import AzureDevOpsBackend
        from planner_lib.backend.registry import get_active_class

        if not storage.exists('config', 'ado_config'):
            return False
        ado = storage.load('config', 'ado_config')
        flags = {}
        if storage.exists('config', 'server_config'):
            flags.update(storage.load('config', 'server_config')['feature_flags'])
        flags.update(ado['feature_flags'])
        return get_active_class(flags) is AzureDevOpsBackend

    def credential_error(self, user_id: str) -> str | None:
        email = self._account_manager.get_account_by_id(user_id)['email']
        return self._account_manager.pat_error(email)

    def authentication_failed(self, credential: Optional[BackendCredential]) -> str:
        if credential is not None:
            if credential['kind'] != 'pat':
                raise ValueError('PAT policy cannot reject an unsupported credential kind')
            email = self._account_manager.get_account_by_id(credential['user_id'])['email']
            self._account_manager.reject_pat(email, credential['token'])
        return 'pat_invalid'


class AccountManagerCredentialProvider:
    """CredentialProvider implementation backed by AccountManager.

    Parameters
    ----------
    account_manager:
        An AccountManager instance (see planner_lib/accounts/).
        Resolves account IDs with ``get_account_by_id`` and loads the
        corresponding credential dict with ``load(email)``.
    """

    def __init__(self, account_manager) -> None:
        self._account_manager = account_manager

    def get_credential(self, user_id: str) -> Optional[BackendCredential]:
        """Return a BackendCredential for *user_id*, or None if no PAT is stored.

        Parameters
        ----------
        user_id:
            Stable account ID from the authenticated session.

        Returns
        -------
        BackendCredential | None
            A TypedDict with ``kind`` (``"pat"``), ``token`` (the PAT), and
            ``user_id`` when a
            PAT is found, otherwise None.
        """
        try:
            email = self._account_manager.get_account_by_id(user_id)['email']
            account = self._account_manager.load(email)
        except KeyError as exc:
            logger.warning("CredentialProvider: failed to load account for '%s': %s", user_id, exc)
            return None

        token = account['pat']
        if not token:
            return None

        return BackendCredential(kind='pat', token=token, user_id=user_id)
