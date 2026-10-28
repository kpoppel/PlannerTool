"""MSAL boundary for the persistent broker; tokens never enter browser responses."""
import math
import time

import msal
from requests.exceptions import RequestException

from broker import ProtocolError


SCOPES = ['https://app.vssps.visualstudio.com/.default']


class EntraUpstream:
    def __init__(self, settings, client_factory):
        self.settings = settings
        self.client_factory = client_factory
        self.http_cache = {}

    def client(self, serialized):
        cache = msal.SerializableTokenCache()
        if serialized:
            cache.deserialize(serialized)
        try:
            client = self.client_factory(
                self.settings.client_id, client_credential=self.settings.client_secret,
                authority=f'https://login.microsoftonline.com/{self.settings.tenant_id}',
                token_cache=cache, http_cache=self.http_cache, timeout=20,
            )
        except RequestException as error:
            raise ProtocolError('auth_unavailable', 503) from error
        return client, cache

    def begin(self, state):
        client, cache = self.client('')
        try:
            flow = client.initiate_auth_code_flow(
                scopes=SCOPES, redirect_uri=self.settings.redirect_uri,
                prompt='select_account', response_mode='form_post', state=state,
            )
        except RequestException as error:
            raise ProtocolError('auth_unavailable', 503) from error
        return flow, cache.serialize()

    def complete(self, flow, serialized, response):
        client, cache = self.client(serialized)
        try:
            result = client.acquire_token_by_auth_code_flow(flow, response)
        except ValueError as error:
            raise ProtocolError('invalid_binding') from error
        except RequestException as error:
            raise ProtocolError('auth_unavailable', 503) from error
        if 'error' in result:
            raise ProtocolError('cancelled' if result['error'] == 'access_denied'
                                else 'interaction_required', 409)
        claims = result.get('id_token_claims')
        issuer = f'https://login.microsoftonline.com/{self.settings.tenant_id}/v2.0'
        if (not isinstance(claims, dict) or claims.get('iss') != issuer
                or not isinstance(claims.get('sub'), str) or not claims['sub']
                or claims.get('tid') != self.settings.tenant_id
                or claims.get('aud') != self.settings.client_id):
            raise ProtocolError('invalid_identity', 403)
        identity = {'issuer': issuer, 'subject': claims['sub']}
        if isinstance(claims.get('name'), str) and claims['name'].strip():
            identity['name'] = claims['name'].strip()
        else:
            identity['name'] = 'Entra user'
        if isinstance(claims.get('email'), str) and claims['email'].strip():
            identity['email'] = claims['email'].strip().casefold()
        return identity, cache.serialize()

    def token(self, serialized):
        client, cache = self.client(serialized)
        accounts = client.get_accounts()
        if len(accounts) != 1:
            raise ProtocolError('interaction_required', 409)
        try:
            result = client.acquire_token_silent_with_error(SCOPES, account=accounts[0])
        except RequestException as error:
            raise ProtocolError('auth_unavailable', 503) from error
        if result is None or 'access_token' not in result:
            if result is not None and result.get('error') == 'temporarily_unavailable':
                raise ProtocolError('auth_unavailable', 503)
            raise ProtocolError('interaction_required', 409)
        expires = result.get('expires_on')
        if expires is None and type(result.get('expires_in')) in (int, float):
            expires = time.time() + result['expires_in']
        try:
            expires = float(expires)
        except (TypeError, ValueError) as error:
            raise ProtocolError('auth_configuration_error', 503) from error
        if (not math.isfinite(expires) or expires <= time.time() + 30
                or not isinstance(result['access_token'], str) or not result['access_token']
                or result.get('token_type', '').casefold() != 'bearer'):
            raise ProtocolError('interaction_required', 409)
        return result['access_token'], expires, cache.serialize()