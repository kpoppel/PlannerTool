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

    def list_tasks(self, pat: str, project_id: Optional[str] = None) -> List[dict]:
        cfg = self._storage_config.load('config', 'server_config')
        project_map = self._project_service.get_project_map()

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

                wis = client.get_work_items(path)  # type: ignore
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
                    entry['project'] = slugify(name, prefix='project-')
                    entry['start'] = entry.get('startDate') or None
                    entry['end'] = entry.get('finishDate') or None
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
                if item_updated:
                    updated += 1
            return {'ok': len(errors) == 0, 'updated': updated, 'errors': errors}

    def list_markers(self, pat: str, project_id: Optional[str] = None) -> List[dict]:
        """Return markers for configured projects.

        If `project_id` is provided, only markers for that configured project
        (derived from the project map) are returned. Markers are resolved via
        the composed `azure_client` and returned as a flat list suitable for
        frontend consumption.
        """
        cfg = self._storage_config.load('config', 'server_config')
        project_map = self._project_service.get_project_map()

        # Prefer admin-persisted mapping (if available) to avoid
        # re-resolving area paths to plans on every request. The mapping is
        # stored in config under the logical key 'area_plan_map' and is
        # expected to be keyed by project id with structure:
        # { <project_id>: { 'areas': { <area_path>: { 'plans': [...], 'last_update': iso } }, 'last_update': iso } }
        # For backward compatibility we also accept the older area_path -> {plans, last_update}
        try:
            area_plan_map = self._storage_config.load('config', 'area_plan_map') or {}
        except Exception:
            area_plan_map = {}

        with self._azure_client.connect(pat) as client:
            out: List[dict] = []
            for p in project_map:
                pid = p.get('id')
                name = p.get('name')
                area = p.get('area_path')

                if project_id and pid != project_id:
                    continue

                # If admin-provided mapping exists for this project/area, fetch per-plan
                # markers directly using plan ids to minimize SDK calls.
                mapping = None
                try:
                    if isinstance(area_plan_map, dict):
                        # project-keyed shape only
                        proj_obj = area_plan_map.get(pid)
                        mapping = None
                        if proj_obj and isinstance(proj_obj, dict):
                            areas = proj_obj.get('areas') or {}
                            mapping = areas.get(area)
                    else:
                        mapping = None
                except Exception:
                    mapping = None

                markers: List[dict] = []
                if mapping and isinstance(mapping, dict) and mapping.get('plans'):
                    plans = mapping.get('plans') or []
                    # Azure API expects the project identifier (root of area path),
                    # not the configured project 'name'. Derive project from area_path.
                    project_for_api = area.split('\\')[0] if '\\' in area else (area.split('/')[0] if area else name)
                    for plan_id in plans:
                        try:
                            pm = client.get_markers_for_plan(project_for_api, str(plan_id))  # type: ignore
                        except Exception:
                            pm = []
                        for m in pm:
                            markers.append({'plan_id': plan_id, 'plan_name': None, 'team_id': None, 'team_name': None, 'marker': m})
                else:
                    # Fallback: let the Azure client compute mapping and markers
                    try:
                        markers = client.get_markers(area)  # type: ignore
                    except Exception:
                        markers = []

                for m in markers or []:
                    entry = dict(m)
                    entry['project'] = slugify(name, prefix='project-')
                    out.append(entry)
        return out
