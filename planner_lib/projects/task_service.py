"""TaskService: handles task listing and updates (Azure interactions).

This service depends on a storage_config (to load server_config), a
TeamService for token/id mapping, and a CapacityService for parsing and
serializing the capacity blocks.
"""
from __future__ import annotations

from typing import List, Optional
import logging

from planner_lib.util import slugify
from planner_lib.services.interfaces import StorageProtocol
from planner_lib.azure.interfaces import AzureServiceProtocol
from planner_lib.projects.interfaces import (
    ProjectServiceProtocol,
    TeamServiceProtocol,
    CapacityServiceProtocol,
    TaskServiceProtocol,
)

logger = logging.getLogger(__name__)


class TaskService(TaskServiceProtocol):
    def __init__(
        self,
        *,
        storage_config: StorageProtocol,
        project_service: ProjectServiceProtocol,
        team_service: TeamServiceProtocol,
        capacity_service: CapacityServiceProtocol,
        azure_client: AzureServiceProtocol,
    ):
        self._storage_config: StorageProtocol = storage_config
        self._project_service: ProjectServiceProtocol = project_service
        self._team_service: TeamServiceProtocol = team_service
        self._capacity_service: CapacityServiceProtocol = capacity_service
        self._azure_client: AzureServiceProtocol = azure_client

    def _build_iteration_map(self, client, azure_project: str) -> dict:
        """Build a mapping of iteration paths to their start/end dates.
        
        Args:
            client: Connected Azure client
            azure_project: Azure project name
            
        Returns:
            Dict mapping iteration path -> {startDate, finishDate}
        """
        try:
            # Load iterations configuration to determine root paths
            iterations_config = {}
            if self._storage_config.exists('config', 'iterations'):
                iterations_config = self._storage_config.load('config', 'iterations') or {}
            
            # Get root paths for this project (or use defaults)
            project_overrides = iterations_config.get('project_overrides', {})
            root_paths = project_overrides.get(azure_project, iterations_config.get('default_roots', []))
            
            # Fetch iterations from Azure for each root path
            iteration_map = {}
            if root_paths:
                for root_path in root_paths:
                    try:
                        iterations = client.get_iterations(azure_project, root_path=root_path)  # type: ignore
                        for iter_data in iterations:
                            path = iter_data.get('path', '')
                            if path:
                                # Normalize the path for matching with work item iterationPath
                                # Remove leading backslash and "Iteration\" component
                                normalized_path = path.lstrip('\\')
                                # Remove "Iteration\" component if present
                                if '\\Iteration\\' in normalized_path:
                                    normalized_path = normalized_path.replace('\\Iteration\\', '\\', 1)
                                
                                iteration_map[normalized_path] = {
                                    'startDate': iter_data.get('startDate'),
                                    'finishDate': iter_data.get('finishDate'),
                                    'name': iter_data.get('name')
                                }
                    except Exception as e:
                        logger.warning(f"Failed to fetch iterations for root '{root_path}': {e}")
            else:
                # No roots configured, fetch all iterations for the project
                try:
                    iterations = client.get_iterations(azure_project)  # type: ignore
                    for iter_data in iterations:
                        path = iter_data.get('path', '')
                        if path:
                            # Normalize the path for matching with work item iterationPath
                            normalized_path = path.lstrip('\\')
                            if '\\Iteration\\' in normalized_path:
                                normalized_path = normalized_path.replace('\\Iteration\\', '\\', 1)
                            
                            iteration_map[normalized_path] = {
                                'startDate': iter_data.get('startDate'),
                                'finishDate': iter_data.get('finishDate'),
                                'name': iter_data.get('name')
                            }
                except Exception as e:
                    logger.warning(f"Failed to fetch iterations for project '{azure_project}': {e}")
            
            return iteration_map
        except Exception as e:
            logger.warning(f"Error building iteration map for '{azure_project}': {e}")
            return {}

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
                
                # Pass configuration to get_work_items
                wis = client.get_work_items(path, task_types=task_types, include_states=include_states)
                logger.debug("Fetched %d work items for project '%s'", len(wis or []), name)
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
        cfg = self._storage_config.load('config', 'server_config')
        if not cfg:
            return {'ok': False, 'updated': 0, 'errors': ['No server config loaded']}
        # Require PAT for updates as well — use composed client's connect()
        with self._azure_client.connect(pat) as client:
            updated = 0
            errors: List[str] = []
            for u in updates or []:
                try:
                    wid = int(u.get('id') or 0)
                except Exception:
                    errors.append(f'Invalid work item id: {u}')
                    continue

                start = u.get('start')
                end = u.get('end')
                capacity = u.get('capacity')
                item_updated = False
                if start is not None or end is not None:
                    try:
                        client.update_work_item_dates(wid, start=start, end=end)  # type: ignore
                        item_updated = True
                    except Exception as e:
                        errors.append(f"{wid} (dates): {e}")
                if capacity is not None and isinstance(capacity, list):
                    try:
                        wit = client.conn.clients.get_work_item_tracking_client()  # type: ignore
                        work_item = wit.get_work_item(wid)
                        current_description = work_item.fields.get('System.Description', '')
                        updated_description = self._capacity_service.update_description(current_description, capacity, cfg)
                        client.update_work_item_description(wid, updated_description)  # type: ignore
                        item_updated = True
                    except Exception as e:
                        errors.append(f"{wid} (capacity): {e}")
                # Apply state change if provided
                state_val = u.get('state')
                if state_val is not None:
                    try:
                        client.update_work_item_state(wid, state_val)  # type: ignore
                        item_updated = True
                    except Exception as e:
                        errors.append(f"{wid} (state): {e}")
                # Apply relation changes if provided
                relations = u.get('relations')
                if relations is not None:
                    try:
                        client.update_work_item_relations(wid, relations)  # type: ignore
                        item_updated = True
                    except Exception as e:
                        errors.append(f"{wid} (relations): {e}")
                if item_updated:
                    updated += 1
            return {'ok': len(errors) == 0, 'updated': updated, 'errors': errors}

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
