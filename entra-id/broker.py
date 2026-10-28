"""Version-one broker configuration and encrypted, atomic state storage."""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from cryptography.fernet import Fernet


PROTOCOL = 'plannertool-auth/1'
RESOURCE = 'ado'
TRANSACTION_TTL = 300
CODE_TTL = 60
GRANT_TTL = 3600
LIVE_GRANT_TTL = 30 * 24 * 3600
MAX_RECORDS = 4096


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def challenge(verifier):
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')


def read_secret(path):
    source = Path(path)
    if source.stat().st_mode & 0o077:
        raise ValueError('Secret files must not be accessible to group or other users')
    value = source.read_text().strip()
    if len(value) < 43:
        raise ValueError('Broker secrets require at least 256 bits of random material')
    return value


@dataclass(frozen=True)
class BrokerConfig:
    mode: str
    public_url: str
    store_path: str
    key: str = field(repr=False)
    instances: dict = field(repr=False)
    private_network: bool = False
    ado_transport: str = 'fixture'

    def __post_init__(self):
        if self.mode not in ('mock', 'entra'):
            raise ValueError('Unknown broker mode')
        Fernet(self.key.encode())
        parsed = urlsplit(self.public_url)
        if (parsed.username or parsed.password or parsed.query or parsed.fragment
                or parsed.path != '/auth/' or not parsed.hostname):
            raise ValueError('Broker public URL must have the exact /auth/ root')
        if self.mode == 'mock':
            loopback = parsed.scheme == 'http' and parsed.hostname == 'localhost' and parsed.port is not None
            https = parsed.scheme == 'https' and self.private_network
            if not (loopback or https):
                raise ValueError('Mock browser ingress requires HTTPS with private Compose or localhost HTTP')
            if self.ado_transport != 'fixture':
                raise ValueError('Sandbox prohibits live ADO transport')
        elif parsed.scheme != 'https' or self.ado_transport != 'live':
            raise ValueError('Live broker requires HTTPS and explicit live transport')
        if not self.instances:
            raise ValueError('Broker requires a nonempty instance registry')
        completions = set()
        secret_hashes = set()
        for name, registration in self.instances.items():
            if not re.fullmatch(r'[a-z][a-z0-9_-]{0,63}', name):
                raise ValueError('Invalid registered instance ID')
            if set(registration) != {'completion_url', 'secret_file', 'scenario'}:
                raise ValueError('Registry requires completion_url, secret_file and scenario')
            target = urlsplit(registration['completion_url'])
            if (target.scheme != parsed.scheme or target.netloc != parsed.netloc
                    or target.path != f'/{name}/api/auth/login/callback'
                    or target.query or target.fragment or target.username):
                raise ValueError('Completion must be the exact same-origin instance callback')
            if registration['completion_url'] in completions:
                raise ValueError('Duplicate registered completion URL')
            completions.add(registration['completion_url'])
            secret_hash = digest(read_secret(registration['secret_file']))
            if secret_hash in secret_hashes:
                raise ValueError('Each instance must have its own service secret')
            secret_hashes.add(secret_hash)
            if registration['scenario'] not in (
                    'success', 'cancel', 'expired', 'revoked', 'interaction_required', 'unavailable', 'access_denied'):
                raise ValueError('Unknown sandbox scenario')
            if self.mode == 'entra' and registration['scenario'] != 'success':
                raise ValueError('Live broker prohibits sandbox scenarios')

    @classmethod
    def from_env(cls, settings):
        registry_path = Path(os.environ['ENTRA_BROKER_REGISTRY_FILE'])
        registry = json.loads(registry_path.read_text())
        if set(registry) != {'version', 'instances', 'mock_registration'} or registry['version'] != 1:
            raise ValueError('Unsupported broker registry schema')
        if settings.missing:
            raise ValueError('Broker registration is incomplete: ' + ', '.join(settings.missing))
        expected = registry['mock_registration']
        actual = {'tenant_id': settings.tenant_id, 'client_id': settings.client_id,
                  'redirect_uri': settings.redirect_uri, 'organization': settings.organization}
        if settings.auth_mode == 'mock' and expected != actual:
            raise ValueError('Sandbox registration does not match the upstream fixture')
        instances = registry['instances']
        for registration in instances.values():
            source = Path(registration['secret_file'])
            if not source.is_absolute():
                registration['secret_file'] = str(registry_path.parent / source)
        return cls(
            mode=settings.auth_mode,
            public_url=os.environ['ENTRA_BROKER_PUBLIC_URL'],
            store_path=os.environ['ENTRA_BROKER_STORE'],
            key=read_secret(os.environ['ENTRA_BROKER_KEY_FILE']),
            instances=instances,
            private_network=os.environ.get('ENTRA_NETWORK', 'loopback') == 'private-compose',
            ado_transport=os.environ['ENTRA_ADO_TRANSPORT'],
        )


