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
