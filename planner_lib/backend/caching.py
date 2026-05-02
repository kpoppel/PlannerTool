"""CachingBackend: transparent diskcache TTL proxy for any backend.

Any ``fetch_*`` method present on the inner backend is intercepted by
``__getattribute__`` and routed through the injected StorageBackend
(backed by diskcache) with a per-method TTL.  The same protocol appears
on both sides — callers never need to know whether a cache is present.

Design
------
* ``CachingBackend`` does NOT import CacheManager, MemoryCacheManager, or any
  warmup service.  diskcache natively provides:
    - per-key TTL via the ``expire`` argument to ``Cache.set``
    - in-memory OS page cache via SQLite WAL + mmap (``sqlite_mmap_size``)
    - thread- and process-safe concurrency
* Cache key: ``<method_name>__<SHA-256[:20]>`` of (method, positional-args,
  non-credential keyword-args).  Credentials are excluded from keys.
* ``write_task``: delegate to inner backend first (ADO / mock persistence),
  then patch every cached ``fetch_tasks__*`` list in-place so diskcache is
  immediately consistent.  The patch preserves the existing TTL.  TTL expiry
  and explicit ``/cache/refresh`` are the only paths that ever re-fetch from ADO.
* ``invalidate_cache``: delete every key in the namespace.
* Adding a new ``fetch_*`` method to any backend is cached automatically —
  no changes here required.
"""
from __future__ import annotations

import dataclasses
import hashlib
import json
import logging
import time
from datetime import timedelta
from typing import Any, Dict, List, Optional

from planner_lib.backend.port import BackendCredential
from planner_lib.domain.tasks import WriteResult
from planner_lib.storage.base import StorageBackend

logger = logging.getLogger(__name__)

_NAMESPACE = 'backend_domain'


@dataclasses.dataclass
class CacheTTLConfig:
    """Per-method TTL configuration for CachingBackend.

    Values are ``timedelta`` objects or ``None``.  ``None`` means no time-based
    expiry — the entry lives until ``invalidate_cache()`` is called explicitly
    (appropriate for config data that only changes on admin writes).

    ``default`` covers any future method that has no explicit entry.  Use
    ``CacheTTLConfig.from_config()`` to construct from a server-config dict
    whose values are in **minutes** (``0`` or absent → ``None``).
    """
    default: Optional[timedelta] = dataclasses.field(default_factory=lambda: timedelta(minutes=30))
    # Remote ADO / static backend methods
    fetch_tasks: Optional[timedelta] = dataclasses.field(default_factory=lambda: timedelta(minutes=30))
    fetch_history: Optional[timedelta] = dataclasses.field(default_factory=lambda: timedelta(hours=24))
    fetch_teams: Optional[timedelta] = dataclasses.field(default_factory=lambda: timedelta(hours=4))
    fetch_plans: Optional[timedelta] = dataclasses.field(default_factory=lambda: timedelta(hours=4))
    fetch_markers: Optional[timedelta] = dataclasses.field(default_factory=lambda: timedelta(hours=2))
    fetch_iterations: Optional[timedelta] = dataclasses.field(default_factory=lambda: timedelta(hours=8))
    # Config backend methods — None = no time-based expiry, invalidate on admin write
    fetch_people: Optional[timedelta] = None
    fetch_projects: Optional[timedelta] = None
    fetch_project_map: Optional[timedelta] = None
    fetch_config_teams: Optional[timedelta] = None
    fetch_iterations_config: Optional[timedelta] = None
    fetch_area_plan_map: Optional[timedelta] = None

    def ttl_for(self, method_name: str) -> Optional[timedelta]:
        return getattr(self, method_name, self.default)

    @classmethod
    def from_config(cls, cfg: dict) -> 'CacheTTLConfig':
        """Build from a server-config ``cache.ttls`` dict (values in minutes).

        A value of ``0`` or a missing key means the field keeps its class default.
        """
        defaults = cls()
        fields = {f.name for f in dataclasses.fields(cls)}

        def _td(key: str, fallback: Optional[timedelta]) -> Optional[timedelta]:
            if key not in cfg:
                return fallback
            minutes = int(cfg[key])
            return timedelta(minutes=minutes) if minutes > 0 else None

        return cls(**{f: _td(f, getattr(defaults, f)) for f in fields})


