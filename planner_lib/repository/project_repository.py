"""ProjectRepository: single authoritative source for configured project data.

Delegates to the active backend implementation to fetch projects.  The backend
is responsible for returning projects in the correct shape, including any
enrichment needed for the frontend (e.g. state_categories).
"""
from __future__ import annotations

import logging
from typing import List

from planner_lib.domain.projects import DomainProject

logger = logging.getLogger(__name__)


class ProjectRepository:
    """Repository for project data.

    Parameters
    ----------
    backend / local_backend:
        ProjectConfigBackend implementation.
    """

    def __init__(
        self,
        backend=None,
        local_backend=None,
    ) -> None:
        # Accept both 'backend' (new name) and 'local_backend' (old name).
        self._backend = backend if backend is not None else local_backend
        logger.info("ProjectRepository: initialised")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def list_projects(self) -> List[DomainProject]:
        """Return all configured projects in frontend-ready shape.

        The backend implementation is responsible for providing the correct
        data shape, including any enrichment needed (e.g. state_categories).
        """
        return self._backend.fetch_projects()

    def get_project_map(self) -> List[dict]:
        """Return raw project entries including area_path and other backend fields.

        Used internally by TaskRepository, PlanRepository, and IterationRepository.
        """
        return self._backend.fetch_project_map()
