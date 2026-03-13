"""Tests for Task 5: Add metrics and monitoring.

Tests that cache statistics are properly tracked and reported.
"""
import pytest
from unittest.mock import Mock, patch

from planner_lib.azure.AzureCachingClient import AzureCachingClient
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


def test_metrics_track_cache_hits(caching_client):
    """Verify that cache hits are tracked in metrics."""
    client, mock_wit_client = caching_client
    work_item_id = 12345
    
    mock_history = create_mock_history(work_item_id, 10)
    mock_work_item = Mock()
    mock_work_item.fields = {"System.Rev": 10}
    mock_wit_client.get_work_item.return_value = mock_work_item
    
    with patch.object(client._work_item_ops, 'get_task_revision_history',
                     return_value=mock_history):
        
        # First fetch
        client.get_task_revision_history(work_item_id)
        
        # Get initial stats
        stats = client.get_cache_stats()
        assert stats["history_cache_hits"] == 0
        assert stats["history_cache_misses"] == 1
        
        # Second fetch - should be cache hit
        client.get_task_revision_history(work_item_id)
        
        # Verify hit was tracked
        stats = client.get_cache_stats()
        assert stats["history_cache_hits"] == 1
        assert stats["history_cache_misses"] == 1
        
        # Third fetch - another hit
        client.get_task_revision_history(work_item_id)
        
        stats = client.get_cache_stats()
        assert stats["history_cache_hits"] == 2
        assert stats["history_cache_misses"] == 1


def test_metrics_track_cache_misses(caching_client):
    """Verify that cache misses are tracked in metrics."""
    client, mock_wit_client = caching_client
    
    mock_history1 = create_mock_history(1000, 5)
    mock_history2 = create_mock_history(2000, 8)
    
    mock_work_item_1 = Mock()
    mock_work_item_1.fields = {"System.Rev": 5}
    
    mock_work_item_2 = Mock()
    mock_work_item_2.fields = {"System.Rev": 8}
    
    mock_wit_client.get_work_item.side_effect = [mock_work_item_1, mock_work_item_2]
    
    with patch.object(client._work_item_ops, 'get_task_revision_history') as mock_fetch:
        mock_fetch.side_effect = [mock_history1, mock_history2]
        
        # Fetch two different work items
        client.get_task_revision_history(1000)
        client.get_task_revision_history(2000)
        
        stats = client.get_cache_stats()
        assert stats["history_cache_misses"] == 2
        assert stats["history_cache_hits"] == 0


def test_metrics_calculate_hit_rate(caching_client):
    """Verify that hit rate is correctly calculated."""
    client, mock_wit_client = caching_client
    work_item_id = 54321
    
    mock_history = create_mock_history(work_item_id, 15)
    mock_work_item = Mock()
    mock_work_item.fields = {"System.Rev": 15}
    mock_wit_client.get_work_item.return_value = mock_work_item
    
    with patch.object(client._work_item_ops, 'get_task_revision_history',
                     return_value=mock_history):
        
        # 1 miss (initial) + 4 hits
        for _ in range(5):
            client.get_task_revision_history(work_item_id)
        
        stats = client.get_cache_stats()
        assert stats["total_history_requests"] == 5
        assert stats["history_cache_hits"] == 4
        assert stats["history_cache_misses"] == 1
        assert stats["history_cache_hit_rate"] == "80.0%"


def test_metrics_track_api_calls_saved(caching_client):
    """Verify that API calls saved metric is tracked."""
    client, mock_wit_client = caching_client
    work_item_id = 99999
    
    mock_history = create_mock_history(work_item_id, 20)
    mock_work_item = Mock()
    mock_work_item.fields = {"System.Rev": 20}
    mock_wit_client.get_work_item.return_value = mock_work_item
    
    with patch.object(client._work_item_ops, 'get_task_revision_history',
                     return_value=mock_history):
        
        # Initial fetch
        client.get_task_revision_history(work_item_id)
        stats = client.get_cache_stats()
        assert stats["api_calls_saved"] == 0
        
        # 10 cache hits within TTL - saves 2 API calls each (revision check + history fetch)
        for _ in range(10):
            client.get_task_revision_history(work_item_id)
        
        stats = client.get_cache_stats()
        # Each fresh cache hit saves both revision check and history fetch
        assert stats["api_calls_saved"] == 20  # 10 hits * 2 calls saved


def test_metrics_track_revision_checks(caching_client):
    """Verify that revision checks are tracked."""
    client, mock_wit_client = caching_client
    work_item_id = 77777
    
    mock_history = create_mock_history(work_item_id, 12)
    mock_work_item = Mock()
    mock_work_item.fields = {"System.Rev": 12}
    mock_wit_client.get_work_item.return_value = mock_work_item
    
    with patch.object(client._work_item_ops, 'get_task_revision_history',
                     return_value=mock_history):
        
        # First fetch - no cache yet, so no revision check metric
        client.get_task_revision_history(work_item_id)
        stats = client.get_cache_stats()
        assert stats["revision_checks_performed"] == 0  # No cache, goes straight to fetch
        
        # Subsequent fetches within TTL - NO revision checks (TTL optimization)
        for _ in range(5):
            client.get_task_revision_history(work_item_id)
        
        stats = client.get_cache_stats()
        # Still 0 - all calls were within TTL
        assert stats["revision_checks_performed"] == 0
        
        # Force refresh to trigger revision checks
        for _ in range(3):
            client.get_task_revision_history(work_item_id, force_refresh=True)
        
        stats = client.get_cache_stats()
        # Now we should have 3 revision checks (one per forced refresh)
        assert stats["revision_checks_performed"] == 3


def test_metrics_zero_division_handled(caching_client):
    """Verify that hit rate calculation handles zero requests."""
    client, _ = caching_client
    
    # No requests yet
    stats = client.get_cache_stats()
    
    # Should not raise division by zero
    assert stats["history_cache_hit_rate"] == "0.0%"
    assert stats["total_history_requests"] == 0


def test_get_cache_stats_returns_all_metrics(caching_client):
    """Verify that get_cache_stats returns all expected metrics."""
    client, _ = caching_client
    
    stats = client.get_cache_stats()
    
    # Check all expected keys are present
    expected_keys = {
        "history_cache_hit_rate",
        "api_calls_saved",
        "history_cache_hits",
        "history_cache_misses",
        "revision_checks_performed",
        "total_history_requests"
    }
    
    assert set(stats.keys()) == expected_keys


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
