"""AzureDevOpsBackend: BackendPort implementation for live Azure DevOps.

This class is the new public surface for all ADO interactions.  It
composes an AzureNativeClient (which owns the SDK connection machinery
and operation classes) and applies AzureAdapter.to_domain() to enrich
raw ADO dicts into DomainTask objects before returning them.

Caching is NOT the responsibility of this class.  Wrap with
CachingBackend for TTL-based cache-first reads.

Authentication model
--------------------
Operations that contact the live ADO API require a BackendCredential.
Pass it via the ``credential`` parameter.  When no credential is
provided and the backend cannot satisfy the request from an internal
cache, PermissionError is raised.  (CachingBackend is responsible for
the cache-hit / no-credential fast path.)
"""
from __future__ import annotations

import hashlib
import logging
import time
from collections import deque
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from threading import Lock
from typing import Any, Dict, List, Optional

from planner_lib.azure.authentication import pat_from_credential
from planner_lib.azure.catalogue import imported_type_index, resolve_plan_process
from planner_lib.backend.port import BackendCredential, BackendPort
from planner_lib.backend.adapter import AzureAdapter, normalize_iteration_path
from planner_lib.backend.errors import (
    BackendAuthError,
    BackendConfigError,
    classify_ado_exception,
)
from planner_lib.domain.tasks import BackendTask, DomainTask, WriteResult
from planner_lib.domain.history import DomainHistoryEntry
from planner_lib.storage.base import StorageBackend
from planner_lib.util import project_id_for_area_path


logger = logging.getLogger(__name__)

def _terminal_date(value: Any) -> Optional[date]:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str) and value:
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


