"""TeamService: listing and mapping helpers for teams."""
from __future__ import annotations

from typing import List, Optional
import logging

from planner_lib.util import slugify
from planner_lib.services.interfaces import StorageProtocol
from planner_lib.projects.interfaces import TeamServiceProtocol

logger = logging.getLogger(__name__)


class TeamService(TeamServiceProtocol):
    """Service for team-related operations and mappings.

    This service reads teams configuration (schema v2).
    Teams marked with "exclude": true are filtered out from operations.
    """

    def __init__(self, storage_config: StorageProtocol):
        self._storage_config = storage_config

    def _get_teams_list(self, cfg: dict, include_excluded: bool = False) -> List[dict]:
        """Extract teams list from config.
        
        Args:
            cfg: The teams configuration dictionary
            include_excluded: If True, include teams marked with exclude=True
            
        Returns:
            List of team dictionaries
        """
        teams_list = cfg.get("teams") or []
        
        if not include_excluded:
            # Filter out teams marked as excluded
            teams_list = [t for t in teams_list if not t.get("exclude", False)]
        
        return teams_list

    def list_teams(self) -> List[dict]:
        cfg = self._storage_config.load("config", "teams")
        teams_list = self._get_teams_list(cfg, include_excluded=False)

        if teams_list:
            names: List[dict] = [
                {
                    "id": slugify(p.get("name"), prefix="team-"),
                    "name": p.get("name"),
                    "short_name": p.get("short_name"),
                }
                for p in teams_list
            ]
            logger.debug("Returning %d configured teams", len(names))
            return names

        logger.debug("No configured teams found; returning empty list")
        return []
    
    def name_to_id(self, name: str, cfg:dict) -> str|None:
        """Map token (name or short_name) to canonical frontend team id.
        """
        tkn = name.strip().lower()
        teams_cfg = self._storage_config.load("config", "teams")
        teams_list = self._get_teams_list(teams_cfg, include_excluded=False)
        for tm in teams_list:
            if tkn == tm["name"].lower() or tkn == tm["short_name"].lower():
                return slugify(tm["name"], prefix="team-")
        return None

    def id_to_short_name(self, team_id: str, cfg:dict) -> str|None:
        """Map a frontend team id (e.g. 'team-architecture') to its short_name.

        Returns the short_name if present, otherwise the full name.
        """
        tid = team_id.strip()
        # Use dedicated teams file rather than server_config
        teams_cfg = self._storage_config.load("config", "teams")
        teams_list = self._get_teams_list(teams_cfg, include_excluded=False)
        for tm in teams_list:
            slugified = slugify(tm["name"], prefix="team-")
            if tid == slugified:
                return tm["short_name"] if "short_name" in tm else tm["name"]
        return None
