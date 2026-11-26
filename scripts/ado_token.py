"""Obtain an Azure DevOps Bearer token for developer scripts (PAT authentication was removed)."""
from __future__ import annotations

import json
import os
import subprocess

# Azure DevOps first-party resource id accepted by Entra token requests.
ADO_RESOURCE = '499b84ac-1321-427f-aa17-267ca6975798'


def ado_access_token() -> str:
    """Return ``AZURE_DEVOPS_TOKEN`` or a token from the signed-in Azure CLI."""
    token = os.environ.get('AZURE_DEVOPS_TOKEN', '').strip()
    if token:
        return token
    result = subprocess.run(
        ['az', 'account', 'get-access-token', '--resource', ADO_RESOURCE, '--output', 'json'],
        check=True, capture_output=True, text=True,
    )
    return json.loads(result.stdout)['accessToken']


def ado_bearer_credential(user_id: str = 'script') -> dict:
    """Build a live Bearer ``BackendCredential`` for ``AzureClient.connect``."""
    return {'kind': 'bearer', 'token': ado_access_token(), 'user_id': user_id, 'transport': 'live'}
