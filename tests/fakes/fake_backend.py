"""FakeBackend and FakeCredentialProvider: in-process test doubles.

Use these in unit tests that need a BackendPort without touching real
Azure DevOps or the disk cache.

Example::

    from tests.fakes.fake_backend import FakeBackend, FakeCredentialProvider

    backend = FakeBackend()
    backend.set_tasks('MyProject\\\\TeamA', [
        {'id': '1', 'title': 'Feature 1', 'type': 'Feature', ...},
    ])

    cred_provider = FakeCredentialProvider('user@example.com', 'fake-pat')

    repo = TaskRepository(
        backend=backend,
        project_service=...,
        credential_provider=cred_provider,
    )
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from planner_lib.backend.port import BackendCredential, BackendPort
from planner_lib.domain.tasks import DomainTask, WriteResult
from planner_lib.domain.history import DomainHistoryEntry


class FakeBackend(BackendPort):
    """In-memory BackendPort double for unit tests.

    Stores task lists per ``area_path`` in a plain dict.  All method calls
    are recorded so tests can assert on interactions.

    Parameters
    ----------
    tasks_by_area:
        Optional initial mapping of ``area_path -> List[DomainTask]``.
    raise_on_write:
        When True, ``write_task()`` raises RuntimeError (to test error paths).
    """

    def __init__(
        self,
        tasks_by_area: Optional[Dict[str, List[DomainTask]]] = None,
        raise_on_write: bool = False,
    ) -> None:
        self._tasks: Dict[str, List[DomainTask]] = dict(tasks_by_area or {})
        self._history: Dict[int, List[DomainHistoryEntry]] = {}
        self._teams: Dict[str, List[dict]] = {}
        self._plans: Dict[str, List[dict]] = {}
        self._iterations: Dict[str, Dict[str, Any]] = {}
        self._people: list = []
        self._raise_on_write = raise_on_write

        # Interaction records
        self.fetch_tasks_calls: List[dict] = []
        self.write_task_calls: List[dict] = []
        self.fetch_history_calls: List[dict] = []
        self.invalidate_cache_calls: int = 0

    # ------------------------------------------------------------------
    # Setup helpers (for test authors)
    # ------------------------------------------------------------------

    def set_tasks(self, area_path: str, tasks: List[DomainTask]) -> None:
        """Register task list for an area_path."""
        self._tasks[area_path] = list(tasks)

    def set_history(self, work_item_id: int, entries: List[DomainHistoryEntry]) -> None:
        self._history[work_item_id] = list(entries)

    def set_teams(self, project: str, teams: List[dict]) -> None:
        self._teams[project] = list(teams)

    def set_plans(self, project: str, plans: List[dict]) -> None:
        self._plans[project] = list(plans)

    def set_iterations(self, project: str, iters: Dict[str, Any]) -> None:
        self._iterations[project] = dict(iters)

    # ------------------------------------------------------------------
    # BackendPort implementation
    # ------------------------------------------------------------------

    def fetch_tasks(
        self,
        area_path: str,
        task_types: Optional[List[str]] = None,
        include_states: Optional[List[str]] = None,
        credential: Optional[BackendCredential] = None,
        **kwargs,
    ) -> List[DomainTask]:
        self.fetch_tasks_calls.append({
            'area_path': area_path,
            'task_types': task_types,
            'include_states': include_states,
            'credential': credential,
            'kwargs': kwargs,
        })
        items = list(self._tasks.get(area_path, []))
        if task_types:
            types_lower = {t.lower() for t in task_types}
            items = [t for t in items if (t.get('type') or '').lower() in types_lower]
        if include_states:
            states_lower = {s.lower() for s in include_states}
            items = [t for t in items if (t.get('state') or '').lower() in states_lower]
        return items

    def write_task(
        self,
        task_id: int,
        updates: Dict[str, Any],
        credential: BackendCredential,
    ) -> WriteResult:
        self.write_task_calls.append({'task_id': task_id, 'updates': updates})
        if self._raise_on_write:
            raise RuntimeError(f"FakeBackend: write_task raise_on_write=True for task {task_id}")
        # Apply updates in-memory
        for area_items in self._tasks.values():
            for item in area_items:
                if str(item.get('id')) == str(task_id):
                    item.update({k: v for k, v in updates.items() if k != 'id'})
                    return WriteResult(ok=True, updated=1, errors=[])
        return WriteResult(ok=False, updated=0, errors=[f'task {task_id} not found'])

    def fetch_history(
        self,
        work_item_id: int,
        start_field: str = 'Microsoft.VSTS.Scheduling.StartDate',
        end_field: str = 'Microsoft.VSTS.Scheduling.TargetDate',
        iteration_field: str = 'System.IterationPath',
        credential: Optional[BackendCredential] = None,
    ) -> List[DomainHistoryEntry]:
        self.fetch_history_calls.append({'work_item_id': work_item_id})
        return list(self._history.get(work_item_id, []))

    def fetch_teams(
        self, project: str, credential: Optional[BackendCredential] = None
    ) -> List[Dict[str, Any]]:
        return list(self._teams.get(project, []))

    def fetch_plans(
        self, project: str, credential: Optional[BackendCredential] = None
    ) -> List[Dict[str, Any]]:
        return list(self._plans.get(project, []))

    def fetch_markers(
        self, area_path: str, credential: Optional[BackendCredential] = None
    ) -> List[Dict[str, Any]]:
        return []

    def fetch_iterations(
        self,
        project: str,
        root_paths: Optional[List[str]] = None,
        credential: Optional[BackendCredential] = None,
    ) -> Dict[str, Any]:
        return dict(self._iterations.get(project, {}))

    def invalidate_cache(self) -> Dict[str, Any]:
        self.invalidate_cache_calls += 1
        return {'ok': True, 'invalidated': [], 'errors': []}

    def fetch_people(self, credential=None):
        return list(self._people)

    def set_people(self, people: list) -> None:
        self._people = list(people)


class FakeCredentialProvider:
    """Credential provider that always returns a fixed BackendCredential.

    Parameters
    ----------
    user_id:
        The user_id / email this provider is authoritative for.
    token:
        The PAT token to return.
    extra_users:
        Optional mapping of ``user_id -> BackendCredential`` for multi-user tests.
    """

    def __init__(
        self,
        user_id: str = 'test@example.com',
        token: str = 'fake-pat',
        extra_users: Optional[Dict[str, BackendCredential]] = None,
    ) -> None:
        self._default = BackendCredential(token=token, user_id=user_id)
        self._users: Dict[str, BackendCredential] = {user_id: self._default}
        if extra_users:
            self._users.update(extra_users)

    def get_credential(self, user_id: str) -> Optional[BackendCredential]:
        return self._users.get(user_id)
