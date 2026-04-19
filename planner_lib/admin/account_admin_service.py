"""AccountAdminService: manages admin and user accounts.

Extracted from :class:`~planner_lib.admin.service.AdminService` so that
account CRUD lives in its own focused class.

All methods interact exclusively with ``account_storage``; no config
keys, no Azure connections, no other service dependencies.

Permissions model
-----------------
Each account record stored under the ``'accounts'`` namespace has the shape::

    {
        'email': 'user@example.com',
        'pat':   '<encrypted>',        # optional
        'permissions': ['admin'],      # list of permission strings; empty = regular user
    }

The ``'permissions'`` field is a list so that additional permissions can be
added in future without schema changes.  Currently only ``'admin'`` is used.

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

# The permission string that grants admin access.
PERMISSION_ADMIN = 'admin'


def _has_permission(record: dict, permission: str) -> bool:
    """Return True when *record* contains *permission* in its permissions list."""
    return permission in (record.get('permissions') or [])


class AccountAdminService:
    """Owns all account / admin-marker CRUD over a single storage backend."""

    def __init__(self, account_storage: StorageBackend) -> None:
        self._account_storage = account_storage

    # ------------------------------------------------------------------
    # Admin checks
    # ------------------------------------------------------------------

    def is_admin(self, email: str) -> bool:
        """Return True when the account for *email* has the 'admin' permission."""
        try:
            record = self._account_storage.load('accounts', email)
            return _has_permission(record, PERMISSION_ADMIN)
        except (KeyError, Exception):
            return False

    def admin_count(self) -> int:
        """Return the number of configured admin accounts."""
        return len(self.get_all_admins())

    # ------------------------------------------------------------------
    # Account creation
    # ------------------------------------------------------------------

    def create_admin_account(self, email: str, pat: str) -> None:
        """Create (or update) a user account and grant it admin permission.

        If an account for *email* already exists its PAT is updated and
        'admin' is added to its permissions list (idempotent).
        """
        try:
            user_data = dict(self._account_storage.load('accounts', email))
            user_data['pat'] = pat
        except KeyError:
            user_data = {'email': email, 'pat': pat}
        permissions = list(user_data.get('permissions') or [])
        if PERMISSION_ADMIN not in permissions:
            permissions.append(PERMISSION_ADMIN)
        user_data['permissions'] = permissions
        self._account_storage.save('accounts', email, user_data)

    # ------------------------------------------------------------------
    # Listing
    # ------------------------------------------------------------------

    def get_all_admins(self) -> list:
        """Return a list of email addresses that have the 'admin' permission."""
        try:
            result = []
            for key in self._account_storage.list_keys('accounts'):
                try:
                    record = self._account_storage.load('accounts', key)
                    if _has_permission(record, PERMISSION_ADMIN):
                        result.append(key)
                except Exception:
                    pass
            return result
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

        *users* is the complete set of accounts; *admins* is the subset that
        should have the 'admin' permission.  Both may be lists of email strings
        (from the admin UI) or dicts of ``{email: user_data}`` (from backup
        restore).  When a list is provided, existing stored data is preserved.

        Accounts no longer present in *users* are deleted.
        The 'admin' permission is added/removed from each account record to
        match the *admins* set exactly.
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
            admins_set = set(admins)
        else:
            admins_set = set(admins.keys())

        current_users = set(self._account_storage.list_keys('accounts') or [])
        incoming_users = set(users.keys())

        # Add / update users — set permissions according to admin membership.
        for user_key, user_data in users.items():
            record = dict(user_data) if user_data else {'email': user_key}
            permissions = list(record.get('permissions') or [])
            if user_key in admins_set:
                if PERMISSION_ADMIN not in permissions:
                    permissions.append(PERMISSION_ADMIN)
            else:
                permissions = [p for p in permissions if p != PERMISSION_ADMIN]
            record['permissions'] = permissions
            self._account_storage.save('accounts', user_key, record)

        # Remove accounts no longer in the incoming set.
        for user_key in current_users - incoming_users:
            try:
                self._account_storage.delete('accounts', user_key)
            except KeyError:
                pass
