from pydantic import BaseModel
from typing import Optional, Union
import logging
import os
import re
import base64
from planner_lib.storage import StorageBackend
from planner_lib.accounts.constants import AccountPermissions

logger = logging.getLogger(__name__)

# RFC-5321-lite: local-part@domain.tld — no spaces, at least one dot in domain.
_EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')

def _is_valid_email(email: str) -> bool:
    return bool(_EMAIL_RE.match(email))


# PAT validation: allow empty/None (preserve existing behaviour), but when
# a PAT value is supplied ensure it contains only printable, non-whitespace
# ASCII characters. This guards against newline/whitespace or exotic input
# that can later cause unexpected errors when the token is used.
_PAT_RE = re.compile(r'^[\x21-\x7E]+$')


def _is_valid_pat(pat: str) -> bool:
    if pat is None:
        return True
    # Empty string is used by the frontend to indicate "preserve existing PAT";
    # therefore treat empty string as valid here and let calling code handle
    # the preservation logic.
    if pat == '':
        return True
    # Disallow whitespace and require printable ASCII characters only.
    if not isinstance(pat, str):
        return False
    if not _PAT_RE.match(pat):
        return False
    # Reasonable length guard to avoid extremely long inputs
    return 1 <= len(pat) <= 512


def _get_fernet():
    """Return a Fernet instance keyed from PLANNER_SECRET_KEY env var.

    Raises RuntimeError when the env var is not set so misconfigured
    deployments fail loudly rather than silently storing plaintext credentials.
    """
    from cryptography.fernet import Fernet
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

    key_material = os.environ.get('PLANNER_SECRET_KEY', '')
    if not key_material:
        raise RuntimeError(
            "PLANNER_SECRET_KEY environment variable is not set. "
            "Set it to a strong random string to enable PAT encryption at rest."
        )
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        # Fixed salt is acceptable here: key_material IS the high-entropy secret.
        salt=b'planner-tool-pat-v1',
        iterations=260_000,
    )
    derived = kdf.derive(key_material.encode())
    return Fernet(base64.urlsafe_b64encode(derived))


def _encrypt_pat(pat: str) -> str:
    """Encrypt a PAT string for storage."""
    return _get_fernet().encrypt(pat.encode()).decode()


def _decrypt_pat(encrypted: str) -> str:
    """Decrypt a stored PAT string.

    Raises ``cryptography.fernet.InvalidToken`` when the ciphertext is
    corrupted or was encrypted with a different key.  Callers that must
    not crash on bad data (e.g. session creation) should use
    ``_try_decrypt_pat`` instead.
    """
    return _get_fernet().decrypt(encrypted.encode()).decode()


def _try_decrypt_pat(encrypted: str) -> Optional[str]:
    """Decrypt a stored PAT string, returning None on any decryption failure.

    Handles ``InvalidToken`` (wrong key, truncated ciphertext, base64
    padding errors) gracefully so callers are never crashed by a corrupt
    or migrated PAT record.
    """
    try:
        return _decrypt_pat(encrypted)
    except Exception:
        # Covers cryptography.fernet.InvalidToken, binascii.Error (bad
        # padding), and any other decryption failure.  Log at WARNING so
        # the problem is visible without crashing the request.
        logger.warning(
            'Stored PAT could not be decrypted (corrupt record or key mismatch). '
            'The PAT will be treated as not set; the user must re-enter it.'
        )
        return None

class AccountPayload(BaseModel):
    email: str
    pat: Optional[str] = None
    permissions: Optional[list[str]] = None

