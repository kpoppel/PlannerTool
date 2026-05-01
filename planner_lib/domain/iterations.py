"""Domain types for sprint / iteration data."""
from __future__ import annotations

from typing import Optional
from typing_extensions import TypedDict


class DomainIteration(TypedDict):
    """A single sprint or iteration node."""
    path: str               # full iteration path e.g. 'MyProject\\Sprint 1'
    name: str               # leaf name e.g. 'Sprint 1'
    startDate: Optional[str]    # ISO date YYYY-MM-DD or None
    finishDate: Optional[str]   # ISO date YYYY-MM-DD or None
