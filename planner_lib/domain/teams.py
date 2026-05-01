"""Domain types for configured teams."""
from __future__ import annotations

from typing import Optional
from typing_extensions import TypedDict


class DomainTeam(TypedDict):
    """A team as defined in the local teams.yml configuration."""
    id: str             # slug e.g. 'team-architecture'
    name: str           # full display name
    short_name: Optional[str]
