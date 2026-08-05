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

            source_project, raw_roots, cached_values, iteration_set_id = self._resolve_iteration_source(project, iterations_config)
            if not source_project:
                continue

            if cached_values:
                effective_iterations = self._normalize_cached_values(cached_values)
            else:
                combo = (source_project, tuple(raw_roots))
                try:
                    if combo not in fetched_combos:
                        iters_map: Dict[str, Any] = self._backend.fetch_iterations(
                            source_project,
                            root_paths=raw_roots or None,
                            credential=credential,
                        )
                        fetched_combos[combo] = self._normalize_iterations(iters_map)
                    effective_iterations = list(fetched_combos[combo])
                except Exception as exc:
                    logger.warning(
                        "Failed to fetch iterations for configured project '%s' "
                        "(source_project='%s', roots=%s): %s",
                        project.get('name') or '?',
                        source_project,
                        raw_roots,
                        exc,
                    )
                    # Keep the configured association visible even when live fetch fails.
                    effective_iterations = []

            out[str(pid)] = DomainIterationGroup(
                projectId=str(pid),
                projectName=str(project.get('name') or ''),
                iterationSetId=iteration_set_id,
                sourceProject=source_project,
                roots=list(raw_roots),
                iterations=effective_iterations,
            )

        return out

    def list_iteration_sets(
        self,
        user_id: Optional[str] = None,
    ) -> Dict[str, dict]:
        """Return configured iteration sets keyed by set id.

        This is the direct payload for plan→iteration_set associations and
        allows clients to resolve iterations by `project.iteration_uuid`.
        """
        _ = self._get_optional_credential(user_id)
        iterations_config = self._iteration_config.fetch_iterations_config() or {}
        raw_sets = iterations_config.get('iteration_sets')
        if not isinstance(raw_sets, list):
            return {}

        out: Dict[str, dict] = {}
        for item in raw_sets:
            if not isinstance(item, dict):
                continue
            set_id = str(item.get('id') or '').strip()
            if not set_id:
                continue

            values = item.get('values') if isinstance(item.get('values'), list) else []
            out[set_id] = {
                'id': set_id,
                'name': str(item.get('name') or set_id),
                'sourceProject': str(item.get('source_project') or '').strip(),
                'rootPath': str(item.get('root_path') or '').strip() or None,
                'cachedAt': item.get('cached_at'),
                'iterations': self._normalize_cached_values(values),
            }

        return out

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _resolve_iteration_source(
        project: dict,
        iterations_config: dict,
    ) -> tuple[str, List[str], List[dict], Optional[str]]:
        """Resolve source ADO project and iteration roots for one configured project.

        Preferred config format:
            {"iteration_sets": [{"id", "source_project", "root_path?", ...}]}

        Matching rule:
        - project.iteration_uuid must point at a set id.
        - no implicit default when association is missing.

        Legacy config fallback remains supported:
            {"azure_project", "default_roots", "project_overrides"}
        """
        iteration_sets = iterations_config.get('iteration_sets')
        if isinstance(iteration_sets, list):
            assoc_id = str(project.get('iteration_uuid') or '').strip()
            if not assoc_id:
                return '', [], [], None

            for s in iteration_sets:
                if not isinstance(s, dict):
                    continue
                if str(s.get('id') or '').strip() != assoc_id:
                    continue
                source_project = str(s.get('source_project') or '').strip()
                if not source_project:
                    return '', [], [], assoc_id
                root_path = str(s.get('root_path') or '').strip()
                values = s.get('values') if isinstance(s.get('values'), list) else []
                return source_project, [root_path] if root_path else [], values, assoc_id

            return '', [], [], assoc_id or None

        # Legacy fallback path
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
        return source_project, clean_roots, [], None

    @classmethod
    def _normalize_cached_values(cls, values: List[dict]) -> List[DomainIteration]:
        """Normalize values embedded in iteration_set payloads."""
        by_path: Dict[str, Dict[str, Any]] = {}
        for item in values or []:
            if not isinstance(item, dict):
                continue
            path = str(item.get('path') or '').strip()
            if not path or path in by_path:
                continue
            by_path[path] = item
        return cls._normalize_iterations(by_path)

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
