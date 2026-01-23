"""TaskService: handles task listing and updates (Azure interactions).

This service depends on a storage_config (to load server_config), a
TeamService for token/id mapping, and a CapacityService for parsing and
serializing the capacity blocks.
"""
from __future__ import annotations

from typing import List, Optional
import logging

from planner_lib.util import slugify
from planner_lib.storage import StorageBackend
from planner_lib.azure import get_client
from planner_lib.projects.project_service import ProjectService
from planner_lib.projects.team_service import TeamService
from planner_lib.projects.capacity_service import CapacityService

logger = logging.getLogger(__name__)


class TaskService:
    def __init__(self, *, storage_config: StorageBackend, project_service: ProjectService, team_service: TeamService, capacity_service: CapacityService):
        self._storage_config = storage_config
        self._project_service = project_service
        self._team_service = team_service
        self._capacity_service = capacity_service

    def list_tasks(self, pat: Optional[str] = None, project_id: Optional[str] = None) -> List[dict]:
        cfg = self._storage_config.load('config', 'server_config')
        project_map = self._project_service.get_project_map()

        client = get_client(cfg['azure_devops_organization'], pat)
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

    def update_tasks(self, updates: List[dict], pat: Optional[str] = None) -> dict:
        cfg = self._storage_config.load('config', 'server_config')
        if not cfg:
            return {'ok': False, 'updated': 0, 'errors': ['No server config loaded']}

        client = get_client(cfg["azure_devops_organization"], pat)
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
