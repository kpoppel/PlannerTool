"""LocalGroupBackend: diskcache-backed implementation of the GroupBackend protocol.

Wraps the pure ``group_store`` CRUD functions with the interface expected by
``GroupRepository``.  The diskcache storage backend provides SQLite WAL-mode
write safety and no additional locking is required.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from planner_lib.storage.base import StorageBackend
from planner_lib.groups import group_store

logger = logging.getLogger(__name__)


class LocalGroupBackend:
    """Groups backend backed by the diskcache storage layer.

    This is the only backend available in Phase 1.  A future
    ``AzureFieldGroupBackend`` will synthesise groups from a custom work-item
    field without requiring changes to ``GroupRepository``.
    """

    def __init__(self, storage: StorageBackend) -> None:
        self._storage = storage
        logger.info("LocalGroupBackend: initialised (storage=%s)", type(storage).__name__)

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    def fetch_groups(
        self,
        plan_id: Optional[str] = None,
        credential=None,
    ) -> List[Dict[str, Any]]:
        """Return all groups, optionally filtered by *plan_id*."""
        return group_store.list_groups(self._storage, plan_id=plan_id)

    def fetch_group(
        self,
        group_id: str,
        credential=None,
    ) -> Dict[str, Any]:
        """Return a single group (raises ``KeyError`` when not found)."""
        return group_store.get_group(self._storage, group_id)

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------

    def create_group(
        self,
        plan_id: str,
        name: str,
        parent_id: Optional[str] = None,
        color: Optional[str] = None,
        rank: int = 0,
        credential=None,
    ) -> Dict[str, Any]:
        """Create a new group and return it (including generated id)."""
        return group_store.create_group(
            self._storage,
            plan_id=plan_id,
            name=name,
            parent_id=parent_id,
            color=color,
            rank=rank,
        )

    def update_group(
        self,
        group_id: str,
        name: Optional[str] = None,
        parent_id: Optional[str] = None,
        color: Optional[str] = None,
        rank: Optional[int] = None,
        plan_id: Optional[str] = None,
        credential=None,
    ) -> Dict[str, Any]:
        """Update fields on an existing group (raises ``KeyError`` when not found)."""
        return group_store.update_group(
            self._storage,
            group_id=group_id,
            name=name,
            parent_id=parent_id,
            color=color,
            rank=rank,
            plan_id=plan_id,
        )

    def delete_group(
        self,
        group_id: str,
        credential=None,
    ) -> bool:
        """Delete a group and its sub-groups (cascade). Returns True when found."""
        return group_store.delete_group(self._storage, group_id)
