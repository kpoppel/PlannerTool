"""Domain types for user-saved views."""
from __future__ import annotations

from typing import Any, Dict, Optional
from typing_extensions import TypedDict, NotRequired


class DomainView(TypedDict):
    """A user-saved UI view configuration."""
    id: str                                         # UUID assigned on first save
    user: str                                       # email of owning user
    name: str                                       # display name (required)
    selectedProjects: NotRequired[Optional[Dict[str, bool]]]
    selectedTeams: NotRequired[Optional[Dict[str, bool]]]
    viewOptions: NotRequired[Optional[Dict[str, Any]]]
    created_at: NotRequired[Optional[str]]          # ISO-8601 timestamp
    updated_at: NotRequired[Optional[str]]          # ISO-8601 timestamp
