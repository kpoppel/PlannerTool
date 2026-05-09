"""Domain types for task groups.

DomainGroup is the canonical internal representation for user-defined
logical groupings of tasks.  Groups are plan-scoped and persist
independently of scenarios.  Feature→group membership is stored on the
group itself (``group.members = [taskId, ...]``); per-scenario overrides
are recorded in ``scenario.groupOverrides``.

Using TypedDict (not dataclass) keeps the type lightweight and dict-
compatible — existing dict-oriented code can accept a DomainGroup without
any changes.
"""
from __future__ import annotations

from typing import List, Optional
from typing_extensions import TypedDict, NotRequired


class DomainGroup(TypedDict):
    """Canonical representation of a task group inside PlannerTool.

    Groups are hierarchical (max 2 UI levels), plan-scoped, and globally
    shared across all sessions for a given plan.  The ``rank`` field
    controls display order within the same parent (lower rank = higher up).

    Membership is stored on the group: ``members`` is the list of task IDs
    that belong to this group.  Per-scenario membership overrides are stored
    as ``overrides[groupId].members`` inside the scenario document.
    """
    id: str                          # unique hex identifier
    plan_id: str                     # plan this group belongs to
    name: str                        # human-readable label
    parent_id: NotRequired[Optional[str]]  # parent group id for 2-level nesting
    color: NotRequired[Optional[str]]      # hex color e.g. '#3b82f6'
    rank: NotRequired[int]           # display order within same parent (default 0)
    members: NotRequired[List[str]]  # task IDs belonging to this group
