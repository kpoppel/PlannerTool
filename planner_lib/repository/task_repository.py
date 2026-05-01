"""TaskRepository: application-layer facade for task read/write operations.

Replaces TaskService and TaskUpdateService.  All I/O goes through the
injected BackendPort.

Public API:

  read(project_id=None, credential=None) -> List[DomainTask]
    Fetch all tasks, optionally filtered to one project.  Uses cached
    values when available; raises PermissionError if a live fetch is
    needed and no credential is available.

  write(updates, user_id) -> WriteResult
    Persist one or more task updates.  Gets a credential from the provider.

  refresh(project_id, user_id) -> dict
    Invalidate the cache and force a live fetch for a project.

Plan markers and sprint iterations are separate domain concerns and live
in PlanRepository and IterationRepository respectively.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from planner_lib.backend.port import TaskBackend, BackendCredential
from planner_lib.domain.tasks import DomainTask, WriteResult

logger = logging.getLogger(__name__)


class TaskRepository:
    """Application-layer repository for work-item (task) data.

    Parameters
    ----------
    backend:
        A BackendPort implementation (live, caching, static, or mock).
    project_repository:
        ProjectRepository — provides ``get_project_map()``.
    credential_provider:
        CredentialProvider — provides ``get_credential(user_id)``.
    """

    def __init__(
        self,
        backend: TaskBackend,
        project_repository,
        credential_provider,
    ) -> None:
        self._backend = backend
        self._project_service = project_repository  # internal alias kept for brevity
        self._credential_provider = credential_provider
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

        Returns ``{'updated': n, 'errors': [...]}``.
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

    def refresh(self, project_id: Optional[str] = None, user_id: Optional[str] = None) -> dict:
        """Invalidate cache and force a live re-fetch for a project.

        Returns a summary dict compatible with the cache-invalidate response.
        """
        credential = self._get_optional_credential(user_id)
        try:
            invalidate_result = self._backend.invalidate_cache()
        except Exception as exc:
            logger.warning("TaskRepository.refresh: cache invalidation failed: %s", exc)
            invalidate_result = {}

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

