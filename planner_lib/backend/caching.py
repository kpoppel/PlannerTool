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
    non-credential keyword-args). Task cache entries are intentionally shared
    across users so everyone can reuse the same baseline snapshot.
* Stale-on-failure for task reads (single copy, no shadow snapshot): the
    ``fetch_tasks`` entry is persisted *without* a hard diskcache TTL so it is
    never silently deleted.  Freshness is tracked separately by a tiny
    ``taskmeta__*`` sidecar holding only a ``fresh_until`` timestamp.  On read,
    a fresh entry is served directly; once soft-expired a live refresh is
    attempted.  For the **remote (ADO) backend only**, if that refresh raises
    (e.g., expired PAT or an ADO outage) or returns no data while content
    already exists, the existing entry is kept and served and a warning is
    queued — the cache is never purged on an error/empty response.  Local,
    static, and mock backends never hit transient outages, so they pass the
    refresh result through unchanged.
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
import threading
import time
from datetime import timedelta
from typing import Any, Dict, List, Optional

from planner_lib.backend.port import BackendCredential
from planner_lib.backend.errors import BackendAuthError, BackendError
from planner_lib.domain.tasks import WriteResult
from planner_lib.storage.base import StorageBackend

logger = logging.getLogger(__name__)

_NAMESPACE = 'backend_domain'

