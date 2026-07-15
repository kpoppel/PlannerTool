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
from planner_lib.backend.errors import (
    BackendAuthError,
    classify_ado_exception,
)
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
        """Extract the token from *credential* or raise BackendAuthError."""
        if credential is None:
            raise BackendAuthError(
                f"AzureDevOpsBackend.{op} requires a credential; "
                "none was provided and there is no cache to serve from."
            )
        token = credential.get('token')
        if not token:
            raise BackendAuthError(f"BackendCredential for {op} has an empty token.")
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

    def _build_iteration_map(
        self,
        client,
        azure_project: str,
        configured_project_name: Optional[str] = None,
        area_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Fetch and return a normalised iteration-path → dates map."""
        try:
            if self._config is not None:
                iterations_config = self._config.fetch_iterations_config()
            else:
                iterations_config = (self._storage.load('config', 'iterations')
                                     if self._storage.exists('config', 'iterations') else {})
            project_overrides = (iterations_config or {}).get('project_overrides', {})
            if not isinstance(project_overrides, dict):
                project_overrides = {}

            default_roots = iterations_config.get('default_roots', [])
            override_entry = None
            if configured_project_name and configured_project_name in project_overrides:
                override_entry = project_overrides.get(configured_project_name)

            source_project = azure_project
            raw_roots = default_roots
            if isinstance(override_entry, dict):
                source_project = str(override_entry.get('azure_project') or azure_project)
                candidate_roots = override_entry.get('roots')
                raw_roots = candidate_roots if isinstance(candidate_roots, list) else default_roots

            raw_roots = [str(r) for r in (raw_roots or []) if str(r).strip()]
            # Azure DevOps expects "<Project>\Iteration\<sub-path>".
            # The config stores only the sub-path, so prepend the full prefix.
            root_paths = [f"{source_project}\\Iteration\\{r}" for r in raw_roots] if raw_roots else []
            iteration_map: Dict[str, Any] = {}
            for root in (root_paths or [None]):
                try:
                    iterations = client.get_iterations(source_project, root_path=root)
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
                    logger.warning(
                        "Failed to fetch iterations for configured project '%s' "
                        "(area='%s', source_project='%s', root='%s'): %s",
                        configured_project_name or '?',
                        area_path or '?',
                        source_project,
                        root,
                        exc,
                    )
            return iteration_map
        except Exception as exc:
            logger.warning(
                "Error building iteration map for configured project '%s' "
                "(area='%s', source_project='%s'): %s",
                configured_project_name or '?',
                area_path or '?',
                azure_project,
                exc,
            )
            return {}

    def _resolve_configured_project_name(self, area_path: str) -> Optional[str]:
        """Resolve configured project name for an area path from projects config."""
        if self._config is None:
            return None
        try:
            project_map = self._config.fetch_project_map()
        except Exception:
            return None

        for entry in (project_map or []):
            if not isinstance(entry, dict):
                continue
            cfg_area = entry.get('area_path')
            if not isinstance(cfg_area, str):
                continue
            if area_path == cfg_area:
                name = entry.get('name')
                return str(name) if name else None
        return None

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

        # Translate any failure contacting ADO into the backend's typed error
        # vocabulary so the caching layer can react by type (auth vs outage)
        # without inspecting exception strings.
        try:
            with self._conn.connect(pat) as client:
                configured_project_name = self._resolve_configured_project_name(area_path)
                iteration_map = self._build_iteration_map(
                    client,
                    azure_project,
                    configured_project_name=configured_project_name,
                    area_path=area_path,
                )
                raw_items = client.get_work_items(
                    area_path,
                    task_types=task_types,
                    include_states=include_states,
                )
        except Exception as exc:
            raise classify_ado_exception(exc) from exc

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
        plan_id: Optional[str] = None,
        credential: Optional[BackendCredential] = None,
    ) -> List[Dict[str, Any]]:
        pat = self._require_credential(credential, 'fetch_markers')
        with self._conn.connect(pat) as client:
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
        pat = self._require_credential(credential, 'fetch_iterations')
        source_project = project
        default_roots: List[str] = []
        if self._config is not None:
            try:
                iterations_config = self._config.fetch_iterations_config()
            except Exception:
                iterations_config = {}
        else:
            iterations_config = (
                self._storage.load('config', 'iterations')
                if self._storage.exists('config', 'iterations')
                else {}
            )
        if isinstance(iterations_config, dict):
            configured_project = iterations_config.get('azure_project')
            if configured_project:
                source_project = str(configured_project)
            default_roots = iterations_config.get('default_roots', []) if isinstance(iterations_config.get('default_roots', []), list) else []

        roots = root_paths if root_paths is not None else default_roots
        with self._conn.connect(pat) as client:
            iteration_map: Dict[str, Any] = {}
            for raw_root in (roots or [None]):
                # Construct the full ADO path: "<project>\Iteration\<sub-path>".
                # raw_root is a plain sub-path from iterations.yml (e.g. "eSW\Platform").
                root = f"{source_project}\\Iteration\\{raw_root}" if raw_root else None
                try:
                    for it in client.get_iterations(source_project, root_path=root):
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
