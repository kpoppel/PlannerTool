"""CachingBackend: transparent TTL cache wrapper for any BackendPort.

CachingBackend wraps any BackendPort implementation and adds a two-tier
cache (hot memory + persistent disk) in front of all read operations.

Design
------
* All fetch_* methods are automatically cached via __getattr__ without any
  per-method boilerplate.  Adding a new read method to BackendPort requires
  no changes here — it is cached seamlessly on first call.
* Only write/mutation methods (write_task, invalidate_cache) are listed
  explicitly because they need special invalidation logic.
* Cache key is derived from (method_name, non-credential args) using a
  short SHA-256 digest so different call signatures never collide.
* Cache stores enriched domain objects (not raw ADO data), eliminating
  per-request transformation cost on cache hits.
* Credential handling: credentials are excluded from cache keys (they are
  auth context, not a cache dimension) and are only forwarded to the inner
  backend on a cache miss.
* Per-method TTL: CacheTTLConfig assigns different cache lifetimes to each
  domain model (tasks/history/teams/plans/markers/iterations). History is
  expensive to fetch and changes infrequently so it gets a long TTL;
  tasks change often and get a short one.
"""
from __future__ import annotations

import dataclasses
import hashlib
import json
import logging
from datetime import timedelta
from typing import Any, Callable, Dict, List, Optional

from planner_lib.backend.port import BackendCredential, BackendPort
from planner_lib.domain.tasks import WriteResult
from planner_lib.storage.caching import CacheManager, CACHE_TTL

logger = logging.getLogger(__name__)

# Separate namespace so the domain-format cache entries do not collide
# with any existing raw-format entries written by the old client stack.
_DOMAIN_NAMESPACE = 'backend_domain'


@dataclasses.dataclass
class CacheTTLConfig:
    """Per-method TTL configuration for CachingBackend.

    Each field corresponds to a BackendPort read method name.  The
    ``default`` field is used for any method that has no explicit entry
    (future methods added to BackendPort are covered automatically).

    Values are ``timedelta`` objects; use ``CacheTTLConfig.from_config()``
    to construct from a server-config dict whose values are in **minutes**.
    """
    default: timedelta = dataclasses.field(default_factory=lambda: CACHE_TTL)
    fetch_tasks: timedelta = dataclasses.field(default_factory=lambda: timedelta(minutes=30))
    fetch_history: timedelta = dataclasses.field(default_factory=lambda: timedelta(hours=24))
    fetch_teams: timedelta = dataclasses.field(default_factory=lambda: timedelta(hours=4))
    fetch_plans: timedelta = dataclasses.field(default_factory=lambda: timedelta(hours=4))
    fetch_markers: timedelta = dataclasses.field(default_factory=lambda: timedelta(hours=2))
    fetch_iterations: timedelta = dataclasses.field(default_factory=lambda: timedelta(hours=8))

    def ttl_for(self, method_name: str) -> timedelta:
        """Return TTL for *method_name*, falling back to ``default``."""
        return getattr(self, method_name, self.default)

    @classmethod
    def from_config(cls, cfg: dict) -> 'CacheTTLConfig':
        """Build from a server-config ``cache.ttls`` dict (values in minutes).

        Unknown keys are silently ignored.  Missing keys use the class defaults.
        Example config::

            cache:
              ttls:
                fetch_tasks: 30
                fetch_history: 1440
                fetch_teams: 240
                fetch_plans: 240
                fetch_markers: 120
                fetch_iterations: 480
        """
        defaults = cls()
        fields = {f.name for f in dataclasses.fields(cls)}

        def _td(key: str, fallback: timedelta) -> timedelta:
            if key in cfg:
                return timedelta(minutes=int(cfg[key]))
            return fallback

        return cls(**{
            f: _td(f, getattr(defaults, f))
            for f in fields
        })


