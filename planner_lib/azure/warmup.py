"""Cache warmup service for loading disk cache into memory on server boot.

This module provides functionality to pre-load cached data from disk storage
into the hot memory cache during application startup.
"""
from dataclasses import dataclass
from typing import List, Optional
import asyncio
import logging
import time

logger = logging.getLogger(__name__)


@dataclass
class WarmupStats:
    """Statistics from cache warmup operation."""
    entries_loaded: int
    bytes_loaded: int
    duration_seconds: float
    errors: List[str]


class CacheWarmupService:
    """Loads disk cache into memory on server boot.
    
    This service preloads cached Azure data from disk storage into the
    in-memory cache to provide instant reads on application startup.
    """
    
    def __init__(self, memory_cache, disk_cache):
        """Initialize warmup service.
        
        Args:
            memory_cache: MemoryCacheManager instance
            disk_cache: Disk storage backend
        """
        self._memory_cache = memory_cache
        self._disk_cache = disk_cache
        self._logger = logging.getLogger(__name__)
    
    def warmup(self, namespaces: Optional[List[str]] = None) -> WarmupStats:
        """Load cached data from disk to memory (synchronous).
        
        Args:
            namespaces: List of namespaces to load, or None for defaults.
                       Default is ['azure_workitems'] which contains all Azure cache data
                       (work items, teams, plans, markers, iterations are all keys within this namespace)
            
        Returns:
            WarmupStats with operation results
        """
        if namespaces is None:
            # All Azure cache data is stored in a single namespace with different key patterns
            namespaces = ['azure_workitems']
        
        start_time = time.time()
        entries_loaded = 0
        bytes_loaded = 0
        errors = []
        
        self._logger.info(f"Starting cache warmup for namespaces: {namespaces}")
        
        for namespace in namespaces:
            try:
                # List all keys in this namespace
                keys = list(self._disk_cache.list_keys(namespace))
                
                if not keys:
                    self._logger.debug(f"No keys found in namespace '{namespace}'")
                    continue
                
                self._logger.info(f"Loading {len(keys)} entries from namespace '{namespace}'")
                
                for key in keys:
                    try:
                        # Load from disk
                        value = self._disk_cache.load(namespace, key)
                        
                        # Load into memory cache (WITHOUT triggering disk write)
                        self._memory_cache.load_into_memory(namespace, key, value)
                        
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
            bytes_loaded=bytes_loaded,
            duration_seconds=duration,
            errors=errors
        )
        
        self._logger.info(
            f"Cache warmup complete: {entries_loaded} entries, "
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
