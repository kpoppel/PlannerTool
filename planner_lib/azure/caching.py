"""Caching utilities for Azure client operations.

This module provides a cache manager that handles TTL-based caching with
storage backend integration. It's designed to work with the Azure client
operations to reduce redundant API calls.
"""
from __future__ import annotations
from typing import Optional, Any, Callable
from datetime import datetime, timezone, timedelta
import threading
import logging

from planner_lib.storage.interfaces import StorageProtocol

logger = logging.getLogger(__name__)

NAMESPACE = 'azure_workitems'
CACHE_TTL = timedelta(minutes=30)


class CacheManager:
    """Manages TTL-based caching with storage backend.
    
    This class handles:
    - Reading/writing cache entries with timestamps
    - TTL-based staleness checking
    - Cache invalidation
    - Index management for tracking cache entries
    """
    
    def __init__(self, storage: StorageProtocol, namespace: str = NAMESPACE):
        """Initialize cache manager with storage backend.
        
        Args:
            storage: Storage backend for persisting cache data
            namespace: Namespace for cache keys (default: 'azure_workitems')
        """
        self.storage = storage
        self.namespace = namespace
        self._lock = threading.Lock()
        self._fetch_count = 0
    
    def _read_index(self) -> dict:
        """Read the cache index from storage."""
        try:
            return self.storage.load(self.namespace, '_index') or {}
        except (KeyError, Exception):
            return {}
    
    def _write_index(self, idx: dict) -> None:
        """Write the cache index to storage."""
        try:
            self.storage.save(self.namespace, '_index', idx)
        except Exception:
            logger.exception("Failed to write cache index")
    
    def read(self, key: str) -> Optional[Any]:
        """Read a cache entry by key.
        
        Args:
            key: Cache key to read
            
        Returns:
            Cached value or None if not found
        """
        try:
            return self.storage.load(self.namespace, key)
        except (KeyError, Exception):
            return None
    
    def write(self, key: str, value: Any) -> None:
        """Write a cache entry.
        
        Args:
            key: Cache key
            value: Value to cache
        """
        try:
            self.storage.save(self.namespace, key, value)
        except Exception:
            logger.exception(f"Failed to write cache entry for key {key}")
    
    def exists(self, key: str) -> bool:
        """Check if a cache key exists.
        
        Args:
            key: Cache key to check
            
        Returns:
            True if the key exists in storage
        """
        try:
            return self.storage.exists(self.namespace, key)
        except Exception:
            return False
    
    def delete(self, key: str) -> None:
        """Delete a cache entry.
        
        Args:
            key: Cache key to delete
        """
        try:
            if self.exists(key):
                self.storage.delete(self.namespace, key)
        except Exception:
            logger.exception(f"Failed to delete cache entry for key {key}")
    
    def is_stale(self, key: str, ttl: timedelta = CACHE_TTL) -> bool:
        """Check if a cache entry is stale based on TTL.
        
        Args:
            key: Cache key to check
            ttl: Time-to-live duration (default: CACHE_TTL)
            
        Returns:
            True if the entry is stale or doesn't exist
        """
        with self._lock:
            index = self._read_index()
            entry = index.get(key)
            
            if not entry or 'last_update' not in entry:
                return True
            
            try:
                last_update_str = entry['last_update']
                last_update = datetime.fromisoformat(last_update_str)
                if last_update.tzinfo is None:
                    last_update = last_update.replace(tzinfo=timezone.utc)
                
                now = datetime.now(timezone.utc)
                return (now - last_update) > ttl
            except Exception:
                return True
    
    def update_timestamp(self, key: str) -> None:
        """Update the last_update timestamp for a cache entry.
        
        Args:
            key: Cache key to update
        """
        with self._lock:
            index = self._read_index()
            index.setdefault(key, {})
            index[key]['last_update'] = datetime.now(timezone.utc).isoformat()
            self._write_index(index)
    
    def get_timestamp(self, key: str) -> Optional[datetime]:
        """Get the last update timestamp for a cache entry.
        
        Args:
            key: Cache key
            
        Returns:
            Last update timestamp or None if not found
        """
        with self._lock:
            index = self._read_index()
            entry = index.get(key)
            
            if not entry or 'last_update' not in entry:
                return None
            
            try:
                last_update_str = entry['last_update']
                last_update = datetime.fromisoformat(last_update_str)
                if last_update.tzinfo is None:
                    last_update = last_update.replace(tzinfo=timezone.utc)
                return last_update
            except Exception:
                return None
    
    def invalidate(self, keys: list[str]) -> None:
        """Invalidate cache entries by removing them.
        
        Args:
            keys: List of cache keys to invalidate
        """
        with self._lock:
            index = self._read_index()
            changed = False
            
            for key in keys:
                if key in index:
                    del index[key]
                    changed = True
                self.delete(key)
            
            if changed:
                self._write_index(index)
    
    def mark_invalidated(self, area_key: str, work_item_ids: list[int]) -> None:
        """Mark work items as invalidated for a specific area.
        
        This maintains a per-area mapping of invalidated work item IDs
        that need to be refetched on the next request.
        
        Args:
            area_key: Area key for grouping invalidations
            work_item_ids: List of work item IDs to mark as invalidated
        """
        if not work_item_ids:
            return
        
        with self._lock:
            index = self._read_index()
            invalidated = index.get('_invalidated', {})
            
            if not isinstance(invalidated, dict):
                invalidated = {}
            
            invalidated.setdefault(area_key, [])
            existing = set(invalidated[area_key])
            existing.update(work_item_ids)
            invalidated[area_key] = list(existing)
            
            index['_invalidated'] = invalidated
            self._write_index(index)
            
            logger.debug(f"Marked {len(work_item_ids)} work items as invalidated for area '{area_key}'")
    
    def get_invalidated(self, area_key: Optional[str] = None) -> set[int]:
        """Get invalidated work item IDs.
        
        Args:
            area_key: Optional area key to filter by. If None, returns all invalidated IDs.
            
        Returns:
            Set of invalidated work item IDs
        """
        with self._lock:
            index = self._read_index()
            raw_invalid = index.get('_invalidated', {})
            
            result = set()
            
            if isinstance(raw_invalid, dict):
                if area_key:
                    # Get invalidated IDs for specific area
                    area_list = raw_invalid.get(area_key, [])
                    try:
                        result = set(int(i) for i in area_list if i is not None)
                    except Exception:
                        pass
                else:
                    # Get all invalidated IDs
                    for v in raw_invalid.values():
                        if isinstance(v, list):
                            try:
                                result.update(int(i) for i in v if i is not None)
                            except Exception:
                                pass
            elif isinstance(raw_invalid, list):
                # Legacy format: global list
                try:
                    result = set(int(i) for i in raw_invalid if i is not None)
                except Exception:
                    pass
            
            return result
    
    def clear_invalidated(self, area_key: str, work_item_ids: set[int]) -> None:
        """Clear invalidated work item IDs after successful fetch.
        
        Args:
            area_key: Area key
            work_item_ids: Set of work item IDs that were successfully fetched
        """
        if not work_item_ids:
            return
        
        with self._lock:
            index = self._read_index()
            raw_invalid = index.get('_invalidated', {})
            
            if isinstance(raw_invalid, dict):
                area_list = set(raw_invalid.get(area_key, []))
                area_list -= work_item_ids
                raw_invalid[area_key] = list(area_list)
                index['_invalidated'] = raw_invalid
            else:
                # Legacy format
                current = set(raw_invalid or [])
                current -= work_item_ids
                index['_invalidated'] = list(current)
            
            self._write_index(index)
            
            if work_item_ids:
                logger.debug(f"Cleared {len(work_item_ids)} invalidated items for area '{area_key}'")
    
    def prune_old_entries(self, keep_count: int = 50) -> list[str]:
        """Prune old cache entries, keeping only the most recent ones.
        
        This is called periodically to prevent unbounded cache growth.
        
        Args:
            keep_count: Number of most recent entries to keep
            
        Returns:
            List of removed cache keys
        """
        self._fetch_count += 1
        if self._fetch_count % 100 != 0:
            return []
        
        with self._lock:
            index = self._read_index()
            
            # Get entries sorted by last_update timestamp
            entries = [(k, v.get('last_update', '')) for k, v in index.items() 
                      if k != '_invalidated']
            entries.sort(key=lambda kv: kv[1])
            
            # Keep the most recent entries
            keep = set(k for k, _ in entries[-keep_count:])
            
            removed = []
            for k in list(index.keys()):
                if k == '_invalidated':
                    continue
                if k not in keep:
                    self.delete(k)
                    removed.append(k)
                    index.pop(k, None)
            
            if removed:
                self._write_index(index)
                logger.debug(f"Pruned {len(removed)} old cache entries")
            
            return removed
    
    def clear_all_caches(self) -> int:
        """Clear all cache entries and reset the index.
        
        This removes all cached data and resets the cache manager to a 
        clean state. Useful for forcing a complete refresh of all data.
        
        Returns:
            Number of cache entries cleared
        """
        with self._lock:
            index = self._read_index()
            
            # Collect all cache keys (excluding _invalidated)
            keys_to_clear = [k for k in index.keys() if k != '_invalidated']
            
            # Delete all cache entries
            for key in keys_to_clear:
                self.delete(key)
            
            # Reset index
            self._write_index({})
            
            logger.info(f"Cleared all caches: {len(keys_to_clear)} entries removed")
            return len(keys_to_clear)