# Sentinel marking "no freshness sidecar present" (distinct from a stored
# ``fresh_until`` of ``None``, which means the entry never soft-expires).
_MISSING = object()


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
        # Only the live ADO backend is subject to transient API outages or PAT
        # expiry; local/static/mock backends never are.  Stale-on-failure
        # resilience (serve cached tasks instead of erroring/emptying) is
        # therefore scoped to remote backends only.
        self._inner_is_remote = bool(getattr(inner, 'is_remote', False))
        self._warnings_lock = threading.Lock()
        self._warnings: List[Dict[str, Any]] = []
        logger.info(
            "CachingBackend: initialised wrapping %s",
            type(inner).__name__,
        )

    # ------------------------------------------------------------------
    # Cache key helper
    # ------------------------------------------------------------------

    def _make_key(self, method: str, args: tuple, kwargs: dict) -> str:
        filtered = {k: v for k, v in kwargs.items() if k != 'credential'}
        payload = {
            'm': method,
            'a': list(args),
            'k': dict(sorted(filtered.items())),
        }
        digest = hashlib.sha256(
            json.dumps(payload, sort_keys=True, default=str).encode()
        ).hexdigest()[:20]
        return f"{method}__{digest}"

    def _meta_key(self, method: str, args: tuple, kwargs: dict) -> str:
        """Sidecar key holding only the freshness timestamp for a cached entry.

        Uses a distinct ``taskmeta__`` prefix so it never collides with the
        ``fetch_tasks__*`` data keys scanned elsewhere (cache load/metrics).
        """
        filtered = {k: v for k, v in kwargs.items() if k != 'credential'}
        payload = {'m': method, 'a': list(args), 'k': dict(sorted(filtered.items()))}
        digest = hashlib.sha256(
            json.dumps(payload, sort_keys=True, default=str).encode()
        ).hexdigest()[:20]
        return f"taskmeta__{digest}"

    def _read_fresh_until(self, meta_key: str) -> Any:
        """Return the stored ``fresh_until`` value, or ``_MISSING`` when absent.

        A stored value of ``None`` means "no expiry" (always fresh); ``_MISSING``
        (no sidecar at all, e.g. after a restart) is treated as soft-expired so a
        refresh is attempted.
        """
        try:
            meta = self._storage.load(_NAMESPACE, meta_key)
        except KeyError:
            return _MISSING
        if isinstance(meta, dict) and 'fresh_until' in meta:
            return meta['fresh_until']
        return _MISSING

    def _record_warning(self, *, code: str, message: str, user_id: Optional[str]) -> None:
        with self._warnings_lock:
            self._warnings.append({
                'code': code,
                'message': message,
                'user_id': user_id,
                'ts': time.time(),
            })

    def consume_warnings(self, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Return and clear queued warnings, optionally filtered by user_id."""
        with self._warnings_lock:
            if user_id is None:
                out = list(self._warnings)
                self._warnings.clear()
                return out
            matched = [w for w in self._warnings if w.get('user_id') == user_id]
            self._warnings = [w for w in self._warnings if w.get('user_id') != user_id]
            return matched

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
                    key = make_key(name, args, kwargs)
                    if name == 'fetch_tasks':
                        # Single-copy soft-freshness path: persist without a hard
                        # TTL and keep serving existing content on a failed or
                        # empty refresh (see _fetch_tasks_cached).
                        return self._fetch_tasks_cached(inner_method, name, key, args, kwargs)
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
    # Task read path: single cached copy with soft-freshness + stale-on-failure
    # ------------------------------------------------------------------

    def _fetch_tasks_cached(self, inner_method, name: str, key: str, args: tuple, kwargs: dict):
        """Cache-first task read that never purges content on error/empty refresh.

        The data entry (``fetch_tasks__*``) is stored without a hard diskcache
        TTL so it persists; a small ``taskmeta__*`` sidecar records the
        ``fresh_until`` timestamp.  When soft-expired we attempt a live refresh:
        on success we replace the data and extend freshness.  For the **remote
        (ADO) backend only**, an auth error, any other exception, or an empty
        response while content already exists keeps and serves the existing
        content and queues a user-facing warning.  Local/static/mock backends
        never hit transient outages, so their refresh result is used as-is.
        """
        storage = self._storage
        meta_key = self._meta_key(name, args, kwargs)
        now = time.time()

        try:
            cached_value = storage.load(_NAMESPACE, key)
            have_cached = True
        except KeyError:
            cached_value = None
            have_cached = False

        if have_cached:
            fresh_until = self._read_fresh_until(meta_key)
            if fresh_until is not _MISSING and (fresh_until is None or now < fresh_until):
                logger.debug('CachingBackend: cache HIT %s (fresh)', key)
                return cached_value

        credential = kwargs.get('credential') if isinstance(kwargs, dict) else None
        user_id = (credential or {}).get('user_id') if isinstance(credential, dict) else None

        try:
            result = inner_method(*args, **kwargs)
        except BackendError as exc:
            # Resilience is ADO-only: a remote outage / PAT expiry should not
            # drop already-cached content.  Only the live ADO backend raises
            # BackendError, so this branch never fires for local backends.
            if self._inner_is_remote and have_cached:
                if isinstance(exc, BackendAuthError):
                    self._record_warning(
                        code='tasks_stale_invalid_pat',
                        message=(
                            'Your Azure DevOps PAT is invalid or expired. '
                            'Showing cached task data that may be out of date.'
                        ),
                        user_id=user_id,
                    )
                else:
                    self._record_warning(
                        code='tasks_stale_api_outage',
                        message=(
                            'Azure DevOps is currently unreachable. '
                            'Showing cached task data that may be out of date.'
                        ),
                        user_id=user_id,
                    )
                logger.warning(
                    'CachingBackend: refresh of %s failed (%s); keeping existing cached content',
                    key, exc,
                )
                return cached_value
            raise

        if self._inner_is_remote and not result and have_cached:
            # Backend returned no data but we already have content.  A live ADO
            # outage often surfaces as an empty result, so keep the existing
            # content rather than overwriting a populated cache with nothing.
            self._record_warning(
                code='tasks_stale_no_data',
                message=(
                    'Azure DevOps returned no task data (possible outage). '
                    'Showing previously cached data that may be out of date.'
                ),
                user_id=user_id,
            )
            logger.warning(
                'CachingBackend: refresh of %s returned no data; keeping existing cached content',
                key,
            )
            return cached_value

        ttl = self._ttl_config.ttl_for(name)
        ttl_seconds = ttl.total_seconds() if ttl is not None else None
        # Persist the data without a hard TTL; freshness is governed by the
        # sidecar so a soft-expired entry can still be served on a failed refresh.
        storage.save(_NAMESPACE, key, result, ttl_seconds=None)
        fresh_until = (now + ttl_seconds) if ttl_seconds is not None else None
        storage.save(_NAMESPACE, meta_key, {'fresh_until': fresh_until}, ttl_seconds=None)
        logger.debug(
            'CachingBackend: cache MISS %s — fetched and stored (fresh_for=%s)',
            key, f'{ttl_seconds:.0f}s' if ttl_seconds is not None else 'none',
        )
        return result

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
