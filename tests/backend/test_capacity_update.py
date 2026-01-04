"""Test capacity annotation update functionality."""
import pytest
from planner_lib.projects import (
    _parse_team_capacity, 
    _serialize_team_capacity,
    _serialize_team_capacity_with_mapping,
    _map_team_id_to_short_name,
    _update_description_with_capacity
)


def test_serialize_team_capacity():
    """Test serializing team capacity to text block."""
    capacity_list = [
        {"team": "team-frontend", "capacity": 80},
        {"team": "team-backend", "capacity": 60},
    ]
    result = _serialize_team_capacity(capacity_list)
    assert "[PlannerTool Team Capacity]" in result
    assert "team-frontend: 80" in result
    assert "team-backend: 60" in result
    assert "[/PlannerTool Team Capacity]" in result


def test_serialize_empty_capacity():
    """Test serializing empty capacity list."""
    result = _serialize_team_capacity([])
    assert result == ""


def test_update_description_adds_new_section():
    """Test adding capacity section to description without existing section."""
    description = "This is a work item description."
    capacity_list = [{"team": "INT", "capacity": 10}]
    
    result = _update_description_with_capacity(description, capacity_list)
    
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
    
    result = _update_description_with_capacity(description, capacity_list)
    
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
    
    result = _update_description_with_capacity(description, capacity_list)
    
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
    
    result = _parse_team_capacity(description)
    
    assert len(result) == 2
    assert {"team": "INT", "capacity": 10} in result
    assert {"team": "EXT", "capacity": 20} in result


def test_parse_team_capacity_with_percent():
    """Test parsing capacity with percent sign."""
    description = """[PlannerTool Team Capacity]
team-alpha: 75%
team-beta: 25%
[/PlannerTool Team Capacity]"""
    
    result = _parse_team_capacity(description)
    
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
    
    result = _parse_team_capacity(description)
    
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
    serialized = _serialize_team_capacity(original_capacity)
    
    # Update description
    updated_desc = _update_description_with_capacity("Original description.", original_capacity)
    
    # Parse back
    parsed = _parse_team_capacity(updated_desc)
    
    assert len(parsed) == len(original_capacity)
    for item in original_capacity:
        assert item in parsed


def test_map_team_id_to_short_name():
    """Test mapping team ID to short_name."""
    from types import SimpleNamespace
    
    # Mock config with team_map
    cfg = SimpleNamespace(
        team_map=[
            {"name": "Architecture", "short_name": "Arch"},
            {"name": "System Framework", "short_name": "SF"},
            {"name": "Integration Team", "short_name": "INT"},
        ]
    )
    
    assert _map_team_id_to_short_name("team-architecture", cfg) == "Arch"
    assert _map_team_id_to_short_name("team-system-framework", cfg) == "SF"
    assert _map_team_id_to_short_name("team-integration-team", cfg) == "INT"
    
    # Non-existent team should return original ID
    assert _map_team_id_to_short_name("team-unknown", cfg) == "team-unknown"
    
    # Without config should return original ID
    assert _map_team_id_to_short_name("team-architecture", None) == "team-architecture"


def test_serialize_with_mapping():
    """Test serializing with team ID to short_name mapping."""
    from types import SimpleNamespace
    
    cfg = SimpleNamespace(
        team_map=[
            {"name": "Architecture", "short_name": "Arch"},
            {"name": "Frontend", "short_name": "FE"},
        ]
    )
    
    capacity_list = [
        {"team": "team-architecture", "capacity": 90},
        {"team": "team-frontend", "capacity": 80},
    ]
    
    result = _serialize_team_capacity_with_mapping(capacity_list, cfg)
    
    assert "[PlannerTool Team Capacity]" in result
    assert "Arch: 90" in result
    assert "FE: 80" in result
    assert "team-architecture" not in result
    assert "team-frontend" not in result


def test_update_description_with_mapping():
    """Test updating description with team ID to short_name mapping."""
    from types import SimpleNamespace
    
    cfg = SimpleNamespace(
        team_map=[
            {"name": "Architecture", "short_name": "Arch"},
            {"name": "Backend", "short_name": "BE"},
        ]
    )
    
    description = "Work item description."
    capacity_list = [
        {"team": "team-architecture", "capacity": 100},
        {"team": "team-backend", "capacity": 50},
    ]
    
    result = _update_description_with_capacity(description, capacity_list, cfg)
    
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
    
    result = _update_description_with_capacity(description, capacity_list, cfg=None)
    
    # Without config, team IDs should be written as-is
    assert "team-architecture: 100" in result

