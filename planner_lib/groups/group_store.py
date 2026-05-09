"""Group storage for PlannerTool.

Groups are plan-scoped objects with:
  - id:        unique hex identifier (generated on creation)
  - plan_id:   the PlannerTool plan identifier this group belongs to
  - name:      human-readable label
  - parent_id: optional parent group id for 2-level nesting
  - color:     optional hex color string (e.g. '#3b82f6')
  - rank:      integer display order within the same parent (lower = first)

All groups are persisted in a single register dict under the
``'groups'`` namespace so they survive restarts and survive across
sessions.  Concurrent-write safety is provided by the diskcache storage
backend (SQLite WAL mode); no additional file lock is needed.

Deleting a parent group automatically removes all its direct sub-groups
(cascade delete limited to 1 level — matching the 2-level UI limit).
"""
from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from planner_lib.storage.base import StorageBackend

GROUPS_NS = "groups"
REGISTER_KEY = "group_register"


def _load_register(storage: StorageBackend) -> Dict[str, Any]:
    try:
        return storage.load(GROUPS_NS, REGISTER_KEY) or {}
    except KeyError:
        return {}


def _save_register(storage: StorageBackend, register: Dict[str, Any]) -> None:
    storage.save(GROUPS_NS, REGISTER_KEY, register)


# ---------------------------------------------------------------------------
# Public CRUD API
# ---------------------------------------------------------------------------

def list_groups(
    storage: StorageBackend,
    plan_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Return all groups, optionally filtered by *plan_id*.

    Results are sorted by (rank, name) so callers receive a stable order.
    """
    reg = _load_register(storage)
    groups = list(reg.values())
    if plan_id is not None:
        groups = [g for g in groups if g.get("plan_id") == plan_id]
    groups.sort(key=lambda g: (g.get("rank", 0), g.get("name", "")))
    return groups


def get_group(storage: StorageBackend, group_id: str) -> Dict[str, Any]:
    """Return a single group by *group_id*; raises ``KeyError`` if not found."""
    reg = _load_register(storage)
    if group_id not in reg:
        raise KeyError(group_id)
    return reg[group_id]


def create_group(
    storage: StorageBackend,
    plan_id: str,
    name: str,
    parent_id: Optional[str] = None,
    color: Optional[str] = None,
    rank: int = 0,
    members: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Create a new group and return it (including generated ``id``)."""
    group_id = uuid.uuid4().hex
    group: Dict[str, Any] = {
        "id": group_id,
        "plan_id": plan_id,
        "name": name,
        "rank": rank,
    }
    if parent_id is not None:
        group["parent_id"] = parent_id
    if color is not None:
        group["color"] = color
    if members is not None:
        group["members"] = list(members)
    reg = _load_register(storage)
    reg[group_id] = group
    _save_register(storage, reg)
    return group


def update_group(
    storage: StorageBackend,
    group_id: str,
    name: Optional[str] = None,
    parent_id: Optional[str] = None,
    color: Optional[str] = None,
    rank: Optional[int] = None,
    plan_id: Optional[str] = None,
    members: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Update fields on an existing group; raises ``KeyError`` if not found.

    Pass ``color=""`` (empty string) or ``color=None`` to clear the color.
    Pass ``members=[]`` to clear the members list.
    Pass ``members=None`` to leave the existing members list unchanged.
    """
    reg = _load_register(storage)
    if group_id not in reg:
        raise KeyError(group_id)
    group = reg[group_id]
    if name is not None:
        group["name"] = name
    if parent_id is not None:
        group["parent_id"] = parent_id
    if color is not None:
        group["color"] = color if color != "" else None
    if rank is not None:
        group["rank"] = rank
    if plan_id is not None:
        group["plan_id"] = plan_id
    if members is not None:
        group["members"] = list(members)
    reg[group_id] = group
    _save_register(storage, reg)
    return group


def delete_group(storage: StorageBackend, group_id: str) -> bool:
    """Delete a group and its direct sub-groups.

    Returns ``True`` on success, ``False`` if the top-level group was not found.
    Sub-groups are deleted regardless (cascade limited to 1 level to match UI).
    """
    reg = _load_register(storage)
    if group_id not in reg:
        return False
    # Cascade: delete all direct children (sub-groups whose parent_id == group_id)
    children = [gid for gid, g in reg.items() if g.get("parent_id") == group_id]
    for cid in children:
        del reg[cid]
    del reg[group_id]
    _save_register(storage, reg)
    return True
