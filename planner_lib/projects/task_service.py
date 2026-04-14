"""TaskService: handles task listing, iteration, and marker queries.

Read operations only.  Write operations (update_tasks) live in
:mod:`planner_lib.projects.task_update_service.TaskUpdateService`.

TaskService delegates update_tasks() to a composed TaskUpdateService instance
so callers that depend on the full TaskServiceProtocol surface still work
without changes.
"""
from __future__ import annotations

from typing import List, Optional
import logging

from planner_lib.util import slugify
from planner_lib.storage.base import StorageBackend
from planner_lib.azure.interfaces import AzureServiceProtocol
from planner_lib.projects.interfaces import (
    ProjectServiceProtocol,
    TeamServiceProtocol,
    CapacityServiceProtocol,
    TaskServiceProtocol,
)
from planner_lib.projects.closed_tasks import (
    get_completed_states,
    get_non_completed_states,
    filter_completed_with_open_ancestors,
)
from planner_lib.projects.task_update_service import TaskUpdateService

logger = logging.getLogger(__name__)


class TaskService(TaskServiceProtocol):
    def __init__(
        self,
        *,
        storage_config: StorageBackend,
        project_service: ProjectServiceProtocol,
        team_service: TeamServiceProtocol,
        capacity_service: CapacityServiceProtocol,
        azure_client: AzureServiceProtocol,
        metadata_service=None,  # Optional AzureProjectMetadataService for closed-task filtering
    ):
        self._storage_config: StorageBackend = storage_config
        self._project_service: ProjectServiceProtocol = project_service
        self._team_service: TeamServiceProtocol = team_service
        self._capacity_service: CapacityServiceProtocol = capacity_service
        self._azure_client: AzureServiceProtocol = azure_client
        # Optional; when present enables automatic fetching of Completed-category
        # tasks that still have open (non-Completed) ancestors.
        self._metadata_service = metadata_service
        # Composed update service: same dependencies, handles all write operations.
        self._updater = TaskUpdateService(
            storage_config=storage_config,
            team_service=team_service,
            capacity_service=capacity_service,
            azure_client=azure_client,
        )

    def _build_iteration_map(self, client, azure_project: str) -> dict:
        """Build a mapping of iteration paths to their start/end dates.

        Args:
            client: Connected Azure client
            azure_project: Azure project name

        Returns:
            Dict mapping normalized iteration path -> {startDate, finishDate, name}
        """
        try:
            iterations_config: dict = {}
            if self._storage_config.exists('config', 'iterations'):
                iterations_config = self._storage_config.load('config', 'iterations') or {}

            project_overrides = iterations_config.get('project_overrides', {})
            root_paths = project_overrides.get(azure_project, iterations_config.get('default_roots', []))

            return self._fetch_iterations_as_map(client, azure_project, root_paths)
        except Exception as e:
            logger.warning("Error building iteration map for '%s': %s", azure_project, e)
            return {}

    def _fetch_iterations_as_map(self, client, azure_project: str, root_paths: list) -> dict:
        """Fetch Azure iterations for each root path and return as a normalized map.

        Shared by :meth:`_build_iteration_map` and :meth:`list_iterations`.
        All iteration paths are normalized via :meth:`_strip_iteration_segment`.

        Args:
            client: Connected Azure client.
            azure_project: Azure DevOps project name.
            root_paths: Root iteration paths to query; when empty all iterations
                        for the project are fetched.

        Returns:
            Dict mapping normalized iteration path -> {startDate, finishDate, name}.
        """
        iteration_map: dict = {}
        roots = root_paths or [None]  # None means "fetch all" in get_iterations
        for root in roots:
            try:
                iterations = client.get_iterations(azure_project, root_path=root)  # type: ignore
                for iter_data in iterations:
                    raw_path = iter_data.get('path', '')
                    norm_path = self._strip_iteration_segment(raw_path)
                    if norm_path:
                        iteration_map[norm_path] = {
                            'startDate': iter_data.get('startDate'),
                            'finishDate': iter_data.get('finishDate'),
                            'name': iter_data.get('name'),
                        }
            except Exception as e:
                logger.warning("Failed to fetch iterations for root '%s': %s", root, e)
        return iteration_map

    @staticmethod
    def _strip_iteration_segment(path: str) -> str:
        """Remove any 'Iteration' or 'Iterations' path segments from an Azure path.

        Example: 'Project\\Iteration\\eSW\\Sprint 1' -> 'Project\\eSW\\Sprint 1'
        """
        if not path or not isinstance(path, str):
            return path
        parts = path.split('\\')
        parts = [p for p in parts if p and p.lower() not in ('iteration', 'iterations')]
        return '\\'.join(parts)

    def list_iterations(self, pat: str, project_filter: str = None) -> List[dict]:
        """Return the configured iterations from Azure, filtered and sorted.

        Encapsulates the full iteration-fetch pipeline that was previously
        inlined in the GET /api/iterations route handler.

        Args:
            pat: Personal Access Token for Azure DevOps.
            project_filter: Optional project name; when set uses project_overrides
                            from iterations.yml instead of default_roots.

        Returns:
            List of iteration dicts sorted by startDate, restricted to the
            current year or later, with normalized paths (Iteration segment stripped).
        """
        from datetime import datetime

        try:
            iterations_cfg = self._storage_config.load('config', 'iterations') or {}
        except KeyError:
            iterations_cfg = {}

        azure_project = iterations_cfg.get('azure_project', '')
        if not azure_project:
            raise ValueError('azure_project not configured in iterations.yml')

        if project_filter and 'project_overrides' in iterations_cfg:
            roots = iterations_cfg.get('project_overrides', {}).get(project_filter)
            if not roots:
                roots = iterations_cfg.get('default_roots', [])
        else:
            roots = iterations_cfg.get('default_roots', [])

        if not roots:
            return []

        all_iterations: List[dict] = []
        seen_paths: set = set()

        with self._azure_client.connect(pat) as client:
            # Build full root paths (Azure expects "Project\Iteration\RootName")
            full_roots = [f"{azure_project}\\Iteration\\{r}" for r in roots]
            raw_map = self._fetch_iterations_as_map(client, azure_project, full_roots)
            for norm_path, data in raw_map.items():
                if norm_path not in seen_paths:
                    all_iterations.append({**data, 'path': norm_path})
                    seen_paths.add(norm_path)

        def _sort_key(item):
            start = item.get('startDate')
            if start:
                return (0, start, item.get('path', ''))
            return (1, '', item.get('path', ''))

        all_iterations.sort(key=_sort_key)

        current_year = datetime.now().year

        def _is_current_or_future(it):
            start = it.get('startDate')
            finish = it.get('finishDate')
            if not start and not finish:
                return False
            try:
                if start and int(start[:4]) >= current_year:
                    return True
                if finish and int(finish[:4]) >= current_year:
                    return True
            except (ValueError, IndexError):
                return False
            return False

        return [it for it in all_iterations if _is_current_or_future(it)]

    def list_tasks(self, pat: str, project_id: Optional[str] = None) -> List[dict]:
        cfg = self._storage_config.load('config', 'server_config')
        project_map = self._project_service.get_project_map()

        # Build a case-insensitive type normalizer from the global hierarchy.
        # Azure DevOps may return type names with any casing (e.g. "epic", "Epic"),
        # while the admin-configured hierarchy holds the canonical capitalisation.
        # NOTE: Modifying word cAsE here. Not great doing this random places!
        type_canonical: dict = {}
        try:
            gs = self._storage_config.load('config', 'global_settings')
            for level in (gs.get('task_type_hierarchy', []) if isinstance(gs, dict) else []):
                for t in (level.get('types') or []):
                    type_canonical[str(t).lower()] = t
        except Exception:
            pass  # Non-fatal; fall back to raw Azure type strings

        # PAT is required for all Azure accesses; create a short-lived
        # connected client via the composed `azure_client` connect() context.
        with self._azure_client.connect(pat) as client:
            items: List[dict] = []

            for p in project_map:
                id = p["id"]
                name = p['name']
                path = p['area_path']

                # Filter by project_id if provided
                # Expect project_id to be in the form 'project-<slug>'
                if project_id and id != project_id:
                    continue

                # Fetch iterations for this project to enable date inference
                # Extract the Azure project name from area path (everything before first backslash/slash)
                azure_project = path.split('\\')[0] if '\\' in path else (path.split('/')[0] if '/' in path else name)
                iteration_map = self._build_iteration_map(client, azure_project)
                logger.debug("Built iteration map with %d entries for project '%s'", len(iteration_map), name)

                # Extract task_types and include_states from project configuration
                task_types = p.get('task_types')
                include_states = p.get('include_states')

                # --- Closed-task split ---
                # If the metadata service has cached state_categories for this Azure
                # project and any of the configured include_states belong to the
                # Completed category, we split the fetch:
                #   1. Regular fetch uses only non-Completed states.
                #   2. A separate fetch retrieves Completed-state items, which are
                #      then filtered to those with at least one non-Completed ancestor.
                # When metadata is unavailable we fall back to the original single fetch.
                completed_states: list = []
                regular_include_states = include_states  # default: unchanged

                if self._metadata_service and include_states:
                    cached_meta = self._metadata_service.get_cached(azure_project)
                    if cached_meta:
                        sc = cached_meta.get('state_categories', {})
                        if sc:
                            c_states = get_completed_states(include_states, sc)
                            if c_states:
                                completed_states = c_states
                                nc_states = get_non_completed_states(include_states, sc)
                                # If all configured states are Completed (edge case) fall back
                                # to the original list so the regular fetch still runs.
                                regular_include_states = nc_states or include_states

                # Regular fetch (non-Completed states, or all states when no split)
                wis = client.get_work_items(path, task_types=task_types, include_states=regular_include_states)
                logger.debug("Fetched %d work items for project '%s'", len(wis or []), name)

                # Fetch and filter Completed-category tasks
                if completed_states:
                    completed_wis = client.get_work_items(
                        path, task_types=task_types, include_states=completed_states
                    )
                    logger.debug(
                        "Fetched %d completed work items for project '%s'",
                        len(completed_wis or []), name,
                    )
                    if completed_wis:
                        # Build combined lookup map so ancestor checks can reuse
                        # already-fetched items without extra API calls.
                        all_by_id = {str(w['id']): w for w in (wis or [])}
                        for w in completed_wis:
                            all_by_id[str(w['id'])] = w
                        qualifying = filter_completed_with_open_ancestors(
                            completed_wis,
                            all_by_id,
                            cached_meta.get('state_categories', {}),  # type: ignore[union-attr]
                            lambda ids: client.get_work_items_by_ids(ids),  # type: ignore[union-attr]
                        )
                        wis = (wis or []) + qualifying

                for wi in wis or []:
                    parsed_capacity = self._capacity_service.parse(wi.get('description'))
                    filtered_capacity: List[dict] = []
                    for entry in parsed_capacity:
                        mapped = self._team_service.name_to_id(entry['team'], cfg)
                        if mapped is None:
                            continue
                        filtered_capacity.append({'team': mapped, 'capacity': entry.get('capacity', 0)})
                    entry = dict(wi)
                    # Normalise the type to the canonical capitalisation from the hierarchy.
                    raw_type = entry.get('type') or ''
                    entry['type'] = type_canonical.get(raw_type.lower(), raw_type)
                    entry['project'] = slugify(name, prefix='project-')
                    
                    # Infer start/end dates from iteration if not explicitly set
                    start_date = entry.get('startDate')
                    end_date = entry.get('finishDate')
                    iteration_path = entry.get('iterationPath')
                    
                    if iteration_path and iteration_path in iteration_map:
                        iter_data = iteration_map[iteration_path]
                        # Infer start date if missing
                        if not start_date and iter_data.get('startDate'):
                            start_date = iter_data['startDate']
                            entry['_inferred_start'] = True
                        # Infer end date if missing
                        if not end_date and iter_data.get('finishDate'):
                            end_date = iter_data['finishDate']
                            entry['_inferred_end'] = True
                    
                    entry['start'] = start_date
                    entry['end'] = end_date
                    entry['capacity'] = filtered_capacity
                    items.append(entry)
        logger.debug('Returning total %d tasks from all projects', len(items))
        return items

    def update_tasks(self, updates: List[dict], pat: str) -> dict:
        """Delegate to the composed TaskUpdateService (write side)."""
        return self._updater.update_tasks(updates, pat)

    def list_markers(self, pat: str, project_id: Optional[str] = None) -> List[dict]:
        """Return markers for configured projects using area_plan_map.

        Fetches markers from delivery plans configured in area_plan_map.yml.
        Each project's area path is mapped to plan IDs with enabled flags.
        """
        project_map = self._project_service.get_project_map()
        # Avoid KeyError from backends that raise when a key is missing.
        # Callers should check `exists()` before `load()` so missing keys
        # don't raise — fall back to empty mapping when absent.
        if self._storage_config.exists('config', 'area_plan_map'):
            area_plan_map = self._storage_config.load('config', 'area_plan_map') or {}
        else:
            area_plan_map = {}

        with self._azure_client.connect(pat) as client:
            out: List[dict] = []
            
            for p in project_map:
                pid = p.get('id')
                name = p.get('name')
                area = p.get('area_path')

                if project_id and pid != project_id:
                    continue

                # Get plan IDs from area_plan_map
                proj_obj = area_plan_map.get(pid, {})
                areas = proj_obj.get('areas', {})
                area_config = areas.get(area, {})
                plans_config = area_config.get('plans', {})
                
                # Only fetch markers for enabled plans
                project_for_api = area.split('\\')[0] if '\\' in area else (area.split('/')[0] if area else name)
                
                for plan_id, plan_info in plans_config.items():
                    if not isinstance(plan_info, dict) or not plan_info.get('enabled', False):
                        continue
                    
                    try:
                        markers = client.get_markers_for_plan(project_for_api, str(plan_id))  # type: ignore
                        plan_name = plan_info.get('name')
                        
                        for m in markers:
                            out.append({
                                'plan_id': plan_id,
                                'plan_name': plan_name,
                                'team_id': None,
                                'team_name': None,
                                'marker': m,
                                'project': slugify(name, prefix='project-')
                            })
                    except Exception as e:
                        logger.warning(f"Failed to fetch markers for plan {plan_id}: {e}")
                        continue

            return out
