"""TeamRepository: single authoritative source for configured team data.

Delegates reads to the canonical configuration backend. Identity resolution
uses immutable allocation tokens, never mutable display labels.
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
        TeamConfigBackend implementation (reads persisted team/group identities).
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

    def allocation_token_to_id(self, token: str) -> Optional[str]:
        """Resolve only immutable persisted allocation tokens, including archived identities."""
        normalized = token.strip().lower()
        for record in self._backend.fetch_config_teams(include_archived=True):
            target = cast(AllocationTarget, record)
            if normalized == target['allocation_token'].strip().lower():
                return target['id']
        return None

    def id_to_allocation_token(self, team_id: str) -> Optional[str]:
        """Return the original immutable token through the capacity writer's existing port."""
        for record in self._backend.fetch_config_teams(include_archived=True):
            target = cast(AllocationTarget, record)
            if target['id'] == team_id:
                return target['allocation_token']
        return None
