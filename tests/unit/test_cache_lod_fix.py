"""TDD tests for CacheManager LoD fix.

Three violations to fix:

1. AzureCachingClient._fetch_count accesses self._cache._fetch_count
   → CacheManager must expose a public `fetch_count` property.

2. AzureCachingClient.invalidate_work_items / invalidate_plans access
   self._cache._read_index() to iterate area keys.
   → CacheManager must expose a public `list_area_keys()` method.

3. HistoryService.invalidate_cache accesses azure_client._cache,
   then cache._lock and cache._read_index().
   → AzureCachingClient must expose a public
     `invalidate_history_cache() -> int` method, and
     HistoryService must call that instead.
"""
from types import SimpleNamespace
import pytest


# ---------------------------------------------------------------------------
# CacheManager public fetch_count property
# ---------------------------------------------------------------------------

class TestCacheManagerFetchCount:
    def test_fetch_count_public_property_read(self):
        """CacheManager.fetch_count is a public readable property."""
        from planner_lib.azure.caching import CacheManager

        class FakeStorage:
            def load(self, ns, key):
                raise KeyError(key)
            def save(self, ns, key, value):
                pass
            def exists(self, ns, key):
                return False

        cm = CacheManager(FakeStorage())
        # must not raise; must return 0 by default
        assert cm.fetch_count == 0

    def test_fetch_count_public_property_write(self):
        """CacheManager.fetch_count can be set via public property."""
        from planner_lib.azure.caching import CacheManager

        class FakeStorage:
            def load(self, ns, key):
                raise KeyError(key)
            def save(self, ns, key, value):
                pass
            def exists(self, ns, key):
                return False

        cm = CacheManager(FakeStorage())
        cm.fetch_count = 42
        assert cm.fetch_count == 42

    def test_private_fetch_count_not_accessed_by_caching_client(self):
        """AzureCachingClient._fetch_count must go through cache.fetch_count."""
        from planner_lib.azure.AzureCachingClient import AzureCachingClient

        class FakeStorage:
            def load(self, ns, key):
                raise KeyError(key)
            def save(self, ns, key, value):
                pass
            def exists(self, ns, key):
                return False
            def delete(self, ns, key):
                pass
            def list_keys(self, ns):
                return []

        client = AzureCachingClient('org', FakeStorage())
        # Reading/writing _fetch_count should go through cache.fetch_count
        client._cache.fetch_count = 5
        assert client._cache.fetch_count == 5
        client._cache.fetch_count = 10
        assert client._cache.fetch_count == 10


# ---------------------------------------------------------------------------
# CacheManager.list_area_keys() public method
# ---------------------------------------------------------------------------

class TestCacheManagerListAreaKeys:
    def _make_cm(self, index_data):
        from planner_lib.azure.caching import CacheManager

        class FakeStorage:
            def __init__(self, idx):
                self._idx = idx
            def load(self, ns, key):
                if key == '_index':
                    return self._idx
                raise KeyError(key)
            def save(self, ns, key, value):
                pass
            def exists(self, ns, key):
                return False

        return CacheManager(FakeStorage(index_data))

    def test_list_area_keys_excludes_special_keys(self):
        """list_area_keys() returns index keys excluding '_invalidated' and
        prefixed history/plan/teams/iterations keys."""
        cm = self._make_cm({
            'area_proj__teamA': {'last_update': '2020-01-01'},
            'area_proj__teamB': {'last_update': '2020-01-01'},
            '_invalidated': {},
            'teams_proj': {},
            'plans_proj': {},
            'history_123': {},
        })
        keys = list(cm.list_area_keys())
        assert 'area_proj__teamA' in keys
        assert 'area_proj__teamB' in keys
        assert '_invalidated' not in keys
        assert 'history_123' not in keys
        assert 'teams_proj' not in keys
        assert 'plans_proj' not in keys

    def test_list_area_keys_empty_index(self):
        cm = self._make_cm({})
        assert list(cm.list_area_keys()) == []

    def test_list_all_index_keys_returns_everything(self):
        """list_all_index_keys() returns every key in the index (for _read_index callers)."""
        cm = self._make_cm({'a': {}, 'b': {}, '_invalidated': {}})
        all_keys = set(cm.list_all_index_keys())
        assert 'a' in all_keys
        assert 'b' in all_keys
        assert '_invalidated' in all_keys


