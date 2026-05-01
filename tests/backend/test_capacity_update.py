"""Test capacity annotation update functionality."""
import pytest

from planner_lib.repository.team_repository import TeamRepository
from planner_lib.projects.capacity_service import CapacityService
from planner_lib.util import slugify


# Lightweight fake TeamRepository for unit tests — avoids real storage.
class FakeTeamRepository:
    """TeamRepository stub: id_to_short_name looks up from an in-memory teams list."""

    def __init__(self, teams: list = None):
        self._teams = teams or []

    def id_to_short_name(self, team_id: str) -> str | None:
        if not self._teams:
            return team_id
        for tm in self._teams:
            if slugify(tm.get("name"), prefix="team-") == team_id:
                return tm.get("short_name") or tm.get("name")
        return None


team_repository = FakeTeamRepository()
cap_service = CapacityService(team_repository)


def test_serialize_team_capacity():
    """Test serializing team capacity to text block."""
    capacity_list = [
        {"team": "team-frontend", "capacity": 80},
        {"team": "team-backend", "capacity": 60},
    ]
    teams = [
        {"name": "Frontend", "short_name": "team-frontend"},
        {"name": "Backend", "short_name": "team-backend"},
    ]
    svc = CapacityService(FakeTeamRepository(teams))
    result = svc.serialize(capacity_list, cfg={})
    assert "[PlannerTool Team Capacity]" in result
    assert "team-frontend: 80" in result
    assert "team-backend: 60" in result
    assert "[/PlannerTool Team Capacity]" in result


def test_serialize_empty_capacity():
    """Test serializing empty capacity list."""
    result = cap_service.serialize([], cfg=None)
    # Empty lists serialize to an empty capacity block (header/footer).
    assert "[PlannerTool Team Capacity]" in result
    assert "[/PlannerTool Team Capacity]" in result


def test_update_description_adds_new_section():
    """Test adding capacity section to description without existing section."""
    description = "This is a work item description."
    capacity_list = [{"team": "INT", "capacity": 10}]
    
    result = cap_service.update_description(description, capacity_list, cfg=None)
    
    assert "This is a work item description." in result
    assert "[PlannerTool Team Capacity]" in result
    assert "INT: 10" in result
    assert "[/PlannerTool Team Capacity]" in result


def test_update_description_replaces_existing_section():
    """Test replacing existing capacity section in description."""
    description = """Work item details here.
[PlannerTool Team Capacity]
OLD-TEAM: 50
[/PlannerTool Team Capacity]
More details."""
    
    capacity_list = [
        {"team": "NEW-TEAM", "capacity": 90},
        {"team": "ANOTHER-TEAM", "capacity": 75},
    ]
    
    result = cap_service.update_description(description, capacity_list, cfg=None)
    
    assert "Work item details here." in result
    assert "More details." in result
    assert "OLD-TEAM" not in result
    assert "NEW-TEAM: 90" in result
    assert "ANOTHER-TEAM: 75" in result
    # Should only have one capacity section
    assert result.count("[PlannerTool Team Capacity]") == 1


def test_update_description_with_html_formatted():
    """Test updating HTML-formatted description."""
    description = """<div>Work item details</div>
<div>[PlannerTool Team Capacity]</div>
<div>TEAM-A: 40</div>
<div>[/PlannerTool Team Capacity]</div>"""
    
    capacity_list = [{"team": "TEAM-B", "capacity": 85}]
    
    result = cap_service.update_description(description, capacity_list, cfg=None)
    
    # Should replace the section even with HTML tags
    assert "TEAM-B: 85" in result
    assert result.count("[PlannerTool Team Capacity]") == 1


def test_parse_team_capacity_basic():
    """Test parsing basic capacity section."""
    description = """Some description
[PlannerTool Team Capacity]
INT: 10
EXT: 20
[/PlannerTool Team Capacity]"""
    
    result = cap_service.parse(description)
    
    assert len(result) == 2
    assert {"team": "INT", "capacity": 10} in result
    assert {"team": "EXT", "capacity": 20} in result


