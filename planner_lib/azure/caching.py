"""Caching utilities for Azure client operations.

This module provides:
- Module-level cache key helper functions (shared by client and API layers).
- CacheManager: TTL-based cache with storage backend integration.
- HistoryCacheManager: Typed wrapper for work item revision history cache.
"""
from __future__ import annotations
from typing import Optional, Any, List
from datetime import datetime, timezone, timedelta
import threading
import logging

from planner_lib.storage.base import StorageBackend

logger = logging.getLogger(__name__)

NAMESPACE = 'azure_workitems'
CACHE_TTL = timedelta(minutes=30)
HISTORY_CACHE_TTL = timedelta(hours=24)  # History cache TTL - 24 hours


def key_for_area(area_path: str) -> str:
    """Generate a cache key for an area path. Shared by client and API layers."""
    safe = area_path.replace('\\', '__').replace('/', '__').replace(' ', '_')
    safe = ''.join(c for c in safe if c.isalnum() or c in ('_', '-'))
    return safe


def key_for_teams(project: str) -> str:
    """Generate a cache key for project teams."""
    safe = project.replace(' ', '_').replace('/', '__').replace('\\', '__')
    return f"teams_{safe}"


def key_for_plans(project: str) -> str:
    """Generate a cache key for project plans."""
    safe = project.replace(' ', '_').replace('/', '__').replace('\\', '__')
    return f"plans_{safe}"


def key_for_area_plan(area_path: str) -> str:
    """Generate a cache key for area->plan mapping."""
    return f"area_plan_{key_for_area(area_path)}"


def key_for_plan_markers(project: str, plan_id: str) -> str:
    """Generate a cache key for plan markers."""
    safe_proj = project.replace(' ', '_').replace('/', '__').replace('\\', '__')
    safe_plan = str(plan_id).replace(' ', '_')
    return f"plan_markers_{safe_proj}_{safe_plan}"


def key_for_iterations(project: str, root_path: Optional[str] = None) -> str:
    """Generate a cache key for iterations."""
    safe_proj = project.replace(' ', '_').replace('/', '__').replace('\\', '__')
    if root_path:
        safe_root = root_path.replace('\\', '__').replace('/', '__').replace(' ', '_')
        safe_root = ''.join(c for c in safe_root if c.isalnum() or c in ('_', '-'))
        return f"iterations_{safe_proj}_{safe_root}"
    return f"iterations_{safe_proj}_all"


def key_for_revision_history(work_item_id: int) -> str:
    """Generate a cache key for work item revision history."""
    return f"history_{work_item_id}"


