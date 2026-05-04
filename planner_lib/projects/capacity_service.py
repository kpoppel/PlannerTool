"""CapacityService: parse/serialize/update team capacity blocks in work item descriptions."""
from __future__ import annotations

from typing import List, Optional
import re
import logging

logger = logging.getLogger(__name__)


class CapacityService:
    """Handles parsing and serializing the `[PlannerTool Team Capacity]` block.

    This class is stateless and depends on a TeamRepository for
    mapping team ids to short names when serializing.
    """

    def __init__(self, team_repository):
        # Accepts TeamRepository (or any object with name_to_id / id_to_short_name).
        self._team_repository = team_repository

    def parse(self, description: str) -> List[dict]:
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
            capacity_allocation: List[dict] = []
            for raw_line in (body.splitlines() or []):
                line = raw_line.strip()
                if not line:
                    continue

                # Skip commented capacity lines (hidden feature)
                if line.startswith('#'):
                    continue

                mm = re.match(r"^([^:]+)\s*:\s*(\d+)%?\s*$", line)
                if not mm:
                    continue
                team = mm.group(1).strip()

                # Clamp capacity to [0, 100]
                try:
                    capacity = int(mm.group(2))
                except Exception:
                    continue
                if capacity < 0:
                    capacity = 0
                if capacity > 100:
                    capacity = 100

                capacity_allocation.append({"team": team, "capacity": capacity})
            return capacity_allocation
        except Exception:
            return []

    def serialize(self, capacity_list: List[dict], cfg: dict) -> str:
        lines = ["[PlannerTool Team Capacity]"]
        for item in capacity_list:
            team_id = item["team"]
            capacity = item["capacity"]
            short_name = self._team_repository.id_to_short_name(team_id)
            lines.append(f"{short_name}: {capacity}")
        lines.append("[/PlannerTool Team Capacity]")

        return "\n".join(lines)

    def update_description(self, description: str, capacity_list: List[dict], cfg: dict) -> str:
        pattern = r"\[PlannerTool Team Capacity\].*?\[/PlannerTool Team Capacity\]"

        # Empty capacity list: remove the block entirely if present
        if not capacity_list:
            description = re.sub(pattern, '', description, flags=re.S)
            return description.rstrip('\n')

        # Serialize the new capacity block
        capacity_block = self.serialize(capacity_list, cfg)

        # Make the swap or append
        if re.search(pattern, description, flags=re.S):
            description = re.sub(pattern, capacity_block, description, flags=re.S)
        else:
            if not description.endswith("\n"):
                description += "\n"
            description += capacity_block

        return description

