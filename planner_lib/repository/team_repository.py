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
        self._name_to_id_index: Optional[dict[str, str]] = None
        self._id_to_short_name_index: Optional[dict[str, str]] = None
        logger.info("TeamRepository: initialised")

    def _build_indexes(self) -> None:
        teams = self._backend.fetch_config_teams()
        name_index: dict[str, str] = {}
        short_name_index: dict[str, str] = {}
        for team in teams:
            team_id = str(team.get('id') or '').strip()
            if not team_id:
                continue
            team_name = str(team.get('name') or '').strip()
            team_short_name = str(team.get('short_name') or '').strip()
            if team_name:
                name_index[team_name.lower()] = team_id
            if team_short_name:
                name_index[team_short_name.lower()] = team_id
                short_name_index[team_id] = team_short_name
            elif team_name:
                short_name_index[team_id] = team_name

        self._name_to_id_index = name_index
        self._id_to_short_name_index = short_name_index

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def list_teams(self) -> List[DomainTeam]:
        """Return all configured teams (excluding entries marked exclude=True)."""
        return self._backend.fetch_config_teams()

    def name_to_id(self, name: str) -> Optional[str]:
        """Map a team display name or short_name to its canonical slug id."""
        if self._name_to_id_index is None:
            self._build_indexes()
        tkn = name.strip().lower()
        return (self._name_to_id_index or {}).get(tkn)

    def id_to_short_name(self, team_id: str) -> Optional[str]:
        """Map a team slug id back to its short_name (or full name)."""
        if self._id_to_short_name_index is None:
            self._build_indexes()
        tid = team_id.strip()
        return (self._id_to_short_name_index or {}).get(tid)