def test_parse_team_capacity_with_percent():
    """Test parsing capacity with percent sign."""
    description = """[PlannerTool Team Capacity]
team-alpha: 75%
team-beta: 25%
[/PlannerTool Team Capacity]"""
    
    result = cap_service.parse(description)
    
    assert len(result) == 2
    assert {"team": "team-alpha", "capacity": 75} in result
    assert {"team": "team-beta", "capacity": 25} in result


def test_parse_team_capacity_html():
    """Test parsing capacity from HTML-formatted description."""
    description = """<div>Description</div>
<br>[PlannerTool Team Capacity]<br>
team-1: 30<br>
team-2: 70<br>
[/PlannerTool Team Capacity]"""
    
    result = cap_service.parse(description)
    
    assert len(result) == 2
    assert {"team": "team-1", "capacity": 30} in result
    assert {"team": "team-2", "capacity": 70} in result


def test_round_trip():
    """Test that we can serialize, update, and parse back the same data."""
    original_capacity = [
        {"team": "team-frontend", "capacity": 80},
        {"team": "team-backend", "capacity": 60},
    ]
    
    # Serialize
    serialized = cap_service.serialize(original_capacity, cfg=None)
    
    # Update description
    updated_desc = cap_service.update_description("Original description.", original_capacity, cfg=None)
    
    # Parse back
    parsed = cap_service.parse(updated_desc)
    
    assert len(parsed) == len(original_capacity)
    for item in original_capacity:
        assert item in parsed


def test_map_team_id_to_short_name():
    """Test mapping team ID to short_name via TeamRepository."""
    teams = [
        {"name": "Architecture", "short_name": "Arch"},
        {"name": "System Framework", "short_name": "SF"},
        {"name": "Integration Team", "short_name": "INT"},
    ]
    repo = FakeTeamRepository(teams)
    assert repo.id_to_short_name("team-architecture") == "Arch"
    assert repo.id_to_short_name("team-system-framework") == "SF"
    assert repo.id_to_short_name("team-integration-team") == "INT"
    assert repo.id_to_short_name("team-unknown") is None


def test_serialize_with_mapping():
    """Test serializing with team ID to short_name mapping."""
    teams = [
        {"name": "Architecture", "short_name": "Arch"},
        {"name": "Frontend", "short_name": "FE"},
    ]
    svc = CapacityService(FakeTeamRepository(teams))
    capacity_list = [
        {"team": "team-architecture", "capacity": 90},
        {"team": "team-frontend", "capacity": 80},
    ]
    result = svc.serialize(capacity_list, cfg={})
    assert "[PlannerTool Team Capacity]" in result
    assert "Arch: 90" in result
    assert "FE: 80" in result
    assert "team-architecture" not in result
    assert "team-frontend" not in result


def test_update_description_with_mapping():
    """Test updating description with team ID to short_name mapping."""
    teams = [
        {"name": "Architecture", "short_name": "Arch"},
        {"name": "Backend", "short_name": "BE"},
    ]
    svc = CapacityService(FakeTeamRepository(teams))
    description = "Work item description."
    capacity_list = [
        {"team": "team-architecture", "capacity": 100},
        {"team": "team-backend", "capacity": 50},
    ]
    result = svc.update_description(description, capacity_list, {})
    assert "Arch: 100" in result
    assert "BE: 50" in result
    # Team IDs should not appear - only short names
    assert "team-architecture" not in result
    assert "team-backend" not in result


def test_update_description_without_config():
    """Test updating description without config uses team IDs directly."""
    description = "Work item description."
    capacity_list = [
        {"team": "team-architecture", "capacity": 100},
    ]
    
    result = cap_service.update_description(description, capacity_list, cfg=None)
    
    # Without config, team IDs should be written as-is
    assert "team-architecture: 100" in result

