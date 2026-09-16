"""CachingBackend: transparent diskcache TTL proxy for any backend.

Any ``fetch_*`` method present on the inner backend is intercepted by
``__getattribute__`` and routed through the injected StorageBackend
(backed by diskcache) with a per-method soft-freshness window.  The same
protocol appears on both sides — callers never need to know whether a cache
is present.

Design
------
* ``CachingBackend`` does NOT import CacheManager, MemoryCacheManager, or any
  warmup service.  diskcache provides in-memory OS page caching (SQLite WAL +
  mmap) and thread-/process-safe concurrency; the freshness window itself is
  tracked by this class rather than diskcache's own ``expire`` argument (see
  "Stale-on-failure" below for why).
* Cache key: ``<method_name>__<SHA-256[:20]>`` of (method, positional-args,
    non-credential keyword-args). Cache entries are intentionally shared
    across users so everyone can reuse the same baseline snapshot.
* Stale-on-failure (single copy, no shadow snapshot): every cached ``fetch_*``
    entry is persisted *without* a hard diskcache TTL so it is never silently
    deleted — a hard ``expire=`` would let diskcache physically drop the row
    at the exact moment the remote backend happens to be unreachable, turning
    a transient outage into a hard failure instead of served stale data.
    Freshness is tracked separately by a tiny ``taskmeta__*`` sidecar (shared
    key-hash scheme, one per cached method+args) holding only a
    ``fresh_until`` timestamp.  On read, a fresh entry is served directly;
    once soft-expired a live refresh is attempted.  For the **remote (ADO)
    backend only**, if that refresh raises (e.g., expired PAT or an ADO
    outage) or returns no data while content already exists, the existing
    entry is kept and served and a warning is queued — the cache is never
    purged on an error/empty response.  Local, static, and mock backends never
    hit transient outages, so they pass the refresh result through unchanged.
* ``write_task``: delegate to inner backend first (ADO / mock persistence),
  then patch every cached ``fetch_tasks__*`` list in-place so diskcache is
  immediately consistent.  The patch preserves the existing freshness window.
  TTL expiry and explicit ``/cache/refresh`` are the only paths that ever
  re-fetch from ADO.
* ``invalidate_cache``: delete every key in the namespace.
* Adding a new ``fetch_*`` method to any backend is cached automatically —
  no changes here required.
* ``fetch_projects`` / ``fetch_project_map`` are overridden below to call
  straight through to the inner backend, bypassing the caching layer
  entirely: project config already lives in diskcache via ``ConfigBackend``,
  and ADO enrichment (state_categories) reads a separate, already-cached
  metadata service, so there is no remote (ADO) API call for this layer to
  save by also caching the result.
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
from planner_lib.backend.errors import BackendAuthError, BackendConfigError, BackendError
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
    fetch_config_teams: Optional[timedelta] = None
    fetch_iterations_config: Optional[timedelta] = None
    fetch_area_plan_map: Optional[timedelta] = None
    # NOTE: fetch_projects / fetch_project_map have no TTL entry — CachingBackend
    # overrides those methods directly and never routes them through diskcache.

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
        self._refresh_lock = threading.Lock()
        self._refresh_inflight: set[str] = set()
        logger.info(
            "CachingBackend: initialised wrapping %s",
            type(inner).__name__,
        )

    # ------------------------------------------------------------------
    # Cache key helper
    # ------------------------------------------------------------------

    def _digest(self, method: str, args: tuple, kwargs: dict) -> str:
        filtered = {k: v for k, v in kwargs.items() if k != 'credential'}
        payload = {
            'm': method,
            'a': list(args),
            'k': dict(sorted(filtered.items())),
        }
        return hashlib.sha256(
            json.dumps(payload, sort_keys=True, default=str).encode()
        ).hexdigest()[:20]

    def _make_key(self, method: str, args: tuple, kwargs: dict) -> str:
        return f"{method}__{self._digest(method, args, kwargs)}"

    def _meta_key(self, method: str, args: tuple, kwargs: dict) -> str:
        """Sidecar key holding only the freshness timestamp for a cached entry.

        Uses a distinct ``taskmeta__`` prefix (shared by every cached ``fetch_*``
        method, not just tasks) so it never collides with the ``<method>__*``
        data keys scanned elsewhere (cache load/metrics).
        """
        return f"taskmeta__{self._digest(method, args, kwargs)}"

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
                'severity': 'warning',
                'user_id': user_id,
                'ts': time.time(),
            })

    def consume_diagnostics(self, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Return and clear backend diagnostics, optionally filtered by user_id."""
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
    #
    # Every cached fetch_* method — not just fetch_tasks — goes through the
    # soft-freshness sidecar (_fetch_with_freshness): the data entry is never
    # given a hard diskcache expiry, so a TTL lapse can never physically
    # delete already-fetched content. A hard `expire=` would let diskcache
    # silently drop the row at the exact moment ADO happens to be unreachable,
    # turning a transient outage into a hard failure for the caller.
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
                make_key = object.__getattribute__(self, '_make_key')
                fetch_with_freshness = object.__getattribute__(self, '_fetch_with_freshness')

                def _cached_wrapper(*args, **kwargs):
                    key = make_key(name, args, kwargs)
                    return fetch_with_freshness(inner_method, name, key, args, kwargs)

                return _cached_wrapper

        return super().__getattribute__(name)

    # ------------------------------------------------------------------
    # Cached read path: single copy with soft-freshness + stale-on-failure
    # ------------------------------------------------------------------

    def _try_mark_refresh_inflight(self, key: str) -> bool:
        """Mark *key* as in-flight if no refresh is currently running."""
        with self._refresh_lock:
            if key in self._refresh_inflight:
                return False
            self._refresh_inflight.add(key)
            return True

    def _clear_refresh_inflight(self, key: str) -> None:
        with self._refresh_lock:
            self._refresh_inflight.discard(key)

    def _record_stale_warning(self, exc: BackendError, *, key: str, user_id: Optional[str]) -> None:
        """Queue a user-facing warning for a failed refresh, keeping stale data.

        Shared by the synchronous and background refresh paths so the
        auth-vs-outage classification lives in exactly one place.
        """
        if isinstance(exc, BackendAuthError):
            code, message = 'tasks_stale_invalid_pat', (
                'Azure DevOps denied the work-item refresh due to a stale PAT, so cached work items could not be '
                'refreshed. Latest cached results will be used instead.'
            )
        elif isinstance(exc, BackendConfigError):
            code, message = 'tasks_stale_invalid_query_config', (
                f'Azure DevOps rejected the configured work-item query for area path "{exc.failed_path}", '
                'so cached work items could not be refreshed. An administrator should verify the project, '
                'area-path, and iteration-path configuration.'
            )
        else:
            code, message = 'tasks_stale_api_outage', (
                'Azure DevOps is currently unreachable, so cached Azure DevOps work items could '
                'not be refreshed. Latest cached results will be used instead.'
            )
        self._record_warning(code=code, message=message, user_id=user_id)
        logger.warning(
            'CachingBackend: refresh of %s failed (%s); keeping existing cached content',
            key, exc,
        )

    def _record_stale_no_data_warning(self, *, key: str, user_id: Optional[str]) -> None:
        self._record_warning(
            code='tasks_stale_no_data',
            message=(
                'Azure DevOps returned no work items while refreshing the cached work items. '
                'Latest cached results will be used instead.'
            ),
            user_id=user_id,
        )
        logger.warning(
            'CachingBackend: refresh of %s returned no data; keeping existing cached content',
            key,
        )

    def _store_fresh(self, name: str, key: str, meta_key: str, result: Any, now: float) -> None:
        """Persist a freshly-fetched result without a hard diskcache TTL.

        Freshness is governed entirely by the ``fresh_until`` sidecar so a
        soft-expired entry can still be served on a failed subsequent refresh.
        """
        ttl = self._ttl_config.ttl_for(name)
        ttl_seconds = ttl.total_seconds() if ttl is not None else None
        self._storage.save(_NAMESPACE, key, result, ttl_seconds=None)
        fresh_until = (now + ttl_seconds) if ttl_seconds is not None else None
        self._storage.save(_NAMESPACE, meta_key, {'fresh_until': fresh_until}, ttl_seconds=None)
        logger.debug(
            'CachingBackend: stored %s (fresh_for=%s)',
            key, f'{ttl_seconds:.0f}s' if ttl_seconds is not None else 'none',
        )

    def _refresh_in_background(
        self,
        *,
        inner_method,
        name: str,
        key: str,
        meta_key: str,
        args: tuple,
        kwargs: dict,
        cached_has_content: bool,
        user_id: Optional[str],
    ) -> None:
        """Refresh a stale cache entry asynchronously, for any cached fetch_* method.

        This keeps request latency low: stale cached data is served immediately,
        then the refreshed snapshot is switched in when ready.
        """

        def _run() -> None:
            try:
                try:
                    result = inner_method(*args, **kwargs)
                except BackendError as exc:
                    if cached_has_content:
                        self._record_stale_warning(exc, key=key, user_id=user_id)
                    return

                if not result and cached_has_content:
                    self._record_stale_no_data_warning(key=key, user_id=user_id)
                    return

                self._store_fresh(name, key, meta_key, result, time.time())
            except Exception as exc:
                logger.warning('CachingBackend: unexpected background refresh error for %s: %s', key, exc)
            finally:
                self._clear_refresh_inflight(key)

        t = threading.Thread(target=_run, name=f'cache-refresh-{key[:24]}', daemon=True)
        t.start()

    def _fetch_with_freshness(self, inner_method, name: str, key: str, args: tuple, kwargs: dict):
        """Cache-first read that never purges content on error/empty refresh.

        The data entry is stored without a hard diskcache TTL so it persists;
        a small ``taskmeta__*`` sidecar records the ``fresh_until`` timestamp.
        When soft-expired we attempt a live refresh: on success we replace the
        data and extend freshness.  For the **remote (ADO) backend only**, an
        auth error, any other exception, or an empty response while content
        already exists keeps and serves the existing content and queues a
        user-facing warning.  Local/static/mock backends never hit transient
        outages, so their refresh result is used as-is.
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
        cached_has_content = bool(cached_value) if have_cached else False

        # For the remote ADO backend, serve stale data immediately and refresh in
        # the background when soft-expired. This removes request-time ADO waits.
        if self._inner_is_remote and have_cached:
            if self._try_mark_refresh_inflight(key):
                logger.debug(
                    'CachingBackend: scheduling background refresh for %s (user_id=%s, cached_has_content=%s)',
                    key, user_id or '-', cached_has_content,
                )
                self._refresh_in_background(
                    inner_method=inner_method,
                    name=name,
                    key=key,
                    meta_key=meta_key,
                    args=args,
                    kwargs=kwargs,
                    cached_has_content=cached_has_content,
                    user_id=user_id,
                )
            else:
                logger.debug('CachingBackend: background refresh already in flight for %s', key)
            return cached_value

        try:
            result = inner_method(*args, **kwargs)
        except BackendError as exc:
            # Resilience is ADO-only: a remote outage / PAT expiry should not
            # drop already-cached content.  Only the live ADO backend raises
            # BackendError, so this branch never fires for local backends.
            if self._inner_is_remote and have_cached and cached_has_content:
                self._record_stale_warning(exc, key=key, user_id=user_id)
                return cached_value
            raise

        if self._inner_is_remote and not result and have_cached and cached_has_content:
            # Backend returned no data but we already have content.  A live ADO
            # outage often surfaces as an empty result, so keep the existing
            # content rather than overwriting a populated cache with nothing.
            self._record_stale_no_data_warning(key=key, user_id=user_id)
            return cached_value

        self._store_fresh(name, key, meta_key, result, now)
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

    # ------------------------------------------------------------------
    # Project config: bypass the diskcache TTL layer entirely.
    #
    # Defining these here (rather than relying on the generic __getattribute__
    # proxy) means they're excluded from caching for free — the proxy only
    # wraps fetch_* methods not already present on this class.
    # ------------------------------------------------------------------

    def fetch_projects(self, *args, **kwargs):
        """Delegate straight to the inner backend; already diskcache-backed."""
        return self._inner.fetch_projects(*args, **kwargs)

    def fetch_project_map(self, *args, **kwargs):
        """Delegate straight to the inner backend; already diskcache-backed."""
        return self._inner.fetch_project_map(*args, **kwargs)


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

    def reload(self) -> None:
        """Reload the wrapped backend in place and refresh wrapper state."""
        if hasattr(self._inner, 'reload'):
            self._inner.reload()
        self._inner_is_remote = bool(getattr(self._inner, 'is_remote', False))