class CacheManager:
    """Manages TTL-based caching with storage backend.
    
    This class handles:
    - Reading/writing cache entries with timestamps
    - TTL-based staleness checking
    - Cache invalidation
    - Index management for tracking cache entries
    """
    
    def __init__(self, storage: StorageBackend, namespace: str = NAMESPACE):
        """Initialize cache manager with storage backend.
        
        Args:
            storage: Storage backend for persisting cache data
            namespace: Namespace for cache keys (default: 'azure_workitems')
        """
        self.storage = storage
        self.namespace = namespace
        self._lock = threading.Lock()
        self._fetch_count = 0

    @property
    def fetch_count(self) -> int:
        """Public accessor for the number of Azure API fetches performed."""
        return self._fetch_count

    @fetch_count.setter
    def fetch_count(self, value: int) -> None:
        self._fetch_count = value

    def list_area_keys(self):
        """Iterate index keys that represent cached area paths.

        Excludes the ``_invalidated`` sentinel, history entries, plan/team
        caches, and iteration caches — anything whose key starts with a
        well-known prefix that is not an area-path cache entry.
        """
        _SKIP_PREFIXES = ('history_', 'teams_', 'plans_', 'plan_markers_',
                          'area_plan_', 'iterations_')
        with self._lock:
            index = self._read_index()
        for key in index:
            if key == '_invalidated':
                continue
            if any(key.startswith(p) for p in _SKIP_PREFIXES):
                continue
            yield key

    def list_all_index_keys(self):
        """Iterate every key that is currently in the cache index."""
        with self._lock:
            index = self._read_index()
        return list(index.keys())

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
                logger.debug(f"is_stale({key}): No entry or no last_update - returning True")
                return True
            
            try:
                last_update_str = entry['last_update']
                last_update = datetime.fromisoformat(last_update_str)
                if last_update.tzinfo is None:
                    last_update = last_update.replace(tzinfo=timezone.utc)
                
                now = datetime.now(timezone.utc)
                age = now - last_update
                is_stale_result = age > ttl
                
                logger.debug(f"is_stale({key}): last_update={last_update}, now={now}, age={age}, ttl={ttl}, stale={is_stale_result}")
                return is_stale_result
            except Exception as e:
                logger.debug(f"is_stale({key}): Exception {e} - returning True")
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
    
    def store_revisions(self, key: str, revisions: dict[int, int]) -> None:
        """Store work item revisions for an area.
        
        Args:
            key: Cache key (area key)
            revisions: Mapping of work_item_id -> revision_number
        """
        with self._lock:
            index = self._read_index()
            index.setdefault(key, {})
            index[key]['revisions'] = revisions
            self._write_index(index)
    
    def get_revisions(self, key: str) -> dict[int, int]:
        """Get stored revisions for an area.
        
        Args:
            key: Cache key (area key)
            
        Returns:
            Mapping of work_item_id -> revision_number, or empty dict
        """
        with self._lock:
            index = self._read_index()
            entry = index.get(key, {})
            return entry.get('revisions', {})
    
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
        
        # After invalidating, clean up any orphaned keys
        # (Do this outside the lock to avoid nested lock issues)
        orphaned_count = self.cleanup_orphaned_keys()
        if orphaned_count > 0:
            logger.debug(f"Cleaned up {orphaned_count} orphaned keys after invalidate")
    
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
        Also cleans up orphaned index entries.
        
        Args:
            keep_count: Number of most recent entries to keep
            
        Returns:
            List of removed cache keys
        """
        self._fetch_count += 1
        if self._fetch_count % 100 != 0:
            return []
        
        # First, clean up orphaned keys
        orphaned_count = self.cleanup_orphaned_keys()
        if orphaned_count > 0:
            logger.debug(f"Cleaned up {orphaned_count} orphaned keys during prune")
        
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
    
    def cleanup_orphaned_keys(self) -> int:
        """Remove index entries for cache files that no longer exist.
        
        This scans the index and removes keys that reference non-existent
        cache files. Useful for cleaning up after area path changes or
        manual cache deletions.
        
        Returns:
            Number of orphaned keys removed
        """
        with self._lock:
            index = self._read_index()
            orphaned = []
            
            for key in list(index.keys()):
                if key == '_invalidated':
                    continue
                
                # Check if the cache file exists
                if not self.exists(key):
                    orphaned.append(key)
                    index.pop(key, None)
            
            if orphaned:
                self._write_index(index)
                logger.info(f"Cleaned up {len(orphaned)} orphaned index entries: {orphaned}")
            
            return len(orphaned)


class HistoryCacheManager:
    """Typed cache manager for work item revision history.

    Wraps a ``CacheManager`` with read/write methods that understand the
    ``{data, metadata: {revision, timestamp}}`` envelope format and handle
    TTL checking and staleness logging.

    All cache keys are derived from module-level :func:`key_for_revision_history`.
    """

    def __init__(self, cache: CacheManager, ttl: timedelta = HISTORY_CACHE_TTL) -> None:
        self._cache = cache
        self._default_ttl = ttl

    def write(
        self,
        work_item_id: int,
        history: List[dict],
        revision: int,
        timestamp: Optional[datetime] = None,
    ) -> None:
        """Persist revision history for *work_item_id* with envelope metadata."""
        key = key_for_revision_history(work_item_id)
        ts = timestamp or datetime.now(timezone.utc)
        entry = {
            "data": history,
            "metadata": {
                "revision": revision,
                "work_item_id": work_item_id,
                "timestamp": ts.isoformat(),
            },
        }
        self._cache.write(key, entry)
        self._cache.update_timestamp(key)

    def read(
        self,
        work_item_id: int,
        ttl: Optional[timedelta] = None,
    ) -> tuple[Optional[List[dict]], Optional[int], bool]:
        """Read cached history for *work_item_id*.

        Returns:
            ``(history, revision, is_fresh)`` where *is_fresh* is ``True``
            when the entry exists and is within TTL.  Returns
            ``(None, None, False)`` on cache miss or corrupted entry.
        """
        effective_ttl = ttl if ttl is not None else self._default_ttl
        key = key_for_revision_history(work_item_id)
        cached = self._cache.read(key)

        if cached is None:
            return None, None, False

        if not (isinstance(cached, dict) and "data" in cached and "metadata" in cached):
            logger.warning("Invalid history cache format for work item %s, will refetch", work_item_id)
            return None, None, False

        history: List[dict] = cached["data"]
        metadata: dict = cached["metadata"]
        revision: Optional[int] = metadata.get("revision")
        timestamp_str: Optional[str] = metadata.get("timestamp")

        is_fresh = False
        if timestamp_str:
            try:
                ts = datetime.fromisoformat(timestamp_str)
                age = datetime.now(timezone.utc) - ts
                is_fresh = age < effective_ttl
                logger.debug(
                    "History cache %s for %s (age=%s, ttl=%s)",
                    "fresh" if is_fresh else "stale",
                    work_item_id,
                    age,
                    effective_ttl,
                )
            except (ValueError, TypeError) as exc:
                logger.warning("Invalid timestamp in history cache for %s: %s", work_item_id, exc)

        return history, revision, is_fresh

