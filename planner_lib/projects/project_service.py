"""ProjectService: project listing helpers extracted from the original combined service."""
from __future__ import annotations

from typing import List
import logging

from planner_lib.util import slugify
from planner_lib.services.interfaces import StorageProtocol
from planner_lib.projects.interfaces import ProjectServiceProtocol

logger = logging.getLogger(__name__)


class ProjectService(ProjectServiceProtocol):
    """Service responsible for project listing logic.

    The service reads server configuration from the provided storage
    backend and exposes `list_projects` returning frontend-ready entries.
    """

    def __init__(self, storage_config: StorageProtocol):
        self._storage_config = storage_config

    def list_projects(self) -> List[dict]:
        cfg = self._storage_config.load("config", "projects")
        project_map = cfg["project_map"]
        if project_map:
            names = [
                {"id": slugify(p.get("name"), prefix="project-"),
                 "name": p.get("name"),
                 "type": p.get("type") if isinstance(p.get("type"), str) else "project"}
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
