"""Bounded broker transport and fixed isolated-sandbox account composition."""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from planner_lib.accounts.config import AccountCredentialsPayload, _get_fernet
from planner_lib.backend.errors import BackendDecisionError
from planner_lib.session.policy import validate_authentication


PROTOCOL = 'plannertool-auth/1'
LOGIN_COOKIE = 'plannerLogin'
SANDBOX_IDENTITIES = {
    '33333333-3333-3333-3333-333333333333': ('alex@example.test', 'Alex Sandbox'),
    '44444444-4444-4444-4444-444444444444': ('sam@example.test', 'Sam Sandbox'),
}
SANDBOX_TENANT = '11111111-1111-1111-1111-111111111111'


class AuthFailure(BackendDecisionError):
    """Typed authentication decision shared by transport and HTTP boundaries."""


def sha256(value):
    return hashlib.sha256(value.encode()).hexdigest()


@dataclass(frozen=True)
class BrokerSettings:
    instance: str
    url: str
    public_url: str
    environment: str
    generation: str
    upstream_mode: str
    secret: str = field(repr=False)
    isolated_sandbox: bool = False

    def __post_init__(self):
        if self.upstream_mode not in ('mock', 'entra'):
            raise ValueError('Unknown expected broker mode')
        for value in (self.instance, self.environment, self.generation):
            if not re.fullmatch(r'[a-z][a-z0-9_-]{0,63}', value):
                raise ValueError('Invalid broker instance, environment or generation')
        public = urlsplit(self.public_url)
        internal = urlsplit(self.url)
        for parsed in (public, internal):
            if (parsed.path != '/auth/' or parsed.username or parsed.password
                    or parsed.query or parsed.fragment or not parsed.hostname):
                raise ValueError('Invalid broker URL')
        if len(self.secret) < 43:
            raise ValueError('Broker service secret must contain at least 256 bits of random material')
        if self.upstream_mode == 'mock':
            if (not self.isolated_sandbox or public.scheme != 'http' or public.hostname != 'localhost'
                    or not public.port or internal.scheme != 'http'
                    or not (internal.hostname in ('localhost', '127.0.0.1')
                            or re.fullmatch(r'auth-[a-z][a-z0-9-]*', internal.hostname))):
                raise ValueError('Sandbox broker requires explicit isolated loopback/private Compose policy')
        elif public.scheme != 'https' or internal.scheme != 'https' or self.isolated_sandbox:
            raise ValueError('Live broker requires validated HTTPS URLs and live policy')

    @classmethod
    def from_env(cls):
        secret_file = Path(os.environ['PLANNER_AUTH_SECRET_FILE'])
        if secret_file.stat().st_mode & 0o077:
            raise ValueError('Instance broker secret requires mode 0600')
        return cls(
            os.environ['PLANNER_AUTH_INSTANCE'], os.environ['PLANNER_AUTH_URL'],
            os.environ['PLANNER_AUTH_PUBLIC_URL'], os.environ['PLANNER_AUTH_ENVIRONMENT'],
            os.environ['PLANNER_AUTH_GENERATION'], os.environ['PLANNER_AUTH_UPSTREAM_MODE'],
            secret_file.read_text().strip(),
            os.environ.get('PLANNER_AUTH_ISOLATED_SANDBOX', '0') == '1',
        )

    def metadata(self):
        return {'protocol': PROTOCOL, 'environment_id': self.environment,
                'generation': self.generation, 'upstream_mode': self.upstream_mode}

    @property
    def completion_url(self):
        public = urlsplit(self.public_url)
        return f'{public.scheme}://{public.netloc}/{self.instance}/api/auth/login/callback'


class BrokerClient:
    def __init__(self, settings, transport=None):
        self.settings = settings
        self.transport = transport

    def request(self, operation, payload=None):
        headers = {'Accept': 'application/json', 'X-Planner-Instance': self.settings.instance,
                   'Authorization': 'Bearer ' + self.settings.secret}
        try:
            with httpx.Client(timeout=httpx.Timeout(5, connect=2), follow_redirects=False,
                              trust_env=False, transport=self.transport) as client:
                with client.stream('GET' if payload is None else 'POST', self.settings.url + operation,
                                   headers=headers, json=None if payload is None else {
                                       **self.settings.metadata(), **payload}) as response:
                    body = bytearray()
                    for chunk in response.iter_bytes():
                        body.extend(chunk)
                        if len(body) > 16384:
                            raise AuthFailure('auth_unavailable')
                    if response.status_code != 200:
                        if response.status_code >= 500 or response.status_code == 429:
                            raise AuthFailure('auth_unavailable')
                        error = json.loads(body)
                        if not isinstance(error, dict) or set(error) != {'error'}:
                            raise AuthFailure('auth_configuration_error')
                        code = error['error']
                        if (operation == 'v1/transactions/redeem' and response.status_code == 400
                                and code in ('expired', 'invalid_binding', 'replay', 'invalid_browser')):
                            raise AuthFailure('invalid_session', 401)
                        if response.status_code == 409 and code == 'interaction_required':
                            raise AuthFailure('interaction_required', 409)
                        if response.status_code == 403 and code in ('access_denied', 'invalid_resource'):
                            raise AuthFailure('access_denied', 403)
                        raise AuthFailure('auth_configuration_error')
            value = json.loads(body)
        except (httpx.HTTPError, ValueError) as error:
            raise AuthFailure('auth_unavailable') from error
        if (not isinstance(value, dict)
                or any(value.get(key) != expected for key, expected in self.settings.metadata().items())):
            raise AuthFailure('auth_configuration_error')
        return value

    def ready(self):
        value = self.request('v1/readiness')
        if value.get('ready') is not True:
            raise AuthFailure('auth_unavailable')
        return value


