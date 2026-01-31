"""Public azure module.

This package exposes the `AzureService` stateless service which should be
registered at application composition time. Use `with service.connect(pat)`
to obtain a short-lived concrete client for the duration of a request.
"""
import logging

logger = logging.getLogger(__name__)

from planner_lib import setup
from planner_lib.storage.interfaces import StorageProtocol
from .interfaces import AzureServiceProtocol
class AzureService(AzureServiceProtocol):
    """Stateless Azure service configured at app composition time.

    Use `with service.connect(pat) as client:` to obtain a short-lived
    per-PAT concrete client instance (caching or native) which is connected
    for the duration of the context. The service does not hold the PAT or
    an active SDK connection itself.
    """
    def __init__(self, organization_url: str, storage: StorageProtocol):
        self.organization_url = organization_url
        self.storage = storage

    def connect(self, pat: str):
        """Return the concrete client's context-manager bound to `pat`.

        This delegates the SDK lifecycle to the concrete client. Callers
        should use `with service.connect(pat) as client:`.
        """
        if setup.has_feature_flag("enable_azure_cache"):
            from planner_lib.azure.AzureCachingClient import AzureCachingClient

            client = AzureCachingClient(self.organization_url, storage=self.storage)
        else:
            from planner_lib.azure.AzureNativeClient import AzureNativeClient

            client = AzureNativeClient(self.organization_url, storage=self.storage)

        # Return the concrete client's context-manager directly.
        return client.connect(pat)


# `get_client()` removed: use `AzureService.connect(pat)` instead.
