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


def initialize_legacy_claims(storage):
    with storage.transaction():
        claims = storage.load('system', 'legacy_email_claims')
        if not claims['initialized']:
            storage.save('system', 'legacy_email_claims', {
                'initialized': True,
                'accounts': [storage.load('accounts', email)['account_id']
                             for email in storage.list_keys('accounts')],
            })


def validate_identity_records(storage):
    if storage.load('system', 'external_identity_schema') != {'version': 3}:
        raise SchemaError('Invalid external identity schema')
    account_ids = {storage.load('accounts', email)['account_id'] for email in storage.list_keys('accounts')}
    linked_accounts = set()
    for key in storage.list_keys('external_identities'):
        record = storage.load('external_identities', key)
        if (set(record) != {'version', 'issuer', 'subject', 'account_id', 'environment', 'name', 'email'}
                or record['version'] != 3 or key != identity_key(record['issuer'], record['subject'])
                or record['account_id'] not in account_ids or record['account_id'] in linked_accounts
                or not isinstance(record['name'], str) or not record['name'].strip()
                or not isinstance(record['email'], str)
                or (record['email'] != '' and not _is_valid_email(record['email']))
                or not isinstance(record['environment'], dict)
                or set(record['environment']) != {'protocol', 'broker_url', 'upstream_mode'}
                or record['environment']['protocol'] != 'plannertool-auth/1'
                or not re.fullmatch(r'[a-z][a-z0-9_-]{0,63}', record['environment']['upstream_mode'])):
            raise SchemaError('Invalid external identity link')
        linked_accounts.add(record['account_id'])


class ExternalIdentityLinks:
    def __init__(self, storage, accounts, settings):
        self.storage = storage
        self.accounts = accounts
        self.settings = settings

    def eligible_account(self, email):
        from planner_lib.session.broker import AuthFailure

        if not isinstance(email, str) or not _is_valid_email(email):
            raise AuthFailure('access_denied', 403)
        eligible = set(self.storage.load('system', 'legacy_email_claims')['accounts'])
        matches = [account for account in self.accounts.list_accounts()
                   if account['id'] in eligible and account['email'].casefold() == email.strip().casefold()]
        if len(matches) != 1:
            raise AuthFailure('access_denied', 403)
        target = matches[0]
        if any(self.storage.load('external_identities', key)['account_id'] == target['id']
               for key in self.storage.list_keys('external_identities')):
            raise AuthFailure('access_denied', 403)
        return target

    def consume_claim(self, account_id):
        claims = self.storage.load('system', 'legacy_email_claims')
        if account_id in claims['accounts']:
            claims['accounts'].remove(account_id)
            self.storage.save('system', 'legacy_email_claims', claims)

    def claim(self, account_id, email):
        from planner_lib.session.broker import AuthFailure

        if self.settings.upstream_mode != 'entra':
            raise AuthFailure('access_denied', 403)
        with self.storage.transaction():
            source = self.accounts.get_account_by_id(account_id)
            if not source['email'].endswith('@identity.invalid'):
                raise AuthFailure('access_denied', 403)
            links = [(key, self.storage.load('external_identities', key))
                     for key in self.storage.list_keys('external_identities')
                     if self.storage.load('external_identities', key)['account_id'] == account_id]
            if len(links) != 1 or links[0][1]['environment'] != self.settings.metadata():
                raise AuthFailure('access_denied', 403)
            target = self.eligible_account(email)
            key, link = links[0]
            self.accounts.merge_external_account(account_id, target['id'])
            link['account_id'] = target['id']
            link['email'] = target['email']
            self.storage.save('external_identities', key, link)
            self.consume_claim(target['id'])
            return target

    def resolve(self, identity):
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
                if link['environment'] != self.settings.metadata():
                    raise AuthFailure('access_denied', 403)
                return self.accounts.get_account_by_id(link['account_id'])
            email = identity.get('email', '')
            if (not isinstance(identity.get('name'), str) or not identity['name'].strip()
                    or len(identity['name']) > 256 or not isinstance(email, str)
                    or (email != '' and not _is_valid_email(email)) or len(email) > 320):
                raise AuthFailure('auth_configuration_error')
            email = email.strip().casefold()
            target = None
            mock_email_identity = identity.get('link_existing_by_email', False)
            if target is None and self.settings.upstream_mode == 'entra' and email:
                claims = self.storage.load('system', 'legacy_email_claims')
                matching = [account for account in self.accounts.list_accounts()
                            if account['id'] in claims['accounts']
                            and account['email'].casefold() == email]
                if matching:
                    target = self.eligible_account(email)['id']
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
                permissions = (['admin'] if self.settings.upstream_mode == 'entra'
                               and not self.accounts.list_accounts() else [])
                created = self.accounts.create_account(
                    AccountCredentialsPayload(email=internal_email), permissions=permissions)
                if not created['ok']:
                    raise AuthFailure('auth_configuration_error')
                target = created['id']
            account = self.accounts.get_account_by_id(target)
            if any(self.storage.load('external_identities', item)['account_id'] == target
                   for item in self.storage.list_keys('external_identities')):
                raise AuthFailure('access_denied', 403)
            self.storage.save('external_identities', key, {
                'version': 3, 'issuer': identity['issuer'], 'subject': identity['subject'],
                'account_id': target, 'environment': self.settings.metadata(),
                'name': identity['name'], 'email': email,
            })
            if self.settings.upstream_mode == 'entra':
                self.consume_claim(target)
            return account

    def profile(self, account_id):
        from planner_lib.session.broker import AuthFailure

        for key in self.storage.list_keys('external_identities'):
            link = self.storage.load('external_identities', key)
            if link['account_id'] == account_id and link['environment'] == self.settings.metadata():
                return {'uuid': account_id, 'email': link['email'], 'name': link['name']}
        raise AuthFailure('invalid_session', 401)