class EntraLoginAdapter:
    def __init__(self, storage, accounts, sessions, client):
        self.storage = storage
        self.accounts = accounts
        self.sessions = sessions
        self.client = client
        self.settings = client.settings
        from planner_lib.session.identity import ExternalIdentityLinks
        self.identities = ExternalIdentityLinks(storage, accounts, self.settings, SANDBOX_TENANT)

    def begin_link(self, account_id, approved_by, session_id):
        from planner_lib.accounts.constants import AccountPermissions

        if AccountPermissions.ADMIN not in self.accounts.get_account_by_id(approved_by)['permissions']:
            raise AuthFailure('access_denied', 403)
        self.accounts.get_account_by_id(account_id)
        binding, result = self.begin('admin')
        self.storage.save('auth_link_approvals', sha256(result['state']), {
            'account_id': account_id, 'approved_by': approved_by,
            'session_hash': sha256(session_id),
        }, ttl_seconds=300)
        return binding, result

    def begin(self, return_target='diagnostic'):
        if return_target not in ('diagnostic', 'app', 'admin'):
            raise AuthFailure('access_denied', 403)
        self.client.ready()
        binding = secrets.token_urlsafe(32)
        state = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(32)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
        value = self.client.request('v1/transactions/begin', {
            'completion_url': self.settings.completion_url, 'challenge': challenge, 'state': state})
        if (not isinstance(value.get('transaction'), str)
                or value.get('authorization_url') != self.settings.public_url
                + 'v1/browser/authorize?transaction=' + value['transaction']
                or not isinstance(value.get('expires_at'), (int, float))
                or not time.time() < value['expires_at'] <= time.time() + 310):
            raise AuthFailure('auth_configuration_error')
        sealed = _get_fernet().encrypt(json.dumps({
            'transaction': value['transaction'], 'verifier': verifier,
            'state': state, 'binding': sha256(binding), 'epoch': self.policy()['epoch'],
            'return_target': return_target,
            'environment': self.settings.metadata(), 'expires': value['expires_at'],
        }).encode()).decode()
        self.storage.save('auth_transactions', sha256(state), sealed, ttl_seconds=300)
        return binding, {'authorization_url': value['authorization_url'], 'state': state,
                         'expires_at': value['expires_at']}

    def policy(self):
        return validate_authentication(self.storage.load('config', 'authentication'))

    def pending(self, state, binding):
        key = sha256(state)
        if not self.storage.exists('auth_transactions', key):
            raise AuthFailure('invalid_session', 401)
        record = json.loads(_get_fernet().decrypt(self.storage.load('auth_transactions', key).encode()))
        if (record['expires'] <= time.time()
                or not hmac.compare_digest(record['binding'], sha256(binding))
                or record['state'] != state or record['epoch'] != self.policy()['epoch']
                or record['environment'] != self.settings.metadata()):
            raise AuthFailure('invalid_session', 401)
        return record

    def cancel(self, state, binding):
        with self.storage.transaction():
            self.pending(state, binding)
            self.storage.delete('auth_transactions', sha256(state))
            if self.storage.exists('auth_link_approvals', sha256(state)):
                self.storage.delete('auth_link_approvals', sha256(state))

    def complete(self, state, code, binding, session_id=''):
        key = sha256(state)
        with self.storage.transaction():
            record = self.pending(state, binding)
            result = self.client.request('v1/transactions/redeem', {
                'transaction': record['transaction'], 'code': code, 'verifier': record['verifier']})
            identity = result.get('identity')
            if (result.get('transaction') != record['transaction'] or not isinstance(identity, dict)
                    or not isinstance(result.get('grant'), str)
                    or not result['grant'] or type(result.get('expires_at')) not in (int, float)
                    or not time.time() < result['expires_at'] <= time.time() + 3610):
                raise AuthFailure('auth_configuration_error')
            target = None
            if self.storage.exists('auth_link_approvals', key):
                from planner_lib.accounts.constants import AccountPermissions
                approval = self.storage.load('auth_link_approvals', key)
                approving_session = self.sessions.get(session_id)
                if (approving_session is None or approving_session['account_id'] != approval['approved_by']
                    or not hmac.compare_digest(sha256(session_id), approval['session_hash'])
                    or AccountPermissions.ADMIN not in self.accounts.get_account_by_id(approval['approved_by'])['permissions']):
                    raise AuthFailure('access_denied', 403)
                target = approval['account_id']
            account = self.identities.resolve(identity, target)
            email = account['email']
            account_id = account['id']
            name = self.identities.profile(account_id)['name']
            local_binding = secrets.token_urlsafe(32)
            encrypted_grant = _get_fernet().encrypt(result['grant'].encode()).decode()
            self.storage.save('auth_grants', local_binding, {
                'account_id': account_id, 'epoch': self.policy()['epoch'], 'grant': encrypted_grant,
                'expires_at': result['expires_at'], 'revoked': False,
                'environment': self.settings.metadata(), 'name': name,
            })
            sid = self.sessions.create(email, source='entra', binding=local_binding)
            self.storage.delete('auth_transactions', key)
            if self.storage.exists('auth_link_approvals', key):
                self.storage.delete('auth_link_approvals', key)
        return sid

    def profile(self, context=None):
        account = None
        status = 'signed_out'
        if context is not None:
            account = self.identities.profile(context['account_id'])
            local = self.storage.load('auth_grants', context['binding'])
            reference = _get_fernet().decrypt(local['grant'].encode()).decode()
            try:
                grant = self.client.request('v1/grants/status', {'grant': reference})
            except AuthFailure as error:
                if error.code != 'auth_unavailable':
                    raise
                status = 'unavailable'
            else:
                if grant.get('status') not in ('active', 'expired', 'revoked', 'interaction_required'):
                    raise AuthFailure('auth_configuration_error')
                status = 'signed_in' if grant['status'] == 'active' else 'interaction_required'
        return {'mode': 'entra', 'status': status,
            'account': account,
            'permissions': [] if context is None else self.accounts.get_account_by_id(context['account_id'])['permissions'],
            'capabilities': {
                    'pat': False, 'enrollment': False, 'reauthenticate': account is not None,
                    'logout': account is not None, 'deleteAccount': False}}

    def logout(self, sid):
        reference = None
        with self.storage.transaction():
            if sid:
                key = sha256(sid)
                if self.storage.exists('auth_sessions', key):
                    session = self.storage.load('auth_sessions', key)
                    binding = session.get('binding')
                    if binding and self.storage.exists('auth_grants', binding):
                        grant = self.storage.load('auth_grants', binding)
                        grant['revoked'] = True
                        self.storage.save('auth_grants', binding, grant)
                        reference = _get_fernet().decrypt(grant['grant'].encode()).decode()
                    self.sessions.delete(sid)
        if reference is not None:
            self.client.request('v1/grants/revoke', {'grant': reference})


