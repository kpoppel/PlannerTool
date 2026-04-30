"""Cache warmup service for loading disk cache into memory on server boot.

This module provides functionality to pre-load cached data from disk storage
into the hot memory cache during application startup, respecting TTL
constraints from CacheManager.
"""
from dataclasses import dataclass
from datetime import timedelta
from typing import Callable, List, Optional
import asyncio
import logging
import time

logger = logging.getLogger(__name__)


@dataclass
class WarmupStats:
    """Statistics from cache warmup operation."""
    entries_loaded: int
    entries_skipped_stale: int
    bytes_loaded: int
    duration_seconds: float
    errors: List[str]


class CacheWarmupService:
    """Loads disk cache into memory on server boot.
    
    This service preloads cached data from disk storage into the
    in-memory cache to provide instant reads on application startup.
    Only loads entries that are still fresh according to CacheManager TTL.
    """
    
    def __init__(self, memory_cache, cache_manager, ttl_for_key: Optional[Callable[[str], timedelta]] = None):
        """Initialize warmup service.
        
        Args:
            memory_cache: MemoryCacheManager instance
            cache_manager: CacheManager instance (TTL authority)
            ttl_for_key: Optional callable mapping a cache key to its TTL.
                         When omitted the CacheManager default TTL is used.
                         Pass ``backend.ttl_for_key`` to apply per-method TTLs.
        """
        self._memory_cache = memory_cache
        self._cache_manager = cache_manager
        self._ttl_for_key = ttl_for_key
        self._logger = logging.getLogger(__name__)
    
    def warmup(self, namespaces: Optional[List[str]] = None) -> WarmupStats:
        """Load cached data from disk to memory (synchronous).
        
        Only loads entries that are fresh according to CacheManager TTL.
        Stale entries are skipped to avoid serving outdated data.
        
        Args:
            namespaces: List of namespaces to load, or None for defaults.
                       Default is ['backend_domain'] which contains DomainTask lists
            
        Returns:
            WarmupStats with operation results
        """
        if namespaces is None:
            # CachingBackend stores DomainTask lists in the 'backend_domain' namespace.
            namespaces = ['backend_domain']
        
        start_time = time.time()
        entries_loaded = 0
        entries_skipped_stale = 0
        bytes_loaded = 0
        errors = []
        
        self._logger.info(f"Starting cache warmup for namespaces: {namespaces}")
        
        for namespace in namespaces:
            try:
                # Get all cache keys from CacheManager's index
                all_keys = list(self._cache_manager.list_all_index_keys())
                
                if not all_keys:
                    self._logger.debug(f"No keys found in cache index for namespace '{namespace}'")
                    continue
                
                self._logger.debug(f"Checking {len(all_keys)} entries from cache index")
                
                for key in all_keys:
                    try:
                        # Check TTL via CacheManager (authority on staleness)
                        # Use per-key TTL when available, else CacheManager default
                        ttl = self._ttl_for_key(key) if self._ttl_for_key else None
                        stale_kwargs = {'ttl': ttl} if ttl is not None else {}
                        if self._cache_manager.is_stale(key, **stale_kwargs):
                            self._logger.debug(f"Skipping stale entry during warmup: {key}")
                            entries_skipped_stale += 1
                            continue
                        
                        # Load from CacheManager (not direct disk access)
                        value = self._cache_manager.read(key)
                        
                        if value is None:
                            self._logger.debug(f"Key exists in index but has no data: {key}")
                            continue
                        
                        # Load into memory cache
                        self._memory_cache.write(namespace, key, value)
                        
                        # Track stats
                        entries_loaded += 1
                        bytes_loaded += self._memory_cache._estimate_size(value)
                        
                    except KeyError:
                        self._logger.warning(f"Key not found during warmup: {namespace}::{key}")
                        errors.append(f"KeyError: {namespace}::{key}")
                    except Exception as e:
                        self._logger.warning(f"Failed to warmup {namespace}::{key}: {e}")
                        errors.append(f"Error loading {namespace}::{key}: {str(e)}")
                
            except Exception as e:
                self._logger.error(f"Failed to process namespace '{namespace}': {e}")
                errors.append(f"Namespace error '{namespace}': {str(e)}")
        
        duration = time.time() - start_time
        stats = WarmupStats(
            entries_loaded=entries_loaded,
            entries_skipped_stale=entries_skipped_stale,
            bytes_loaded=bytes_loaded,
            duration_seconds=duration,
            errors=errors
        )
        
        self._logger.info(
            f"Cache warmup complete: {entries_loaded} entries loaded, "
            f"{entries_skipped_stale} skipped (stale), "
            f"{bytes_loaded // 1024}KB, {duration:.2f}s"
        )
        
        if errors:
            self._logger.warning(f"Warmup completed with {len(errors)} errors")
        
        return stats
    
    async def warmup_async(self, namespaces: Optional[List[str]] = None) -> WarmupStats:
        """Load cached data asynchronously (non-blocking).
        
        Args:
            namespaces: List of namespaces to load, or None for defaults
            
        Returns:
            WarmupStats with operation results
        """
        # Run synchronous warmup in executor to avoid blocking
        loop = asyncio.get_event_loop()
        stats = await loop.run_in_executor(None, self.warmup, namespaces)
        return stats
