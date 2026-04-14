"""Tests for Task 3: Implement revision-based validation.

Tests the complete flow of checking revision before refetching history.
"""
import pytest
from unittest.mock import Mock, patch

from planner_lib.azure.AzureCachingClient import AzureCachingClient
from planner_lib.azure.caching import key_for_area, key_for_revision_history
from planner_lib.storage.memory_backend import MemoryStorage


@pytest.fixture
def caching_client():
    """Create AzureCachingClient with mocked Azure connection."""
    storage = MemoryStorage()
    client = AzureCachingClient(
        organization_url="https://dev.azure.com/test",
        storage=storage
    )
    
    # Mock the connection
    mock_conn = Mock()
    mock_wit_client = Mock()
    mock_conn.clients = Mock()
    mock_conn.clients.get_work_item_tracking_client.return_value = mock_wit_client
    
    client.conn = mock_conn
    client._connected = True
    
    return client, mock_wit_client


def create_mock_history(work_item_id: int, num_revisions: int = 10):
    """Create mock revision history."""
    return [
        {"id": work_item_id, "rev": i,  "fields": {"System.Rev": i, "System.State": "Active"}}
        for i in range(1, num_revisions + 1)
    ]


def test_cache_hit_when_revision_unchanged(caching_client):
    """Verify cache hit when work item revision hasn't changed."""
    client, mock_wit_client = caching_client
    work_item_id = 12345
    revision = 10
    
    mock_history = create_mock_history(work_item_id, 10)
    
    # Setup: Mock get_work_item to return revision
    mock_work_item = Mock()
    mock_work_item.fields = {"System.Rev": revision}
    mock_wit_client.get_work_item.return_value = mock_work_item
    
    with patch.object(client._work_item_ops, 'get_task_revision_history', 
                     return_value=mock_history) as mock_fetch:
        
        # First fetch - should call API
        history1 = client.get_task_revision_history(work_item_id)
        assert len(history1) == 10
        assert mock_fetch.call_count == 1
        
        # Second fetch - revision unchanged, should use cache (no history API call)
        history2 = client.get_task_revision_history(work_item_id)
        assert history2 == history1
        assert mock_fetch.call_count == 1  # Still 1, no additional call
        
        # Verify revision was checked
        assert mock_wit_client.get_work_item.called


def test_cache_miss_when_revision_changed(caching_client):
    """Verify cache miss and refetch when work item revision changed (force refresh)."""
    client, mock_wit_client = caching_client
    work_item_id = 99999
    
    initial_history = create_mock_history(work_item_id, 10)
    updated_history = create_mock_history(work_item_id, 11)  # One more revision
    
    # Setup: First revision is 10, then changes to 11
    mock_work_item_rev10 = Mock()
    mock_work_item_rev10.fields = {"System.Rev": 10}
    
    mock_work_item_rev11 = Mock()
    mock_work_item_rev11.fields = {"System.Rev": 11}
    
    # First call returns rev 10, second call returns rev 11
    mock_wit_client.get_work_item.side_effect = [mock_work_item_rev10, mock_work_item_rev11]
    
    with patch.object(client._work_item_ops, 'get_task_revision_history') as mock_fetch:
        mock_fetch.side_effect = [initial_history, updated_history]
        
        # First fetch
        history1 = client.get_task_revision_history(work_item_id)
        assert len(history1) == 10
        assert mock_fetch.call_count == 1
        
        # Second fetch with force_refresh - revision changed, should refetch
        history2 = client.get_task_revision_history(work_item_id, force_refresh=True)
        assert len(history2) == 11
        assert mock_fetch.call_count == 2  # Additional call


def test_cache_invalidated_for_deleted_item(caching_client):
    """Verify cache invalidated and empty list returned for deleted work item (force refresh)."""
    client, mock_wit_client = caching_client
    work_item_id = 77777
    
    mock_history = create_mock_history(work_item_id, 5)
    
    # Setup: First call succeeds, second call fails (item deleted)
    mock_work_item = Mock()
    mock_work_item.fields = {"System.Rev": 5}
    
    mock_wit_client.get_work_item.side_effect = [
        mock_work_item,  # First call - item exists
        Exception("Work item not found")  # Second call - item deleted
    ]
    
    with patch.object(client._work_item_ops, 'get_task_revision_history',
                     return_value=mock_history):
        
        # First fetch - succeeds
        history1 = client.get_task_revision_history(work_item_id)
        assert len(history1) == 5
        
        # Second fetch with force_refresh - work item deleted
        history2 = client.get_task_revision_history(work_item_id, force_refresh=True)
        assert history2 == []
        
        # Verify cache was cleared
        cache_key = key_for_revision_history(work_item_id)
        assert client._cache.read(cache_key) is None


def test_revision_check_before_ttl_expiry(caching_client):
    """Verify TTL optimization: fresh cache returns immediately without revision checks."""
    client, mock_wit_client = caching_client
    work_item_id = 55555
    
    mock_history = create_mock_history(work_item_id, 20)
    
    # Mock work item with same revision
    mock_work_item = Mock()
    mock_work_item.fields = {"System.Rev": 20}
    mock_wit_client.get_work_item.return_value = mock_work_item
    
    with patch.object(client._work_item_ops, 'get_task_revision_history',
                     return_value=mock_history) as mock_fetch:
        
        # First fetch - will fetch from Azure and check revision
        client.get_task_revision_history(work_item_id)
        initial_fetch_count = mock_fetch.call_count
        initial_revision_checks = mock_wit_client.get_work_item.call_count
        
        # Multiple fetches within TTL - should NOT check revision
        for _ in range(5):
            client.get_task_revision_history(work_item_id)
        
        # History API should only have been called once
        assert mock_fetch.call_count == initial_fetch_count
        
        # Revision check should also only have been called once (within TTL)
        # This is the TTL optimization - no Azure calls for fresh cache
        assert mock_wit_client.get_work_item.call_count == initial_revision_checks


def test_concurrent_requests_same_work_item(caching_client):
    """Verify thread-safe handling of concurrent requests for same work item."""
    client, mock_wit_client = caching_client
    work_item_id = 44444
    
    mock_history = create_mock_history(work_item_id, 15)
    
    mock_work_item = Mock()
    mock_work_item.fields = {"System.Rev": 15}
    mock_wit_client.get_work_item.return_value = mock_work_item
    
    with patch.object(client._work_item_ops, 'get_task_revision_history',
                     return_value=mock_history) as mock_fetch:
        
        # First request establishes cache
        history1 = client.get_task_revision_history(work_item_id)
        
        # Subsequent concurrent requests should all use cache
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            futures = [
                executor.submit(client.get_task_revision_history, work_item_id)
                for _ in range(10)
            ]
            results = [f.result() for f in futures]
        
        # All should return same data
        for result in results:
            assert result == history1
        
        # History should not have been fetched multiple times
        # (may be called once or twice due to timing, but not 10+ times)
        assert mock_fetch.call_count < 5


def test_fallback_when_revision_unavailable(caching_client):
    """Verify fallback to basic caching when revision can't be determined."""
    client, mock_wit_client = caching_client
    work_item_id = 33333
    
    mock_history = create_mock_history(work_item_id, 8)
    
    # Mock revision check to fail
    mock_wit_client.get_work_item.side_effect = Exception("API error")
    
    with patch.object(client._work_item_ops, 'get_task_revision_history',
                     return_value=mock_history) as mock_fetch:
        
        # Should still cache successfully (fallback mode)
        history = client.get_task_revision_history(work_item_id)
        assert len(history) == 8
        assert mock_fetch.call_count == 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