class AccountManager:
    """Manages account configuration using a StorageBackend for persistence. All account management must pass
       through this class to ensure consistent handling of PAT encryption and validation."""
    DEFAULT_NS = 'accounts'
    def __init__(self, account_storage: StorageBackend):
        self._storage = account_storage

    def save(self, config: AccountPayload) -> dict:
        """Save an account configuration, validating input and handling PAT encryption."""
        # load from file storage to not change the PAT if empty
        try:
            existing = self._storage.load(self.DEFAULT_NS, config.email)
        except KeyError:
            existing = None

        # Simple email verification
        if not _is_valid_email(config.email):
            return { 'ok': False, 'email': config.email }

        # Validate PAT format when provided (but allow None/empty to preserve
        # existing PAT behaviour).
        if config.pat is not None and config.pat != '' and not _is_valid_pat(config.pat):
            return { 'ok': False, 'email': config.email, 'error': 'invalid_pat' }

        # Save configuration using the storage backend.
        # Preserve existing (encrypted) PAT when caller sends empty string.
        # Only encrypt when a new plaintext PAT is being set; when preserving
        # the existing PAT, copy the already-encrypted value directly.
        if existing and config.pat == '':
            # Preserve the stored (already-encrypted) PAT without re-encrypting.
            encrypted_pat = existing.get('pat')
        else:
            encrypted_pat = _encrypt_pat(config.pat) if config.pat else None
        if config.permissions is None:
            permissions = list((existing or {}).get('permissions') or [])
        else:
            permissions = list(config.permissions)
        payload = { 'email': config.email, 'pat': encrypted_pat, 'permissions': permissions }
        self._storage.save(self.DEFAULT_NS, config.email, payload)

        logger.info('Saved account configuration for %s', config.email)
        return { 'ok': True, 'email': config.email }

    def load(self, key: str) -> dict:
        # Load configuration from the storage backend
        res = self._storage.load(self.DEFAULT_NS, key)
        pat = None
        if isinstance(res, dict) and res.get('pat'):
            # Decrypt the stored PAT.  Use the safe variant so a corrupted or
            # migrated ciphertext surfaces as "no PAT" instead of a 500 crash
            # that would lock the user (or admin) out of the interface.
            pat = _try_decrypt_pat(res['pat'])

        logger.debug('Loaded config for %s: pat_set=%s', key, pat is not None)
        return { 'ok': True, 'email': key, 'pat': pat }

    def has_permission(self, key: str, permission: str) -> bool:
        """Return True when the account for *key* has the specified permission."""
        try:
            record = self._storage.load(self.DEFAULT_NS, key)
            return permission in (record.get('permissions') or [])
        except (KeyError, Exception):
            return False
        
    def get_all_with_permission(self, permission: str) -> list:
        """Return a list of users that have the specified permission."""
        try:
            result = []
            for key in self._storage.list_keys(self.DEFAULT_NS):
                try:
                    record = self._storage.load(self.DEFAULT_NS, key)
                    if permission in (record.get('permissions') or []):
                        result.append(key)
                except Exception:
                    pass
            return result
        except Exception:
            return []
        
    def count_all_with_permission(self, permission: str) -> int:
        """Return the number of users that have the specified permission."""
        return len(self.get_all_with_permission(permission))
    
    def get_all_users(self) -> list:
        """Return a list of all user email keys."""
        try:
            return list(self._storage.list_keys('accounts'))
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
        should have the ADMIN permission.  Both may be lists of email strings
        (from the admin UI) or dicts of ``{email: user_data}`` (from backup
        restore).  When a list is provided, existing stored data is preserved.

        Accounts no longer present in *users* are deleted.
        The ADMIN permission is added/removed from each account record to
        match the *admins* set exactly.
        """
        # Normalise lists → dicts, preserving any existing stored user data.
        if isinstance(users, list):
            users_dict: dict = {}
            for email in users:
                try:
                    users_dict[email] = self._storage.load('accounts', email)
                except KeyError:
                    users_dict[email] = {'email': email}
            users = users_dict
        if isinstance(admins, list):
            admins_set = set(admins)
        else:
            admins_set = set(admins.keys())

        current_users = set(self._storage.list_keys('accounts') or [])
        incoming_users = set(users.keys())

        # Add / update users — set permissions according to admin membership.
        for user_key, user_data in users.items():
            record = dict(user_data) if user_data else {'email': user_key}
            permissions = list(record.get('permissions') or [])
            if user_key in admins_set:
                if AccountPermissions.ADMIN not in permissions:
                    permissions.append(AccountPermissions.ADMIN)
            else:
                permissions = [p for p in permissions if p != AccountPermissions.ADMIN]
            record['permissions'] = permissions
            self._storage.save('accounts', user_key, record)

        # Remove accounts no longer in the incoming set.
        for user_key in current_users - incoming_users:
            try:
                self._storage.delete('accounts', user_key)
            except KeyError:
                pass