class AzureDevOpsBackend(BackendPort):
    """Live Azure DevOps backend implementing BackendPort.

    Parameters
    ----------
    organization_url:
        Azure DevOps organisation slug (e.g. ``'MyOrg'``).
    storage:
        Disk-cache StorageBackend used by the underlying client for
        plan/team caching (lightweight in-memory caches on the client).
    team_service:
        TeamServiceProtocol — required for allocation-token → team-ID mapping
        in AzureAdapter.to_domain().
    capacity_service:
        CapacityServiceProtocol — parses capacity allocation from item
        descriptions.
    """

    # AzureDevOpsBackend is the default; it has no dedicated feature flag.
    FEATURE_FLAG = None

    # Live ADO is the only backend subject to transient API outages and PAT
    # expiry.  CachingBackend reads this flag to scope its stale-on-failure
    # resilience to the remote backend only — local/static/mock backends never
    # face these conditions, so their reads pass through unchanged.
    is_remote = True

    @classmethod
    def config_schema(cls) -> Dict[str, Any]:
        """Return empty dict — AzureDevOpsBackend is the implicit default backend.

    # All other feature_flags properties (enable_cache, etc.) live in the
        non-backend portion of the system schema.
        """
        return {}

    @classmethod
    def build_from_flags(cls, feature_flags: Dict[str, Any], **services: Any) -> 'AzureDevOpsBackend':
        """Construct an AzureDevOpsBackend from injected services."""
        return cls(
            organization_url=services.get('org_url', ''),
            storage=services['storage'],
            local_backend=services.get('config_backend'),
            team_repository=services.get('team_repository'),
            capacity_service=services.get('capacity_service'),
        )

    def __init__(
        self,
        organization_url: str,
        storage: StorageBackend,
        team_repository,
        capacity_service,
        local_backend=None,
    ) -> None:
        from planner_lib.azure.AzureClient import AzureClient
        self._organization_url = organization_url
        # _conn provides connect(credential) and all Azure operation classes
        self._conn = AzureClient(organization_url, storage=storage)
        self._adapter = AzureAdapter()
        self._team_repository = team_repository
        self._capacity_service = capacity_service
        self._storage = storage
        self._config = local_backend
        self._diagnostics = []
        self._diagnostics_lock = Lock()
        logger.info(
            "AzureDevOpsBackend: initialised (org_url=%r, team_repository=%s, capacity_service=%s)",
            organization_url,
            type(team_repository).__name__ if team_repository is not None else 'None',
            type(capacity_service).__name__ if capacity_service is not None else 'None',
        )

    def reload(self) -> None:
        """Rebuild the backend in place from the current ADO config."""
        try:
            ado_cfg = self._config.fetch_ado_config() if self._config is not None else {}
        except Exception:
            ado_cfg = {}
        from planner_lib.backend.registry import rebuild_backend_instance
        rebuild_backend_instance(
            self,
            ado_cfg.get('feature_flags') or {},
            org_url=ado_cfg.get('organization_url') or self._organization_url,
            storage=self._storage,
            config_backend=self._config,
            team_repository=self._team_repository,
            capacity_service=self._capacity_service,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def consume_diagnostics(self, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
        with self._diagnostics_lock:
            if user_id is None:
                diagnostics = list(self._diagnostics)
                self._diagnostics.clear()
                return diagnostics
            diagnostics = [entry for entry in self._diagnostics if entry['user_id'] == user_id]
            self._diagnostics = [entry for entry in self._diagnostics if entry['user_id'] != user_id]
            return diagnostics

    def _require_credential(
        self,
        credential: Optional[BackendCredential],
        op: str,
    ) -> BackendCredential:
        """Validate and retain the operation credential or raise BackendAuthError."""
        if credential is None:
            raise BackendAuthError(
                f"AzureDevOpsBackend.{op} requires a credential; "
                "none was provided and there is no cache to serve from."
            )
        try:
            pat_from_credential(credential)
        except ValueError as error:
            raise BackendAuthError(
                f"BackendCredential for {op} is invalid: {error}"
            ) from error
        return credential

    def _build_type_canonical(self) -> Dict[str, str]:
        """Return exact catalogue casing for imported work item types."""
        catalogue = self._storage.load('config', 'ado_processes')
        return {item['name'].casefold(): item['name'] for process in catalogue['processes']
                for item in process['types'] if item['imported']}

    def _build_iteration_map(
        self,
        client,
        area_path: str,
        azure_project: str,
    ) -> Dict[str, Any]:
        """Resolve assigned schedules from the work item's native ADO project."""
        iteration_map: Dict[str, Any] = {}
        for iteration in client.get_iterations(azure_project):
            path = normalize_iteration_path(iteration['path'])
            iteration_map[path] = {
                'startDate': iteration.get('startDate'),
                'finishDate': iteration.get('finishDate'),
                'name': iteration.get('name'),
            }
        return iteration_map

    @staticmethod
    def _strip_iteration_segment(path: str) -> str:
        """Return the project-qualified work-item form of a classification path."""
        return normalize_iteration_path(path)

    # ------------------------------------------------------------------
    # BackendPort: fetch_tasks
    # ------------------------------------------------------------------

    def fetch_plan_tasks(
        self,
        plan: Dict[str, Any],
        credential: Optional[BackendCredential] = None,
    ) -> List[BackendTask]:
        """Run this plan's exact-area seed query and associate its seed items."""
        tasks = self.fetch_tasks(
            area_path=plan['area_path'],
            task_types=plan['task_types'],
            closed_history_days=plan['closed_history_days'],
            project_id=plan['id'],
            credential=credential,
        )
        return [{**task, 'project': plan['id'], 'sourcePlanIds': [plan['id']]} for task in tasks]

    def fetch_task_context(
        self,
        seeds: List[BackendTask],
        credential: Optional[BackendCredential] = None,
    ) -> List[BackendTask]:
        """Expand one seed forest while retaining backend-owned source identity."""
        if not seeds:
            return []
        credential = self._require_credential(credential, 'fetch_task_context')
        assert credential is not None
        plans = self._config.fetch_project_map()
        plans_by_id = {plan['id']: plan for plan in plans}
        owners = {}
        for plan in plans:
            area_key = plan['area_path'].strip('/\\').replace('/', '\\').casefold()
            if area_key in owners and owners[area_key] != plan['id']:
                raise BackendConfigError(f"Ambiguous source owner for area {plan['area_path']}")
            owners[area_key] = plan['id']
        seed_by_id = {}
        raw_seeds = []
        for seed in seeds:
            task_id = str(seed['id'])
            previous = seed_by_id.get(task_id)
            if previous is None or seed['revision'] > previous['revision']:
                seed_by_id[task_id] = seed
        for seed in seed_by_id.values():
            metadata = seed['backendData']
            raw_seeds.append({
                **seed, 'adoProject': metadata['adoProject'],
                'rev': metadata['rev'], 'type': metadata['type'],
            })
        catalogue = self._storage.load('config', 'ado_processes')
        eligible = imported_type_index(catalogue)
        tasks = {}
        iteration_maps = {}
        removed_ids = set()
        schedule_issues = {}
        try:
            with self._conn.connect(credential) as client:
                def iteration_map_for(area, ado_project):
                    key = ado_project
                    if key not in iteration_maps:
                        iteration_maps[key] = self._build_iteration_map(client, area, ado_project)
                    return iteration_maps[key]

                raw_items = client.get_linked_work_items(raw_seeds, catalogue=catalogue)
                for raw in raw_items:
                    task_id = str(raw['id'])
                    area = raw['areaPath']
                    ado_project = raw['adoProject']
                    identity = (ado_project.casefold(), raw['type'].casefold())
                    if identity not in eligible:
                        removed_ids.add(task_id)
                        continue
                    process, item_type = eligible[identity]
                    categories = {state['name']: state['category'] for state in item_type['states']}
                    if categories[raw['state']] == 'Removed':
                        removed_ids.add(task_id)
                        continue
                    area_key = area.strip('/\\').replace('/', '\\').casefold()
                    owner = owners.get(area_key)
                    if owner is None:
                        identity = f'{self._organization_url}|{area_key}'
                        owner = 'context-' + hashlib.sha256(identity.encode()).hexdigest()[:20]
                    if task_id in seed_by_id:
                        task = dict(seed_by_id[task_id])
                        if task.get('iterationPath') and (
                            not task.get('start') or not task.get('end')
                            or task.get('_inferred_start', False) or task.get('_inferred_end', False)
                        ):
                            iteration_map = iteration_map_for(area, raw['adoProject'])
                            iteration_path = task.get('iterationPath')
                            iteration = iteration_map.get(
                                normalize_iteration_path(iteration_path) if iteration_path else None
                            )
                            for field, date_field, inferred in (
                                ('start', 'startDate', '_inferred_start'),
                                ('end', 'finishDate', '_inferred_end'),
                            ):
                                if not task.get(field) or task.get(inferred, False):
                                    task[field] = None if iteration is None else iteration.get(date_field)
                                    task[inferred] = task[field] is not None
                    else:
                        task = self._adapter.to_domain(
                            raw_wi=raw,
                            project_id=owner,
                            team_repository=self._team_repository,
                            type_canonical={item_type['name'].lower(): item_type['name']},
                            iteration_map=iteration_map_for(area, raw['adoProject']),
                            capacity_service=self._capacity_service,
                        )
                    task['project'] = owner
                    task['type'] = item_type['name']
                    task['process_id'] = process['id']
                    task['stateCategory'] = categories[raw['state']]
                    task['sourcePlanName'] = area.strip('/\\').replace('/', '\\').rsplit('\\', 1)[-1]
                    task['excludedChildIds'] = raw['excludedChildIds']
                    task['unresolvedChildIds'] = raw['unresolvedChildIds']
                    task['traversalBoundary'] = raw['traversalBoundary']
                    for field in ('ancestorOnly', 'childrenComplete', 'unresolvedParentIds'):
                        if field in raw:
                            task[field] = raw[field]
                    iteration_path = task.get('iterationPath')
                    if iteration_path and '\\' in iteration_path and (
                        not task.get('start') or not task.get('end')
                    ):
                        iteration = iteration_map_for(area, ado_project).get(
                            normalize_iteration_path(iteration_path)
                        )
                        code = 'schedule_metadata_missing' if iteration is None else 'schedule_dates_missing'
                        key = (ado_project, code)
                        schedule_issues[key] = schedule_issues.get(key, 0) + 1
                    if task.get('start') and not task.get('end'):
                        task['end'] = task['start']
                        task['_inferred_end'] = True
                    elif task.get('end') and not task.get('start'):
                        task['start'] = task['end']
                        task['_inferred_start'] = True
                    task['sourcePlanIds'] = []
                    tasks[task_id] = task
        except Exception as exc:
            raise classify_ado_exception(exc) from exc

        for task in tasks.values():
            task['excludedChildIds'] = sorted(set(task['excludedChildIds']) | {
                str(relation['id']) for relation in task['relations']
                if relation['type'] == 'Child' and str(relation['id']) in removed_ids
            })
        adjacency = {task_id: set() for task_id in tasks}
        for parent_id, task in tasks.items():
            if task['traversalBoundary']:
                continue
            for relation in task['relations']:
                child_id = str(relation['id'])
                if (relation['type'] == 'Child' and child_id in tasks
                        and child_id not in task['excludedChildIds']
                        and not tasks[child_id]['traversalBoundary']):
                    adjacency[parent_id].add(child_id)
                    adjacency[child_id].add(parent_id)

        expired_ids = set()
        visited = set()
        for task_id in tasks:
            if task_id in visited:
                continue
            component = set()
            pending_component = [task_id]
            while pending_component:
                member_id = pending_component.pop()
                if member_id in visited:
                    continue
                visited.add(member_id)
                component.add(member_id)
                pending_component.extend(adjacency[member_id] - visited)
            descendants = [
                member_id for member_id in component
                if not tasks[member_id].get('ancestorOnly', False)
            ]
            if any(tasks[member_id]['stateCategory'] != 'Completed' for member_id in descendants):
                continue
            source_ids = {plan_id for seed in seeds if str(seed['id']) in component
                          for plan_id in seed['sourcePlanIds']}
            window = max((plans_by_id[plan_id]['closed_history_days'] for plan_id in source_ids),
                         default=0)
            cutoff = datetime.now(timezone.utc).date() - timedelta(days=window)
            dates = [_terminal_date(tasks[member_id]['backendData'].get('stateChangeDate'))
                     for member_id in component]
            if window == 0 or not any(value is not None and value >= cutoff for value in dates):
                expired_ids.update(component)
        for task in tasks.values():
            task['excludedChildIds'] = sorted(set(task['excludedChildIds']) | {
                str(relation['id']) for relation in task['relations']
                if relation['type'] == 'Child' and str(relation['id']) in expired_ids
            })
        for task_id in expired_ids:
            del tasks[task_id]

        pending = deque(
            (str(seed['id']), plan_id)
            for seed in seeds for plan_id in seed['sourcePlanIds']
            if str(seed['id']) in tasks
        )
        while pending:
            task_id, plan_id = pending.popleft()
            task = tasks[task_id]
            if plan_id in task['sourcePlanIds']:
                continue
            task['sourcePlanIds'].append(plan_id)
            if task['traversalBoundary']:
                continue
            for relation in task['relations']:
                child_id = str(relation['id'])
                if (relation['type'] == 'Child' and child_id in tasks
                        and child_id not in task['excludedChildIds']
                        and not tasks[child_id]['traversalBoundary']):
                    pending.append((child_id, plan_id))
        for task in tasks.values():
            task['sourcePlanIds'].sort()
            task['presentationPlanIds'] = []
            if task.get('ancestorOnly', False):
                continue
            for plan_id in sorted(set(task['sourcePlanIds']) | {task['project']}):
                if plan_id not in plans_by_id:
                    continue
                task['presentationPlanIds'].append(plan_id)
        for task in tasks.values():
            ado_project = task.get('backendData', {}).get('adoProject')
            iteration_path = task.get('iterationPath')
            has_iteration = iteration_path is not None and (
                normalize_iteration_path(iteration_path).casefold() != str(ado_project).casefold()
            )
            if (task['stateCategory'] != 'Completed'
                    or task.get('start') or task.get('end') or has_iteration):
                continue
            anchor_date = _terminal_date(task.get('backendData', {}).get('stateChangeDate'))
            if anchor_date is not None:
                task['presentation'] = {
                    'renderType': 'anchor',
                    'date': anchor_date.isoformat(),
                    'reason': 'completed-unscheduled',
                    'sourceState': task['state'],
                }
        diagnostics = []
        for (ado_project, code), count in sorted(schedule_issues.items()):
            missing = code == 'schedule_metadata_missing'
            reason = 'could not be found' if missing else 'have missing date boundaries'
            item_label = 'item' if count == 1 else 'items'
            diagnostics.append({
                'code': code,
                'severity': 'warning' if missing else 'info',
                'message': f'{count} {item_label} in {ado_project} have assigned schedules that {reason}. '
                           'Unavailable start/end dates remain unset.',
                'user_id': credential['user_id'],
                'ts': time.time(),
            })
        with self._diagnostics_lock:
            self._diagnostics = (self._diagnostics + diagnostics)[-100:]
        return list(tasks.values())

    def fetch_tasks(
        self,
        area_path: str,
        task_types: Optional[List[str]] = None,
        closed_history_days: int = 0,
        credential: Optional[BackendCredential] = None,
        project_id: Optional[str] = None,
        **kwargs,
    ) -> List[DomainTask]:
        """Fetch and enrich work items for one *area_path*.

        Contacts the live ADO API for the requested states in a single pass.
        This is seed retrieval only; whole-forest hierarchy normalization is
        handled separately by this backend's fetch_task_context operation.
        Wrap with CachingBackend to add a TTL cache in front.
        """
        credential = self._require_credential(credential, 'fetch_tasks')
        catalogue = self._storage.load('config', 'ado_processes')
        process = resolve_plan_process({
            'name': area_path, 'area_path': area_path, 'task_types': task_types,
        }, catalogue)
        type_canonical = {item['name'].lower(): item['name']
                          for item in process['types'] if item['imported']}
        if project_id is None:
            if self._config is None:
                raise BackendConfigError(
                    f'No configured project owns area {area_path}',
                    failed_path=area_path,
                )
            project_id = project_id_for_area_path(area_path, self._config.fetch_project_map())
            if project_id is None:
                raise BackendConfigError(
                    f'No unique configured project owns area {area_path}',
                    failed_path=area_path,
                )

        azure_project = (
            area_path.split('\\')[0] if '\\' in area_path
            else (area_path.split('/')[0] if '/' in area_path else area_path)
        )

        # Translate any failure contacting ADO into the backend's typed error
        # vocabulary so the caching layer can react by type (auth vs outage)
        # without inspecting exception strings.
        try:
            with self._conn.connect(credential) as client:
                iteration_map = self._build_iteration_map(
                    client,
                    area_path,
                    azure_project,
                )
                raw_items = client.get_work_items(
                    area_path,
                    task_types=task_types,
                    catalogue=catalogue,
                    closed_history_days=closed_history_days,
                )
        except Exception as exc:
            error = classify_ado_exception(exc)
            if isinstance(error, BackendConfigError):
                error.failed_path = area_path
            raise error from exc

        results: List[DomainTask] = []
        for raw_wi in (raw_items or []):
            task = self._adapter.to_domain(
                raw_wi=raw_wi,
                project_id=project_id,
                team_repository=self._team_repository,
                type_canonical=type_canonical,
                iteration_map=iteration_map,
                capacity_service=self._capacity_service,
            )
            task['process_id'] = process['id']
            results.append(task)
        return results

    # ------------------------------------------------------------------
    # BackendPort: write_task
    # ------------------------------------------------------------------

    def write_task(
        self,
        task_id: int | str,
        updates: Dict[str, Any],
        credential: BackendCredential,
    ) -> WriteResult:
        """Persist *updates* for *task_id* to ADO."""
        credential = self._require_credential(credential, 'write_task')
        task_id = int(task_id)

        errors: List[str] = []
        item_updated = False

        with self._conn.connect(credential) as client:
            # Dates ─────────────────────────────────────────────────────
            if self._adapter.has_date_update(updates):
                try:
                    date_kwargs = self._adapter.extract_date_kwargs(updates)
                    client.update_work_item_dates(task_id, **date_kwargs)
                    item_updated = True
                except Exception as exc:
                    errors.append(f"{task_id} (dates): {exc}")

            # Capacity ──────────────────────────────────────────────────
            if self._adapter.has_capacity_update(updates):
                try:
                    current_desc = client.get_work_item_description(task_id)
                    new_desc = self._capacity_service.update_description(
                        current_desc, updates['capacity'], None
                    )
                    client.update_work_item_description(task_id, new_desc)
                    item_updated = True
                except Exception as exc:
                    errors.append(f"{task_id} (capacity): {exc}")

            # State ─────────────────────────────────────────────────────
            if self._adapter.has_state_update(updates):
                try:
                    client.update_work_item_state(task_id, updates['state'])
                    item_updated = True
                except Exception as exc:
                    errors.append(f"{task_id} (state): {exc}")

            # Relations ─────────────────────────────────────────────────
            if self._adapter.has_relations_update(updates):
                try:
                    client.update_work_item_relations(task_id, updates['relations'])
                    item_updated = True
                except Exception as exc:
                    errors.append(f"{task_id} (relations): {exc}")

            # Iteration path ────────────────────────────────────────────
            if self._adapter.has_iteration_update(updates):
                try:
                    client.update_work_item_iteration_path(task_id, updates['iterationPath'])
                    item_updated = True
                except Exception as exc:
                    errors.append(f"{task_id} (iterationPath): {exc}")

            # Tags ─────────────────────────────────────────────────────
            if self._adapter.has_tags_update(updates):
                try:
                    client.update_work_item_tags(task_id, updates.get('tags'))
                    item_updated = True
                except Exception as exc:
                    errors.append(f"{task_id} (tags): {exc}")

        return WriteResult(
            ok=len(errors) == 0,
            updated=1 if item_updated else 0,
            errors=errors,
        )

    # ------------------------------------------------------------------
    # BackendPort: fetch_history
    # ------------------------------------------------------------------

    def fetch_history(
        self,
        work_item_id: int,
        credential: Optional[BackendCredential] = None,
    ) -> List[DomainHistoryEntry]:
        """Fetch raw revision history for *work_item_id* and return as DomainHistoryEntry list."""
        credential = self._require_credential(credential, 'fetch_history')
        with self._conn.connect(credential) as client:
            revisions = client.get_task_revision_history(
                work_item_id=work_item_id,
                start_field='Microsoft.VSTS.Scheduling.StartDate',
                end_field='Microsoft.VSTS.Scheduling.TargetDate',
                iteration_field='System.IterationPath',
            )
        entries: List[DomainHistoryEntry] = []
        for rev in revisions:
            changed_at = rev.get('changed_at', '')
            changed_by = rev.get('changed_by', '')
            for change in rev.get('changes', []):
                entries.append(
                    DomainHistoryEntry(
                        field=change.get('field', ''),
                        value=change.get('new_value'),
                        changed_at=changed_at,
                        changed_by=changed_by,
                    )
                )
        return entries

    # ------------------------------------------------------------------
    # BackendPort: fetch_teams / fetch_plans / fetch_markers / fetch_iterations
    # ------------------------------------------------------------------

    def fetch_teams(
        self,
        project: str,
        credential: Optional[BackendCredential] = None,
    ) -> List[Dict[str, Any]]:
        credential = self._require_credential(credential, 'fetch_teams')
        with self._conn.connect(credential) as client:
            return client.get_all_teams(project)

    def fetch_plans(
        self,
        project: str,
        credential: Optional[BackendCredential] = None,
    ) -> List[Dict[str, Any]]:
        credential = self._require_credential(credential, 'fetch_plans')
        with self._conn.connect(credential) as client:
            return client.get_all_plans(project)

    def fetch_markers(
        self,
        area_path: str,
        plan_id: Optional[str] = None,
        credential: Optional[BackendCredential] = None,
    ) -> List[Dict[str, Any]]:
        credential = self._require_credential(credential, 'fetch_markers')
        with self._conn.connect(credential) as client:
            if plan_id:
                # Fast path: plan_id is known (from area_plan_map) — fetch directly
                # without expensive plan-discovery + delivery-timeline traversal.
                project = area_path.split('\\')[0] if '\\' in area_path else area_path.split('/')[0]
                return client.get_markers_for_plan(project, plan_id)
            # Slow fallback: discover plans from area path (admin UI / unknown plan_id).
            return client.get_markers(area_path)

    def fetch_iterations(
        self,
        project: str,
        root_paths: Optional[List[str]] = None,
        credential: Optional[BackendCredential] = None,
    ) -> Dict[str, Any]:
        credential = self._require_credential(credential, 'fetch_iterations')
        with self._conn.connect(credential) as client:
            iteration_map: Dict[str, Any] = {}
            for raw_root in (root_paths or [None]):
                try:
                    for it in client.get_iterations(project, root_path=raw_root):
                        raw_path = it.get('path', '')
                        norm = self._strip_iteration_segment(raw_path)
                        if norm:
                            iteration_map[norm] = {
                                'startDate': it.get('startDate'),
                                'finishDate': it.get('finishDate'),
                                'name': it.get('name'),
                            }
                except Exception as exc:
                    logger.warning("Failed to fetch iterations for root '%s': %s", raw_root, exc)
            return iteration_map

    # ------------------------------------------------------------------
    # BackendPort: fetch_projects
    # ------------------------------------------------------------------

    def fetch_projects(
        self,
        credential: Optional[BackendCredential] = None,
    ) -> List[Any]:
        """Return configured projects with catalogue-owned display metadata."""
        if self._config is None:
            return []
        
        return self._config.fetch_projects()

    def fetch_project_map(
        self,
        credential: Optional[BackendCredential] = None,
    ) -> List[dict]:
        """Return raw project entries including area_path and other backend fields.

        Delegates to the local config backend.
        """
        if self._config is None:
            return []
        return self._config.fetch_project_map()

    # ------------------------------------------------------------------
    # BackendPort: invalidate_cache
    # ------------------------------------------------------------------

    def invalidate_cache(self) -> Dict[str, Any]:
        """No-op: AzureDevOpsBackend has no internal cache."""
        return {'ok': True, 'invalidated': [], 'errors': []}
