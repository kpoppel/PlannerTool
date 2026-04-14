"""Storage interface alias.

``StorageBackend`` (in ``planner_lib.storage.base``) is the canonical storage
interface. ``StorageProtocol`` is a **deprecated** alias kept so existing
imports continue to work, but all new code should import ``StorageBackend``
directly from ``planner_lib.storage.base``.
"""
from planner_lib.storage.base import StorageBackend

__all__ = ["StorageBackend"]
