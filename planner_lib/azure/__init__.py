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
import hashlib
import threading

logger = logging.getLogger(__name__)

from planner_lib import setup

# Module-level server singleton (used when no per-user PAT is supplied)
_client_instance: Optional[object] = None

# Cache of per-(org,pat) client instances keyed by sha256(org + ':' + pat)
_client_cache: dict[str, object] = {}
_client_cache_lock = threading.Lock()
_client_meta: dict[str, dict] = {}


def _make_client(org: str, token: str) -> object:
    """Instantiate the appropriate Azure client implementation for org/token.

    This performs the lazy import of the concrete client classes.
    """
    if setup.has_feature_flag("azure_cache_enabled"):
        from planner_lib.azure.AzureCachingClient import AzureCachingClient

        return AzureCachingClient(org, token)
    else:
        from planner_lib.azure.AzureNativeClient import AzureNativeClient

        return AzureNativeClient(org, token)


def get_client(organization_url: Optional[str] = None, pat: Optional[str] = None):
    """Return an Azure client.

    - If `pat` is provided, return a client specific to (org,pat). Clients are
      cached by a SHA256 hash of org+pat so repeated requests reuse the same
      instance and avoid repeated expensive setup.
    - If `pat` is not provided, return a global singleton client created from
      the environment `AZURE_DEVOPS_PAT` (existing behavior).
    """
    global _client_instance

    org = organization_url or os.environ.get("AZURE_DEVOPS_ORG")
    token = pat or os.environ.get("AZURE_DEVOPS_PAT", "")
    if not org:
        raise RuntimeError(
            "Azure organization URL not provided. Set AZURE_DEVOPS_URL or pass organization_url."
        )

    # Per-user PAT: return or create a client cached by token hash
    if pat:
        # Per-user PAT: always create a fresh client instance to avoid caching
        # per-user tokens in memory. This avoids unbounded growth.
        inst = _make_client(org, token)
        inst.connect()
        return inst

    # No per-user PAT: fall back to singleton behavior
    if _client_instance is not None:
        return _client_instance

    _client_instance = _make_client(org, token)
    try:
        _client_instance.connect()
    except Exception:
        # If connect fails, leave instance as-is; caller will see errors on use
        pass
    return _client_instance

