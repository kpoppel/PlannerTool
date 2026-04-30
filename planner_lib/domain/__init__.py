"""Domain model for PlannerTool.

This package defines the canonical internal representation of all data
that flows through the application.  All layers — repository, caching,
backend adapters — work with these types at their boundaries.
"""
from planner_lib.domain.tasks import DomainTask, WriteResult
from planner_lib.domain.history import DomainHistoryEntry, DomainTaskHistory

__all__ = [
    'DomainTask',
    'WriteResult',
    'DomainHistoryEntry',
    'DomainTaskHistory',
]
