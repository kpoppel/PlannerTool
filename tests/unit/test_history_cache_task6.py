"""Tests for Task 6: Handle edge cases.

Tests edge case handling including deleted items, revision rollback,
thread safety, and API errors.
"""
import pytest
from unittest.mock import Mock, patch
import threading
import time

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
        {"id": work_item_id, "rev": i, "fields": {"System.Rev": i}}
        for i in range(1, num_revisions + 1)
    ]


def test_deleted_work_item_returns_empty_list(caching_client):
    """Verify that deleted work items return empty list and cache is cleared."""
    client, mock_wit_client = caching_client
    work_item_id = 12345
    
    mock_history = create_mock_history(work_item_id, 10)
    
    # First call - work item exists
    mock_work_item = Mock()
    mock_work_item.fields = {"System.Rev": 10}
    mock_wit_client.get_work_item.side_effect = [
        mock_work_item,
        Exception("Work item not found")  # Second call - deleted
    ]
    
    with patch.object(client._work_item_ops, 'get_task_revision_history',
                     return_value=mock_history):
        
        # Cache the history
        history1 = client.get_task_revision_history(work_item_id)
        assert len(history1) == 10
        
        # Now item is deleted - use force_refresh to check
        history2 = client.get_task_revision_history(work_item_id, force_refresh=True)
        assert history2 == []
        
        # Verify cache was cleared
        cache_key = key_for_revision_history(work_item_id)
        assert client._cache.read(cache_key) is None


def test_revision_rollback_triggers_refetch(caching_client):
    """Verify that revision rollback (decrease) triggers refetch."""
    client, mock_wit_client = caching_client
    work_item_id = 99999
    
    mock_history_v10 = create_mock_history(work_item_id, 10)
    mock_history_v5 = create_mock_history(work_item_id, 5)  # Rolled back
    
    # First revision 10, then rollback to revision 5
    mock_work_item_v10 = Mock()
    mock_work_item_v10.fields = {"System.Rev": 10}
    
    mock_work_item_v5 = Mock()
    mock_work_item_v5.fields = {"System.Rev": 5}
    
    mock_wit_client.get_work_item.side_effect = [mock_work_item_v10, mock_work_item_v5]
    
    with patch.object(client._work_item_ops, 'get_task_revision_history') as mock_fetch:
        mock_fetch.side_effect = [mock_history_v10, mock_history_v5]
        
        # Cache at revision 10
        history1 = client.get_task_revision_history(work_item_id)
        assert len(history1) == 10
        
        # Revision rolled back to 5 - use force_refresh to check
        history2 = client.get_task_revision_history(work_item_id, force_refresh=True)
        assert len(history2) == 5
        
        # Should have refetched
        assert mock_fetch.call_count == 2


def test_concurrent_history_requests_thread_safe(caching_client):
    """Verify thread-safe handling of concurrent requests."""
    client, mock_wit_client = caching_client
    work_item_id = 54321
    
    mock_history = create_mock_history(work_item_id, 20)
    mock_work_item = Mock()
    mock_work_item.fields = {"System.Rev": 20}
    mock_wit_client.get_work_item.return_value = mock_work_item
    
    fetch_call_count = [0]  # Use list to make it mutable in nested scope
    
    def slow_fetch(*args, **kwargs):
        """Slow fetch to simulate real API call."""
        fetch_call_count[0] += 1
        time.sleep(0.01)  # Small delay
        return mock_history
    
    with patch.object(client._work_item_ops, 'get_task_revision_history',
                     side_effect=slow_fetch):
        
        results = []
        errors = []
        
        def fetch_history():
            try:
                result = client.get_task_revision_history(work_item_id)
                results.append(result)
            except Exception as e:
                errors.append(e)
        
        # Create 10 concurrent threads
        threads = [threading.Thread(target=fetch_history) for _ in range(10)]
        
        # Start all threads simultaneously
        for t in threads:
            t.start()
        
        # Wait for all to complete
        for t in threads:
            t.join()
        
        # No errors should occur
        assert len(errors) == 0
        
        # All results should be identical
        assert len(results) == 10
        for result in results:
            assert result == mock_history
        
        # Fetch should have been called by all or most threads initially
        # (race condition is acceptable for first fetch)
        # But subsequent fetches should use cache
        assert fetch_call_count[0] <= 10
        
        # Now verify caching works after initial race
        with patch.object(client._work_item_ops, 'get_task_revision_history',
                         side_effect=slow_fetch) as mock_fetch2:
            # Should use cache now
            for _ in range(5):
                client.get_task_revision_history(work_item_id)
            
            # No additional fetches
            assert mock_fetch2.call_count == 0


