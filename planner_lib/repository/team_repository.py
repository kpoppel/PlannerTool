"""TeamRepository: single authoritative source for configured team data.

Delegates all reads to LocalConfigBackend (via the ``local_backend``
DI key) so that team data benefits from the TTL cache.  Adds utility methods
(name_to_id, id_to_short_name) that search the cached domain list.
"""
from __future__ import annotations

import logging
from typing import List, Optional, cast

from planner_lib.domain.teams import AllocationTarget, DomainTeam

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

    def list_teams(self, *, include_archived: bool = False) -> List[DomainTeam]:
        """Return active choices, with archives available for existing calculations."""
        return self._backend.fetch_config_teams(include_archived=include_archived)

    def name_to_id(self, name: str) -> Optional[str]:
        """Resolve existing names/tokens, including archives, to the current team id."""
        tkn = name.strip().lower()
        for t in self._backend.fetch_config_teams(include_archived=True):
            if tkn == t.get("name", "").lower() or tkn == (t.get("short_name") or "").lower():
                return t["id"]
        return None

    def id_to_short_name(self, team_id: str) -> Optional[str]:
        """Resolve existing team IDs, including archives, for allocation serialization."""
        tid = team_id.strip()
        for t in self._backend.fetch_config_teams(include_archived=True):
            if t["id"] == tid:
                return t.get("short_name") or t.get("name")
        return None


class WorkforceTeamRepository(TeamRepository):
    """Canonical token-only repository, retaining unknown source tokens as unresolved."""

    def name_to_id(self, name: str) -> Optional[str]:
        """Resolve only immutable persisted tokens, including archived identities."""
        normalized = name.strip().lower()
        for record in self._backend.fetch_config_teams(include_archived=True):
            target = cast(AllocationTarget, record)
            if normalized == target['allocation_token'].strip().lower():
                return target['id']
        return None

    def id_to_short_name(self, team_id: str) -> Optional[str]:
        """Return the original immutable token through the capacity writer's existing port."""
        for record in self._backend.fetch_config_teams(include_archived=True):
            target = cast(AllocationTarget, record)
            if target['id'] == team_id:
                return target['allocation_token']
        return None