class CachingBackend(BackendPort):
    """Generic transparent caching proxy for any BackendPort implementation.

    Any BackendPort method not explicitly overridden here is intercepted by
    __getattribute__ and routed through the two-tier (memory + disk) cache
    automatically.  Only mutation methods are defined explicitly.

    Adding new read methods to BackendPort requires no changes here.

    Parameters
    ----------
    inner:
        The wrapped BackendPort (e.g. AzureDevOpsBackend, MockFixtureBackend).
    storage:
        Disk StorageBackend used for persistent cache.
    memory_cache:
        Optional MemoryCacheManager for hot in-process reads.
    ttl_config:
        Per-method TTL configuration.  Defaults are used when omitted.
        Pass ``CacheTTLConfig.from_config(server_cfg['cache']['ttls'])``
        to apply admin-configured TTLs.
    """

    def __init__(
        self,
        inner: BackendPort,
        storage,
        memory_cache=None,
        ttl_config: Optional[CacheTTLConfig] = None,
    ) -> None:
        self._inner = inner
        self._cache = CacheManager(storage, namespace=_DOMAIN_NAMESPACE)
        self._memory_cache = memory_cache
        self._ttl_config = ttl_config or CacheTTLConfig()
        tier = 'memory+disk' if memory_cache is not None else 'disk-only'
        logger.info(
            "CachingBackend: initialised wrapping %s (cache=%s, ttls=%s)",
            type(inner).__name__,
            tier,
            {f.name: str(getattr(self._ttl_config, f.name))
             for f in dataclasses.fields(self._ttl_config)},
        )

    def get_cache_manager(self) -> CacheManager:
        """Get the underlying CacheManager for TTL-aware operations.
        
        This is used by CacheWarmupService to access TTL logic when
        loading data into memory during startup.
        
        Returns:
            The CacheManager instance managing TTL and disk persistence
        """
        return self._cache

    def ttl_for_key(self, key: str) -> timedelta:
        """Return the configured TTL for a cache key.

        The key format is ``{method_name}__{digest}``.  The method name is
        extracted and looked up in ``CacheTTLConfig``; unknown methods fall
        back to ``CacheTTLConfig.default``.
        """
        method = key.split('__')[0] if '__' in key else key
        return self._ttl_config.ttl_for(method)

    # ------------------------------------------------------------------
    # Generic cache key + call helpers
    # ------------------------------------------------------------------

    def _make_key(self, method: str, args: tuple, kwargs: dict) -> str:
        """Build a stable, collision-resistant cache key.

        Credentials are excluded — they are auth context, not a cache dimension.
        Prefixed with the method name for debuggability.
        """
        filtered = {k: v for k, v in kwargs.items() if k != 'credential'}
        payload = {'m': method, 'a': list(args), 'k': dict(sorted(filtered.items()))}
        digest = hashlib.sha256(
            json.dumps(payload, sort_keys=True, default=str).encode()
        ).hexdigest()[:20]
        return f"{method}__{digest}"

    def _cached_call(self, key: str, fetcher):
        """Serve from memory → disk → backend, writing through on a miss.
        
        TTL authority: CacheManager is checked even when memory has data.
        Memory cache is just a hot tier; staleness is determined by CacheManager.
        The TTL used depends on the method encoded in the cache key prefix.
        """
        ttl = self.ttl_for_key(key)

        # 1. Check if data exists in memory cache
        mem_data = self._mem_read(key)
        
        # 2. Verify freshness via CacheManager (TTL authority)
        #    This happens regardless of whether memory cache has data
        if not self._cache.is_stale(key, ttl=ttl):
            # Data is fresh according to CacheManager
            if mem_data is not None:
                logger.debug("Memory cache HIT (fresh) for key '%s'", key)
                return mem_data
            
            # Memory doesn't have it, but disk might
            disk_data = self._cache.read(key)
            if disk_data is not None:
                logger.debug("Disk cache HIT for key '%s'", key)
                self._mem_write(key, disk_data)
                return disk_data
        else:
            # Data is stale according to CacheManager
            if mem_data is not None:
                logger.debug("Memory cache HIT but STALE for key '%s', refetching", key)
                # Remove stale data from memory
                self._mem_invalidate(key)

        # 3. Cache miss or stale — delegate to inner backend
        logger.debug("Cache MISS for key '%s' — fetching from backend", key)
        result = fetcher()

        # 4. Write through both layers (CacheManager first for index update)
        self._cache.write(key, result)
        self._cache.update_timestamp(key)
        self._mem_write(key, result)

        return result

    # ------------------------------------------------------------------
    # Generic proxy: auto-caches any BackendPort read method not explicitly
    # overridden on this class.  Mutation methods (write_task, invalidate_cache)
    # are defined below and bypass this interception via the cls.__dict__ guard.
    # ------------------------------------------------------------------

    def __getattribute__(self, name: str):
        cls = type(self)
        # Intercept BackendPort methods that:
        #   (a) are not defined directly on CachingBackend (i.e. not in cls.__dict__), and
        #   (b) do not start with '_' (i.e. are not internal helpers), and
        #   (c) are actually BackendPort members (i.e. are read operations on the protocol).
        # New BackendPort methods satisfy all three conditions automatically.
        if (
            not name.startswith('_')
            and name not in cls.__dict__
            and hasattr(BackendPort, name)
        ):
            inner = object.__getattribute__(self, '_inner')
            inner_method = getattr(inner, name)
            if callable(inner_method):
                make_key = object.__getattribute__(self, '_make_key')
                cached_call = object.__getattribute__(self, '_cached_call')

                def _cached_wrapper(*args, **kwargs):
                    cache_kwargs = {k: v for k, v in kwargs.items() if k != 'credential'}
                    key = make_key(name, args, cache_kwargs)
                    return cached_call(key, lambda: inner_method(*args, **kwargs))

                return _cached_wrapper

        return super().__getattribute__(name)

    # ------------------------------------------------------------------
    # Internal memory-cache helpers
    # ------------------------------------------------------------------

    def _mem_read(self, key: str):
        """Read from memory cache (existence check only, no TTL)."""
        if self._memory_cache is None:
            return None
        return self._memory_cache.read(_DOMAIN_NAMESPACE, key)

    def _mem_write(self, key: str, data) -> None:
        if self._memory_cache is not None:
            self._memory_cache.write(_DOMAIN_NAMESPACE, key, data)

    def _mem_invalidate(self, key: str) -> None:
        """Invalidate memory cache entry (removes from memory)."""
        if self._memory_cache is not None:
            try:
                self._memory_cache.delete(_DOMAIN_NAMESPACE, key)
            except Exception:
                pass

    # ------------------------------------------------------------------
    # Explicit mutations — write-through with targeted cache patch
    # ------------------------------------------------------------------

    def write_task(
        self,
        task_id: int,
        updates: Dict[str, Any],
        credential: BackendCredential,
    ) -> WriteResult:
        """Write-through: delegate to inner backend, then patch the cache.

        Rather than invalidating the entire cache, we locate every cached
        fetch_tasks result that contains ``task_id``, apply the same field
        updates to that DomainTask in-place, and write the modified list back
        to both cache tiers.  This keeps the cache consistent immediately
        without requiring a round-trip to the backend for subsequent reads.

        Keys written by ``fetch_tasks`` start with ``fetch_tasks__`` in the
        cache index; all other keys (history, iterations, …) are unaffected.
        """
        # 1. Write-through to the backend first so any server-side rejection
        #    (validation, permission) happens before we mutate the cache.
        result = self._inner.write_task(task_id, updates, credential)

        if result.get('ok') or result.get('updated', 0) > 0:
            self._patch_cached_tasks(task_id, updates)

        return result

    # ------------------------------------------------------------------
    # DomainTask fields that can be patched from an update payload.
    # Mirrors the fields handled by AzureAdapter / AzureDevOpsBackend.
    # ------------------------------------------------------------------
    _PATCHABLE_FIELDS = ('start', 'end', 'state', 'iterationPath',
                         'relations', 'capacity', 'title', 'assignee',
                         'tags', 'areaPath', 'description')

    def _patch_cached_tasks(self, task_id: int, updates: Dict[str, Any]) -> None:
        """Find and patch all cached task lists that contain *task_id*.

        Iterates every fetch_tasks cache entry, applies *updates* to the
        matching DomainTask, and writes the modified list back to both tiers.
        Entries that do not contain the task are left untouched.
        """
        str_id = str(task_id)
        patched_keys: List[str] = []

        try:
            all_keys = list(self._cache.list_all_index_keys())
        except Exception as exc:
            logger.warning("CachingBackend: could not list cache keys for patch: %s", exc)
            return

        for key in all_keys:
            if not key.startswith('fetch_tasks__'):
                continue
            task_list = self._cache.read(key)
            if not isinstance(task_list, list):
                continue

            changed = False
            for task in task_list:
                if str(task.get('id', '')) != str_id:
                    continue
                for field in self._PATCHABLE_FIELDS:
                    if field in updates:
                        task[field] = updates[field]
                changed = True
                break  # task IDs are unique within an area list

            if changed:
                self._cache.write(key, task_list)
                self._mem_write(key, task_list)
                patched_keys.append(key)
                logger.debug(
                    "CachingBackend: patched task %s in cache key '%s'", task_id, key
                )

        if not patched_keys:
            logger.debug(
                "CachingBackend: task %s not found in any cached task list — no patch applied",
                task_id,
            )

    def _invalidate_all(self) -> None:
        """Mark every cached entry as stale in both tiers (used by invalidate_cache)."""
        try:
            for key in list(self._cache.list_all_index_keys()):
                self._cache.invalidate([key])
                self._mem_invalidate(key)
            logger.debug("CachingBackend: invalidated all cache entries")
        except Exception as exc:
            logger.warning("CachingBackend: cache invalidation error: %s", exc)

    def invalidate_cache(self) -> Dict[str, Any]:
        """Invalidate all cache entries in both tiers (admin endpoint)."""
        invalidated: List[str] = []
        errors: List[str] = []
        try:
            keys = list(self._cache.list_all_index_keys())
            for key in keys:
                try:
                    self._cache.invalidate([key])
                    self._mem_invalidate(key)
                    invalidated.append(key)
                except Exception as exc:
                    errors.append(f"{key}: {exc}")
        except Exception as exc:
            errors.append(f"list_all_index_keys: {exc}")

        # Also delegate to inner (e.g. if inner has its own cache)
        try:
            inner_result = self._inner.invalidate_cache()
            invalidated.extend(inner_result.get('invalidated', []))
            errors.extend(inner_result.get('errors', []))
        except Exception as exc:
            errors.append(f"inner.invalidate_cache: {exc}")

        return {'ok': not errors, 'invalidated': invalidated, 'errors': errors}