class CachingBackend:
    """Transparent diskcache TTL proxy for any backend.

    Parameters
    ----------
    inner:
        The wrapped backend (AzureDevOpsBackend, ConfigBackend, …).
    storage:
        DiskCacheStorage used for persistence and TTL expiry.
    ttl_config:
        Per-method TTL configuration.  Defaults used when omitted.
    """

    def __init__(
        self,
        inner,
        storage: StorageBackend,
        ttl_config: Optional[CacheTTLConfig] = None,
    ) -> None:
        self._inner = inner
        self._storage = storage
        self._ttl_config = ttl_config or CacheTTLConfig()
        logger.info(
            "CachingBackend: initialised wrapping %s",
            type(inner).__name__,
        )

    # ------------------------------------------------------------------
    # Cache key helper
    # ------------------------------------------------------------------

    def _make_key(self, method: str, args: tuple, kwargs: dict) -> str:
        filtered = {k: v for k, v in kwargs.items() if k != 'credential'}
        payload = {'m': method, 'a': list(args), 'k': dict(sorted(filtered.items()))}
        digest = hashlib.sha256(
            json.dumps(payload, sort_keys=True, default=str).encode()
        ).hexdigest()[:20]
        return f"{method}__{digest}"

    # ------------------------------------------------------------------
    # Generic proxy: auto-caches any fetch_* not overridden on this class.
    # ------------------------------------------------------------------

    def __getattribute__(self, name: str):
        cls = type(self)
        if name.startswith('fetch_') and name not in cls.__dict__:
            inner = object.__getattribute__(self, '_inner')
            if not hasattr(inner, name):
                raise AttributeError(
                    f"{type(inner).__name__!r} does not implement '{name}'"
                )
            inner_method = getattr(inner, name)
            if callable(inner_method):
                storage = object.__getattribute__(self, '_storage')
                ttl_config = object.__getattribute__(self, '_ttl_config')
                make_key = object.__getattribute__(self, '_make_key')

                def _cached_wrapper(*args, **kwargs):
                    key = make_key(name, args, {k: v for k, v in kwargs.items() if k != 'credential'})
                    try:
                        value = storage.load(_NAMESPACE, key)
                        # Log time-to-expiry so operators can see staleness at a glance.
                        if logger.isEnabledFor(logging.DEBUG):
                            get_expire = getattr(storage, 'get_expire_time', None)
                            if get_expire is not None:
                                abs_exp = get_expire(_NAMESPACE, key)
                                if abs_exp is not None:
                                    remaining = max(0.0, abs_exp - time.time())
                                    logger.debug(
                                        'CachingBackend: cache HIT %s (expires in %.0fs)',
                                        key, remaining,
                                    )
                                else:
                                    logger.debug('CachingBackend: cache HIT %s (no expiry)', key)
                        return value
                    except KeyError:
                        pass
                    result = inner_method(*args, **kwargs)
                    ttl = ttl_config.ttl_for(name)
                    ttl_seconds = ttl.total_seconds() if ttl is not None else None
                    storage.save(_NAMESPACE, key, result, ttl_seconds=ttl_seconds)
                    logger.debug(
                        'CachingBackend: cache MISS %s — fetched and stored (ttl=%s)',
                        key, f'{ttl_seconds:.0f}s' if ttl_seconds is not None else 'none',
                    )
                    return result

                return _cached_wrapper

        return super().__getattribute__(name)

    # ------------------------------------------------------------------
    # Explicit mutations
    # ------------------------------------------------------------------

    def write_task(
        self,
        task_id: int,
        updates: Dict[str, Any],
        credential: BackendCredential,
    ) -> WriteResult:
        """Persist the update to the inner backend, then patch diskcache in-place.

        After a successful write the diskcache is immediately consistent: every
        cached fetch_tasks list that contains the task is updated with the new
        field values.  No cache eviction or re-fetch from ADO is needed —
        the TTL-driven re-fetch exists only to pick up changes made in ADO
        *outside* this application.
        """
        result = self._inner.write_task(task_id, updates, credential)
        if result.get('ok') or result.get('updated', 0) > 0:
            self._patch_task_in_cache(task_id, updates)
        return result

    def _patch_task_in_cache(self, task_id: int, updates: Dict[str, Any]) -> None:
        """Update every cached fetch_tasks list that contains *task_id* in-place.

        The remaining TTL of each entry is preserved: we read the absolute
        expiry timestamp before overwriting, then re-apply the remaining seconds.
        This keeps the TTL clock unchanged — the entry will still expire at the
        same wall-clock time it would have without the patch.
        """
        str_id = str(task_id)
        get_expire = getattr(self._storage, 'get_expire_time', None)
        try:
            for key in list(self._storage.list_keys(_NAMESPACE)):
                if not key.startswith('fetch_tasks__'):
                    continue
                try:
                    tasks = self._storage.load(_NAMESPACE, key)
                except KeyError:
                    continue
                if not isinstance(tasks, list):
                    continue
                patched = False
                new_tasks = []
                for task in tasks:
                    if isinstance(task, dict) and str(task.get('id')) == str_id:
                        new_tasks.append({**task, **updates})
                        patched = True
                    else:
                        new_tasks.append(task)
                if patched:
                    # Re-apply the remaining TTL so the expiry clock is unchanged.
                    remaining: Optional[float] = None
                    if get_expire is not None:
                        abs_expire = get_expire(_NAMESPACE, key)
                        if abs_expire is not None:
                            remaining = max(0.0, abs_expire - time.time())
                    self._storage.save(_NAMESPACE, key, new_tasks, ttl_seconds=remaining)
        except Exception as exc:
            logger.warning("CachingBackend: _patch_task_in_cache error: %s", exc)

    def invalidate_cache(self) -> Dict[str, Any]:
        """Delete every cache entry in the backend_domain namespace."""
        invalidated: List[str] = []
        errors: List[str] = []
        try:
            for key in list(self._storage.list_keys(_NAMESPACE)):
                try:
                    self._storage.delete(_NAMESPACE, key)
                    invalidated.append(key)
                except Exception as exc:
                    errors.append(f"{key}: {exc}")
        except Exception as exc:
            errors.append(f"list_keys: {exc}")
        try:
            self._inner.invalidate_cache()
        except Exception:
            pass
        logger.info("CachingBackend: invalidated %d entries", len(invalidated))
        return {'ok': not errors, 'invalidated': invalidated, 'errors': errors}
