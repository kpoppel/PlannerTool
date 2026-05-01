"""Domain types for delivery-plan markers."""
from __future__ import annotations

from typing_extensions import TypedDict, NotRequired


class DomainMarker(TypedDict):
    """A single timeline marker attached to a delivery plan."""
    plan_id: str
    plan_name: NotRequired[str]
    team_id: NotRequired[str]
    team_name: NotRequired[str]
    project: str            # project slug e.g. 'project-my-team'
    marker: dict            # raw marker payload from the backend
