"""Domain types for user-saved scenarios."""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from typing_extensions import TypedDict, NotRequired


class DomainScenario(TypedDict):
    """A user-saved planning scenario."""
    id: str                                     # UUID assigned on first save
    user: str                                   # email of owning user
    name: NotRequired[Optional[str]]            # display name
    shared: NotRequired[bool]                   # whether visible to other users
    overrides: NotRequired[Optional[Dict[str, Any]]]  # feature overrides keyed by feature id
    groupOverrides: NotRequired[Optional[Dict[str, Any]]]  # group overrides keyed by group id
    scenarioGroups: NotRequired[Optional[List[Any]]]  # locally-created groups (promoted on save)
    created_at: NotRequired[Optional[str]]      # ISO-8601 timestamp
    updated_at: NotRequired[Optional[str]]      # ISO-8601 timestamp
