from pydantic import BaseModel
from typing import Optional
import logging
import os
import re
import base64
from planner_lib.storage import StorageBackend

logger = logging.getLogger(__name__)

# RFC-5321-lite: local-part@domain.tld — no spaces, at least one dot in domain.
_EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


def _is_valid_email(email: str) -> bool:
    return bool(_EMAIL_RE.match(email))


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
    """Decrypt a stored PAT string."""
    return _get_fernet().decrypt(encrypted.encode()).decode()

class AccountPayload(BaseModel):
    email: str
    pat: Optional[str] = None

class AccountManager:
    DEFAULT_NS = 'accounts'
    def __init__(self, account_storage: StorageBackend):
        self._storage = account_storage

    def save(self, config: AccountPayload) -> dict:
        # load from file storage to not change the PAT if empty
        try:
            existing = self._storage.load(self.DEFAULT_NS, config.email)
        except KeyError:
            existing = None

        # Simple email verification
        if not _is_valid_email(config.email):
            return { 'ok': False, 'email': config.email }

        # Save configuration using the storage backend.
        # Preserve existing (encrypted) PAT when caller sends empty string.
        # Only encrypt when a new plaintext PAT is being set; when preserving
        # the existing PAT, copy the already-encrypted value directly.
        if existing and config.pat == '':
            # Preserve the stored (already-encrypted) PAT without re-encrypting.
            encrypted_pat = existing.get('pat')
        else:
            encrypted_pat = _encrypt_pat(config.pat) if config.pat else None
        payload = { 'email': config.email, 'pat': encrypted_pat }
        self._storage.save(self.DEFAULT_NS, config.email, payload)

        logger.info('Saved config for %s', config.email)
        return { 'ok': True, 'email': config.email }

    def load(self, key: str) -> dict:
        # Load configuration from the storage backend
        res = self._storage.load(self.DEFAULT_NS, key)
        pat = None
        if isinstance(res, dict) and res.get('pat'):
            # Decrypt the stored PAT.
            pat = _decrypt_pat(res['pat'])

        logger.debug('Loaded config for %s: pat_set=%s', key, pat is not None)
        return { 'ok': True, 'email': key, 'pat': pat }
