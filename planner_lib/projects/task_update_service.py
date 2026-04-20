"""TaskUpdateService: handles mutating task data in Azure DevOps.

Split from TaskService to honour the Single Responsibility Principle:
TaskService owns read operations; TaskUpdateService owns write operations.
Both services share the same constructor dependencies so they can be
composed together or used independently.
"""
from __future__ import annotations

from typing import List
import logging

from planner_lib.storage.base import StorageBackend
from planner_lib.azure.interfaces import AzureServiceProtocol
from planner_lib.projects.interfaces import (
    TeamServiceProtocol,
    CapacityServiceProtocol,
)

logger = logging.getLogger(__name__)


class TaskUpdateService:
    """Writes task changes back to Azure DevOps.

    Handles date updates, capacity (description) updates, state changes,
    and relation changes.  Unlike TaskService (the query side), this class
    has no dependency on ProjectService because updates always target a
    specific work item id supplied by the caller.
    """

    def __init__(
        self,
        *,
        storage_config: StorageBackend,
        team_service: TeamServiceProtocol,
        capacity_service: CapacityServiceProtocol,
        azure_client: AzureServiceProtocol,
    ) -> None:
        self._storage_config = storage_config
        self._team_service = team_service
        self._capacity_service = capacity_service
        self._azure_client = azure_client

    def update_tasks(self, updates: List[dict], pat: str) -> dict:
        """Apply a list of update payloads to Azure work items.

        Each payload may contain any combination of:
          - ``id`` (required): work item id
          - ``start`` / ``end``: new date strings (ISO format)
          - ``capacity``: list of ``{team, capacity}`` dicts
          - ``state``: new state string
          - ``relations``: relation change payload

        Returns a dict ``{"ok": bool, "updated": int, "errors": [str]}``.
        """
        cfg = self._storage_config.load('config', 'server_config')
        if not cfg:
            return {'ok': False, 'updated': 0, 'errors': ['No server config loaded']}

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

                # Use key-presence to distinguish "not provided" from "explicit null
                # (clear the field)".  Only pass kwargs that are present in the payload
                # so the Azure client sentinel logic works correctly.
                has_start = 'start' in u
                has_end = 'end' in u
                if has_start or has_end:
                    try:
                        date_kwargs = {}
                        if has_start:
                            date_kwargs['start'] = u['start']
                        if has_end:
                            date_kwargs['end'] = u['end']
                        client.update_work_item_dates(wid, **date_kwargs)  # type: ignore
                        item_updated = True
                    except Exception as e:
                        errors.append(f"{wid} (dates): {e}")

                if capacity is not None and isinstance(capacity, list):
                    try:
                        current_description = client.get_work_item_description(wid)  # type: ignore
                        updated_description = self._capacity_service.update_description(
                            current_description, capacity, cfg
                        )
                        client.update_work_item_description(wid, updated_description)  # type: ignore
                        item_updated = True
                    except Exception as e:
                        errors.append(f"{wid} (capacity): {e}")

                state_val = u.get('state')
                if state_val is not None:
                    try:
                        client.update_work_item_state(wid, state_val)  # type: ignore
                        item_updated = True
                    except Exception as e:
                        errors.append(f"{wid} (state): {e}")

                relations = u.get('relations')
                if relations is not None:
                    try:
                        client.update_work_item_relations(wid, relations)  # type: ignore
                        item_updated = True
                    except Exception as e:
                        errors.append(f"{wid} (relations): {e}")

                # iterationPath uses key-presence: present (even as null) means
                # "set/clear the field"; absent means "leave unchanged".
                if 'iterationPath' in u:
                    try:
                        client.update_work_item_iteration_path(wid, u['iterationPath'])  # type: ignore
                        item_updated = True
                    except Exception as e:
                        errors.append(f"{wid} (iterationPath): {e}")

                if item_updated:
                    updated += 1

            return {'ok': len(errors) == 0, 'updated': updated, 'errors': errors}