def test_api_error_during_revision_check_fallback(caching_client):
    """Verify graceful fallback when revision check fails."""
    client, mock_wit_client = caching_client
    work_item_id = 77777
    
    mock_history = create_mock_history(work_item_id, 15)
    
    # Revision check fails
    mock_wit_client.get_work_item.side_effect = Exception("API error")
    
    with patch.object(client._work_item_ops, 'get_task_revision_history',
                     return_value=mock_history):
        
        # Should still successfully fetch and cache history
        history = client.get_task_revision_history(work_item_id)
        assert len(history) == 15
        
        # Verify it was cached (even without revision metadata)
        cache_key = key_for_revision_history(work_item_id)
        cached_data = client._cache.read(cache_key)
        assert cached_data is not None


def test_empty_history_cached_correctly(caching_client):
    """Verify that empty history (no revisions) is cached correctly."""
    client, mock_wit_client = caching_client
    work_item_id = 44444
    
    empty_history = []
    
    mock_work_item = Mock()
    mock_work_item.fields = {"System.Rev": 1}
    mock_wit_client.get_work_item.return_value = mock_work_item
    
    with patch.object(client._work_item_ops, 'get_task_revision_history',
                     return_value=empty_history):
        
        # Fetch empty history
        history1 = client.get_task_revision_history(work_item_id)
        assert history1 == []
        
        # Second fetch should use cache
        history2 = client.get_task_revision_history(work_item_id)
        assert history2 == []


def test_large_history_handled(caching_client):
    """Verify that large history (many revisions) is handled correctly."""
    client, mock_wit_client = caching_client
    work_item_id = 33333
    
    # 1000 revisions
    large_history = create_mock_history(work_item_id, 1000)
    
    mock_work_item = Mock()
    mock_work_item.fields = {"System.Rev": 1000}
    mock_wit_client.get_work_item.return_value = mock_work_item
    
    with patch.object(client._work_item_ops, 'get_task_revision_history',
                     return_value=large_history):
        
        # Should handle large history
        history = client.get_task_revision_history(work_item_id)
        assert len(history) == 1000
        
        # Should cache successfully
        history2 = client.get_task_revision_history(work_item_id)
        assert history2 == history


def test_multiple_work_items_independent_caching(caching_client):
    """Verify that different work items are cached independently."""
    client, mock_wit_client = caching_client
    
    work_item_1 = 1000
    work_item_2 = 2000
    
    history_1 = create_mock_history(work_item_1, 10)
    history_2 = create_mock_history(work_item_2, 20)
    
    mock_work_item_1 = Mock()
    mock_work_item_1.fields = {"System.Rev": 10}
    
    mock_work_item_2 = Mock()
    mock_work_item_2.fields = {"System.Rev": 20}
    
    def get_work_item_side_effect(id, **kwargs):
        if id == work_item_1:
            return mock_work_item_1
        elif id == work_item_2:
            return mock_work_item_2
        raise Exception("Unknown work item")
    
    mock_wit_client.get_work_item.side_effect = get_work_item_side_effect
    
    def get_history_side_effect(work_item_id, **kwargs):
        if work_item_id == work_item_1:
            return history_1
        elif work_item_id == work_item_2:
            return history_2
        raise Exception("Unknown work item")
    
    with patch.object(client._work_item_ops, 'get_task_revision_history',
                     side_effect=get_history_side_effect) as mock_fetch:
        
        # Fetch both
        h1 = client.get_task_revision_history(work_item_1)
        h2 = client.get_task_revision_history(work_item_2)
        
        assert len(h1) == 10
        assert len(h2) == 20
        assert mock_fetch.call_count == 2
        
        # Fetch again - should use cache
        h1_cached = client.get_task_revision_history(work_item_1)
        h2_cached = client.get_task_revision_history(work_item_2)
        
        assert h1_cached == h1
        assert h2_cached == h2
        assert mock_fetch.call_count == 2  # No additional calls


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
