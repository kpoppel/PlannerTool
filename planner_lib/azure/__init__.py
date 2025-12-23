"""Public azure module.

This package exposes a small public surface: a `get_client` factory and
the module-level `_client_instance` used to hold a singleton. The heavy
lifting implementation lives in `client.py` and `caching.py` to avoid
importing the `azure-devops` SDK at top-level unnecessarily.
"""
from __future__ import annotations
from typing import Optional
import os

import logging

logger = logging.getLogger(__name__)

from planner_lib import setup

# Module-level client singleton (holds whichever implementation is chosen)
_client_instance: Optional[object] = None


def get_client(organization_url: Optional[str] = None, pat: Optional[str] = None):
    """Return a singleton Azure client instance.

    Chooses between `AzureClient` and `AzureCachingClient` based on the
    `azure_cache_enabled` feature flag. Import of the concrete classes is
    performed lazily to avoid requiring the SDK unless a client is used.
    """
    global _client_instance
    if _client_instance is not None:
        return _client_instance

    org = organization_url or os.environ.get("AZURE_DEVOPS_ORG")
    token = pat or os.environ.get("AZURE_DEVOPS_PAT", "")
    if not org:
        raise RuntimeError("Azure organization URL not provided. Set AZURE_DEVOPS_URL or pass organization_url.")

    # Choose implementation based on feature flag
    if setup.has_feature_flag("azure_cache_enabled"):
        from planner_lib.azure.AzureCachingClient import AzureCachingClient
        _client_instance = AzureCachingClient(org, token)
    else:
        from planner_lib.azure.AzureNativeClient import AzureNativeClient
        _client_instance = AzureNativeClient(org, token)

    return _client_instance

