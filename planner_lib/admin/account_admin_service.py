"""AccountAdminService: manages admin and user accounts.

Extracted from :class:`~planner_lib.admin.service.AdminService` so that
account CRUD lives in its own focused class.

All methods interact exclusively with ``account_storage``; no config
keys, no Azure connections, no other service dependencies.

Public API:
- ``is_admin(email)``
- ``admin_count()``
- ``create_admin_account(email, pat)``
- ``get_all_admins()``
- ``get_all_users()``
- ``sync_accounts_full(users, admins)``
"""
from __future__ import annotations

import logging
from typing import Union

from planner_lib.storage.base import StorageBackend

logger = logging.getLogger(__name__)


class AccountAdminService:
    """Owns all account / admin-marker CRUD over a single storage backend."""

    def __init__(self, account_storage: StorageBackend) -> None:
        self._account_storage = account_storage

    # ------------------------------------------------------------------
    # Admin checks
    # ------------------------------------------------------------------

    def is_admin(self, email: str) -> bool:
        """Return True when an admin marker exists for *email*."""
        try:
            return bool(self._account_storage.exists('accounts_admin', email))
        except Exception:
            return False

    def admin_count(self) -> int:
        """Return the number of configured admin accounts."""
        return len(self.get_all_admins())

    # ------------------------------------------------------------------
    # Account creation
    # ------------------------------------------------------------------

    def create_admin_account(self, email: str, pat: str) -> None:
        """Create (or update) a user account and elevate it to admin.

        If an account for *email* already exists its PAT is updated.
        A corresponding admin marker is always written.
        """
        try:
            user_data = self._account_storage.load('accounts', email)
            user_data['pat'] = pat
        except KeyError:
            user_data = {'email': email, 'pat': pat}
        self._account_storage.save('accounts', email, user_data)
        self._account_storage.save('accounts_admin', email, user_data)

    # ------------------------------------------------------------------
    # Listing
    # ------------------------------------------------------------------

    def get_all_admins(self) -> list:
        """Return a list of all admin email keys."""
        try:
            return list(self._account_storage.list_keys('accounts_admin'))
        except Exception:
            return []

    def get_all_users(self) -> list:
        """Return a list of all user email keys."""
        try:
            return list(self._account_storage.list_keys('accounts'))
        except Exception:
            return []

    # ------------------------------------------------------------------
    # Bulk sync (used by backup restore and the users admin endpoint)
    # ------------------------------------------------------------------

    def sync_accounts_full(
        self,
        users: Union[list, dict],
        admins: Union[list, dict],
    ) -> None:
        """Synchronize user and admin accounts to exactly the supplied sets.

        *users* and *admins* may be lists of email strings (from the admin UI)
        or dicts of ``{email: user_data}`` (from backup restore).  When a list
        is provided, existing user data is preserved; otherwise a minimal
        record with just the email is created.
        """
        # Normalise lists → dicts, preserving any existing stored user data.
        if isinstance(users, list):
            users_dict: dict = {}
            for email in users:
                try:
                    users_dict[email] = self._account_storage.load('accounts', email)
                except KeyError:
                    users_dict[email] = {'email': email}
            users = users_dict
        if isinstance(admins, list):
            admins_dict: dict = {}
            for email in admins:
                try:
                    admins_dict[email] = self._account_storage.load('accounts', email)
                except KeyError:
                    admins_dict[email] = {'email': email}
            admins = admins_dict

        current_users = set(self._account_storage.list_keys('accounts') or [])
        current_admins = set(self._account_storage.list_keys('accounts_admin') or [])
        incoming_users = set(users.keys())
        incoming_admins = set(admins.keys())

        # Add / update users.
        for user_key, user_data in users.items():
            self._account_storage.save('accounts', user_key, user_data)

        # Remove users no longer in the incoming set.
        for user_key in current_users - incoming_users:
            try:
                self._account_storage.delete('accounts', user_key)
            except KeyError:
                pass

        # Add / update admins.
        for admin_key, admin_data in admins.items():
            self._account_storage.save('accounts_admin', admin_key, admin_data)

        # Remove admin markers no longer in the incoming set.
        for admin_key in current_admins - incoming_admins:
            try:
                self._account_storage.delete('accounts_admin', admin_key)
            except KeyError:
                pass
