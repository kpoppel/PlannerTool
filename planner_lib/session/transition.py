"""Offline, sandbox-only deployment transition over exclusively leased databases."""
import time
from uuid import UUID

from planner_lib.accounts.config import _get_fernet
from planner_lib.session.policy import initial_transition, validate_transition


class SandboxFleetTransition:
    def __init__(self, instances, transition_id, *, fault=None):
        if not instances or str(UUID(transition_id)) != transition_id:
            raise ValueError('Transition requires a fleet and canonical transition UUID')
        self.instances = instances
        self.transition_id = transition_id
        self.fleet = sorted(instances)
        self.fault = fault

    def _record(self, instance):
        return validate_transition(instance.storage.load('system', 'authentication_transition'))

    def _sandbox(self, name, instance):
        settings = instance.client.settings
        if (settings.instance != name or not settings.isolated_sandbox or settings.upstream_mode != 'mock'
                or not instance.storage.exists('system', 'sandbox_auth')
                or instance.storage.load('system', 'sandbox_auth') != settings.metadata()):
            raise ValueError('Transitions are restricted to explicitly marked isolated sandbox data')

    def _admin(self, instance, account_id):
        account = instance.accounts.get_account_by_id(account_id)
        if ('admin' not in account['permissions'] or not any(
                instance.storage.load('external_identities', key)['account_id'] == account_id
                and instance.storage.load('external_identities', key)['environment'] == instance.client.settings.metadata()
                for key in instance.storage.list_keys('external_identities'))):
            raise ValueError('Transition requires an identity-proven linked local administrator')

    def _proof(self, instance, epoch, account_id=None):
        for key in instance.storage.list_keys('auth_transition_proofs'):
            if account_id is not None and key != account_id:
                continue
            proof = instance.storage.load('auth_transition_proofs', key)
            if (proof['epoch'] != epoch or proof['environment'] != instance.client.settings.metadata()
                    or proof['expires_at'] <= time.time()):
                continue
            sid = _get_fernet().decrypt(proof['session'].encode()).decode()
            session = instance.sessions.get(sid)
            if session is None or session['account_id'] != key:
                continue
            self._admin(instance, key)
            reference = _get_fernet().decrypt(proof['grant'].encode()).decode()
            if instance.client.request('v1/grants/status', {'grant': reference}).get('status') != 'active':
                raise ValueError('Transition admin proof grant is not active')
            return key
        raise ValueError('A current session-owned administrator link proof is required')

    def _validate(self, name, instance):
        self._sandbox(name, instance)
        record = self._record(instance)
        policy = instance.storage.load('config', 'authentication')
        if instance.storage.load('config', 'ado_config')['organization_url'] != 'example':
            raise ValueError('Sandbox work-item target must match the registered organization')
        if instance.storage.exists('config', 'events_config'):
            events = instance.storage.load('config', 'events_config')
            if events['event_backend'] == 'ado_wiki' and events['ado_wiki']['organization_url'] != 'example':
                raise ValueError('Sandbox wiki target must match the registered organization')
        if record['state'] == 'idle':
            if policy['active'] != 'enrollment' or policy['selected'] != 'enrollment':
                raise ValueError('Only explicit enrollment-to-Entra sandbox transition is supported')
            admin_id = self._proof(instance, policy['epoch'])
            return {**initial_transition(), 'id': self.transition_id, 'state': 'prepared',
                    'fleet': self.fleet, 'target': 'entra', 'epoch': policy['epoch'] + 1,
                    'admin_id': admin_id, 'environment': instance.client.settings.metadata()}
        if (record['id'] != self.transition_id or record['fleet'] != self.fleet
                or record['environment'] != instance.client.settings.metadata()):
            raise ValueError('Resume requires the exact recorded fleet, environment and transition ID')
        self._admin(instance, record['admin_id'])
        committed = record['state'] in ('committed', 'released')
        if (policy['active'] != ('entra' if committed else 'enrollment')
                or policy['epoch'] != (record['epoch'] if committed else record['epoch'] - 1)):
            raise ValueError('Transition journal disagrees with active authentication policy')
        if not committed:
            self._proof(instance, policy['epoch'], record['admin_id'])
        return record

    def _save(self, name, instance, record, state):
        record = {**record, 'state': state}
        instance.storage.save('system', 'authentication_transition', record)
        if self.fault is not None:
            self.fault(name, state)
        return record

    def execute(self, *, confirmed=False):
        if confirmed is not True:
            raise ValueError('Explicit confirmation of sandbox PAT/enrollment purge and logout is required')
        records = {}
        for name, instance in self.instances.items():
            readiness = instance.client.request('v1/deployment/readiness', {})
            if (readiness.get('ready') is not True or readiness.get('instances') != self.fleet
                    or readiness.get('completion_urls', {}).get(name) != instance.client.settings.completion_url
                    or readiness.get('tenant') != '11111111-1111-1111-1111-111111111111'
                    or readiness.get('organization') != 'example'):
                raise ValueError('Broker registration, complete fleet or approved target mismatch')
            records[name] = self._validate(name, instance)
        for name, instance in self.instances.items():
            if self._record(instance)['state'] == 'idle':
                self._save(name, instance, records[name], 'prepared')
        for name, instance in self.instances.items():
            if records[name]['state'] == 'prepared':
                records[name] = self._save(name, instance, records[name], 'fenced')
        for name, instance in self.instances.items():
            record = records[name]
            if record['state'] in ('committed', 'released'):
                continue
            with instance.storage.transaction():
                self._validate(name, instance)
                for email in instance.storage.list_keys('accounts'):
                    account = instance.storage.load('accounts', email)
                    instance.storage.save('accounts', email, {**account, 'pat': None})
                    instance.storage.save('account_auth', account['account_id'], {'enrolled': False})
                for namespace in ('auth_sessions', 'auth_transactions', 'auth_grants',
                                  'auth_link_approvals', 'auth_transition_proofs'):
                    for key in list(instance.storage.list_keys(namespace)):
                        instance.storage.delete(namespace, key)
                instance.storage.save('auth_control', 'bootstrap_claimed', True)
                instance.storage.save('config', 'authentication', {
                    'version': 1, 'selected': 'entra', 'active': 'entra',
                    'backend_credentials': 'delegated', 'epoch': record['epoch']})
                records[name] = {**record, 'state': 'committed'}
                instance.storage.save('system', 'authentication_transition', records[name])
            if self.fault is not None:
                self.fault(name, 'committed')
        for name, instance in self.instances.items():
            if self._record(instance)['state'] not in ('committed', 'released'):
                raise ValueError('Fleet is incomplete; instances remain fenced')
            self._validate(name, instance)
        for name, instance in self.instances.items():
            if records[name]['state'] != 'released':
                self._save(name, instance, records[name], 'released')

    def abort(self):
        records = {name: self._record(instance) for name, instance in self.instances.items()}
        for name, instance in self.instances.items():
            self._sandbox(name, instance)
            record = records[name]
            if (record['state'] != 'idle' and (record['id'] != self.transition_id
                    or record['fleet'] != self.fleet or record['state'] in ('committed', 'released'))):
                raise ValueError('Cannot abort after any fleet commit; resume forward or recover the whole fleet')
        for instance in self.instances.values():
            instance.storage.save('system', 'authentication_transition', initial_transition())


