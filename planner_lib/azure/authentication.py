"""Azure DevOps credential validation and PAT transport construction."""
from __future__ import annotations

from planner_lib.backend.port import BackendCredential


def pat_from_credential(credential: BackendCredential) -> str:
    """Validate an operation credential and return its PAT for the selected transport."""
    if not isinstance(credential, dict):
        raise ValueError('Backend credential must be a mapping')
    if credential.get('kind') != 'pat':
        raise ValueError('Unsupported backend credential kind')

    token = credential.get('token')
    if not isinstance(token, str) or not token:
        raise ValueError('PAT credential must contain a non-empty token')
    user_id = credential.get('user_id')
    if not isinstance(user_id, str) or not user_id:
        raise ValueError('PAT credential must contain a user ID')
    return token


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
