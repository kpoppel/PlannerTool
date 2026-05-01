"""ProjectRepository: single authoritative source for configured project data.

Delegates all YAML reading to LocalConfigBackend (via the ``local_backend``
DI key) so that project data benefits from the same TTL cache as all other
domain data.  The repository adds one optional enrichment step: attaching
``state_categories`` from the ADO metadata cache when available.
"""
from __future__ import annotations

import logging
from typing import Any, List, Optional

from planner_lib.domain.projects import DomainProject

logger = logging.getLogger(__name__)


class ProjectRepository:
    """Repository for locally-configured project data.

    Parameters
    ----------
    local_backend:
        ProjectConfigBackend implementation (reads from projects.yml).
    metadata_service:
        Optional AzureProjectMetadataService -- enriches state_categories per
        project for the frontend.  No behaviour change when absent.
    """

    def __init__(self, backend=None, local_backend=None, metadata_service: Optional[Any] = None) -> None:
        # Accept both 'backend' (new name) and 'local_backend' (old name via legacy call sites).
        self._backend = backend if backend is not None else local_backend
        self._metadata_service = metadata_service
        logger.info("ProjectRepository: initialised")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def list_projects(self) -> List[DomainProject]:
        """Return all configured projects in frontend-ready shape."""
        projects = self._backend.fetch_projects()
        if self._metadata_service is None:
            return projects
        return [self._enrich(p) for p in projects]

    def get_project_map(self) -> List[dict]:
        """Return raw project entries including area_path and other backend fields.

        Used internally by TaskRepository, PlanRepository, and IterationRepository.
        """
        return self._backend.fetch_project_map()

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _enrich(self, project: DomainProject) -> DomainProject:
        """Attach state_categories from the ADO metadata cache."""
        display_states = project.get("display_states") or []
        area_path = project.get("area_path") or ""
        if not display_states or not area_path:
            return project

        sep = "\\" if "\\" in area_path else "/"
        azure_project = area_path.split(sep)[0]
        if not azure_project:
            return project

        cached = self._metadata_service.get_cached(azure_project)
        if not cached:
            return project

        all_categories: dict = cached.get("state_categories") or {}
        return {**project, "state_categories": {s: all_categories[s] for s in display_states if s in all_categories}}  # type: ignore[return-value]
