"""Domain types for work items (tasks / epics / features).

DomainTask is the canonical internal representation returned by the
repository layer and consumed by the REST API.  It matches the shape
that the frontend already expects, so no further transformation is
needed once the domain dict is built.

Using TypedDict (not dataclass) keeps the type lightweight and dict-
compatible — existing dict-oriented code can accept a DomainTask without
any changes.
"""
from __future__ import annotations

from typing import List, Optional
from typing_extensions import TypedDict, NotRequired


class DomainRelation(TypedDict):
    type: str    # 'Parent' | 'Child' | 'Successor' | 'Predecessor' | 'Related'
    id: str
    url: NotRequired[str]


class DomainCapacity(TypedDict):
    team: str     # team ID (slug)
    capacity: float


class DomainTask(TypedDict):
    """Canonical representation of a work item inside PlannerTool.

    Field names match what the frontend JavaScript State service expects.
    Optional/absent fields use NotRequired so they are only present when
    the backend actually provides them.
    """
    id: str
    title: str
    type: str                       # canonical casing from task_type_hierarchy
    state: str
    project: str                    # project slug e.g. 'project-my-team'
    start: NotRequired[Optional[str]]      # ISO date YYYY-MM-DD or None
    end: NotRequired[Optional[str]]        # ISO date YYYY-MM-DD or None
    iterationPath: NotRequired[Optional[str]]
    parentId: NotRequired[Optional[str]]
    relations: NotRequired[List[DomainRelation]]
    capacity: NotRequired[List[DomainCapacity]]
    description: NotRequired[Optional[str]]
    assignee: NotRequired[Optional[str]]
    tags: NotRequired[Optional[str]]
    areaPath: NotRequired[Optional[str]]
    url: NotRequired[Optional[str]]
    # Set when start/end were inferred from iteration dates rather than
    # explicit ADO field values.
    _inferred_start: NotRequired[bool]
    _inferred_end: NotRequired[bool]


class WriteResult(TypedDict):
    """Returned by repository.write() after persisting updates to the backend."""
    ok: bool
    updated: int
    errors: List[str]