def transition_command(argv):
    import argparse
    import json
    import sys
    from contextlib import ExitStack
    from pathlib import Path
    from types import SimpleNamespace

    from planner_lib.accounts.config import AccountManager
    from planner_lib.middleware.session import SessionManager
    from planner_lib.migrations.contracts import SchemaError
    from planner_lib.migrations.coordinator import Database
    from planner_lib.session.broker import AuthFailure, BrokerClient, BrokerSettings
    from planner_lib.session.policy import SessionPolicy

    parser = argparse.ArgumentParser(prog='planner.py authentication-transition')
    parser.add_argument('action', choices=('commit', 'abort', 'status'))
    parser.add_argument('--fleet', required=True, help='protected sandbox fleet JSON, never a secret on argv')
    parser.add_argument('--id', required=True, help='stable transition UUID; reuse exactly for resume')
    parser.add_argument('--confirm-purge-sandbox-authority', action='store_true')
    args = parser.parse_args(argv)
    try:
        path = Path(args.fleet).resolve()
        if path.stat().st_mode & 0o077:
            raise ValueError('Fleet configuration requires mode 0600')
        config = json.loads(path.read_text())
        if (set(config) != {'version', 'instances'} or config['version'] != 1
                or not isinstance(config['instances'], dict) or not config['instances']):
            raise ValueError('Invalid sandbox fleet configuration')
        with ExitStack() as stack:
            instances = {}
            roots = set()
            for name, value in sorted(config['instances'].items()):
                if set(value) != {'data_dir', 'broker'}:
                    raise ValueError('Fleet member requires only data_dir and broker settings')
                root = (path.parent / value['data_dir']).resolve()
                if root in roots:
                    raise ValueError('Fleet members require distinct databases')
                roots.add(root)
                broker = dict(value['broker'])
                secret_file = (path.parent / broker.pop('secret_file')).resolve()
                if secret_file.stat().st_mode & 0o077:
                    raise ValueError('Broker secret requires mode 0600')
                settings = BrokerSettings(**broker, secret=secret_file.read_text().strip())
                if not settings.isolated_sandbox or settings.upstream_mode != 'mock':
                    raise ValueError('Live transitions are not authorized')
                handle = Database(root).open_offline()
                stack.callback(handle.close)
                accounts = AccountManager(handle.storage)
                instances[name] = SimpleNamespace(storage=handle.storage, accounts=accounts,
                    sessions=SessionManager(accounts, handle.storage, auth_policy=SessionPolicy(handle.storage)),
                    client=BrokerClient(settings))
            transition = SandboxFleetTransition(instances, args.id)
            if args.action == 'status':
                for name, instance in instances.items():
                    transition._sandbox(name, instance)
                print(json.dumps({name: transition._record(instance) for name, instance in instances.items()},
                                 sort_keys=True))
            elif args.action == 'abort':
                transition.abort()
                print('Pre-commit sandbox transition aborted; no credentials restored or deleted.')
            else:
                transition.execute(confirmed=args.confirm_purge_sandbox_authority)
                print('Sandbox fleet committed and released. Start only with matching deployment policy.')
        return 0
    except (ValueError, KeyError, TypeError, OSError, PermissionError, SchemaError, AuthFailure) as error:
        print('Authentication transition blocked (' + type(error).__name__
              + '). Inspect fleet status and operator recovery instructions; no automatic rollback.', file=sys.stderr)
        return 2