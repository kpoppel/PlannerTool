from pydantic import BaseModel
from typing import Optional
from planner_lib.storage.file_backend import FileStorageBackend
import logging

logger = logging.getLogger(__name__)

# simple file storage for server-side persistence
_storage = FileStorageBackend(data_dir='./data')


class AccountPayload(BaseModel):
    email: str
    pat: Optional[str] = None

class ConfigManager:
    def __init__(self):
        pass

    def save(self, config: AccountPayload) -> dict:
        # load from file storage to not change the PAT if empty
        try:
            existing = _storage.load('accounts', config.email)
        except KeyError:
            existing = None

        # Save configuration using the storage backend
        if '@' not in config.email:
            return { 'ok': False, 'email': config.email }
        config.pat = existing.get('pat') if existing and config.pat == '' else config.pat
        # store full config dict (including email) for easier inspection
        payload = { 'email': config.email, 'pat': config.pat }
        _storage.save('accounts', config.email, payload)
        logger.info('Saved config for %s', config.email)
        return { 'ok': True, 'email': config.email }

    def load(self, key: str) -> dict:
        # Load configuration from the storage backend
        res = _storage.load('accounts', key)
        if isinstance(res, dict):
            pat = res.get('pat')
        else:
            pat = None
        logger.debug('Loaded config for %s: present=%s', key, res is not None)
        return { 'ok': True, 'email': key, 'pat': pat }
    
config_manager = ConfigManager()