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
        # Generator mock: builds a coherent synthetic dataset from config files.
        if self.feature_flags.get("use_azure_mock_generator", False):
            from planner_lib.azure.AzureMockGeneratorClient import AzureMockGeneratorClient
            data_dir = self.feature_flags.get("data_dir", "data")
            cfg = dict(self.feature_flags.get("generator_config") or {})
            # persist_dir may be top-level flag or inside generator_config
            persist_dir = (
                self.feature_flags.get("generator_persist_dir")
                or cfg.pop("persist_dir", None)
            )
            return AzureMockGeneratorClient(
                self.organization_url,
                storage=self.storage,
                data_dir=data_dir,
                config_dict=cfg or None,
                memory_cache=self.memory_cache,
                persist_dir=persist_dir,
            )

        # Fixture mock: replays pre-recorded SDK responses from disk.
        if self.feature_flags.get("use_azure_mock", False):
            from planner_lib.azure.AzureMockClient import AzureMockClient
            fixture_dir = self.feature_flags.get("azure_mock_data_dir", "data/azure_mock")
            return AzureMockClient(
                self.organization_url,
                storage=self.storage,
                fixture_dir=fixture_dir,
                memory_cache=self.memory_cache,
            )
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

    def rebuild_client(self) -> None:
        """Rebuild the concrete client (e.g. after a feature-flag change via admin reload)."""
        self._client = self._build_client()

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
