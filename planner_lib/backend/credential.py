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
import math
import time
from contextlib import contextmanager
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


class DelegatedCredentialProvider:
    """Acquire credentials only for the exact acting session's local grant."""

    def __init__(self, storage, accounts, client):
        self.storage = storage
        self.accounts = accounts
        self.client = client

    def get_credential(self, user_id):
        from planner_lib.middleware.session import current_session_context
        from planner_lib.session.broker import AuthFailure

        context = current_session_context.get()
        if context is None or context['account_id'] != user_id or 'binding' not in context:
            raise AuthFailure('invalid_session', 401)
        policy = self.storage.load('config', 'authentication')
        return self.acquire(user_id, context['binding'], policy['epoch'])

    def validate(self, credential):
        from planner_lib.session.broker import AuthFailure
        from planner_lib.middleware.session import SESSION_IDLE, SESSION_MAX

        if credential['kind'] != 'bearer':
            raise ValueError('Delegated provider requires a Bearer credential')
        policy = self.storage.load('config', 'authentication')
        binding = credential['binding']
        if (policy['active'] != 'entra' or policy['epoch'] != credential['epoch']
                or not self.storage.exists('auth_grants', binding)):
            raise AuthFailure('invalid_session', 401)
        grant = self.storage.load('auth_grants', binding)
        now = time.time()
        if (grant['account_id'] != credential['user_id'] or grant['epoch'] != credential['epoch']
                or grant['environment'] != self.client.settings.metadata()):
            raise AuthFailure('invalid_session', 401)
        sessions = (self.storage.load('auth_sessions', key) for key in self.storage.list_keys('auth_sessions'))
        if not any(session['source'] == 'entra' and session['binding'] == binding
               and session['account_id'] == credential['user_id'] and session['epoch'] == credential['epoch']
               and now - session['last_seen'] <= SESSION_IDLE and now - session['created'] <= SESSION_MAX
               for session in sessions):
            raise AuthFailure('invalid_session', 401)
        try:
            self.accounts.get_account_by_id(credential['user_id'])
        except KeyError as error:
            raise AuthFailure('invalid_session', 401) from error
        if grant['revoked'] or grant['expires_at'] <= now:
            raise AuthFailure('interaction_required', 409)
        return grant

    def acquire(self, user_id, binding, epoch):
        from planner_lib.accounts.config import _get_fernet
        from planner_lib.session.broker import AuthFailure

        credential = {'kind': 'bearer', 'user_id': user_id, 'binding': binding, 'epoch': epoch}
        with self.storage.transaction():
            grant = self.validate(credential)
            reference = _get_fernet().decrypt(grant['grant'].encode()).decode()
        value = self.client.request('v1/grants/token', {'grant': reference, 'resource': 'ado'})
        expected_kind = 'fixture' if self.client.settings.upstream_mode == 'mock' else 'bearer'
        expires = value.get('expires_at')
        token = value.get('access_token')
        if (value.get('resource') != 'ado' or value.get('token_kind') != expected_kind
                or not isinstance(token, str) or not token or len(token) > 8192
                or type(expires) not in (int, float) or not math.isfinite(expires)
                or expires <= time.time() + 30 or expires > grant['expires_at']
                or 'refresh_token' in value):
            raise AuthFailure('auth_configuration_error')
        with self.storage.transaction():
            self.validate(credential)
        return {**credential, 'token': token, 'expires_at': expires,
                'transport': 'fixture' if expected_kind == 'fixture' else 'live'}

    def renew(self, credential):
        return self.acquire(credential['user_id'], credential['binding'], credential['epoch'])

    @contextmanager
    def publication_guard(self, credential):
        with self.storage.transaction():
            self.validate(credential)
            yield


class DelegatedCredentialPolicy:
    """Remote denial never revokes a grant or mutates a PAT."""

    def credential_error(self, user_id):
        return None

    def authentication_failed(self, credential):
        if credential is not None and credential['kind'] != 'bearer':
            raise ValueError('Delegated policy requires a Bearer credential')
        return 'access_denied'
