"""Integration test for cache TTL coordination.

Verifies that memory cache respects CacheManager TTL decisions:
- Fresh data in memory is served
- Stale data in memory triggers refetch from backend
- CacheManager is the single source of truth for TTL
"""
import pytest
from datetime import timedelta, datetime, timezone
from unittest.mock import MagicMock

from planner_lib.backend.caching import CachingBackend, CacheTTLConfig
from planner_lib.storage.memory_cache_manager import MemoryCacheManager
from planner_lib.storage.caching import CacheManager
from planner_lib.storage.memory_backend import MemoryStorage


def _ttl_config(minutes: float = 30) -> CacheTTLConfig:
    """Return a uniform CacheTTLConfig for simpler test setup."""
    td = timedelta(minutes=minutes)
    return CacheTTLConfig(default=td, fetch_tasks=td, fetch_history=td,
                          fetch_teams=td, fetch_plans=td, fetch_markers=td,
                          fetch_iterations=td)


def test_memory_cache_serves_fresh_data_respecting_cache_manager_ttl():
    """When memory has data and CacheManager says it's fresh, serve from memory."""
    # Setup
    storage = MemoryStorage()
    memory_cache = MemoryCacheManager(size_limit_mb=10)
    
    inner = MagicMock()
    inner.fetch_tasks.return_value = [{'id': 1, 'title': 'Initial task'}]
    
    backend = CachingBackend(
        inner=inner,
        storage=storage,
        memory_cache=memory_cache,
        ttl_config=_ttl_config(minutes=30)
    )
    
    # First call: cache miss, populates both tiers
    result1 = backend.fetch_tasks(area_path='test-area')
    assert len(inner.fetch_tasks.call_args_list) == 1
    assert result1[0]['title'] == 'Initial task'
    
    # Second call: memory has data and CacheManager says it's fresh
    result2 = backend.fetch_tasks(area_path='test-area')
    assert len(inner.fetch_tasks.call_args_list) == 1  # No additional backend call
    assert result2[0]['title'] == 'Initial task'


def test_memory_cache_refetches_when_cache_manager_says_stale():
    """When memory has data but CacheManager says it's stale, refetch from backend."""
    # Setup
    storage = MemoryStorage()
    memory_cache = MemoryCacheManager(size_limit_mb=10)
    cache_manager = CacheManager(storage, namespace='backend_domain')
    
    inner = MagicMock()
    inner.fetch_tasks.return_value = [{'id': 1, 'title': 'Initial task'}]
    
    backend = CachingBackend(
        inner=inner,
        storage=storage,
        memory_cache=memory_cache,
        ttl_config=_ttl_config(minutes=1/60)  # ~1 second TTL
    )
    
    # First call: populates cache
    result1 = backend.fetch_tasks(area_path='test-area')
    assert result1[0]['title'] == 'Initial task'
    assert len(inner.fetch_tasks.call_args_list) == 1
    
    # Manually mark the cache entry as stale by setting an old timestamp
    cache_keys = list(cache_manager.list_all_index_keys())
    assert len(cache_keys) > 0
    key = cache_keys[0]
    
    # Backdoor: set timestamp to past to simulate expiry
    index = cache_manager._read_index()
    old_timestamp = datetime.now(timezone.utc) - timedelta(minutes=10)
    index[key]['last_update'] = old_timestamp.isoformat()
    cache_manager._write_index(index)
    
    # Update backend to return different data
    inner.fetch_tasks.return_value = [{'id': 1, 'title': 'Refreshed task'}]
    
    # Second call: memory has data but CacheManager says it's stale
    result2 = backend.fetch_tasks(area_path='test-area')
    
    # Should have refetched from backend
    assert len(inner.fetch_tasks.call_args_list) == 2
    assert result2[0]['title'] == 'Refreshed task'


def test_cache_warmup_skips_stale_entries():
    """CacheWarmupService should skip stale entries during warmup."""
    from planner_lib.storage.warmup import CacheWarmupService
    
    # Setup
    storage = MemoryStorage()
    memory_cache = MemoryCacheManager(size_limit_mb=10)
    cache_manager = CacheManager(storage, namespace='backend_domain')
    
    # Populate cache with fresh and stale entries
    cache_manager.write('fresh_key', [{'id': 1, 'title': 'Fresh'}])
    cache_manager.update_timestamp('fresh_key')
    
    cache_manager.write('stale_key', [{'id': 2, 'title': 'Stale'}])
    cache_manager.update_timestamp('stale_key')  # Initialize timestamp first
    
    # Manually set stale timestamp
    index = cache_manager._read_index()
    old_timestamp = datetime.now(timezone.utc) - timedelta(hours=10)
    index['stale_key']['last_update'] = old_timestamp.isoformat()
    cache_manager._write_index(index)
    
    # Warmup
    warmup = CacheWarmupService(memory_cache, cache_manager)
    stats = warmup.warmup(namespaces=['backend_domain'])
    
    # Should have loaded only the fresh entry
    assert stats.entries_loaded == 1
    assert stats.entries_skipped_stale == 1
    
    # Verify memory cache has fresh but not stale
    assert memory_cache.read('backend_domain', 'fresh_key') is not None
    assert memory_cache.read('backend_domain', 'stale_key') is None


def test_cache_manager_is_authority_for_ttl():
    """CacheManager.is_stale() is always consulted, even when memory has data."""
    storage = MemoryStorage()
    memory_cache = MemoryCacheManager(size_limit_mb=10)
    cache_manager = CacheManager(storage, namespace='backend_domain')
    
    inner = MagicMock()
    inner.fetch_tasks.return_value = [{'id': 1, 'title': 'Task'}]
    
    backend = CachingBackend(
        inner=inner,
        storage=storage,
        memory_cache=memory_cache,
        ttl_config=_ttl_config(minutes=2/60)  # ~2 second TTL
    )
    
    # Populate cache
    backend.fetch_tasks(area_path='test-area')
    
    # Verify CacheManager has the entry with timestamp
    keys = list(cache_manager.list_all_index_keys())
    assert len(keys) > 0
    
    key = keys[0]
    timestamp = cache_manager.get_timestamp(key)
    assert timestamp is not None
    
    # Verify not stale yet
    assert not cache_manager.is_stale(key, ttl=timedelta(seconds=2))
    
    # Wait for TTL to expire
    import time
    time.sleep(2.1)
    
    # Verify now stale
    assert cache_manager.is_stale(key, ttl=timedelta(seconds=2))
