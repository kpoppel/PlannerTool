"""Domain model for PlannerTool.

This package defines the canonical internal representation of all data
that flows through the application.  All layers — repository, caching,
backend adapters — work with these types at their boundaries.
"""
from planner_lib.domain.tasks import DomainTask, WriteResult
from planner_lib.domain.history import DomainHistoryEntry, DomainTaskHistory
from planner_lib.domain.plans import DomainMarker
from planner_lib.domain.iterations import DomainIteration
from planner_lib.domain.teams import DomainTeam
from planner_lib.domain.projects import DomainProject
from planner_lib.domain.people import DomainPerson

__all__ = [
    'DomainTask',
    'WriteResult',
    'DomainHistoryEntry',
    'DomainTaskHistory',
    'DomainMarker',
    'DomainIteration',
    'DomainTeam',
    'DomainProject',
    'DomainPerson',
]
