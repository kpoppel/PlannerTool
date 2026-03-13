"""Tests for Task 2: Add lightweight revision check.

Tests the methods for getting work item revision numbers with minimal data transfer.
"""
import pytest
from unittest.mock import Mock, MagicMock

from planner_lib.azure.AzureCachingClient import AzureCachingClient
from planner_lib.azure.work_items import WorkItemOperations
from planner_lib.storage.memory_backend import MemoryStorage


@pytest.fixture
def caching_client():
    """Create AzureCachingClient with mocked Azure connection."""
    storage = MemoryStorage()
    client = AzureCachingClient(
        organization_url="https://dev.azure.com/test",
        storage=storage
    )
    
    # Mock the connection and WIT client
    mock_conn = Mock()
    mock_wit_client = Mock()
    mock_conn.clients = Mock()
    mock_conn.clients.get_work_item_tracking_client.return_value = mock_wit_client
    mock_conn.base_url = "https://dev.azure.com/test"
    
    client.conn = mock_conn
    client._connected = True
    
    return client, mock_wit_client


def test_get_work_item_revision_returns_current_rev(caching_client):
    """Verify get_work_item_revision returns the current revision number."""
    client, mock_wit_client = caching_client
    work_item_id = 12345
    
    # Mock the Azure API response
    mock_work_item = Mock()
    mock_work_item.fields = {"System.Rev": 42}
    mock_wit_client.get_work_item.return_value = mock_work_item
    
    # Call the method
    revision = client._work_item_ops.get_work_item_revision(work_item_id)
    
    # Verify
    assert revision == 42
    mock_wit_client.get_work_item.assert_called_once_with(
        id=work_item_id,
        fields=["System.Rev"]
    )


def test_get_work_item_revision_handles_deleted_item(caching_client):
    """Verify get_work_item_revision returns None for deleted work items."""
    client, mock_wit_client = caching_client
    work_item_id = 99999
    
    # Mock the Azure API to raise an exception (work item not found)
    mock_wit_client.get_work_item.side_effect = Exception("Work item not found")
    
    # Call the method
    revision = client._work_item_ops.get_work_item_revision(work_item_id)
    
    # Should return None without raising
    assert revision is None


def test_get_work_item_revision_minimal_api_call(caching_client):
    """Verify that only System.Rev field is requested (minimal data transfer)."""
    client, mock_wit_client = caching_client
    work_item_id = 54321
    
    mock_work_item = Mock()
    mock_work_item.fields = {"System.Rev": 10}
    mock_wit_client.get_work_item.return_value = mock_work_item
    
    client._work_item_ops.get_work_item_revision(work_item_id)
    
    # Verify that fields parameter is used to limit data transfer
    call_args = mock_wit_client.get_work_item.call_args
    assert call_args.kwargs.get('fields') == ["System.Rev"]


def test_get_current_revision_wrapper(caching_client):
    """Verify _get_current_revision wrapper method works."""
    client, mock_wit_client = caching_client
    work_item_id = 77777
    
    mock_work_item = Mock()
    mock_work_item.fields = {"System.Rev": 100}
    mock_wit_client.get_work_item.return_value = mock_work_item
    
    # Call via the wrapper
    revision = client._get_current_revision(work_item_id)
    
    assert revision == 100


def test_get_current_revision_returns_none_on_error(caching_client):
    """Verify _get_current_revision returns None on error."""
    client, mock_wit_client = caching_client
    work_item_id = 88888
    
    mock_wit_client.get_work_item.side_effect = Exception("API error")
    
    # Should return None, not raise
    revision = client._get_current_revision(work_item_id)
    
    assert revision is None


def test_revision_check_not_connected_raises(caching_client):
    """Verify that revision check raises if client not connected."""
    client, _ = caching_client
    
    # Disconnect the client
    client._connected = False
    
    work_item_id = 12345
    
    # Should raise RuntimeError
    with pytest.raises(RuntimeError, match="not connected"):
        client._work_item_ops.get_work_item_revision(work_item_id)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
