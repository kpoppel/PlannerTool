"""Stable external identity links, independent of email and enrollment secrets."""
import hashlib
import json
import re

from planner_lib.accounts.config import AccountCredentialsPayload, _is_valid_email
from planner_lib.migrations.contracts import SchemaError


def identity_key(issuer, subject):
    for value in (issuer, subject):
        if (not isinstance(value, str) or not value or len(value) > 512
                or value != value.strip() or any(ord(character) < 32 for character in value)):
            raise ValueError('External identity requires a bounded issuer and subject')
    return hashlib.sha256(json.dumps([issuer, subject], separators=(',', ':')).encode()).hexdigest()


def validate_identity_records(storage):
    if storage.load('system', 'external_identity_schema') != {'version': 2}:
        raise SchemaError('Invalid external identity schema')
    account_ids = {storage.load('accounts', email)['account_id'] for email in storage.list_keys('accounts')}
    linked_accounts = set()
    for key in storage.list_keys('external_identities'):
        record = storage.load('external_identities', key)
        if (set(record) != {'version', 'issuer', 'subject', 'account_id', 'environment', 'name', 'email'}
                or record['version'] != 2 or key != identity_key(record['issuer'], record['subject'])
                or record['account_id'] not in account_ids or record['account_id'] in linked_accounts
                or not isinstance(record['name'], str) or not record['name'].strip()
                or not isinstance(record['email'], str) or not _is_valid_email(record['email'])
                or not isinstance(record['environment'], dict)
                or set(record['environment']) != {'protocol', 'environment_id', 'generation', 'upstream_mode'}
                or record['environment']['protocol'] != 'plannertool-auth/1'
                or not re.fullmatch(r'[a-z][a-z0-9_-]{0,63}', record['environment']['upstream_mode'])):
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
            key = identity_key(identity['issuer'], identity['subject'])
        except (KeyError, TypeError, ValueError, AttributeError) as error:
            raise AuthFailure('auth_configuration_error') from error
        if (set(identity) - {'issuer', 'subject', 'name', 'email', 'link_existing_by_email'}
                or type(identity.get('link_existing_by_email', False)) is not bool
                or (identity.get('link_existing_by_email', False)
                    and self.settings.upstream_mode != 'mock')):
            raise AuthFailure('auth_configuration_error')
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
            email = identity['email'].strip().casefold()
            mock_email_identity = identity.get('link_existing_by_email', False)
            if target is None and mock_email_identity:
                matching_ids = {account['id'] for account in self.accounts.list_accounts()
                                if account['email'].casefold() == email}
                for item in self.storage.list_keys('external_identities'):
                    link = self.storage.load('external_identities', item)
                    if (link['environment'] == self.settings.metadata()
                            and link['email'].casefold() == email):
                        matching_ids.add(link['account_id'])
                if len(matching_ids) > 1:
                    raise AuthFailure('access_denied', 403)
                if matching_ids:
                    target = matching_ids.pop()
                    for item in self.storage.list_keys('external_identities'):
                        link = self.storage.load('external_identities', item)
                        if (link['account_id'] == target
                                and link['environment'] == self.settings.metadata()):
                            return self.accounts.get_account_by_id(target)
            if target is None:
                internal_email = email if mock_email_identity else key + '@identity.invalid'
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
                'version': 2, 'issuer': identity['issuer'], 'subject': identity['subject'],
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