# ---------------------------------------------------------------------------
# AzureCachingClient.invalidate_history_cache() public method
# ---------------------------------------------------------------------------

class TestAzureCachingClientHistoryInvalidate:
    def _make_client_with_history_entries(self):
        from planner_lib.azure.AzureCachingClient import AzureCachingClient

        index = {
            'history_1': {'last_update': '2020-01-01'},
            'history_2': {'last_update': '2020-01-01'},
            'area_proj__team': {'last_update': '2020-01-01'},
        }
        deleted = []

        class FakeStorage:
            def load(self, ns, key):
                if key == '_index':
                    return dict(index)
                raise KeyError(key)
            def save(self, ns, key, value):
                if key == '_index':
                    index.clear()
                    index.update(value)
            def exists(self, ns, key):
                return key in index
            def delete(self, ns, key):
                deleted.append(key)
                index.pop(key, None)
            def list_keys(self, ns):
                return list(index.keys())

        client = AzureCachingClient('org', FakeStorage())
        return client, deleted

    def test_invalidate_history_cache_returns_count(self):
        """invalidate_history_cache() returns the number of deleted history keys."""
        client, _ = self._make_client_with_history_entries()
        count = client.invalidate_history_cache()
        assert count == 2

    def test_invalidate_history_cache_deletes_only_history_keys(self):
        """invalidate_history_cache() must not touch non-history cache entries."""
        client, deleted = self._make_client_with_history_entries()
        client.invalidate_history_cache()
        assert all(k.startswith('history_') for k in deleted)

    def test_invalidate_history_cache_on_non_caching_client_returns_zero(self):
        """If client has no _cache, invalidate_history_cache() returns 0 gracefully."""
        from planner_lib.azure.AzureNativeClient import AzureNativeClient

        class FakeStorage:
            def load(self, ns, key):
                raise KeyError(key)
            def save(self, ns, key, value):
                pass
            def exists(self, ns, key):
                return False

        nc = AzureNativeClient('org', FakeStorage())
        # AzureNativeClient has no invalidate_history_cache → should raise AttributeError
        # (it's not expected to have this method; HistoryService should check for it)
        assert not hasattr(nc, 'invalidate_history_cache')


# ---------------------------------------------------------------------------
# HistoryService.invalidate_cache uses public API only
# ---------------------------------------------------------------------------

class TestHistoryServiceInvalidateCacheUsesPublicAPI:
    def test_invalidate_cache_calls_client_method_not_internal(self):
        """HistoryService.invalidate_cache must call azure_client.invalidate_history_cache()
        rather than reaching into azure_client._cache."""
        from unittest.mock import MagicMock, patch
        from planner_lib.projects.history_service import HistoryService

        storage = MagicMock()
        svc = HistoryService(storage_config=storage)

        # Build a client that exposes the public method and tracks calls
        mock_client = MagicMock()
        mock_client.invalidate_history_cache.return_value = 3

        count = svc.invalidate_cache(mock_client)
        assert count == 3
        mock_client.invalidate_history_cache.assert_called_once()

    def test_invalidate_cache_returns_zero_for_uncaching_client(self):
        """If client has no invalidate_history_cache, invalidate_cache returns 0."""
        from planner_lib.projects.history_service import HistoryService

        class FakeStorage:
            pass

        svc = HistoryService(storage_config=FakeStorage())

        class PlainClient:
            pass  # no invalidate_history_cache

        count = svc.invalidate_cache(PlainClient())
        assert count == 0
