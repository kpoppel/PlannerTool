"""Public azure module.

This package exposes the `AzureService` stateless service which should be
registered at application composition time. Use `with service.connect(pat)`
to obtain a short-lived concrete client for the duration of a request.
"""
import logging

logger = logging.getLogger(__name__)

from planner_lib.storage.base import StorageBackend
from .interfaces import AzureServiceProtocol


class AzureService(AzureServiceProtocol):
    """Azure service configured at app composition time.

    The concrete client (caching or native) is created once in ``__init__``
    based on feature flags rather than being re-created on every request.
    Use ``with service.connect(pat) as client:`` to obtain a connected
    client for the duration of a request; the SDK auth context is the only
    thing that changes per-call.
    """

    def __init__(self, organization_url: str, storage: StorageBackend, feature_flags: dict = None, memory_cache=None):
        self.organization_url = organization_url
        self.storage = storage
        self.feature_flags = feature_flags or {}
        self.memory_cache = memory_cache
        # Build the concrete client once so CacheManager is not reconstructed
        # on every call to connect().
        self._client = self._build_client()

    def _build_client(self):
        """Construct the concrete client once based on current feature flags."""
        if self.feature_flags.get("enable_azure_cache", False):
            from planner_lib.azure.AzureCachingClient import AzureCachingClient
            return AzureCachingClient(
                self.organization_url,
                storage=self.storage,
                memory_cache=self.memory_cache,
            )
        from planner_lib.azure.AzureNativeClient import AzureNativeClient
        cache_plans = bool(self.feature_flags.get('cache_azure_plans', True))
        return AzureNativeClient(self.organization_url, storage=self.storage, cache_plans=cache_plans)

    def connect(self, pat: str):
        """Return the concrete client's context-manager bound to `pat`.

        Callers should use ``with service.connect(pat) as client:``.
        """
        return self._client.connect(pat)

    def invalidate_all_caches(self) -> dict:
        """Invalidate all cached Azure data.

        Only effective when enable_azure_cache feature flag is enabled.
        """
        if not self.feature_flags.get("enable_azure_cache", False):
            logger.warning("Cache invalidation requested but enable_azure_cache is not enabled")
            return {'ok': False, 'error': 'Caching not enabled', 'cleared': 0}
        return self._client.invalidate_all_caches()

    def invalidate_cache(self) -> None:
        """Satisfy the Invalidatable protocol — delegates to invalidate_all_caches()."""
        self.invalidate_all_caches()

    def cleanup_orphaned_cache_keys(self) -> dict:
        """Clean up orphaned cache index entries.

        Only effective when enable_azure_cache feature flag is enabled.
        """
        if not self.feature_flags.get("enable_azure_cache", False):
            logger.warning("Cache cleanup requested but enable_azure_cache is not enabled")
            return {'ok': False, 'error': 'Caching not enabled', 'orphaned_cleaned': 0}
        return self._client.cleanup_orphaned_cache_keys()


# `get_client()` removed: use `AzureService.connect(pat)` instead.
