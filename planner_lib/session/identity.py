"""Stable external identity links, independent of email and enrollment secrets."""
from uuid import UUID

from planner_lib.accounts.config import AccountCredentialsPayload, _is_valid_email
from planner_lib.migrations.contracts import SchemaError


def identity_key(tenant, subject):
    if str(UUID(tenant)) != tenant or str(UUID(subject)) != subject:
        raise ValueError('External identity requires canonical tenant/object UUIDs')
    return tenant + ':' + subject


def validate_identity_records(storage):
    if storage.load('system', 'external_identity_schema') != {'version': 1}:
        raise SchemaError('Invalid external identity schema')
    account_ids = {storage.load('accounts', email)['account_id'] for email in storage.list_keys('accounts')}
    linked_accounts = set()
    for key in storage.list_keys('external_identities'):
        record = storage.load('external_identities', key)
        if (set(record) != {'version', 'tenant', 'subject', 'account_id', 'environment', 'name', 'email'}
                or record['version'] != 1 or key != identity_key(record['tenant'], record['subject'])
                or record['account_id'] not in account_ids or record['account_id'] in linked_accounts
                or not isinstance(record['name'], str) or not record['name'].strip()
                or not isinstance(record['email'], str) or not _is_valid_email(record['email'])
                or not isinstance(record['environment'], dict)
                or set(record['environment']) != {'protocol', 'environment_id', 'generation', 'upstream_mode'}
                or record['environment']['protocol'] != 'plannertool-auth/1'
                or record['environment']['upstream_mode'] not in ('mock', 'entra')):
            raise SchemaError('Invalid external identity link')
        linked_accounts.add(record['account_id'])


class ExternalIdentityLinks:
    def __init__(self, storage, accounts, settings):
        self.storage = storage
        self.accounts = accounts
        self.settings = settings

    def resolve(self, identity, target=None):
        from planner_lib.session.broker import AuthFailure

        try:
            key = identity_key(identity['tid'], identity['oid'])
        except (KeyError, TypeError, ValueError, AttributeError) as error:
            raise AuthFailure('auth_configuration_error') from error
        with self.storage.transaction():
            if self.storage.exists('external_identities', key):
                link = self.storage.load('external_identities', key)
                if link['environment'] != self.settings.metadata() or (target is not None and link['account_id'] != target):
                    raise AuthFailure('access_denied', 403)
                return self.accounts.get_account_by_id(link['account_id'])
            if (not isinstance(identity.get('name'), str) or not identity['name'].strip()
                    or len(identity['name']) > 256 or not isinstance(identity.get('email'), str)
                    or not _is_valid_email(identity['email']) or len(identity['email']) > 320):
                raise AuthFailure('auth_configuration_error')
            if target is None:
                internal_email = identity['oid'] + '.' + identity['tid'] + '@identity.invalid'
                if self.storage.exists('accounts', internal_email):
                    raise AuthFailure('access_denied', 403)
                created = self.accounts.create_account(AccountCredentialsPayload(email=internal_email), permissions=[])
                if not created['ok']:
                    raise AuthFailure('auth_configuration_error')
                target = created['id']
            account = self.accounts.get_account_by_id(target)
            if any(self.storage.load('external_identities', item)['account_id'] == target
                   for item in self.storage.list_keys('external_identities')):
                raise AuthFailure('access_denied', 403)
            self.storage.save('external_identities', key, {
                'version': 1, 'tenant': identity['tid'], 'subject': identity['oid'],
                'account_id': target, 'environment': self.settings.metadata(),
                'name': identity['name'], 'email': identity['email'],
            })
            return account

    def profile(self, account_id):
        from planner_lib.session.broker import AuthFailure

        for key in self.storage.list_keys('external_identities'):
            link = self.storage.load('external_identities', key)
            if link['account_id'] == account_id and link['environment'] == self.settings.metadata():
                return {'uuid': account_id, 'email': link['email'], 'name': link['name']}
        raise AuthFailure('invalid_session', 401)
