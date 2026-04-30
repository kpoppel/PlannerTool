"""Domain types for work item revision history.

DomainHistoryEntry represents a single field change (one field, one
new value, one actor, one timestamp).  DomainTaskHistory bundles a list
of entries with the task metadata needed by the frontend timeline overlay.
"""
from __future__ import annotations

from typing import List, Optional
from typing_extensions import TypedDict, NotRequired


class DomainHistoryEntry(TypedDict):
    """A single change record for one field of one work item."""
    field: str          # 'start' | 'end' | 'iteration'
    value: Optional[str]
    changed_at: str     # ISO 8601 timestamp
    changed_by: str
    pair_id: NotRequired[int]  # set when this entry was paired with another nearby change


class DomainTaskHistory(TypedDict):
    """A work item with its relevant change history."""
    task_id: int
    title: str
    plan_id: str
    history: List[DomainHistoryEntry]
