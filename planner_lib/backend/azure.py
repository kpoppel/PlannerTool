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

import logging
from contextlib import contextmanager
from typing import Any, Dict, List, Optional

from planner_lib.backend.port import BackendCredential, BackendPort
from planner_lib.backend.adapter import AzureAdapter
from planner_lib.domain.tasks import DomainTask, WriteResult
from planner_lib.domain.history import DomainHistoryEntry
from planner_lib.storage.base import StorageBackend


logger = logging.getLogger(__name__)


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
        TeamServiceProtocol — required for team-name → team-ID mapping
        in AzureAdapter.to_domain().
    capacity_service:
        CapacityServiceProtocol — parses capacity allocation from item
        descriptions.
    """

    # AzureDevOpsBackend is the default; it has no dedicated feature flag.
    FEATURE_FLAG = None

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
        # _conn provides connect(pat) context manager and all operation classes
        self._conn = AzureClient(organization_url, storage=storage)
        self._adapter = AzureAdapter()
        self._team_repository = team_repository
        self._capacity_service = capacity_service
        self._storage = storage
        self._config = local_backend
        logger.info(
            "AzureDevOpsBackend: initialised (org_url=%r, team_repository=%s, capacity_service=%s)",
            organization_url,
            type(team_repository).__name__ if team_repository is not None else 'None',
            type(capacity_service).__name__ if capacity_service is not None else 'None',
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _require_credential(self, credential: Optional[BackendCredential], op: str) -> str:
        """Extract the token from *credential* or raise PermissionError."""
        if credential is None:
            raise PermissionError(
                f"AzureDevOpsBackend.{op} requires a credential; "
                "none was provided and there is no cache to serve from."
            )
        token = credential.get('token')
        if not token:
            raise PermissionError(f"BackendCredential for {op} has an empty token.")
        return token

    def _build_type_canonical(self) -> Dict[str, str]:
        """Build a lowercased-type \u2192 canonical-type map from project task_type_hierarchy."""
        type_canonical: Dict[str, str] = {}
        try:
            if self._config is not None:
                projects = self._config.fetch_projects()
                # All projects share the same global hierarchy; take from first result
                hierarchy = (projects[0].get('task_type_hierarchy') or []) if projects else []
            else:
                gs = self._storage.load('config', 'global_settings')
                hierarchy = (gs.get('task_type_hierarchy', []) if isinstance(gs, dict) else [])
            for level in hierarchy:
                for t in (level.get('types') or []):
                    type_canonical[str(t).lower()] = t
        except Exception:
            pass
        return type_canonical

    def _build_iteration_map(self, client, azure_project: str) -> Dict[str, Any]:
        """Fetch and return a normalised iteration-path → dates map."""
        try:
            if self._config is not None:
                iterations_config = self._config.fetch_iterations_config()
            else:
                iterations_config = (self._storage.load('config', 'iterations')
                                     if self._storage.exists('config', 'iterations') else {})
            project_overrides = (iterations_config or {}).get('project_overrides', {})
            raw_roots = project_overrides.get(
                azure_project, iterations_config.get('default_roots', [])
            )
            # Azure DevOps expects "<Project>\Iteration\<sub-path>".
            # The yml stores only the sub-path, so prepend the full prefix.
            root_paths = [f"{azure_project}\\Iteration\\{r}" for r in raw_roots] if raw_roots else []
            iteration_map: Dict[str, Any] = {}
            for root in (root_paths or [None]):
                try:
                    iterations = client.get_iterations(azure_project, root_path=root)
                    for it in iterations:
                        raw_path = it.get('path', '')
                        norm_path = self._strip_iteration_segment(raw_path)
                        if norm_path:
                            iteration_map[norm_path] = {
                                'startDate': it.get('startDate'),
                                'finishDate': it.get('finishDate'),
                                'name': it.get('name'),
                            }
                except Exception as exc:
                    logger.warning("Failed to fetch iterations for root '%s': %s", root, exc)
            return iteration_map
        except Exception as exc:
            logger.warning("Error building iteration map for '%s': %s", azure_project, exc)
            return {}

    @staticmethod
    def _strip_iteration_segment(path: str) -> str:
        """Remove leading 'Iteration' / 'Iterations' segment from an ADO path."""
        import re
        return re.sub(r'^[^\\]+\\Iterations?\\?', '', path)

    # ------------------------------------------------------------------
    # BackendPort: fetch_tasks
    # ------------------------------------------------------------------

    def fetch_tasks(
        self,
        area_path: str,
        task_types: Optional[List[str]] = None,
        include_states: Optional[List[str]] = None,
        credential: Optional[BackendCredential] = None,
        **kwargs,
    ) -> List[DomainTask]:
        """Fetch and enrich work items for one *area_path*.

        Contacts the live ADO API for the requested states in a single pass.
        The completed-task ancestor filter is the responsibility of the caller
        (TaskRepository); this method does not split or double-fetch.
        Wrap with CachingBackend to add a TTL cache in front.
        """
        pat = self._require_credential(credential, 'fetch_tasks')
        type_canonical = self._build_type_canonical()
        # Derive the project slug from the area_path (first path segment, slugified)
        from planner_lib.util import slugify
        project_slug = slugify(
            area_path.split('\\')[0] if '\\' in area_path else
            area_path.split('/')[0] if '/' in area_path else area_path,
            prefix='project-',
        )

        azure_project = (
            area_path.split('\\')[0] if '\\' in area_path
            else (area_path.split('/')[0] if '/' in area_path else area_path)
        )

        with self._conn.connect(pat) as client:
            iteration_map = self._build_iteration_map(client, azure_project)
            raw_items = client.get_work_items(
                area_path,
                task_types=task_types,
                include_states=include_states,
            )

            results: List[DomainTask] = []
            for raw_wi in (raw_items or []):
                try:
                    task = self._adapter.to_domain(
                        raw_wi=raw_wi,
                        project_slug=project_slug,
                        team_repository=self._team_repository,
                        type_canonical=type_canonical,
                        iteration_map=iteration_map,
                        capacity_service=self._capacity_service,
                    )
                    results.append(task)
                except Exception as exc:
                    logger.warning(
                        "Failed to enrich work item %s: %s",
                        raw_wi.get('id', '?'), exc,
                    )
            return results

    # ------------------------------------------------------------------
    # BackendPort: write_task
    # ------------------------------------------------------------------

    def write_task(
        self,
        task_id: int,
        updates: Dict[str, Any],
        credential: BackendCredential,
    ) -> WriteResult:
        """Persist *updates* for *task_id* to ADO."""
        pat = self._require_credential(credential, 'write_task')

        errors: List[str] = []
        item_updated = False

        with self._conn.connect(pat) as client:
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
                        current_desc, updates['capacity'], cfg
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
        pat = self._require_credential(credential, 'fetch_history')
        with self._conn.connect(pat) as client:
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
        pat = self._require_credential(credential, 'fetch_teams')
        with self._conn.connect(pat) as client:
            return client.get_all_teams(project)

    def fetch_plans(
        self,
        project: str,
        credential: Optional[BackendCredential] = None,
    ) -> List[Dict[str, Any]]:
        pat = self._require_credential(credential, 'fetch_plans')
        with self._conn.connect(pat) as client:
            return client.get_all_plans(project)

    def fetch_markers(
        self,
        area_path: str,
        credential: Optional[BackendCredential] = None,
    ) -> List[Dict[str, Any]]:
        pat = self._require_credential(credential, 'fetch_markers')
        # Markers are fetched per-plan; this method returns all markers for
        # the given area path by looking up plans via the stored area_plan_map.
        # The full plan-markers resolution lives in TaskRepository.list_markers().
        # Here we expose the per-plan call that the repository orchestrates.
        raise NotImplementedError(
            "fetch_markers() on AzureDevOpsBackend is not used directly; "
            "use TaskRepository.list_markers() instead."
        )

    def fetch_iterations(
        self,
        project: str,
        root_paths: Optional[List[str]] = None,
        credential: Optional[BackendCredential] = None,
    ) -> Dict[str, Any]:
        pat = self._require_credential(credential, 'fetch_iterations')
        with self._conn.connect(pat) as client:
            iteration_map: Dict[str, Any] = {}
            for raw_root in (root_paths or [None]):
                # Construct the full ADO path: "<project>\Iteration\<sub-path>".
                # raw_root is a plain sub-path from iterations.yml (e.g. "eSW\Platform").
                root = f"{project}\\Iteration\\{raw_root}" if raw_root else None
                try:
                    for it in client.get_iterations(project, root_path=root):
                        raw_path = it.get('path', '')
                        norm = self._strip_iteration_segment(raw_path)
                        if norm:
                            iteration_map[norm] = {
                                'startDate': it.get('startDate'),
                                'finishDate': it.get('finishDate'),
                                'name': it.get('name'),
                            }
                except Exception as exc:
                    logger.warning("Failed to fetch iterations for root '%s': %s", root, exc)
            return iteration_map

    # ------------------------------------------------------------------
    # BackendPort: invalidate_cache
    # ------------------------------------------------------------------

    def invalidate_cache(self) -> Dict[str, Any]:
        """No-op: AzureDevOpsBackend has no internal cache."""
        return {'ok': True, 'invalidated': [], 'errors': []}
