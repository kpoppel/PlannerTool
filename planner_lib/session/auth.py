"""Persistent browser enrollment using a rotating account key."""

import hashlib
import secrets
import threading
import time
from contextlib import nullcontext

from planner_lib.accounts.config import AccountCredentialsPayload, _is_valid_email
from planner_lib.accounts.constants import AccountPermissions


DEVICE_AGE = 90 * 86400


def _digest(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


class AuthManager:
    def __init__(self, storage, account_manager, session_manager):
        self._storage = storage
        self._accounts = account_manager
        self._sessions = session_manager
        self._lock = threading.RLock()

    def _transaction(self):
        cache = getattr(self._storage, '_cache', None)
        return cache.transact() if cache is not None else nullcontext()

    def _record(self, email):
        account_id = self._accounts.get_account_id(email)
        try:
            record = self._storage.load('account_auth', account_id)
        except KeyError:
            return account_id, None
        if not record['enrolled']:
            return account_id, None
        return account_id, record

    def requires_account_key(self, email: str) -> bool:
        if not _is_valid_email(email):
            raise ValueError('Valid email required')
        try:
            _, record = self._record(email)
        except KeyError:
            return False
        return record is not None

    def enroll(self, email: str, name: str = '', account_key: str = ''):
        if not _is_valid_email(email):
            raise ValueError('Valid email required')
        with self._lock, self._transaction():
            try:
                account_id, record = self._record(email)
            except KeyError:
                if account_key:
                    raise PermissionError('Invalid account key')
                if not name.strip():
                    raise ValueError('Name required for first enrollment')
                self._accounts.create_account(AccountCredentialsPayload(email=email))
                account_id, record = self._record(email)
            if record is not None:
                if not account_key:
                    raise PermissionError('Account key required')
                self._verify_key(record, account_key)
            else:
                if account_key:
                    raise PermissionError('Invalid account key')
                if not name.strip():
                    raise ValueError('Name required for first enrollment')
                if not self._storage.exists('auth_control', 'bootstrap_claimed'):
                    if self._accounts.count_all_with_permission(AccountPermissions.ADMIN) == 0:
                        self._accounts.set_permissions(account_id, [AccountPermissions.ADMIN])
                    self._storage.save('auth_control', 'bootstrap_claimed', True)
                record = {'enrolled': True, 'name': name.strip(), 'devices': {}}
            device_id = secrets.token_hex(16)
            device_secret = secrets.token_urlsafe(32)
            next_key = secrets.token_urlsafe(32)
            record['account_key_hash'] = _digest(next_key)
            record['devices'][device_id] = {
                'hash': _digest(device_secret), 'expires': time.time() + DEVICE_AGE,
            }
            self._storage.save('account_auth', account_id, record)
            session_id = self._sessions.create(email, device_id)
            return account_id + '.' + device_id + '.' + device_secret, next_key, session_id

    def _verify_key(self, record, account_key):
        if record is None or not secrets.compare_digest(
            record['account_key_hash'], _digest(account_key)
        ):
            raise PermissionError('Invalid account key')

    def delete_account(self, email: str, account_key: str):
        with self._lock, self._transaction():
            try:
                account_id, record = self._record(email)
            except KeyError as error:
                raise PermissionError('Invalid account key') from error
            self._verify_key(record, account_key)
            self._accounts.delete_account(account_id)

    def authenticate_device(self, device_token: str):
        with self._lock, self._transaction():
            try:
                account_id, device_id, secret = device_token.split('.')
                email = self._accounts.get_account_by_id(account_id)['email']
                _, record = self._record(email)
                device = record['devices'][device_id]
            except (ValueError, KeyError, TypeError) as error:
                raise PermissionError('Invalid device') from error
            if device['expires'] <= time.time() or not secrets.compare_digest(
                device['hash'], _digest(secret)
            ):
                raise PermissionError('Invalid device')
            device['expires'] = time.time() + DEVICE_AGE
            self._storage.save('account_auth', account_id, record)
            return email, self._sessions.create(email, device_id)

    def devices(self, email: str):
        _, record = self._record(email)
        return [{'id': key, 'expires': value['expires']}
                for key, value in record['devices'].items()]

    def revoke(self, email: str, device_id: str):
        with self._lock, self._transaction():
            account_id, record = self._record(email)
            del record['devices'][device_id]
            self._storage.save('account_auth', account_id, record)

    def reset(self, email: str):
        with self._lock, self._transaction():
            account_id, record = self._record(email)
            if record is None:
                raise ValueError('Account has not enrolled')
            key = secrets.token_urlsafe(32)
            record['account_key_hash'] = _digest(key)
            record['devices'] = {}
            self._storage.save('account_auth', account_id, record)
            self._sessions.delete_by_account_id(account_id)
            return key

    def throttle(self, identity: str, limit: int = 30):
        with self._lock, self._transaction():
            key = _digest(identity)
            now = time.time()
            try:
                attempts = self._storage.load('auth_attempts', key)
            except KeyError:
                attempts = []
            attempts = [attempt for attempt in attempts if now - attempt < 600]
            if len(attempts) >= limit:
                raise PermissionError('Too many attempts')
            attempts.append(now)
            self._storage.save('auth_attempts', key, attempts, ttl_seconds=600)