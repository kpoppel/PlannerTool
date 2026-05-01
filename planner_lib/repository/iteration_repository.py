"""IterationRepository: sprint / iteration data for all configured projects.

Provides the single authoritative source for iteration data.
"""
from __future__ import annotations

import logging
from datetime import date as _date
from typing import Any, Dict, List, Optional

from planner_lib.backend.port import IterationsBackend, IterationConfigBackend, BackendCredential
from planner_lib.domain.iterations import DomainIteration

logger = logging.getLogger(__name__)


class IterationRepository:
    """Repository for sprint / iteration data.

    Parameters
    ----------
    backend:
        BackendPort implementation — ``fetch_iterations()`` is called per project.
    project_repository:
        ProjectRepository — provides ``get_project_map()``.
    credential_provider:
        CredentialProvider — provides ``get_credential(user_id)``.
    local_backend:
        IterationConfigBackend — provides ``fetch_iterations_config()``.
    """

    def __init__(self, backend: IterationsBackend, project_repository, credential_provider, iteration_config: IterationConfigBackend) -> None:
        self._backend = backend
        self._project_service = project_repository  # internal alias
        self._credential_provider = credential_provider
        self._iteration_config = iteration_config
        logger.info("IterationRepository: initialised (backend=%s)", type(backend).__name__)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def list_iterations(
        self,
        project_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> List[DomainIteration]:
        """Return iterations sorted so current / future sprints appear first.

        Parameters
        ----------
        project_id:
            When supplied, only iterations for that project are returned.
        user_id:
            Session user id for optional credential lookup on a cache miss.
        """
        project_map = self._project_service.get_project_map()
        credential = self._get_optional_credential(user_id)
        iterations_config = self._iteration_config.fetch_iterations_config()

        project_overrides = iterations_config.get('project_overrides', {})

        out: List[DomainIteration] = []
        seen_paths: set = set()
        # Track (project_name, frozen_roots) combos already fetched to avoid
        # duplicate backend calls when multiple project-map entries share the
        # same ADO project.
        fetched_combos: set = set()

        for project in project_map:
            pid = project.get('id')
            if project_id and pid != project_id:
                continue

            area_path = project.get('area_path', '')
            # Use the explicit project name from iterations_config when available.
            # Iteration nodes are a project-level concept; the first segment of
            # an area_path may be an area root rather than the project name.
            project_name = (
                iterations_config.get('azure_project')
                or (area_path.split('\\')[0] if '\\' in area_path
                    else area_path.split('/')[0] if '/' in area_path
                    else project.get('name', ''))
            )
            raw_roots = project_overrides.get(
                project_name, iterations_config.get('default_roots', [])
            )

            combo = (project_name, tuple(raw_roots))
            if combo in fetched_combos:
                continue
            fetched_combos.add(combo)

            try:
                iters_map: Dict[str, Any] = self._backend.fetch_iterations(
                    project_name,
                    root_paths=raw_roots or None,
                    credential=credential,
                )
                for path, iter_data in iters_map.items():
                    if path in seen_paths:
                        continue
                    seen_paths.add(path)
                    leaf = path.split('\\')[-1] if '\\' in path else path
                    out.append(DomainIteration(
                        path=path,
                        name=iter_data.get('name', leaf),
                        startDate=iter_data.get('startDate'),
                        finishDate=iter_data.get('finishDate'),
                    ))
            except Exception as exc:
                logger.warning("Failed to fetch iterations for '%s': %s", project_name, exc)

        # Sort: current/future iterations first, then ascending by startDate
        today_str = _date.today().isoformat()

        def _sort_key(it: DomainIteration):
            finish = it.get('finishDate') or ''
            is_current_or_future = not finish or finish[:10] >= today_str
            return (not is_current_or_future, it.get('startDate') or '')

        out.sort(key=_sort_key)
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
