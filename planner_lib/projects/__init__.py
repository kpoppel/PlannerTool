"""Project-related services split into single-responsibility classes.

This package exposes three services: `ProjectService`, `TeamService`, and
`CapacityService` implemented in their respective modules. Import these
classes from the package root for convenience.
"""

from .project_service import ProjectService
from .team_service import TeamService
from .capacity_service import CapacityService

__all__ = ["ProjectService", "TeamService", "CapacityService"]
