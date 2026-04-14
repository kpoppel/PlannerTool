"""ProjectService: project listing helpers extracted from the original combined service."""
from __future__ import annotations

from typing import Any, List, Optional
import logging

from planner_lib.util import slugify
from planner_lib.storage.base import StorageBackend
from planner_lib.projects.interfaces import ProjectServiceProtocol

logger = logging.getLogger(__name__)


class ProjectService(ProjectServiceProtocol):
    """Service responsible for project listing logic.

    The service reads server configuration from the provided storage
    backend and exposes `list_projects` returning frontend-ready entries.
    """

    def __init__(self, storage_config: StorageBackend, metadata_service: Optional[Any] = None):
        self._storage_config = storage_config
        self._metadata_service = metadata_service

    def list_projects(self) -> List[dict]:
        cfg = self._storage_config.load("config", "projects")
        project_map = cfg["project_map"]

        # Load the server-wide global settings to get the task type hierarchy.
        # The hierarchy is a global concept and is not stored per-project.
        # NOTE: Attaching the global hierarchy to each project entry here for convenience, so that callers (e.g. State)
        # don't have to load global settings separately to get the hierarchy. This is admittedly a bit hacky but it
        # avoids unnecessary complexity and extra loads in multiple places. The hierarchy is global, so it doesn't matter
        # that we attach it to each project entry since it will be the same for all of them.
        global_hierarchy: list = []
        try:
            gs = self._storage_config.load("config", "global_settings")
            global_hierarchy = gs.get("task_type_hierarchy", []) if isinstance(gs, dict) else []
        except (KeyError, Exception):
            global_hierarchy = []

        if project_map:
            names = [
                {
                    "id": slugify(p.get("name"), prefix="project-"),
                    "name": p.get("name"),
                    "type": p.get("type") if isinstance(p.get("type"), str) else "project",
                    "display_states": p.get("display_states", []),
                    "state_categories": self._get_state_categories(p),
                    "task_types": p.get("task_types", []),
                    "task_type_hierarchy": global_hierarchy,
                }
                for p in project_map
            ]
            logger.debug("Returning %d configured projects", len(names))
            return names

        logger.debug("No configured projects found; returning empty list")
        return []

    def get_project_map(self) -> List[dict]:
        """Return raw project configuration entries from server_config.

        This preserves fields such as `area_path` that callers (e.g. TaskService)
        may rely on.
        """
        cfg = self._storage_config.load("config", "projects")
        project_map = cfg.get("project_map", [])

        return [dict(p, id=slugify(p.get("name"), prefix="project-")) for p in project_map]

    def _get_state_categories(self, project: dict) -> dict:
        """Return a state→category mapping for the project's display_states.

        Uses the AzureProjectMetadataService cache when available.  Only
        states listed in display_states are included in the returned mapping
        so the frontend receives only what it needs.

        Falls back to an empty dict when no metadata service is configured or
        when no cached metadata exists for the project yet.
        """
        display_states: list = project.get("display_states", [])
        if not display_states or self._metadata_service is None:
            return {}

        area_path: str = project.get("area_path", "")
        if not area_path:
            return {}

        sep = '\\' if '\\' in area_path else '/'
        azure_project = area_path.split(sep)[0]
        if not azure_project:
            return {}

        cached = self._metadata_service.get_cached(azure_project)
        if not cached:
            return {}

        all_categories: dict = cached.get("state_categories", {})
        # Return only the categories for states that are configured for display
        return {state: all_categories[state] for state in display_states if state in all_categories}
