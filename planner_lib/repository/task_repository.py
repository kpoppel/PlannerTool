"""TaskRepository: application-layer facade for task read/write operations.

Replaces TaskService and TaskUpdateService.  All I/O goes through the
injected BackendPort.

Public API:

  read(project_id=None, credential=None) -> List[DomainTask]
    Fetch all tasks, optionally filtered to one project.  Uses cached
    values when available; raises BackendAuthError if a live fetch is
    needed and no (valid) credential is available, or BackendUnavailableError
    if the remote backend is unreachable.

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

from planner_lib.backend.errors import BackendAuthError
from planner_lib.backend.port import TaskBackend, BackendCredential
from planner_lib.domain.tasks import BackendTask, DomainTask, WriteResult
from planner_lib.domain.teams import TeamCatalogue
from planner_lib.domain.allocation_availability import project_allocation_availability, validate_allocation_change
from planner_lib.cost.allocation_rule import allocation_conflicts
from planner_lib.storage.base import StorageBackend

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
        """Return the normalized forest, optionally scoped to one importing plan.

        Parameters
        ----------
        project_id:
            When supplied, return tasks reached from the matching configured
            plan after normalizing the combined seed forest.
        credential:
            Optional BackendCredential for cache-miss paths.  When absent and
            the backend needs a live fetch, the backend raises BackendAuthError.

        Notes
        -----
        Source configuration, availability and authentication failures propagate;
        an incomplete forest cannot certify allocation or publication validity.
        """
        tasks = self._fetch_context(credential)
        if project_id is not None:
            tasks = [task for task in tasks if project_id in task['sourcePlanIds']]
        return self._project_tasks(tasks)

    def _fetch_seeds(
        self,
        credential: Optional[BackendCredential],
    ) -> List[BackendTask]:
        """Require every configured source and ignore opaque metadata when merging seeds."""
        items: dict[str, BackendTask] = {}
        for project in self._project_service.get_project_map():
            for task in self._backend.fetch_plan_tasks(plan=project, credential=credential):
                identity = str(task['id'])
                previous = items.get(identity)
                sources = set(task.get('sourcePlanIds', [])) | {project['id']}
                if previous is not None:
                    sources.update(previous['sourcePlanIds'])
                if previous is None or task.get('revision', 0) > previous.get('revision', 0):
                    items[identity] = dict(task)
                elif task.get('revision', 0) == previous.get('revision', 0):
                    comparable = {key: value for key, value in previous.items()
                                  if key not in {'sourcePlanIds', 'backendData'}}
                    incoming = {key: value for key, value in task.items()
                                if key not in {'sourcePlanIds', 'backendData'}}
                    if comparable != incoming:
                        raise ValueError(f'Conflicting task snapshots at the same revision: {identity}')
                items[identity]['sourcePlanIds'] = sorted(sources)
        return list(items.values())

    def _fetch_context(
        self,
        credential: Optional[BackendCredential] = None,
    ) -> List[BackendTask]:
        """Normalize one combined forest before projecting it to consumers."""
        seeds = self._fetch_seeds(credential)
        return self._backend.fetch_task_context(seeds, credential=credential)

    @staticmethod
    def _project_tasks(tasks: List[BackendTask]) -> List[DomainTask]:
        return [{key: value for key, value in task.items() if key != 'backendData'}
                for task in tasks]

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
                task_id = update.get('id')
                if 'backendData' in update:
                    all_errors.append(f'Task {task_id}: backendData is private to the backend')
                    continue
                if task_id is None or task_id == '':
                    all_errors.append(f"Invalid task id: {update!r}")
                    continue
                result: WriteResult = self._backend.write_task(str(task_id), update, credential)
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


class WorkforceTaskRepository(TaskRepository):
    """Canonical publication boundary requiring a complete forest and valid allocation graph."""

    def __init__(
        self, backend: TaskBackend, project_repository, credential_provider,
        *, storage: StorageBackend, task_storage: StorageBackend,
    ) -> None:
        super().__init__(backend, project_repository, credential_provider)
        self._storage = storage
        self._task_storage = task_storage

    def write(self, updates: List[dict], user_id: str) -> Dict[str, Any]:
        """Validate the entire authored batch before issuing the first external mutation."""
        if not updates:
            return {'updated': 0, 'errors': []}
        credential = self._credential_provider.get_credential(user_id)
        if credential is None:
            raise BackendAuthError('No credential available for publication')
        with self._storage.transaction(), self._task_storage.transaction():
            catalogue = TeamCatalogue(self._storage.load('config', 'teams'))
            definitions = catalogue.definitions()
            projects = self._project_service.list_projects()
            defaults = {} if not projects else projects[0]['allocation_defaults']
            originals = {str(task['id']): task for task in self.read(credential=credential)}
            candidate = {identity: dict(task) for identity, task in originals.items()}
            seen: set[str] = set()
            editable = {'id', 'capacity', 'start', 'end', 'state', 'iterationPath', 'tags', 'relations'}
            for update in updates:
                identity = str(update['id'])
                if identity in seen or identity not in originals:
                    raise ValueError(f'Unknown or duplicate publication task: {identity}')
                if set(update) - editable:
                    raise ValueError(f'Unsupported publication fields: {sorted(set(update) - editable)}')
                seen.add(identity)
                original = originals[identity]
                if 'capacity' in update:
                    availability = project_allocation_availability(original, projects, definitions, defaults)
                    validate_allocation_change(availability, update['capacity'])
                candidate[identity].update(update)
                if 'state' in update:
                    owner = next((project for project in projects if project['id'] == original['project']), None)
                    if owner is None or update['state'] not in owner['state_categories']:
                        raise ValueError(f'Unknown publication state: {update["state"]}')
                    candidate[identity]['stateCategory'] = owner['state_categories'][update['state']]
                if 'relations' in update:
                    for relation in update['relations']:
                        if relation['type'] in ('Parent', 'Child') and str(relation['id']) not in candidate:
                            raise ValueError('Cannot publish hierarchy links without loaded context')
            memberships = {
                entry['id']: entry['group_id'] for entry in definitions
                if entry['kind'] == 'team' and entry['group_id'] is not None
            }
            conflicts = allocation_conflicts(list(candidate.values()), memberships)
            if conflicts:
                raise ValueError(f'Allocation conflict: {conflicts}')
            return super().write(updates, user_id)

