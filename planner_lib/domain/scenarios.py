"""Domain types for user-saved scenarios."""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from typing_extensions import TypedDict, NotRequired


def scenario_access(user_id: str, owner_id: str, scenario_id: str, readonly: bool) -> dict:
    if scenario_id == 'baseline':
        return {'canEdit': False, 'reason': 'baseline'}
    if user_id != owner_id:
        return {'canEdit': False, 'reason': 'not-owner'}
    if readonly:
        return {'canEdit': False, 'reason': 'read-only'}
    return {'canEdit': True, 'reason': None}


class DomainScenario(TypedDict):
    """A user-saved planning scenario."""
    id: str                                     # UUID assigned on first save
    user: str                                   # canonical account UUID of owner
    access: NotRequired[Dict[str, Any]]          # derived response-only capabilities
    name: NotRequired[Optional[str]]            # display name
    shared: NotRequired[bool]                   # whether visible to other users
    overrides: NotRequired[Optional[Dict[str, Any]]]  # feature overrides keyed by feature id
    groupOverrides: NotRequired[Optional[Dict[str, Any]]]  # group overrides keyed by group id
    scenarioGroups: NotRequired[Optional[List[Any]]]  # locally-created groups (promoted on save)
    created_at: NotRequired[Optional[str]]      # ISO-8601 timestamp
    updated_at: NotRequired[Optional[str]]      # ISO-8601 timestamp
