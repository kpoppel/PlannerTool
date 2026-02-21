"""Test task update API with capacity updates."""
import pytest
from unittest.mock import Mock, MagicMock, patch
from planner_lib.projects.task_service import TaskService
from planner_lib.projects.team_service import TeamService
from planner_lib.projects.capacity_service import CapacityService
from contextlib import contextmanager


# Instantiate a service for unit tests using a small storage stub that
# returns the `mock_config` fixture when `load` is called.
class _DummyStorage:
    def __init__(self, cfg):
        self._cfg = cfg

    def load(self, namespace, key):
        return self._cfg



@pytest.fixture
def mock_config():
    """Mock config with Azure organization and teams (schema v2)."""
    cfg = {
        "azure_devops_organization": "test-org",
        "teams": [
            {"name": "Frontend", "short_name": "FE"},
            {"name": "Backend", "short_name": "BE"},
            {"name": "Architecture", "short_name": "Arch"},
            {"name": "Integration Team", "short_name": "INT"},
            {"name": "System Framework", "short_name": "SF"},
            {"name": "Bluetooth", "short_name": "BT"},
            {"name": "Connectivity Interactions", "short_name": "CI"},
            {"name": "Signal Processing", "short_name": "SP"},
            {"name": "Hardware Abstraction", "short_name": "HA"},
            {"name": "Test Operations And Pipelines", "short_name": "TOP"},
            {"name": "Platform Tooling", "short_name": "PT"},
            {"name": "Requirements", "short_name": "REQ"},
        ]
    }
    return cfg


@pytest.fixture
def mock_client():
    """Mock Azure client."""
    client = Mock()
    
    # Mock work item tracking client
    wit_client = Mock()
    mock_work_item = Mock()
    mock_work_item.fields = {"System.Description": "Existing description"}
    wit_client.get_work_item = Mock(return_value=mock_work_item)
    
    # Mock connection structure
    client.conn = Mock()
    client.conn.clients = Mock()
    client.conn.clients.get_work_item_tracking_client = Mock(return_value=wit_client)
    
    # Mock update methods
    client.update_work_item_dates = Mock()
    client.update_work_item_description = Mock()
    
    return client


class _DummyAzureManager:
    def __init__(self, client):
        self._client = client

    @contextmanager
    def connect(self, pat: str):
        yield self._client


def test_update_tasks_with_dates_only(mock_config, mock_client):
    """Test updating task with only date changes."""
    storage = _DummyStorage(mock_config)
    team_svc = TeamService(storage_config=storage)
    capacity_svc = CapacityService(team_svc)
    class _DummyProjectService:
        def get_project_map(self):
            return []

    proj_svc = _DummyProjectService()
    azure_mgr = _DummyAzureManager(mock_client)
    service = TaskService(storage_config=storage, project_service=proj_svc, team_service=team_svc, capacity_service=capacity_svc, azure_client=azure_mgr)
    
    updates = [
        {"id": 12345, "start": "2026-01-01", "end": "2026-01-31"}
    ]

    result = service.update_tasks(updates, pat='dummy-pat')

    assert result["ok"] is True
    assert result["updated"] == 1
    assert len(result["errors"]) == 0

    # Verify dates were updated
    mock_client.update_work_item_dates.assert_called_once_with(
        12345, start="2026-01-01", end="2026-01-31"
    )

    # Verify description was NOT updated
    mock_client.update_work_item_description.assert_not_called()


