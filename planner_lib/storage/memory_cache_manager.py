"""Hot memory cache manager with metadata tracking.

This module provides a high-performance in-memory cache with LRU eviction and
thread-safe operations. It serves as the hot tier in a two-tier cache system,
with CacheManager handling TTL and disk persistence.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from threading import RLock
from typing import Dict, Any, Optional
import logging
import sys

logger = logging.getLogger(__name__)


@dataclass
class CacheMetadata:
    """Metadata for a cache entry."""
    version: str
    timestamp: datetime
    last_update: datetime
    size_bytes: int = 0


class MemoryCacheManager:
    """Pure in-memory cache with LRU eviction.
    
    This cache manager provides:
    - Thread-safe in-memory storage
    - Size-based LRU eviction
    - Version tracking
    - Memory usage tracking
    
    TTL/staleness is managed by CacheManager, not by this layer.
    """
    
    def __init__(self, size_limit_mb: int = 50):
        """Initialize memory cache manager.
        
        Args:
            size_limit_mb: Maximum memory usage in MB
        """
        self._lock = RLock()
        self._data: Dict[str, Dict[str, Any]] = {}
        self._metadata: Dict[str, CacheMetadata] = {}
        self._version_counter = 0
        self._size_limit_bytes = size_limit_mb * 1024 * 1024
        self._total_size = 0
        
        logger.info(f"MemoryCacheManager initialized: {size_limit_mb}MB limit")
    
    def _composite_key(self, namespace: str, key: str) -> str:
        """Generate composite key for internal storage."""
        return f"{namespace}::{key}"
    
    def _increment_version(self) -> str:
        """Increment and return new version string."""
        with self._lock:
            self._version_counter += 1
            return f"v{self._version_counter}"
    
    def _estimate_size(self, value: Any) -> int:
        """Estimate memory size of value in bytes."""
        try:
            return sys.getsizeof(value)
        except Exception:
            return 0
    
    def _evict_if_needed(self) -> None:
        """Evict oldest entries if cache exceeds size limit.
        
        This must be called while holding self._lock.
        Uses LRU eviction based on last_update timestamp.
        """
        if self._total_size <= self._size_limit_bytes:
            return
        
        # Sort entries by last_update (oldest first)
        entries_by_age = sorted(
            self._metadata.items(),
            key=lambda item: item[1].last_update
        )
        
        evicted_count = 0
        for comp_key, meta in entries_by_age:
            if self._total_size <= self._size_limit_bytes:
                break
            
            # Extract namespace and key from composite key
            namespace, key = comp_key.split('::', 1)
            
            # Remove from data
            if namespace in self._data and key in self._data[namespace]:
                self._data[namespace].pop(key)
                self._total_size -= meta.size_bytes
                evicted_count += 1
            
            # Remove metadata
            self._metadata.pop(comp_key)
        
        if evicted_count > 0:
            logger.info(
                f"Cache eviction: removed {evicted_count} entries, "
                f"size now {self._total_size // 1024}KB / "
                f"{self._size_limit_bytes // 1024}KB"
            )
    
    def read(self, namespace: str, key: str) -> Optional[Any]:
        """Read value from memory cache.
        
        Args:
            namespace: Cache namespace
            key: Cache key
            
        Returns:
            Cached value or None if not found
        """
        comp_key = self._composite_key(namespace, key)
        with self._lock:
            ns_data = self._data.get(namespace, {})
            return ns_data.get(key)
    
    def write(self, namespace: str, key: str, value: Any) -> None:
        """Write value to memory cache.
        
        Args:
            namespace: Cache namespace
            key: Cache key
            value: Value to cache
        """
        comp_key = self._composite_key(namespace, key)
        size = self._estimate_size(value)
        
        with self._lock:
            # Initialize namespace if needed
            if namespace not in self._data:
                self._data[namespace] = {}
            
            # Update data
            old_value = self._data[namespace].get(key)
            old_size = self._estimate_size(old_value) if old_value else 0
            self._data[namespace][key] = value
            
            # Update metadata
            now = datetime.now(timezone.utc)
            version = self._increment_version()
            self._metadata[comp_key] = CacheMetadata(
                version=version,
                timestamp=now,
                last_update=now,
                size_bytes=size
            )
            
            # Update total size
            self._total_size = self._total_size - old_size + size
            
            # Evict old entries if over size limit
            self._evict_if_needed()
        
        logger.debug(f"Memory write: {comp_key} ({size} bytes, {version})")

    
    def delete(self, namespace: str, key: str) -> None:
        """Delete value from memory cache.
        
        Args:
            namespace: Cache namespace
            key: Cache key
        """
        comp_key = self._composite_key(namespace, key)
        
        with self._lock:
            if namespace in self._data and key in self._data[namespace]:
                value = self._data[namespace].pop(key)
                size = self._estimate_size(value)
                self._total_size -= size
            
            if comp_key in self._metadata:
                self._metadata.pop(comp_key)
        
        logger.debug(f"Memory delete: {comp_key}")
    
    def exists(self, namespace: str, key: str) -> bool:
        """Check if key exists in memory cache.
        
        Args:
            namespace: Cache namespace
            key: Cache key
            
        Returns:
            True if key exists
        """
        with self._lock:
            return namespace in self._data and key in self._data[namespace]
    
    def get_metadata(self, namespace: str, key: str) -> Optional[CacheMetadata]:
        """Get metadata for cache entry.
        
        Args:
            namespace: Cache namespace
            key: Cache key
            
        Returns:
            CacheMetadata or None if not found
        """
        comp_key = self._composite_key(namespace, key)
        with self._lock:
            return self._metadata.get(comp_key)
    
    def get_version(self, namespace: str, key: str) -> str:
        """Get version string for cache entry.
        
        Args:
            namespace: Cache namespace
            key: Cache key
            
        Returns:
            Version string or 'v0' if not found
        """
        meta = self.get_metadata(namespace, key)
        return meta.version if meta else 'v0'
    
    def get_all(self, namespace: str) -> Dict[str, Any]:
        """Get all entries in a namespace.
        
        Args:
            namespace: Cache namespace
            
        Returns:
            Dictionary of key: value pairs
        """
        with self._lock:
            return dict(self._data.get(namespace, {}))
    
    def get_total_size(self) -> int:
        """Get total memory size in bytes.
        
        Returns:
            Total size in bytes
        """
        with self._lock:
            return self._total_size
    
    def clear(self, namespace: str) -> int:
        """Remove all entries for a given namespace from the in-memory store.

        Does NOT touch the disk cache — callers that also want the disk cache
        cleared must call the appropriate disk-cache invalidation method
        separately (e.g. ``CacheManager.clear_all_caches()``).

        Args:
            namespace: The cache namespace to clear (e.g. 'azure_workitems').

        Returns:
            Number of entries removed.
        """
        with self._lock:
            ns_data = self._data.pop(namespace, {})
            count = len(ns_data)

            # Recalculate freed size and remove associated metadata
            for key in ns_data:
                comp_key = self._composite_key(namespace, key)
                meta = self._metadata.pop(comp_key, None)
                if meta:
                    self._total_size -= meta.size_bytes

            if self._total_size < 0:
                # Guard against rounding errors from size estimates
                self._total_size = 0

        if count:
            logger.info(f"Memory cache clear: removed {count} entries from namespace '{namespace}'")
        return count

    def close(self) -> None:
        """Shutdown cache manager."""
        logger.info("MemoryCacheManager shutdown complete")
