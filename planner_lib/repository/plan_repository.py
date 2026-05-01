"""PlanRepository: delivery-plan markers for all configured projects.

Provides the single authoritative source for plan marker data.
"""
from __future__ import annotations

import logging
from typing import List, Optional

from planner_lib.backend.port import PlansBackend, PlanConfigBackend, BackendCredential
from planner_lib.domain.plans import DomainMarker
from planner_lib.util import slugify

logger = logging.getLogger(__name__)


class PlanRepository:
    """Repository for delivery-plan markers.

    Parameters
    ----------
    backend:
        BackendPort implementation — ``fetch_markers()`` is called per plan.
    project_repository:
        ProjectRepository — provides ``get_project_map()``.
    credential_provider:
        CredentialProvider — provides ``get_credential(user_id)``.
    local_backend:
        PlanConfigBackend — provides ``fetch_area_plan_map()``.
    """

    def __init__(self, backend: PlansBackend, project_repository, credential_provider, plan_config: PlanConfigBackend) -> None:
        self._backend = backend
        self._project_service = project_repository  # internal alias
        self._credential_provider = credential_provider
        self._plan_config = plan_config
        logger.info("PlanRepository: initialised (backend=%s)", type(backend).__name__)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def list_markers(
        self,
        project_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> List[DomainMarker]:
        """Return delivery-plan markers for all (or one) project.

        Reads ``area_plan_map.yml`` to discover enabled plans, then calls
        ``backend.fetch_markers()`` for each enabled plan area.

        Parameters
        ----------
        project_id:
            When supplied, only markers for that project are returned.
        user_id:
            Session user id for optional credential lookup on a cache miss.
        """
        project_map = self._project_service.get_project_map()
        area_plan_map = self._plan_config.fetch_area_plan_map()
        credential = self._get_optional_credential(user_id)
        out: List[DomainMarker] = []

        for project in project_map:
            pid = project.get('id')
            if project_id and pid != project_id:
                continue

            name = project.get('name', '')
            area = project.get('area_path', '')
            proj_obj = area_plan_map.get(pid, {})
            areas = proj_obj.get('areas', {})
            area_config = areas.get(area, {})
            plans_config = area_config.get('plans', {})

            for plan_id, plan_info in plans_config.items():
                if not isinstance(plan_info, dict) or not plan_info.get('enabled', False):
                    continue
                try:
                    raw_markers = self._backend.fetch_markers(area, credential=credential)
                    plan_name = plan_info.get('name')
                    project_slug = slugify(name, prefix='project-')
                    for m in raw_markers:
                        out.append(DomainMarker(
                            plan_id=plan_id,
                            plan_name=plan_name,
                            team_id=None,
                            team_name=None,
                            project=project_slug,
                            marker=m,
                        ))
                except Exception as exc:
                    logger.warning("Failed to fetch markers for plan %s: %s", plan_id, exc)

        return out

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _get_optional_credential(self, user_id: Optional[str]) -> Optional[BackendCredential]:
        if not user_id:
            return None
        try:
            return self._credential_provider.get_credential(user_id)
        except Exception:
            return None
