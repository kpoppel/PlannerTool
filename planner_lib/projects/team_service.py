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

    This service reads `team_map` from the server config when needed.
    """

    def __init__(self, storage_config: StorageProtocol):
        self._storage_config = storage_config

    def list_teams(self) -> List[dict]:
        cfg = self._storage_config.load("config", "server_config")
        team_map = cfg.get("team_map", {})
        if team_map:
            names: List[dict] = [
                {
                    "id": slugify(p.get("name"), prefix="team-"),
                    "name": p.get("name"),
                    "short_name": p.get("short_name"),
                }
                for p in team_map
            ]
            logger.debug("Returning %d configured teams", len(names))
            return names

        logger.debug("No configured teams found; returning empty list")
        return []
    
    def name_to_id(self, name: str, cfg:dict) -> str|None:
        """Map token (name or short_name) to canonical frontend team id.
        """
        tkn = name.strip().lower()
        for tm in cfg["team_map"]:
            if tkn == tm["name"].lower() or tkn == tm["short_name"].lower():
                return slugify(tm["name"], prefix="team-")
        return None

    def id_to_short_name(self, team_id: str, cfg:dict) -> str|None:
        """Map a frontend team id (e.g. 'team-architecture') to its short_name.

        Returns the short_name if present, otherwise the full name.
        """
        tid = team_id.strip()
        for tm in cfg["team_map"]:
            slugified = slugify(tm["name"], prefix="team-")
            if tid == slugified:
                return tm["short_name"] if tm["short_name"] else tm["name"]
        return None