def prepare_sandbox(storage, settings):
    if not settings.isolated_sandbox or settings.upstream_mode != 'mock':
        raise ValueError('Phase D permits Entra activation only in isolated sandbox data')
    marker = settings.metadata()
    if storage.exists('system', 'sandbox_auth'):
        if storage.load('system', 'sandbox_auth') != marker:
            raise ValueError('Sandbox environment or generation mismatch; use separate data')
        from planner_lib.admin.config_manager import ConfigManager
        ConfigManager(storage)._validate_sandbox_config('ado_config', storage.load('config', 'ado_config'))
        return
    if list(storage.list_keys('accounts')):
        raise ValueError('Sandbox activation requires fresh isolated data, never existing accounts')
    from planner_lib.accounts.config import AccountManager

    with storage.transaction():
        accounts = AccountManager(storage)
        for index, (email, name) in enumerate(SANDBOX_IDENTITIES.values()):
            accounts.create_account(AccountCredentialsPayload(email=email), permissions=['admin'] if index == 0 else [])
        from planner_lib.session.identity import seed_sandbox_links
        seed_sandbox_links(storage, accounts, settings)
        storage.save('config', 'authentication', {
            'version': 1, 'selected': 'entra', 'active': 'entra', 'backend_credentials': 'delegated', 'epoch': 1})
        storage.save('config', 'ado_config', {
            'organization_url': 'example', 'feature_flags': {'use_azure_mock': True}})
        storage.save('system', 'sandbox_auth', marker)