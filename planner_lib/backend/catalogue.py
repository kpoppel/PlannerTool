"""Backend-keyed process/type/state catalogues behind one display contract.

Each task backend owns its catalogue definitions. Consumers read the display
model (processes, ordered type tiers and categorised states) without knowing
which backend defined it.
"""
from __future__ import annotations

from typing import List

from planner_lib.azure.catalogue import work_item_display
from planner_lib.backend.selection import ADO_BACKEND_ID, task_backend_id
from planner_lib.storage.base import StorageBackend


class AdoCatalogue:
    """Imported ADO processes ordered by Global Project Settings."""

    backend_id = ADO_BACKEND_ID

    def __init__(self, storage: StorageBackend) -> None:
        self._storage = storage

    def work_item_display(self) -> List[dict]:
        return work_item_display(
            self._storage.load('config', 'ado_processes'),
            self._storage.load('config', 'global_settings'),
        )


def active_catalogue(storage: StorageBackend):
    """Return the catalogue owned by the selected task backend."""
    backend_id = task_backend_id(storage.load('config', 'server_config'))
    if backend_id == ADO_BACKEND_ID:
        return AdoCatalogue(storage)
    raise ValueError(f'Task backend {backend_id!r} has no catalogue in this build')
