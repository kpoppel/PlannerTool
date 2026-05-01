"""TeamRepository: single authoritative source for configured team data.

Delegates all YAML reading to LocalConfigBackend (via the ``local_backend``
DI key) so that team data benefits from the TTL cache.  Adds utility methods
(name_to_id, id_to_short_name) that search the cached domain list.
"""
from __future__ import annotations

import logging
from typing import List, Optional

from planner_lib.domain.teams import DomainTeam

logger = logging.getLogger(__name__)


class TeamRepository:
    """Repository for locally-configured team data.

    Parameters
    ----------
    local_backend:
        TeamConfigBackend implementation (reads from teams.yml).
    """

    def __init__(self, local_backend) -> None:
        self._backend = local_backend
        logger.info("TeamRepository: initialised")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def list_teams(self) -> List[DomainTeam]:
        """Return all configured teams (excluding entries marked exclude=True)."""
        return self._backend.fetch_config_teams()

    def name_to_id(self, name: str) -> Optional[str]:
        """Map a team display name or short_name to its canonical slug id."""
        tkn = name.strip().lower()
        for t in self._backend.fetch_config_teams():
            if tkn == t.get("name", "").lower() or tkn == (t.get("short_name") or "").lower():
                return t["id"]
        return None

    def id_to_short_name(self, team_id: str) -> Optional[str]:
        """Map a team slug id back to its short_name (or full name)."""
        tid = team_id.strip()
        for t in self._backend.fetch_config_teams():
            if t["id"] == tid:
                return t.get("short_name") or t.get("name")
        return None
