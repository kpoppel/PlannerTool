"""Central re-exports for package-local Protocols.

Place truly cross-cutting Protocols here for discoverability, while the
canonical definitions live beside their implementations in each package.
"""

from planner_lib.storage.interfaces import StorageProtocol
from planner_lib.accounts.interfaces import AccountManagerProtocol
from planner_lib.middleware.interfaces import SessionManagerProtocol
from planner_lib.projects.interfaces import (
    ProjectServiceProtocol,
    TeamServiceProtocol,
    TaskServiceProtocol,
    CapacityServiceProtocol,
)

__all__ = [
    "StorageProtocol",
    "AccountManagerProtocol",
    "SessionManagerProtocol",
    "ProjectServiceProtocol",
    "TeamServiceProtocol",
    "TaskServiceProtocol",
    "CapacityServiceProtocol",
]
