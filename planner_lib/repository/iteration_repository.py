"""IterationRepository: sprint / iteration data for all configured projects.

Provides the single authoritative source for iteration data.
"""
from __future__ import annotations

import logging
from datetime import date as _date
from typing import Any, Dict, List, Optional

from planner_lib.backend.port import IterationsBackend, IterationConfigBackend, BackendCredential
from planner_lib.domain.iterations import DomainIteration, DomainIterationGroup, DomainIterationsByProject

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
    ) -> DomainIterationsByProject:
        """Return project-keyed effective iteration sets.

        Parameters
        ----------
        project_id:
            When supplied, only the matching configured project's iteration set is returned.
        user_id:
            Session user id for optional credential lookup on a cache miss.
        """
        project_map = self._project_service.get_project_map()
        credential = self._get_optional_credential(user_id)
        iterations_config = self._iteration_config.fetch_iterations_config()

        out: DomainIterationsByProject = {}
        # Track (source_project, frozen_roots) combos already fetched to avoid
        # duplicate backend calls when multiple configured projects share the
        # same ADO iteration source.
        fetched_combos: Dict[tuple[str, tuple[str, ...]], List[DomainIteration]] = {}

        for project in project_map:
            pid = project.get('id')
            if project_id and pid != project_id:
                continue

            source_project, raw_roots = self._resolve_iteration_source(project, iterations_config)
            if not source_project:
                continue

            combo = (source_project, tuple(raw_roots))
            try:
                if combo not in fetched_combos:
                    iters_map: Dict[str, Any] = self._backend.fetch_iterations(
                        source_project,
                        root_paths=raw_roots or None,
                        credential=credential,
                    )
                    fetched_combos[combo] = self._normalize_iterations(iters_map)

                out[str(pid)] = DomainIterationGroup(
                    projectId=str(pid),
                    projectName=str(project.get('name') or ''),
                    sourceProject=source_project,
                    roots=list(raw_roots),
                    iterations=list(fetched_combos[combo]),
                )
            except Exception as exc:
                logger.warning(
                    "Failed to fetch iterations for configured project '%s' "
                    "(source_project='%s', roots=%s): %s",
                    project.get('name') or '?',
                    source_project,
                    raw_roots,
                    exc,
                )

        return out

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _resolve_iteration_source(project: dict, iterations_config: dict) -> tuple[str, List[str]]:
        """Resolve source ADO project and iteration roots for one configured project."""
        configured_name = str(project.get('name') or '').strip()
        area_path = str(project.get('area_path') or '')
        area_project = (
            area_path.split('\\')[0]
            if '\\' in area_path
            else area_path.split('/')[0]
            if '/' in area_path
            else area_path
        )
        default_project = str(iterations_config.get('azure_project') or area_project).strip()

        project_overrides = iterations_config.get('project_overrides', {})
        if not isinstance(project_overrides, dict):
            project_overrides = {}

        default_roots = iterations_config.get('default_roots', [])
        override_entry = None
        if configured_name and configured_name in project_overrides:
            override_entry = project_overrides.get(configured_name)

        source_project = default_project
        raw_roots = default_roots

        if isinstance(override_entry, dict):
            source_project = str(override_entry.get('azure_project') or default_project).strip()
            candidate_roots = override_entry.get('roots')
            raw_roots = candidate_roots if isinstance(candidate_roots, list) else default_roots

        clean_roots = [str(r) for r in (raw_roots or []) if str(r).strip()]
        return source_project, clean_roots

    @staticmethod
    def _normalize_iterations(iters_map: Dict[str, Any]) -> List[DomainIteration]:
        """Normalize and sort backend iteration maps for one effective source."""
        out: List[DomainIteration] = []
        seen_paths: set[str] = set()

        for path, iter_data in (iters_map or {}).items():
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

        today_str = _date.today().isoformat()

        def _sort_key(it: DomainIteration):
            finish = it.get('finishDate') or ''
            is_current_or_future = not finish or finish[:10] >= today_str
            return (not is_current_or_future, it.get('startDate') or '')

        out.sort(key=_sort_key)
        return out

    def _get_optional_credential(self, user_id: Optional[str]) -> Optional[BackendCredential]:
        if not user_id:
            return None
        try:
            return self._credential_provider.get_credential(user_id)
        except Exception:
            return None
