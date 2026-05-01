"""UserDataBackend: mutable per-user data (scenarios and views).

Implements ScenarioBackend and ViewBackend.  Reads and writes go directly to
the injected diskcache StorageBackend.

This backend is intentionally NOT wrapped in CachingBackend — a CachingBackend
would cache fetch_* results and return stale data after a save_* call, because
save_* bypasses the TTL cache.  diskcache itself is the persistent store, so
no additional caching layer is needed or appropriate.

Adding new mutable user domains
---------------------------------
1.  Add a new focused Protocol to port.py (e.g. UserPreferencesBackend).
2.  Implement the methods here.
3.  Create a repository that depends on user_data_backend.
4.  No changes to any other backend.
"""
from __future__ import annotations

import logging
from typing import List, Optional

from planner_lib.backend.port import ScenarioBackend, ViewBackend
from planner_lib.domain.scenarios import DomainScenario
from planner_lib.domain.views import DomainView
from planner_lib.storage.base import StorageBackend

logger = logging.getLogger(__name__)


class UserDataBackend(ScenarioBackend, ViewBackend):
    """Backend for mutable per-user data stored in diskcache.

    Parameters
    ----------
    storage:
        StorageBackend backed by diskcache (fast persistent store).
    """

    def __init__(self, storage: StorageBackend) -> None:
        self._storage = storage
        logger.info("UserDataBackend: initialised")

    # ------------------------------------------------------------------
    # ScenarioBackend
    # ------------------------------------------------------------------

    def fetch_scenarios(self, user_id: str) -> List[DomainScenario]:
        """Return all scenario metadata entries for *user_id*."""
        from planner_lib.scenarios.scenario_store import list_user_scenarios
        return list_user_scenarios(self._storage, user_id)

    def fetch_scenario(self, user_id: str, scenario_id: str) -> DomainScenario:
        """Return a single scenario (raises KeyError when not found)."""
        from planner_lib.scenarios.scenario_store import load_user_scenario
        return load_user_scenario(self._storage, user_id, scenario_id)

    def save_scenario(self, user_id: str, scenario_id: Optional[str], data: dict) -> DomainScenario:
        """Persist a scenario and return its metadata."""
        from planner_lib.scenarios.scenario_store import save_user_scenario
        return save_user_scenario(self._storage, user_id, scenario_id, data)

    def delete_scenario(self, user_id: str, scenario_id: str) -> bool:
        """Delete a scenario; returns True when found and deleted."""
        from planner_lib.scenarios.scenario_store import delete_user_scenario
        return delete_user_scenario(self._storage, user_id, scenario_id)

    # ------------------------------------------------------------------
    # ViewBackend
    # ------------------------------------------------------------------

    def fetch_views(self, user_id: str) -> List[DomainView]:
        """Return all view metadata entries for *user_id*."""
        from planner_lib.views.view_store import list_user_views
        return list_user_views(self._storage, user_id)

    def fetch_view(self, user_id: str, view_id: str) -> DomainView:
        """Return a single view (raises KeyError when not found)."""
        from planner_lib.views.view_store import load_user_view
        return load_user_view(self._storage, user_id, view_id)

    def save_view(self, user_id: str, view_id: Optional[str], data: dict) -> DomainView:
        """Persist a view and return its metadata."""
        from planner_lib.views.view_store import save_user_view
        return save_user_view(self._storage, user_id, view_id, data)

    def delete_view(self, user_id: str, view_id: str) -> bool:
        """Delete a view; returns True when found and deleted."""
        from planner_lib.views.view_store import delete_user_view
        return delete_user_view(self._storage, user_id, view_id)
