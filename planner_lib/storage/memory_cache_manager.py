"""Hot memory cache manager with metadata tracking.

This module provides a high-performance in-memory cache with automatic disk
persistence, staleness tracking, and thread-safe operations.
"""
from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import RLock, Thread
from queue import Queue, Empty
from typing import Dict, Any, Optional, List, Tuple
import logging
import sys

logger = logging.getLogger(__name__)


@dataclass
class CacheMetadata:
    """Metadata for a cache entry."""
    version: str
    timestamp: datetime
    last_update: datetime
    needs_refresh: bool = False
    size_bytes: int = 0


class MemoryCacheManager:
    """Hot memory cache for Azure data with version tracking.
    
    This cache manager provides:
    - Thread-safe in-memory storage
    - Automatic disk persistence (async writes)
    - Staleness tracking per entry
    - Version management
    - Memory usage tracking
    """
    
    def __init__(self, disk_cache, size_limit_mb: int = 50, staleness_seconds: int = 1800):
        """Initialize memory cache manager.
        
        Args:
            disk_cache: Storage backend for persistence
            size_limit_mb: Maximum memory usage in MB
            staleness_seconds: Time threshold for automatic staleness marking (seconds)
        """
        self._lock = RLock()
        self._data: Dict[str, Dict[str, Any]] = {}
        self._metadata: Dict[str, CacheMetadata] = {}
        self._disk_cache = disk_cache
        self._version_counter = 0
        self._size_limit_bytes = size_limit_mb * 1024 * 1024
        self._staleness_seconds = staleness_seconds
        self._total_size = 0
        
        # Async disk writer
        self._write_queue: Queue = Queue(maxsize=1000)
        self._disk_writer_thread: Optional[Thread] = None
        self._running = False
        self._start_disk_writer()
        
        logger.info(
            f"MemoryCacheManager initialized: {size_limit_mb}MB limit, "
            f"{staleness_seconds}s staleness threshold"
        )
    
    def _start_disk_writer(self) -> None:
        """Start background disk writer thread."""
        self._running = True
        self._disk_writer_thread = Thread(target=self._disk_writer_loop, daemon=True)
        self._disk_writer_thread.start()
    
    def _disk_writer_loop(self) -> None:
        """Background loop for writing to disk cache."""
        while self._running:
            try:
                # Get write request from queue (timeout to check _running periodically)
                item = self._write_queue.get(timeout=1.0)
                namespace, key, value = item
                
                try:
                    self._disk_cache.save(namespace, key, value)
                    logger.debug(f"Disk write: {namespace}::{key}")
                except Exception as e:
                    logger.error(f"Failed to write {namespace}::{key} to disk: {e}")
                
            except Empty:
                continue
            except Exception as e:
                logger.error(f"Error in disk writer loop: {e}")
    
    def _queue_disk_write(self, namespace: str, key: str, value: Any) -> None:
        """Queue a write to disk cache (non-blocking)."""
        try:
            self._write_queue.put_nowait((namespace, key, value))
        except Exception as e:
            logger.warning(f"Failed to queue disk write for {namespace}::{key}: {e}")
    
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
        """Write value to memory cache and queue disk write.
        
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
                needs_refresh=False,
                size_bytes=size
            )
            
            # Update total size
            self._total_size = self._total_size - old_size + size
            
            # Evict old entries if over size limit
            self._evict_if_needed()
        
        # Queue async disk write
        self._queue_disk_write(namespace, key, value)
        
        logger.debug(f"Memory write: {comp_key} ({size} bytes, {version})")
    
    def load_into_memory(self, namespace: str, key: str, value: Any) -> None:
        """Load value into memory cache WITHOUT triggering disk write.
        
        This is used during warmup to avoid redundant disk writes for data
        that's already persisted on disk.
        
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
                needs_refresh=False,
                size_bytes=size
            )
            
            # Update total size
            self._total_size = self._total_size - old_size + size
            
            # Evict old entries if over size limit
            self._evict_if_needed()
        
        # NO disk write queued - data is already on disk
        logger.debug(f"Memory load: {comp_key} ({size} bytes, {version})")

    
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
        
        Automatically checks if the entry is stale based on time threshold.
        
        Args:
            namespace: Cache namespace
            key: Cache key
            
        Returns:
            CacheMetadata or None if not found
        """
        comp_key = self._composite_key(namespace, key)
        with self._lock:
            meta = self._metadata.get(comp_key)
            if meta:
                # Check if entry has exceeded staleness threshold
                age_seconds = (datetime.now(timezone.utc) - meta.last_update).total_seconds()
                if age_seconds > self._staleness_seconds:
                    meta.needs_refresh = True
            return meta
    
    def get_staleness_threshold(self) -> int:
        """Get the configured staleness threshold in seconds.
        
        Returns:
            Staleness threshold in seconds
        """
        return self._staleness_seconds
    
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
    
    def mark_stale(self, namespace: str, key: str) -> None:
        """Mark cache entry as needing refresh.
        
        Args:
            namespace: Cache namespace
            key: Cache key
        """
        comp_key = self._composite_key(namespace, key)
        with self._lock:
            if comp_key in self._metadata:
                self._metadata[comp_key].needs_refresh = True
    
    def mark_fresh(self, namespace: str, key: str) -> None:
        """Mark cache entry as fresh (recently updated).
        
        Args:
            namespace: Cache namespace
            key: Cache key
        """
        comp_key = self._composite_key(namespace, key)
        with self._lock:
            if comp_key in self._metadata:
                self._metadata[comp_key].needs_refresh = False
                self._metadata[comp_key].last_update = datetime.now(timezone.utc)
    
    def get_all(self, namespace: str) -> Dict[str, Any]:
        """Get all entries in a namespace.
        
        Args:
            namespace: Cache namespace
            
        Returns:
            Dictionary of key: value pairs
        """
        with self._lock:
            return dict(self._data.get(namespace, {}))
    
    def get_stale_keys(self, ttl_seconds: int = 300) -> List[Tuple[str, str]]:
        """Get all cache keys that need refresh.
        
        Args:
            ttl_seconds: Time-to-live in seconds (default 5 minutes)
            
        Returns:
            List of (namespace, key) tuples
        """
        stale = []
        now = datetime.now(timezone.utc)
        
        with self._lock:
            for comp_key, meta in self._metadata.items():
                if meta.needs_refresh:
                    namespace, key = comp_key.split('::', 1)
                    stale.append((namespace, key))
                else:
                    # Check age
                    age = (now - meta.last_update).total_seconds()
                    if age > ttl_seconds:
                        namespace, key = comp_key.split('::', 1)
                        stale.append((namespace, key))
        
        return stale
    
    def get_total_size(self) -> int:
        """Get total memory size in bytes.
        
        Returns:
            Total size in bytes
        """
        with self._lock:
            return self._total_size
    
    def flush_disk_writes(self) -> None:
        """Wait for all pending disk writes to complete."""
        self._write_queue.join()
    
    def close(self) -> None:
        """Shutdown cache manager."""
        logger.info("Shutting down MemoryCacheManager")
        self._running = False
        if self._disk_writer_thread:
            self._disk_writer_thread.join(timeout=5.0)
        logger.info("MemoryCacheManager shutdown complete")
