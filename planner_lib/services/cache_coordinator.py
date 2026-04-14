"""CacheCoordinator: single entry-point for invalidating all application caches.

Previously cache invalidation was scattered across three independent paths:
  - azure_client.invalidate_all_caches()   — Azure work item cache
  - cost_service.invalidate_cache()        — team rates/cost cache
  - MemoryCacheManager.delete(ns, key)     — individual memory entries

This class collects all registered Invalidatable services and fans out
a single invalidate_all() call to each one. Callers (e.g. the admin
/api/cache/invalidate endpoint) only need to know about the coordinator.
"""
from __future__ import annotations

import logging
from typing import Any, List

from planner_lib.services.interfaces import Invalidatable

logger = logging.getLogger(__name__)


class CacheCoordinator:
    """Fans out cache invalidation to all registered Invalidatable services.

    Register services via :meth:`register`. Order of registration determines
    order of invalidation (azure first, then derived caches).
    """

    def __init__(self) -> None:
        self._services: List[Any] = []

    def register(self, service: Any, name: str = "") -> None:
        """Add a service to the invalidation fan-out list.

        Non-Invalidatable objects are silently ignored so callers do not need
        to guard against optional services.
        """
        if isinstance(service, Invalidatable):
            self._services.append((name or type(service).__name__, service))
            logger.debug("CacheCoordinator: registered %s", name or type(service).__name__)
        else:
            logger.debug(
                "CacheCoordinator: skipping %s — does not implement Invalidatable",
                name or type(service).__name__,
            )

    def invalidate_all(self) -> dict:
        """Call invalidate_cache() on every registered service.

        Returns a summary dict ``{"invalidated": [<names>], "errors": [<msgs>]}``.
        Errors do not abort the fan-out; all services are always attempted.
        """
        invalidated: list[str] = []
        errors: list[str] = []
        for name, svc in self._services:
            try:
                svc.invalidate_cache()
                invalidated.append(name)
                logger.info("CacheCoordinator: invalidated %s", name)
            except Exception as e:
                msg = f"{name}: {e}"
                errors.append(msg)
                logger.exception("CacheCoordinator: error invalidating %s — %s", name, e)
        return {"ok": not errors, "invalidated": invalidated, "errors": errors}
