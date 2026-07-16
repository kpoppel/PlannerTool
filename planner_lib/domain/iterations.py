"""Domain types for sprint / iteration data."""
from __future__ import annotations

from typing import Dict, List, Optional
from typing_extensions import NotRequired, TypedDict


class DomainIteration(TypedDict):
    """A single sprint or iteration node."""
    path: str               # full iteration path e.g. 'MyProject\\Sprint 1'
    name: str               # leaf name e.g. 'Sprint 1'
    startDate: Optional[str]    # ISO date YYYY-MM-DD or None
    finishDate: Optional[str]   # ISO date YYYY-MM-DD or None


class DomainIterationGroup(TypedDict):
    """Effective iteration set for one configured project."""
    projectId: str
    projectName: str
    sourceProject: str
    roots: List[str]
    iterations: List[DomainIteration]
    matchedRuleId: NotRequired[Optional[str]]
    fallbackUsed: NotRequired[bool]
    resolutionWarnings: NotRequired[List[str]]


DomainIterationsByProject = Dict[str, DomainIterationGroup]
