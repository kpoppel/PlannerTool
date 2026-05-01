"""Central re-exports for package-local Protocols."""
from typing import Protocol, runtime_checkable

from planner_lib.storage.base import StorageBackend
from planner_lib.accounts.interfaces import AccountManagerProtocol
from planner_lib.middleware.interfaces import SessionManagerProtocol


@runtime_checkable
class Reloadable(Protocol):
    """Service that supports in-place config/cache reload without restart."""

    def reload(self) -> None: ...


@runtime_checkable
class Invalidatable(Protocol):
    """Service that supports explicit cache invalidation."""

    def invalidate_cache(self) -> None: ...


__all__ = [
    "StorageBackend",
    "AccountManagerProtocol",
    "SessionManagerProtocol",
    "Reloadable",
    "Invalidatable",
]