def test_update_tasks_with_capacity_only(mock_config, mock_client):
    """Test updating task with only capacity changes."""
    storage = _DummyStorage(mock_config)
    team_svc = TeamService(storage_config=storage)
    capacity_svc = CapacityService(team_svc)
    class _DummyProjectService:
        def get_project_map(self):
            return []

    proj_svc = _DummyProjectService()
    azure_mgr = _DummyAzureManager(mock_client)
    service = TaskService(storage_config=storage, project_service=proj_svc, team_service=team_svc, capacity_service=capacity_svc, azure_client=azure_mgr)
    
    updates = [
        {
            "id": 12345,
            "capacity": [
                {"team": "team-frontend", "capacity": 80},
                {"team": "team-backend", "capacity": 60}
            ]
        }
    ]

    result = service.update_tasks(updates, pat='dummy-pat')

    assert result["ok"] is True
    assert result["updated"] == 1
    assert len(result["errors"]) == 0

    # Verify dates were NOT updated
    mock_client.update_work_item_dates.assert_not_called()

    # Verify description was updated
    mock_client.update_work_item_description.assert_called_once()
    call_args = mock_client.update_work_item_description.call_args
    assert call_args[0][0] == 12345
    updated_desc = call_args[0][1]
    assert "[PlannerTool Team Capacity]" in updated_desc
    # Team IDs should be converted to short names
    assert "FE: 80" in updated_desc
    assert "BE: 60" in updated_desc
    # Original team IDs should NOT appear
    assert "team-frontend" not in updated_desc
    assert "team-backend" not in updated_desc


def test_update_tasks_with_dates_and_capacity(mock_config, mock_client):
    """Test updating task with both dates and capacity changes."""
    storage = _DummyStorage(mock_config)
    team_svc = TeamService(storage_config=storage)
    capacity_svc = CapacityService(team_svc)
    class _DummyProjectService:
        def get_project_map(self):
            return []

    proj_svc = _DummyProjectService()
    azure_mgr = _DummyAzureManager(mock_client)
    service = TaskService(storage_config=storage, project_service=proj_svc, team_service=team_svc, capacity_service=capacity_svc, azure_client=azure_mgr)

    updates = [
        {
            "id": 12345,
            "start": "2026-01-01",
            "end": "2026-01-31",
            "capacity": [
                {"team": "INT", "capacity": 10},
                {"team": "EXT", "capacity": 20}
            ]
        }
    ]

    result = service.update_tasks(updates, pat='dummy-pat')

    assert result["ok"] is True
    assert result["updated"] == 1
    assert len(result["errors"]) == 0

    # Verify both dates and description were updated
    mock_client.update_work_item_dates.assert_called_once_with(
        12345, start="2026-01-01", end="2026-01-31"
    )
    mock_client.update_work_item_description.assert_called_once()


def test_update_tasks_multiple_items(mock_config, mock_client):
    """Test updating multiple tasks with mixed updates."""
    storage = _DummyStorage(mock_config)
    team_svc = TeamService(storage_config=storage)
    capacity_svc = CapacityService(team_svc)
    class _DummyProjectService:
        def get_project_map(self):
            return []

    proj_svc = _DummyProjectService()
    azure_mgr = _DummyAzureManager(mock_client)
    service = TaskService(storage_config=storage, project_service=proj_svc, team_service=team_svc, capacity_service=capacity_svc, azure_client=azure_mgr)

    updates = [
        {"id": 100, "start": "2026-01-01"},
        {"id": 200, "capacity": [{"team": "team-a", "capacity": 50}]},
        {"id": 300, "start": "2026-02-01", "end": "2026-02-28", 
         "capacity": [{"team": "team-b", "capacity": 75}]}
    ]

    result = service.update_tasks(updates, pat='dummy-pat')

    assert result["ok"] is True
    assert result["updated"] == 3
    assert len(result["errors"]) == 0


def test_update_tasks_with_errors(mock_config, mock_client):
    """Test handling errors during updates."""
    # Make dates update fail for work item 100
    def mock_update_dates(wid, start=None, end=None):
        if wid == 100:
            raise Exception("Date update failed")
    
    mock_client.update_work_item_dates.side_effect = mock_update_dates
    
    storage = _DummyStorage(mock_config)
    team_svc = TeamService(storage_config=storage)
    capacity_svc = CapacityService(team_svc)
    class _DummyProjectService:
        def get_project_map(self):
            return []

    proj_svc = _DummyProjectService()
    azure_mgr = _DummyAzureManager(mock_client)
    service = TaskService(storage_config=storage, project_service=proj_svc, team_service=team_svc, capacity_service=capacity_svc, azure_client=azure_mgr)

    updates = [
        {"id": 100, "start": "2026-01-01"},
        {"id": 200, "start": "2026-02-01"}
    ]

    result = service.update_tasks(updates, pat='dummy-pat')

    assert result["ok"] is False
    assert result["updated"] == 1  # One succeeded
    assert len(result["errors"]) == 1
    assert "100" in result["errors"][0]


