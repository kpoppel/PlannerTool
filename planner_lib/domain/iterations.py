"""Domain types for sprint / iteration data."""
from __future__ import annotations

from typing import Dict, List, Optional
from typing_extensions import TypedDict


class DomainIteration(TypedDict):
    """A single sprint or iteration node."""
    path: str               # full iteration path e.g. 'MyProject\\Sprint 1'
    name: str               # leaf name e.g. 'Sprint 1'
    startDate: Optional[str]    # ISO date YYYY-MM-DD or None
    finishDate: Optional[str]   # ISO date YYYY-MM-DD or None


class DomainIterationSet(TypedDict):
    """A configured iteration set stored under ``config/iterations``."""
    id: str
    name: str
    source_project: str
    values: List[DomainIteration]
    cached_at: Optional[str]
    root_path: Optional[str]


class DomainIterationGroup(TypedDict):
    """Effective iteration set for one configured project."""
    projectId: str
    projectName: str
    iterationSetId: Optional[str]
    sourceProject: str
    roots: List[str]
    iterations: List[DomainIteration]


DomainIterationsByProject = Dict[str, DomainIterationGroup]
