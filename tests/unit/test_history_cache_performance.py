"""Performance comparison test: Baseline vs Optimized history caching.

This test measures and compares the performance characteristics of:
- Baseline: TTL-based expiration always refetches history
- Optimized: Revision-based change detection skips unnecessary fetches
"""
import pytest
from unittest.mock import Mock, patch
from datetime import datetime, timedelta, timezone
from typing import List

from planner_lib.azure.AzureCachingClient import AzureCachingClient
from planner_lib.storage.memory_backend import MemoryStorage


def create_mock_history(work_item_id: int, num_revisions: int = 100):
    """Create mock revision history (expensive operation)."""
    return [
        {
            "id": work_item_id,
            "rev": i,
            "fields": {
                "System.Rev": i,
                "System.State": "Active",
                "System.ChangedDate": datetime.now().isoformat(),
                "System.IterationPath": "Sprint 1"
            }
        }
        for i in range(1, num_revisions + 1)
    ]


class TestOptimizedPerformance:
    """Performance tests for optimized history caching."""
    
    def test_optimized_stable_work_items(self):
        """Test: 10 work items, all unchanged, 10 requests each.
        
        Expected optimization:
        - Baseline: 100 history API calls (10 items × 10 requests)
        - Optimized: 10 history API calls + 90 revision checks
        - Savings: 90% reduction in expensive history calls
        """
        storage = MemoryStorage()
        client = AzureCachingClient("https://dev.azure.com/test", storage=storage)
        
        # Setup mocks
        mock_conn = Mock()
        mock_wit_client = Mock()
        mock_conn.clients = Mock()
        mock_conn.clients.get_work_item_tracking_client.return_value = mock_wit_client
        client.conn = mock_conn
        client._connected = True
        
        # 10 work items, each with 100 revisions, all stable (revision doesn't change)
        work_items = list(range(1000, 1010))
        
        # Mock revision checks (lightweight)
        def get_work_item(id, **kwargs):
            work_item = Mock()
            work_item.fields = {"System.Rev": 100}
            return work_item
        
        mock_wit_client.get_work_item.side_effect = get_work_item
        
        # Track history fetch calls (expensive)
        history_fetch_count = 0
        
        def get_history(work_item_id, **kwargs):
            nonlocal history_fetch_count
            history_fetch_count += 1
            return create_mock_history(work_item_id, 100)
        
        with patch.object(client._work_item_ops, 'get_task_revision_history',
                         side_effect=get_history):
            
            # Simulate 10 requests per work item
            for _ in range(10):
                for wid in work_items:
                    client.get_task_revision_history(wid)
            
            # Verify optimization
            stats = client.get_cache_stats()
            
            print("\n" + "="*70)
            print("PERFORMANCE TEST: Stable Work Items")
            print("="*70)
            print(f"Work items: {len(work_items)}")
            print(f"Requests per item: 10")
            print(f"Total requests: {stats['total_history_requests']}")
            print(f"Revisions per item: 100")
            print()
            print("RESULTS:")
            print(f"  History API calls (expensive): {history_fetch_count}")
            print(f"  Revision checks (lightweight): {stats['revision_checks_performed']}")
            print(f"  Cache hits: {stats['history_cache_hits']}")
            print(f"  Cache hit rate: {stats['history_cache_hit_rate']}")
            print(f"  API calls saved: {stats['api_calls_saved']}")
            print()
            print("BASELINE (no optimization):")
            print(f"  Would require: 100 history calls (10 items × 10 requests)")
            print()
            print("SAVINGS:")
            baseline_calls = 100
            savings_pct = (1 - history_fetch_count / baseline_calls) * 100
            print(f"  Reduction: {savings_pct:.1f}%")
            print(f"  Avoided: {baseline_calls - history_fetch_count} expensive API calls")
            print("="*70)
            
            # Assertions
            assert history_fetch_count == 10  # Only initial fetches
            assert stats["history_cache_hits"] == 90  # 10 items × 9 additional requests
            assert float(stats["history_cache_hit_rate"].rstrip('%')) == 90.0
            
            return {
                "scenario": "stable_work_items",
                "work_items": len(work_items),
                "requests_per_item": 10,
                "baseline_calls": 100,
                "optimized_calls": history_fetch_count,
                "savings_percent": savings_pct,
                "cache_hit_rate": stats["history_cache_hit_rate"]
            }
    
    def test_optimized_mixed_change_patterns(self):
        """Test: Mixed workload - some stable, some changing.
        
        10 work items:
        - 5 stable (never change)
        - 3 change once
        - 2 change frequently (every other request)
        
        Each item requested 10 times.
        """
        storage = MemoryStorage()
        client = AzureCachingClient("https://dev.azure.com/test", storage=storage)
        
        # Setup mocks
        mock_conn = Mock()
        mock_wit_client = Mock()
        mock_conn.clients = Mock()
        mock_conn.clients.get_work_item_tracking_client.return_value = mock_wit_client
        client.conn = mock_conn
        client._connected = True
        
        work_items = list(range(1000, 1010))
        stable = work_items[:5]  # 1000-1004
        change_once = work_items[5:8]  # 1005-1007
        frequent = work_items[8:]  # 1008-1009
        
        # Track revision changes
        revisions = {wid: 100 for wid in work_items}
        request_count = {wid: 0 for wid in work_items}
        
        def get_work_item(id, **kwargs):
            work_item = Mock()
            
            # Simulate revision changes
            if id in change_once and request_count[id] == 5:
                revisions[id] = 101
            elif id in frequent and request_count[id] % 2 == 0:
                revisions[id] += 1
            
            work_item.fields = {"System.Rev": revisions[id]}
            return work_item
        
        mock_wit_client.get_work_item.side_effect = get_work_item
        
        history_fetch_count = 0
        
        def get_history(work_item_id, **kwargs):
            nonlocal history_fetch_count
            history_fetch_count += 1
            request_count[work_item_id] += 1
            return create_mock_history(work_item_id, 50)
        
        with patch.object(client._work_item_ops, 'get_task_revision_history',
                         side_effect=get_history):
            
            # 10 requests per work item
            for _ in range(10):
                for wid in work_items:
                    client.get_task_revision_history(wid)
            
            stats = client.get_cache_stats()
            
            print("\n" + "="*70)
            print("PERFORMANCE TEST: Mixed Change Patterns")
            print("="*70)
            print(f"Total work items: {len(work_items)}")
            print(f"  Stable (never change): {len(stable)}")
            print(f"  Change once: {len(change_once)}")
            print(f"  Frequent changes: {len(frequent)}")
            print(f"Requests per item: 10")
            print()
            print("RESULTS:")
            print(f"  History API calls: {history_fetch_count}")
            print(f"  Cache hit rate: {stats['history_cache_hit_rate']}")
            print()
            print("BREAKDOWN:")
            print(f"  Stable items: 5 items × 1 fetch = 5 calls")
            print(f"  Change once: 3 items × 2 fetches = 6 calls")
            print(f"  Frequent: 2 items × ~6 fetches = ~12 calls")
            print(f"  Total expected: ~23 calls")
            print()
            print("BASELINE (no optimization):")
            print(f"  Would require: 100 calls (10 items × 10 requests)")
            print()
            baseline_calls = 100
            savings_pct = (1 - history_fetch_count / baseline_calls) * 100
            print(f"SAVINGS: {savings_pct:.1f}%")
            print("="*70)
            
            # Assertions - should be much less than baseline
            assert history_fetch_count < 50  # Significant reduction
            assert float(stats["history_cache_hit_rate"].rstrip('%')) > 50.0
            
            return {
                "scenario": "mixed_patterns",
                "baseline_calls": 100,
                "optimized_calls": history_fetch_count,
                "savings_percent": savings_pct
            }
    
    def test_optimized_new_work_items_only(self):
        """Test: All new work items (no cache).
        
        Expected: No optimization benefit (baseline = optimized).
        """
        storage = MemoryStorage()
        client = AzureCachingClient("https://dev.azure.com/test", storage=storage)
        
        # Setup mocks
        mock_conn = Mock()
        mock_wit_client = Mock()
        mock_conn.clients = Mock()
        mock_conn.clients.get_work_item_tracking_client.return_value = mock_wit_client
        client.conn = mock_conn
        client._connected = True
        
        work_items = list(range(1000, 1020))  # 20 items
        
        mock_wit_client.get_work_item.side_effect = lambda id, **kwargs: Mock(
            fields={"System.Rev": 10}
        )
        
        history_fetch_count = 0
        
        def get_history(work_item_id, **kwargs):
            nonlocal history_fetch_count
            history_fetch_count += 1
            return create_mock_history(work_item_id, 50)
        
        with patch.object(client._work_item_ops, 'get_task_revision_history',
                         side_effect=get_history):
            
            # Single request per work item (all new)
            for wid in work_items:
                client.get_task_revision_history(wid)
            
            stats = client.get_cache_stats()
            
            print("\n" + "="*70)
            print("PERFORMANCE TEST: New Work Items Only")
            print("="*70)
            print("Expected: No optimization (all need initial fetch)")
            print()
            print(f"History calls: {history_fetch_count}")
            print(f"Work items: {len(work_items)}")
            print("="*70)
            
            # Should equal number of work items (no savings possible)
            assert history_fetch_count == len(work_items)
            
            return {
                "scenario": "new_items_only",
                "calls": history_fetch_count,
                "note": "No optimization benefit for new items"
            }


def generate_performance_report():
    """Generate comprehensive performance report."""
    print("\n" + "="*70)
    print("PRIORITY 2: INTELLIGENT HISTORY CACHING")
    print("Performance Optimization Report")
    print("="*70)
    print()
    print("IMPLEMENTATION SUMMARY:")
    print("- Added revision tracking to cache metadata")
    print("- Implemented lightweight revision checks (System.Rev field only)")
    print("- Skip expensive history fetch if revision unchanged")
    print("- Comprehensive metrics tracking")
    print()
    print("EXPECTED IMPACT:")
    print("- Stable items: 90%+ reduction in API calls")
    print("- Mixed workload: 50-80% reduction")
    print("- Active items: 30-50% reduction")
    print()
    print("Run: pytest tests/unit/test_history_cache_performance.py -v -s")
    print("="*70)


if __name__ == "__main__":
    generate_performance_report()
    pytest.main([__file__, "-v", "-s"])