class ProtocolError(Exception):
    def __init__(self, code, status=400):
        super().__init__(code)
        self.code = code
        self.status = status


class BrokerStore:
    def __init__(self, config, clock=time.time, upstream=None):
        self.config = config
        self.clock = clock
        self.upstream = upstream
        self.cipher = Fernet(config.key.encode())
        path = Path(config.store_path)
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if path.parent.stat().st_mode & 0o077:
            raise ValueError('Broker store directory requires mode 0700')
        with self.connection() as connection:
            connection.execute('CREATE TABLE IF NOT EXISTS metadata (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
            connection.execute('CREATE TABLE IF NOT EXISTS records '
                               '(id TEXT PRIMARY KEY, kind TEXT NOT NULL, owner TEXT NOT NULL, '
                               'expires REAL NOT NULL, payload BLOB NOT NULL)')
            expected = json.dumps({'protocol': PROTOCOL, 'mode': config.mode,
                                   'broker_url': config.public_url, 'key': digest(config.key)}, sort_keys=True)
            row = connection.execute('SELECT value FROM metadata WHERE id=1').fetchone()
            if row is not None and row[0] != expected:
                raise ValueError('Broker store URL, mode or key mismatch; migrate the store explicitly')
            connection.execute('INSERT OR IGNORE INTO metadata VALUES (1, ?)', (expected,))
        path.chmod(0o600)

    @contextmanager
    def connection(self):
        connection = sqlite3.connect(self.config.store_path, timeout=30)
        try:
            connection.execute('PRAGMA secure_delete=ON')
            connection.execute('BEGIN IMMEDIATE')
            yield connection
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()

    def put(self, connection, reference, kind, owner, expires, payload):
        if (connection.execute('SELECT 1 FROM records WHERE id=?', (digest(reference),)).fetchone() is None
            and connection.execute('SELECT count(*) FROM records').fetchone()[0] >= MAX_RECORDS):
            raise ProtocolError('auth_unavailable', 503)
        connection.execute('INSERT OR REPLACE INTO records VALUES (?, ?, ?, ?, ?)',
                           (digest(reference), kind, owner, expires,
                            self.cipher.encrypt(json.dumps(payload).encode())))

    def get(self, connection, reference, kind, owner=None, *, allow_expired=False):
        row = connection.execute('SELECT kind, owner, expires, payload FROM records WHERE id=?',
                                 (digest(reference),)).fetchone()
        if row is None or row[0] != kind or (owner is not None and row[1] != owner):
            raise ProtocolError('invalid_binding')
        if row[2] <= self.clock() and not allow_expired:
            raise ProtocolError('expired')
        return json.loads(self.cipher.decrypt(row[3]))

    def begin(self, owner, completion, verifier_challenge, state):
        registration = self.config.instances[owner]
        if completion != registration['completion_url']:
            raise ProtocolError('invalid_completion')
        if not re.fullmatch(r'[A-Za-z0-9_-]{43}', verifier_challenge):
            raise ProtocolError('invalid_challenge')
        if not re.fullmatch(r'[A-Za-z0-9_-]{43,128}', state):
            raise ProtocolError('invalid_state')
        if registration['scenario'] == 'unavailable':
            raise ProtocolError('auth_unavailable', 503)
        reference = secrets.token_urlsafe(32)
        expires = self.clock() + TRANSACTION_TTL
        with self.connection() as connection:
            connection.execute('DELETE FROM records WHERE expires<=?', (self.clock(),))
            if connection.execute('SELECT count(*) FROM records').fetchone()[0] >= MAX_RECORDS:
                raise ProtocolError('auth_unavailable', 503)
            self.put(connection, reference, 'transaction', owner, expires, {
                'owner': owner, 'completion': completion, 'challenge': verifier_challenge,
                'state': state, 'expires': expires, 'browser': None, 'code': None,
                'scenario': registration['scenario'],
            })
        return reference, expires

    def bind_browser(self, reference, browser):
        with self.connection() as connection:
            transaction = self.get(connection, reference, 'transaction')
            if transaction['browser'] is not None:
                raise ProtocolError('replay')
            transaction['browser'] = digest(browser)
            self.put(connection, reference, 'transaction', transaction['owner'],
                     transaction['expires'], transaction)
        return transaction

    def authorize(self, reference, browser, identity):
        code = secrets.token_urlsafe(32)
        with self.connection() as connection:
            transaction = self.get(connection, reference, 'transaction')
            if (transaction['browser'] is None
                    or not hmac.compare_digest(transaction['browser'], digest(browser))):
                raise ProtocolError('invalid_browser')
            if transaction['code'] is not None:
                raise ProtocolError('replay')
            if identity is None or transaction['scenario'] == 'cancel':
                connection.execute('DELETE FROM records WHERE id=?', (digest(reference),))
                return transaction, None
            transaction['code'] = digest(code)
            transaction['identity'] = identity
            transaction['code_expires'] = self.clock() + CODE_TTL
            self.put(connection, reference, 'transaction', transaction['owner'],
                     transaction['expires'], transaction)
        return transaction, code

    def redeem(self, owner, reference, code, verifier):
        grant = secrets.token_urlsafe(32)
        with self.connection() as connection:
            transaction = self.get(connection, reference, 'transaction', owner)
            if (transaction['code'] is None
                    or not hmac.compare_digest(transaction['code'], digest(code))
                    or not hmac.compare_digest(transaction['challenge'], challenge(verifier))):
                raise ProtocolError('invalid_binding')
            if transaction['code_expires'] <= self.clock() or transaction['scenario'] == 'expired':
                raise ProtocolError('expired')
            expires = self.clock() + (LIVE_GRANT_TTL if self.config.mode == 'entra' else GRANT_TTL)
            payload = {'identity': transaction['identity'], 'transaction': reference,
                       'expires_at': expires, 'revoked': transaction['scenario'] == 'revoked',
                       'scenario': transaction['scenario']}
            if self.config.mode == 'entra':
                payload['token_cache'] = transaction['token_cache']
            self.put(connection, grant, 'grant', owner, expires, payload)
            connection.execute('DELETE FROM records WHERE id=?', (digest(reference),))
        return {**self.metadata(), 'transaction': reference, 'identity': payload['identity'],
                'grant': grant, 'expires_at': expires}

    def metadata(self):
        return {'protocol': PROTOCOL, 'broker_url': self.config.public_url,
            'upstream_mode': self.config.mode}

    def grant(self, owner, reference, operation, resource=None):
        with self.connection() as connection:
            payload = self.get(connection, reference, 'grant', owner, allow_expired=True)
            if operation == 'revoke':
                payload['revoked'] = True
                self.put(connection, reference, 'grant', owner, payload['expires_at'], payload)
                return {**self.metadata(), 'status': 'revoked'}
            status = 'expired' if payload['expires_at'] <= self.clock() else (
                'revoked' if payload['revoked'] else (
                    'interaction_required' if payload['scenario'] == 'interaction_required' else 'active'))
            if operation == 'status':
                return {**self.metadata(), 'status': status, 'expires_at': payload['expires_at']}
            if resource != RESOURCE:
                raise ProtocolError('invalid_resource', 403)
            if status != 'active':
                raise ProtocolError('interaction_required', 409)
            if payload['scenario'] == 'access_denied':
                raise ProtocolError('access_denied', 403)
            if self.config.mode == 'entra':
                token, expires, cache = self.upstream.token(payload['token_cache'])
                payload['token_cache'] = cache
                self.put(connection, reference, 'grant', owner, payload['expires_at'], payload)
                return {**self.metadata(), 'resource': RESOURCE, 'token_kind': 'bearer',
                        'access_token': token, 'expires_at': min(expires, payload['expires_at'])}
            return {**self.metadata(), 'resource': RESOURCE, 'token_kind': 'fixture',
                    'access_token': 'invalid-sandbox-ado-' + secrets.token_urlsafe(24),
                    'expires_at': min(self.clock() + 300, payload['expires_at'])}