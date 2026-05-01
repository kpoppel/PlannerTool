"""Domain types for people / team members."""
from __future__ import annotations

from typing import Optional
from typing_extensions import TypedDict, NotRequired


class DomainPerson(TypedDict):
    """A person record from the people database."""
    name: str
    team_name: NotRequired[Optional[str]]
    site: NotRequired[Optional[str]]
    external: NotRequired[bool]
