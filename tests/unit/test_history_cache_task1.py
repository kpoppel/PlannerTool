"""Tests for Task 1: Cache data structure updates for revision tracking.

Tests the helper methods for reading and writing history cache entries
with revision metadata.
"""
import pytest
from unittest.mock import Mock
from typing import List

from planner_lib.azure.AzureCachingClient import AzureCachingClient
from planner_lib.azure.caching import key_for_area, key_for_revision_history
from planner_lib.storage.memory_backend import MemoryStorage


@pytest.fixture
def caching_client():
    """Create AzureCachingClient with memory storage."""
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
    
    return client


def test_write_history_cache_stores_revision_metadata(caching_client):
    """Verify that _write_history_cache stores revision metadata."""
    work_item_id = 12345
    revision = 42
    history = [
        {"id": work_item_id, "rev": 1, "fields": {"System.State": "New"}},
        {"id": work_item_id, "rev": 2, "fields": {"System.State": "Active"}},
    ]
    
    # Write history with revision
    caching_client._write_history_cache(work_item_id, history, revision)
    
    # Read directly from cache
    cache_key = key_for_revision_history(work_item_id)
    cached_entry = caching_client._cache.read(cache_key)
    
    # Verify structure
    assert cached_entry is not None
    assert "data" in cached_entry
    assert "metadata" in cached_entry
    assert cached_entry["data"] == history
    assert cached_entry["metadata"]["revision"] == revision
    assert cached_entry["metadata"]["work_item_id"] == work_item_id


def test_read_history_cache_returns_tuple(caching_client):
    """Verify that _read_history_cache returns (history, revision, is_fresh) tuple."""
    work_item_id = 99999
    revision = 10
    history = [{"id": work_item_id, "rev": i} for i in range(1, 11)]
    
    # Write using new method
    caching_client._write_history_cache(work_item_id, history, revision)
    
    # Read using new method
    cached_history, cached_revision, is_fresh = caching_client._read_history_cache(work_item_id)
    
    # Verify
    assert cached_history == history
    assert cached_revision == revision
    assert is_fresh is True  # Should be fresh right after writing


def test_read_history_cache_returns_none_for_missing(caching_client):
    """Verify that _read_history_cache returns (None, None, False) for missing entries."""
    work_item_id = 77777
    
    cached_history, cached_revision, is_fresh = caching_client._read_history_cache(work_item_id)
    
    assert cached_history is None
    assert cached_revision is None
    assert is_fresh is False


def test_cache_handles_invalid_format(caching_client):
    """Verify that invalid cache format returns None to trigger refetch."""
    work_item_id = 55555
    cache_key = key_for_revision_history(work_item_id)
    
    # Write invalid format (just a list, no metadata)
    invalid_history = [
        {"id": work_item_id, "rev": 1, "fields": {"System.Rev": 1}},
        {"id": work_item_id, "rev": 2, "fields": {"System.Rev": 2}},
    ]
    caching_client._cache.write(cache_key, invalid_history)
    caching_client._cache.update_timestamp(cache_key)
    
    # Read should return None to force refetch
    cached_history, cached_revision, is_fresh = caching_client._read_history_cache(work_item_id)
    
    assert cached_history is None
    assert cached_revision is None
    assert is_fresh is False


def test_cache_handles_malformed_format(caching_client):
    """Verify that malformed cache entries return None."""
    work_item_id = 44444
    cache_key = key_for_revision_history(work_item_id)
    
    # Write malformed format (missing metadata)
    malformed_data = {"data": [{"rev": 1}]}  # Missing metadata
    caching_client._cache.write(cache_key, malformed_data)
    
    # Should return None to trigger refetch
    cached_history, cached_revision, is_fresh = caching_client._read_history_cache(work_item_id)
    
    assert cached_history is None
    assert cached_revision is None
    assert is_fresh is False


def test_write_then_read_roundtrip(caching_client):
    """Verify write/read round-trip preserves data."""
    work_item_id = 33333
    revision = 100
    history = [{"rev": i, "data": f"revision {i}"} for i in range(1, 101)]
    
    # Write
    caching_client._write_history_cache(work_item_id, history, revision)
    
    # Read
    read_history, read_revision, is_fresh = caching_client._read_history_cache(work_item_id)
    
    # Verify exact match
    assert read_history == history
    assert read_revision == revision
    assert is_fresh is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
