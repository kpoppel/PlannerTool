"""Azure DevOps credential validation and explicit PAT/Bearer transport construction."""
from __future__ import annotations

from planner_lib.backend.port import BackendCredential


def token_from_credential(credential: BackendCredential) -> str:
    """Validate an operation credential without inferring its kind from token syntax."""
    if not isinstance(credential, dict):
        raise ValueError('Backend credential must be a mapping')
    if credential.get('kind') not in ('pat', 'bearer'):
        raise ValueError('Unsupported backend credential kind')

    token = credential.get('token')
    if not isinstance(token, str) or not token:
        raise ValueError('Backend credential must contain a non-empty token')
    user_id = credential.get('user_id')
    if not isinstance(user_id, str) or not user_id:
        raise ValueError('Backend credential must contain a user ID')
    return token


def pat_from_credential(credential: BackendCredential) -> str:
    """Validate a credential for a PAT-only operation."""
    token = token_from_credential(credential)
    if credential['kind'] != 'pat':
        raise ValueError('PAT operation requires a PAT credential')
    return token


def azure_devops_authentication(credential: BackendCredential, credential_provider=None):
    """Construct the installed SDK authentication selected by the credential kind."""
    token = token_from_credential(credential)
    if credential.get('transport') == 'fixture':
        raise ValueError('Sandbox credentials require an explicit fixture transport')
    if credential['kind'] == 'pat':
        return azure_devops_pat_authentication(token)
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


def azure_devops_pat_authentication(pat: str):
    """Create the SDK authentication object used for all Azure DevOps PAT access."""
    if not isinstance(pat, str) or not pat:
        raise ValueError('PAT must be a non-empty string')
    try:
        from msrest.authentication import BasicAuthentication
    except ImportError as error:
        raise RuntimeError(
            "azure-devops package not installed. Install 'azure-devops' to use Azure features"
        ) from error
    return BasicAuthentication('', pat)
