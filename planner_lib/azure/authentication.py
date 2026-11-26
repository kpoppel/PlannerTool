"""Azure DevOps credential validation and Bearer transport construction."""
from __future__ import annotations

from planner_lib.backend.port import BackendCredential


def token_from_credential(credential: BackendCredential) -> str:
    """Validate an operation credential without inferring its kind from token syntax."""
    if not isinstance(credential, dict):
        raise ValueError('Backend credential must be a mapping')
    if credential.get('kind') not in ('bearer', 'mock'):
        raise ValueError('Unsupported backend credential kind')

    token = credential.get('token')
    if not isinstance(token, str) or not token:
        raise ValueError('Backend credential must contain a non-empty token')
    user_id = credential.get('user_id')
    if not isinstance(user_id, str) or not user_id:
        raise ValueError('Backend credential must contain a user ID')
    return token


def azure_devops_authentication(credential: BackendCredential, credential_provider=None):
    """Construct the installed SDK Bearer authentication for a live credential."""
    token = token_from_credential(credential)
    if credential['kind'] != 'bearer':
        raise ValueError('Live Azure DevOps requires a Bearer credential')
    if credential.get('transport') == 'fixture':
        raise ValueError('Sandbox credentials require an explicit fixture transport')
    from msrest.authentication import BasicTokenAuthentication

    if credential_provider is not None:
        class RenewingBearerAuthentication(BasicTokenAuthentication):
            def signed_session(self, session=None):
                current = credential_provider.renew(credential)
                current_token = token_from_credential(current)
                if current['kind'] != 'bearer' or current['transport'] != 'live':
                    raise ValueError('Live SDK requires a live Bearer credential')
                self.credential = current
                return BasicTokenAuthentication({
                    'access_token': current_token, 'token_type': 'Bearer',
                }).signed_session(session)

        authentication = RenewingBearerAuthentication({'access_token': token, 'token_type': 'Bearer'})
        authentication.credential = credential
        return authentication
    return BasicTokenAuthentication({'access_token': token, 'token_type': 'Bearer'})
