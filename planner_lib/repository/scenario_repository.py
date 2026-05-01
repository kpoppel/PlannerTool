"""ScenarioRepository: single authoritative source for user-saved scenarios.

Delegates all persistence to LocalConfigBackend (``local_backend`` DI key)
so that scenario reads are covered by the TTL cache when caching is enabled.
Route handlers never touch scenarios_storage directly.
"""
from __future__ import annotations

import logging
from typing import List, Optional

from planner_lib.domain.scenarios import DomainScenario

logger = logging.getLogger(__name__)


class ScenarioRepository:
    """Repository for user-saved planning scenarios.

    Parameters
    ----------
    backend:
        ScenarioBackend implementation (``LocalConfigBackend``).
    """

    def __init__(self, backend) -> None:
        self._backend = backend
        logger.info("ScenarioRepository: initialised")

    def list_scenarios(self, user_id: str) -> List[DomainScenario]:
        """Return all scenario metadata entries for *user_id*."""
        return self._backend.fetch_scenarios(user_id)

    def get_scenario(self, user_id: str, scenario_id: str) -> DomainScenario:
        """Return a single scenario (raises KeyError when not found)."""
        return self._backend.fetch_scenario(user_id, scenario_id)

    def save_scenario(
        self,
        user_id: str,
        scenario_id: Optional[str],
        data: dict,
    ) -> DomainScenario:
        """Persist a scenario and return its metadata dict."""
        return self._backend.save_scenario(user_id, scenario_id, data)

    def delete_scenario(self, user_id: str, scenario_id: str) -> bool:
        """Delete a scenario. Returns True when found and deleted."""
        return self._backend.delete_scenario(user_id, scenario_id)
