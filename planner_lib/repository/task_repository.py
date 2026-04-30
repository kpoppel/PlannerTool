"""TaskRepository: application-layer facade for task read/write operations.

Replaces TaskService and TaskUpdateService.  All I/O goes through the
injected BackendPort (AzureDevOpsBackend / CachingBackend / StaticBackend
/ MockFixtureBackend …).

Public API (mirrors the old TaskService signatures so api.py changes are
minimal):

  read(project_id=None, credential=None) -> List[DomainTask]
    Fetch all tasks (optionally filtered to one project).  Uses cached
    values when available; raises PermissionError if a live fetch is
    needed and no credential is available.

  write(updates, user_id) -> WriteResult
    Persist one or more task updates.  Gets a credential from the provider.

  list_markers(project_id=None, user_id=None) -> List[dict]
    Return plan-linked markers (legacy format, same as old list_markers).

  list_iterations(project_id=None, user_id=None) -> List[dict]
    Return iteration data (filtered / sorted as before).

  refresh(project_id, user_id) -> dict
    Invalidate the cache and force a live fetch for a project.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from planner_lib.backend.port import BackendPort, BackendCredential
from planner_lib.domain.tasks import DomainTask, WriteResult
from planner_lib.util import slugify

logger = logging.getLogger(__name__)


class TaskRepository:
    """Application-layer repository for task data.

    Parameters
    ----------
    backend:
        A BackendPort implementation (live, caching, static, or mock).
    project_service:
        ProjectServiceProtocol — provides ``get_project_map()``.
    credential_provider:
        CredentialProvider — provides ``get_credential(user_id)``.
    storage:
        StorageBackend — used for reading config (area_plan_map,
        iterations, global_settings).
    """

    def __init__(
        self,
        backend: BackendPort,
        project_service,
        credential_provider,
        storage,
    ) -> None:
        self._backend = backend
        self._project_service = project_service
        self._credential_provider = credential_provider
        self._storage = storage
        logger.info(
            "TaskRepository: initialised (backend=%s)",
            type(backend).__name__,
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def read(
        self,
        project_id: Optional[str] = None,
        credential: Optional[BackendCredential] = None,
    ) -> List[DomainTask]:
        """Return all tasks, optionally filtered to one project.

        Parameters
        ----------
        project_id:
            When supplied, only tasks from the matching project entry are
            returned.  Matches the ``id`` field from projects.yml project_map.
        credential:
            Optional BackendCredential for cache-miss paths.  When absent and
            the backend needs a live fetch, the backend raises PermissionError.
        """
        project_map = self._project_service.get_project_map()
        items: List[DomainTask] = []

        for project in project_map:
            pid = project.get('id')
            if project_id and pid != project_id:
                continue

            area_path: str = project.get('area_path', '')
            task_types: Optional[List[str]] = project.get('task_types')
            include_states: Optional[List[str]] = project.get('include_states')

            tasks = self._backend.fetch_tasks(
                area_path=area_path,
                task_types=task_types,
                include_states=include_states,
                credential=credential,
            )

            # Post-fill the project identifier so consumers can filter by project
            # without relying on adapter-level slug derivation.
            for task in tasks or []:
                task['project'] = pid

            items.extend(tasks or [])
            logger.debug(
                "TaskRepository.read: %d tasks for project '%s'",
                len(tasks or []),
                pid,
            )

        logger.debug("TaskRepository.read: %d total tasks returned", len(items))
        return items

    def write(
        self,
        updates: List[dict],
        user_id: str,
    ) -> Dict[str, Any]:
        """Persist a batch of task updates.

        Matches the legacy ``update_tasks(updates, pat)`` return shape
        (``{'updated': n, 'errors': [...]}``).
        """
        if not updates:
            return {'updated': 0, 'errors': []}

        credential = self._credential_provider.get_credential(user_id)
        if credential is None:
            return {'updated': 0, 'errors': ['No credential available for user']}

        total_updated = 0
        all_errors: List[str] = []

        for update in updates:
            try:
                task_id = int(update.get('id', 0))
                if not task_id:
                    all_errors.append(f"Invalid task id: {update!r}")
                    continue
                result: WriteResult = self._backend.write_task(task_id, update, credential)
                total_updated += result.get('updated', 0)
                all_errors.extend(result.get('errors') or [])
            except Exception as exc:
                all_errors.append(f"Task {update.get('id', '?')}: {exc}")

        return {'updated': total_updated, 'errors': all_errors}

    def list_markers(
        self,
        project_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> List[dict]:
        """Return delivery-plan markers (legacy dict format).

        Reads ``area_plan_map.yml`` to discover enabled plans, then calls
        ``backend.fetch_markers()`` per plan.  Matches the old
        ``TaskService.list_markers()`` return shape.
        """
        project_map = self._project_service.get_project_map()

        if self._storage.exists('config', 'area_plan_map'):
            area_plan_map = self._storage.load('config', 'area_plan_map') or {}
        else:
            area_plan_map = {}

        credential = self._get_optional_credential(user_id)
        out: List[dict] = []

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
                    markers = self._backend.fetch_markers(area, credential=credential)
                    plan_name = plan_info.get('name')
                    for m in markers:
                        out.append({
                            'plan_id': plan_id,
                            'plan_name': plan_name,
                            'team_id': None,
                            'team_name': None,
                            'marker': m,
                            'project': slugify(name, prefix='project-'),
                        })
                except Exception as exc:
                    logger.warning("Failed to fetch markers for plan %s: %s", plan_id, exc)

        return out

    def list_iterations(
        self,
        project_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> List[dict]:
        """Return iteration data (filtered, sorted) for all or one project.

        Matches the legacy ``TaskService.list_iterations()`` return shape.
        """
        project_map = self._project_service.get_project_map()
        credential = self._get_optional_credential(user_id)

        iterations_config: dict = {}
        if self._storage.exists('config', 'iterations'):
            iterations_config = self._storage.load('config', 'iterations') or {}

        project_overrides = iterations_config.get('project_overrides', {})

        out: List[dict] = []
        seen_paths: set = set()
        # Track (project_name, frozen_roots) combos already fetched to avoid
        # fetching the same iteration tree once per project-map entry when
        # multiple teams share the same ADO project.
        fetched_combos: set = set()

        for project in project_map:
            pid = project.get('id')
            if project_id and pid != project_id:
                continue

            area_path = project.get('area_path', '')
            # Use the explicit project name from iterations_config when available.
            # Iteration nodes are a project-level concept; the first path segment
            # of an area_path may be an area root rather than the project name.
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
                    out.append({
                        'path': path,
                        'name': iter_data.get('name', path.split('\\')[-1] if '\\' in path else path),
                        'startDate': iter_data.get('startDate'),
                        'finishDate': iter_data.get('finishDate'),
                    })
            except Exception as exc:
                logger.warning("Failed to fetch iterations for '%s': %s", project_name, exc)

        # Sort: current/future iterations first, then by startDate
        from datetime import date as _date
        today_str = _date.today().isoformat()

        def _sort_key(it: dict):
            start = it.get('startDate') or ''
            finish = it.get('finishDate') or ''
            is_current_or_future = not finish or finish[:10] >= today_str
            return (not is_current_or_future, start)

        out.sort(key=_sort_key)
        return out

    def refresh(self, project_id: Optional[str] = None, user_id: Optional[str] = None) -> dict:
        """Invalidate cache and force a live re-fetch for a project.

        Returns a summary dict compatible with the old cache-invalidate response.
        """
        credential = self._get_optional_credential(user_id)
        try:
            invalidate_result = self._backend.invalidate_cache()
        except Exception as exc:
            return {'ok': False, 'error': str(exc)}

        # Eagerly re-fill cache if credential available
        if credential:
            try:
                self.read(project_id=project_id, credential=credential)
            except Exception as exc:
                logger.warning("TaskRepository.refresh: re-fetch failed: %s", exc)

        return invalidate_result

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