def test_update_tasks_invalid_id(mock_config, mock_client):
    """Test handling invalid work item ID."""
    storage = _DummyStorage(mock_config)
    team_svc = TeamService(storage_config=storage)
    capacity_svc = CapacityService(team_svc)
    class _DummyProjectService:
        def get_project_map(self):
            return []

    proj_svc = _DummyProjectService()
    azure_mgr = _DummyAzureManager(mock_client)
    service = TaskService(storage_config=storage, project_service=proj_svc, team_service=team_svc, capacity_service=capacity_svc, azure_client=azure_mgr)

    updates = [
        {"id": "not-a-number", "start": "2026-01-01"}
    ]

    result = service.update_tasks(updates, pat='dummy-pat')

    assert result["ok"] is False
    assert result["updated"] == 0
    assert len(result["errors"]) == 1
    assert "Invalid work item id" in result["errors"][0]


def test_update_tasks_empty_capacity(mock_config, mock_client):
    """Test updating with empty capacity list."""
    storage = _DummyStorage(mock_config)
    team_svc = TeamService(storage_config=storage)
    capacity_svc = CapacityService(team_svc)
    class _DummyProjectService:
        def get_project_map(self):
            return []

    proj_svc = _DummyProjectService()
    azure_mgr = _DummyAzureManager(mock_client)
    service = TaskService(storage_config=storage, project_service=proj_svc, team_service=team_svc, capacity_service=capacity_svc, azure_client=azure_mgr)

    updates = [
        {"id": 12345, "capacity": []}
    ]

    result = service.update_tasks(updates, pat='dummy-pat')

    assert result["ok"] is True
    assert result["updated"] == 1
    # Empty capacity list should still trigger update (clears capacity section)
    mock_client.update_work_item_description.assert_called_once()


def test_update_tasks_capacity_format_validation(mock_config, mock_client):
    """Test that capacity data matches expected format."""
    storage = _DummyStorage(mock_config)
    team_svc = TeamService(storage_config=storage)
    capacity_svc = CapacityService(team_svc)
    class _DummyProjectService:
        def get_project_map(self):
            return []

    proj_svc = _DummyProjectService()
    azure_mgr = _DummyAzureManager(mock_client)
    service = TaskService(storage_config=storage, project_service=proj_svc, team_service=team_svc, capacity_service=capacity_svc, azure_client=azure_mgr)

    # Test with the exact format from the user's example
    updates = [
        {
            "id": 12345,
            "capacity": [
                {"team": "team-integration-team", "capacity": 10},
                {"team": "team-system-framework", "capacity": 20},
                {"team": "team-bluetooth", "capacity": 30},
                {"team": "team-connectivity-interactions", "capacity": 40},
                {"team": "team-signal-processing", "capacity": 50},
                {"team": "team-hardware-abstraction", "capacity": 60},
                {"team": "team-test-operations-and-pipelines", "capacity": 70},
                {"team": "team-platform-tooling", "capacity": 80},
                {"team": "team-architecture", "capacity": 90},
                {"team": "team-requirements", "capacity": 100}
            ]
        }
    ]

    result = service.update_tasks(updates, pat='dummy-pat')

    assert result["ok"] is True
    assert result["updated"] == 1

    # Verify the description contains all teams (as short names)
    mock_client.update_work_item_description.assert_called_once()
    call_args = mock_client.update_work_item_description.call_args
    updated_desc = call_args[0][1]

    # Team IDs should be converted to short names
    assert "INT: 10" in updated_desc
    assert "SF: 20" in updated_desc
    assert "Arch: 90" in updated_desc
    assert "REQ: 100" in updated_desc

    # Original team IDs should NOT appear
    assert "team-integration-team" not in updated_desc
    assert "team-architecture" not in updated_desc
