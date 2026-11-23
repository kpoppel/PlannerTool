"""Domain types for delivery plans and their markers."""
from __future__ import annotations

from typing import List

from typing_extensions import TypedDict, NotRequired


def validate_plan_common(plan: dict, container_types: List[str]) -> None:
    """Validate plan fields shared by every task backend; backends add their own rules."""
    if not isinstance(plan.get('name'), str) or not plan['name'].strip():
        raise ValueError('Plan name must not be empty')
    if plan.get('type') not in container_types:
        raise ValueError(f"Unknown plan level for {plan['name']}")
    days = plan.get('closed_history_days')
    if type(days) is not int or days < 0:
        raise ValueError('closed_history_days must be an integer >= 0')
    names = plan.get('task_types')
    if (not isinstance(names, list) or not names
            or any(not isinstance(name, str) or not name for name in names)):
        raise ValueError('task_types must be a non-empty list of type names')


class DomainMarker(TypedDict):
    """A single timeline marker attached to a delivery plan."""
    plan_id: str
    plan_name: NotRequired[str]
    team_id: NotRequired[str]
    team_name: NotRequired[str]
    project: str            # canonical project UUID
    marker: dict            # raw marker payload from the backend
