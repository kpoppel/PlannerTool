"""GroupRepository: single authoritative source for plan-scoped groups.

Delegates all persistence to a GroupBackend implementation.  The default
implementation is ``LocalGroupBackend`` (diskcache-backed).  A future
``AzureFieldGroupBackend`` can be configured in ``config::groups_config``
to read group definitions from a custom ADO work-item field.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class GroupRepository:
    """Repository for plan-scoped task groups.

    Parameters
    ----------
    backend:
        GroupBackend implementation (``LocalGroupBackend`` or future ADO backend).
    """

    def __init__(self, backend) -> None:
        self._backend = backend
        logger.info(
            "GroupRepository: initialised (backend=%s)",
            type(backend).__name__,
        )

    def list_groups(
        self,
        plan_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Return all groups, optionally filtered by *plan_id*."""
        return self._backend.fetch_groups(plan_id=plan_id)

    def get_group(self, group_id: str) -> Dict[str, Any]:
        """Return a single group (raises KeyError when not found)."""
        return self._backend.fetch_group(group_id)

    def create_group(
        self,
        plan_id: str,
        name: str,
        parent_id: Optional[str] = None,
        color: Optional[str] = None,
        rank: int = 0,
    ) -> Dict[str, Any]:
        """Create a new group and return it (including generated id)."""
        return self._backend.create_group(
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
    ) -> Dict[str, Any]:
        """Update fields on an existing group (raises KeyError when not found)."""
        return self._backend.update_group(
            group_id=group_id,
            name=name,
            parent_id=parent_id,
            color=color,
            rank=rank,
            plan_id=plan_id,
        )

    def delete_group(self, group_id: str) -> bool:
        """Delete a group and cascade-delete its sub-groups.

        Returns True when found and deleted, False when not found.
        """
        return self._backend.delete_group(group_id)
