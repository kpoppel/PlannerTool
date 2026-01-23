from pydantic import BaseModel
from typing import Optional
import logging
from planner_lib.storage import StorageBackend

logger = logging.getLogger(__name__)

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
        if '@' not in config.email:
            return { 'ok': False, 'email': config.email }

        # Save configuration using the storage backend
        config.pat = existing.get('pat') if existing and config.pat == '' else config.pat
        payload = { 'email': config.email, 'pat': config.pat }
        self._storage.save(self.DEFAULT_NS, config.email, payload)

        logger.info('Saved config for %s', config.email)
        return { 'ok': True, 'email': config.email }

    def load(self, key: str) -> dict:
        # Load configuration from the storage backend
        res = self._storage.load(self.DEFAULT_NS, key)
        pat = None
        if isinstance(res, dict):
            pat = res.get('pat')

        logger.debug('Loaded config for %s: pat_set=%s', key, pat is not None)
        return { 'ok': True, 'email': key, 'pat': pat }
