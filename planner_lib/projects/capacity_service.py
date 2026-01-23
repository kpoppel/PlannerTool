"""CapacityService: parse/serialize/update team capacity blocks in work item descriptions."""
from __future__ import annotations

from typing import List, Optional
import re
import logging
from planner_lib.projects.team_service import TeamService

logger = logging.getLogger(__name__)


class CapacityService:
    """Handles parsing and serializing the `[PlannerTool Team Capacity]` block.

    This class is stateless and depends on an optional `cfg` for
    mapping team ids to short names when serializing.
    """

    def __init__(self, team_service: Optional[TeamService] = None):
        self._team_service = team_service

    def parse(self, description: Optional[str]) -> List[dict]:
        if not description or not isinstance(description, str):
            return []
        try:
            desc = description
            desc = re.sub(r"<br\s*/?>", "\n", desc, flags=re.I)
            desc = re.sub(r">\s*<", ">\n<", desc)
            desc = re.sub(r"</?\w+[^>]*>", "", desc)
            desc = desc.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")

            m = re.search(r"\[PlannerTool Team Capacity\](.*?)\[/PlannerTool Team Capacity\]", desc, flags=re.S)
            if not m:
                return []
            body = m.group(1)
            capacity_estimation: List[dict] = []
            for raw_line in (body.splitlines() or []):
                line = raw_line.strip()
                if not line:
                    continue
                if line.startswith('#'):
                    continue
                mm = re.match(r"^([^:]+)\s*:\s*(\d+)%?\s*$", line)
                if not mm:
                    continue
                team = mm.group(1).strip()
                try:
                    capacity = int(mm.group(2))
                except Exception:
                    continue
                if capacity < 0:
                    capacity = 0
                if capacity > 100:
                    capacity = 100
                capacity_estimation.append({"team": team, "capacity": capacity})
            return capacity_estimation
        except Exception:
            return []

    def serialize(self, capacity_list: List[dict]) -> str:
        if not capacity_list:
            return ""
        lines = ["[PlannerTool Team Capacity]"]
        for item in capacity_list:
            team = item.get("team", "")
            capacity = item.get("capacity", 0)
            if team:
                lines.append(f"{team}: {capacity}")
        lines.append("[/PlannerTool Team Capacity]")
        return "\n".join(lines)

    def serialize_with_mapping(self, capacity_list: List[dict], cfg) -> str:
        if not capacity_list:
            return ""
        lines = ["[PlannerTool Team Capacity]"]
        for item in capacity_list:
            team_id = item.get("team", "")
            capacity = item.get("capacity", 0)
            if not team_id:
                continue
            short_name = self._map_team_id_to_short_name(team_id, cfg)
            if short_name is None:
                continue
            lines.append(f"{short_name}: {capacity}")
        lines.append("[/PlannerTool Team Capacity]")
        return "\n".join(lines)

    def update_description(self, description: Optional[str], capacity_list: List[dict], cfg=None) -> str:
        if cfg:
            capacity_block = self.serialize_with_mapping(capacity_list, cfg)
        else:
            capacity_block = self.serialize(capacity_list)

        if not capacity_block:
            return description or ""

        desc = description or ""
        pattern = r"\[PlannerTool Team Capacity\].*?\[/PlannerTool Team Capacity\]"
        if re.search(pattern, desc, flags=re.S):
            desc = re.sub(pattern, capacity_block, desc, flags=re.S)
        else:
            if desc and not desc.endswith("\n"):
                desc += "\n"
            desc += capacity_block

        return desc

    def _map_team_id_to_short_name(self, team_id: str, cfg) -> Optional[str]:
        # Prefer an injected TeamService instance for mapping
        if self._team_service is not None:
            return self._team_service.id_to_short_name(team_id, cfg)

        # Fallback: create a temporary TeamService to use the mapping logic
        try:
            tmp = TeamService(storage_config=None)  # storage_config not used when cfg is supplied
            return tmp.id_to_short_name(team_id, cfg)
        except Exception:
            return None
