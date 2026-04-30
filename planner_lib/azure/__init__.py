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

    One ``AzureClient`` instance is created in ``__init__`` and reused across
    requests. Use ``with service.connect(pat) as client:`` to obtain a
    connected client for the duration of a request.

    Client selection (first match wins):
    - ``use_azure_mock_generator``  → AzureMockGeneratorClient (synthetic data)
    - ``use_azure_mock``            → AzureMockClient (fixture replay)
    - (default)                     → AzureClient (live Azure DevOps)

    Caching of domain objects is the responsibility of CachingBackend; the
    azure layer no longer maintains a separate disk cache.
    """

    def __init__(self, organization_url: str, storage: StorageBackend, feature_flags: dict = None):
        self.organization_url = organization_url
        self.storage = storage
        self.feature_flags = feature_flags or {}
        self._client = self._build_client()

    def _build_client(self):
        """Construct the concrete client based on current feature flags."""
        # Generator mock: builds a coherent synthetic dataset from config files.
        if self.feature_flags.get("use_azure_mock_generator", False):
            from planner_lib.azure.AzureMockGeneratorClient import AzureMockGeneratorClient
            data_dir = self.feature_flags.get("data_dir", "data")
            cfg = dict(self.feature_flags.get("generator_config") or {})
            # Resolve persist_dir: explicit flag > boolean toggle > config dict entry
            persist_dir = self.feature_flags.get("generator_persist_dir") or cfg.pop("persist_dir", None)
            if not persist_dir and self.feature_flags.get("generator_persist_enabled", False):
                persist_dir = f"{data_dir}/azure_mock_generated"
            return AzureMockGeneratorClient(
                self.organization_url,
                storage=self.storage,
                data_dir=data_dir,
                config_dict=cfg or None,
                persist_dir=persist_dir,
            )

        # Fixture mock: replays pre-recorded SDK responses from disk.
        if self.feature_flags.get("use_azure_mock", False):
            from planner_lib.azure.AzureMockClient import AzureMockClient
            fixture_dir = self.feature_flags.get("azure_mock_data_dir", "data/azure_mock")
            persist_enabled = bool(self.feature_flags.get("azure_mock_persist_enabled", False))
            return AzureMockClient(
                self.organization_url,
                storage=self.storage,
                fixture_dir=fixture_dir,
                persist_enabled=persist_enabled,
            )

        # Live client — all caching is handled by CachingBackend at the domain layer.
        from planner_lib.azure.AzureClient import AzureClient
        cache_plans = bool(self.feature_flags.get('cache_azure_plans', True))
        return AzureClient(self.organization_url, storage=self.storage, cache_plans=cache_plans)

    def connect(self, pat: str):
        """Return the concrete client's context-manager bound to `pat`.

        Callers should use ``with service.connect(pat) as client:``.
        """
        return self._client.connect(pat)

    @property
    def requires_pat(self) -> bool:
        """Return True when a non-empty PAT is required to make API calls.

        False for mock clients (fixture replay and synthetic generator) because
        they never contact the live Azure DevOps endpoint.
        """
        from planner_lib.azure.AzureMockClient import AzureMockClient
        from planner_lib.azure.AzureMockGeneratorClient import AzureMockGeneratorClient
        return not isinstance(self._client, (AzureMockClient, AzureMockGeneratorClient))

    def rebuild_client(self) -> None:
        """Rebuild the concrete client (e.g. after a feature-flag change via admin reload)."""
        self._client = self._build_client()

    def invalidate_all_caches(self) -> dict:
        """No-op: the azure service layer no longer owns a disk cache.

        Domain-level caching is handled by CachingBackend; call
        CacheCoordinator.invalidate_all() to invalidate the backend cache.
        """
        return {'ok': True, 'cleared': 0}

    def invalidate_cache(self) -> None:
        """Satisfy the Invalidatable protocol."""
        self.invalidate_all_caches()

    def cleanup_orphaned_cache_keys(self) -> dict:
        """No-op: the azure service layer no longer owns a disk cache index."""
        return {'ok': True, 'orphaned_cleaned': 0}


# `get_client()` removed: use `AzureService.connect(pat)` instead.
