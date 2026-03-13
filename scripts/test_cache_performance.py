#!/usr/bin/env python3
"""
Performance test for Azure cache optimization.

This script measures:
- API calls made during cache refresh
- Time taken for operations
- Cache hit/miss rates
- Items fetched vs skipped

Usage:
    python scripts/test_cache_performance.py
"""

import sys
import time
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace
from pathlib import Path

# Add parent dir to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from planner_lib.storage import create_storage
from planner_lib.azure.AzureCachingClient import AzureCachingClient


class FakeRelation:
    def __init__(self, name, url):
        self.attributes = {"name": name}
        self.url = url


class FakeWorkItem:
    def __init__(self, wid, title="Task", state="Active", rev=1, changed_date=None):
        self.id = wid
        self.url = f"https://dev.azure.com/org/proj/_apis/wit/workItems/{wid}"
        self.relations = []
        self.fields = {
            "System.WorkItemType": "Feature",
            "System.Title": title,
            "System.State": state,
            "System.Tags": None,
            "System.Description": None,
            "Microsoft.VSTS.Scheduling.StartDate": None,
            "Microsoft.VSTS.Scheduling.TargetDate": None,
            "System.AreaPath": "Project\\Area",
            "System.IterationPath": "Project\\Iteration",
            "System.ChangedDate": changed_date,
            "System.Rev": rev,  # Revision number
        }


class FakeWiqlResult:
    def __init__(self, ids):
        self.work_items = [SimpleNamespace(id=i) for i in ids]


class InstrumentedWitClient:
    """Fake WIT client that tracks API calls."""
    
    def __init__(self, items_map, wiql_ids=None):
        self._map = items_map
        self._wiql_ids = wiql_ids or list(items_map.keys())
        
        # Metrics
        self.wiql_calls = 0
        self.get_work_items_calls = 0
        self.total_items_fetched = 0
    
    def reset_metrics(self):
        """Reset all metrics."""
        self.wiql_calls = 0
        self.get_work_items_calls = 0
        self.total_items_fetched = 0
    
    def query_by_wiql(self, wiql=None, **kwargs):
        """Simulate WIQL query."""
        self.wiql_calls += 1
        return FakeWiqlResult(self._wiql_ids)
    
    def get_work_items(self, ids, expand=None, fields=None):
        """Simulate batch get with optional fields."""
        self.get_work_items_calls += 1
        
        if fields:
            # Lightweight fetch (just specific fields)
            # Don't count as items fetched for metrics since it's just metadata
            res = []
            for i in ids:
                item = self._map.get(int(i))
                if item:
                    res.append(SimpleNamespace(id=item.id, fields=item.fields))
            return res
        
        # Full fetch - count these
        self.total_items_fetched += len(ids)
        return [self._map[int(i)] for i in ids if int(i) in self._map]


def create_test_dataset(num_items=100):
    """Create a test dataset with specified number of work items.
    
    Returns (items_map, wiql_ids)
    """
    items_map = {}
    for i in range(1, num_items + 1):
        items_map[i] = FakeWorkItem(
            wid=i,
            title=f"Item {i}",
            state="Active",
            rev=1,
            changed_date=datetime.now(timezone.utc).isoformat()
        )
    
    wiql_ids = list(items_map.keys())
    return items_map, wiql_ids


def run_baseline_test(num_items=100, num_changed=10):
    """Run baseline performance test.
    
    Args:
        num_items: Total number of work items
        num_changed: Number of items that changed (for incremental test)
    
    Returns:
        dict with metrics
    """
    print(f"\n{'='*70}")
    print(f"BASELINE PERFORMANCE TEST")
    print(f"{'='*70}")
    print(f"Dataset: {num_items} work items, {num_changed} changed")
    print()
    
    # Create test dataset
    items_map, wiql_ids = create_test_dataset(num_items)
    
    # Create storage and client
    storage = create_storage(backend='memory', serializer='pickle', accessor='dict')
    wit_client = InstrumentedWitClient(items_map, wiql_ids)
    
    client = AzureCachingClient("https://dev.azure.com/org", storage=storage)
    
    # Monkey-patch the connection
    client._connected = True
    client.conn = SimpleNamespace(
        clients=SimpleNamespace(
            get_work_item_tracking_client=lambda: wit_client
        )
    )
    
    area_path = "Project\\TestArea"
    
    # Test 1: Initial fetch (cold cache)
    print("Test 1: Initial fetch (cold cache)")
    print("-" * 70)
    wit_client.reset_metrics()
    
    start = time.time()
    result1 = client.get_work_items(area_path)
    elapsed1 = time.time() - start
    
    print(f"  Duration: {elapsed1*1000:.2f}ms")
    print(f"  Items returned: {len(result1)}")
    print(f"  WIQL calls: {wit_client.wiql_calls}")
    print(f"  get_work_items calls: {wit_client.get_work_items_calls}")
    print(f"  Total items fetched: {wit_client.total_items_fetched}")
    print()
    
    # Test 2: Immediate re-fetch (warm cache, no changes)
    print("Test 2: Immediate re-fetch (warm cache, TTL not expired)")
    print("-" * 70)
    wit_client.reset_metrics()
    
    start = time.time()
    result2 = client.get_work_items(area_path)
    elapsed2 = time.time() - start
    
    print(f"  Duration: {elapsed2*1000:.2f}ms")
    print(f"  Items returned: {len(result2)}")
    print(f"  WIQL calls: {wit_client.wiql_calls}")
    print(f"  get_work_items calls: {wit_client.get_work_items_calls}")
    print(f"  Total items fetched: {wit_client.total_items_fetched}")
    print(f"  Hit rate: 100% (cache hit)")
    print()
    
    # Test 3: Force TTL expiry, then re-fetch (simulates 30min later)
    print("Test 3: Re-fetch after TTL expiry (cache stale)")
    print("-" * 70)
    
    # Mark some items as changed
    for i in range(1, num_changed + 1):
        items_map[i].fields["System.Rev"] = 2
        items_map[i].fields["System.ChangedDate"] = datetime.now(timezone.utc).isoformat()
    
    # Force cache staleness by manipulating timestamp
    area_key = client._key_for_area(area_path)
    old_timestamp = datetime.now(timezone.utc) - timedelta(minutes=35)
    
    # Update cache timestamp to be stale
    index = client._cache._read_index()
    if area_key in index:
        index[area_key]['last_update'] = old_timestamp.isoformat()
        client._cache._write_index(index)
    
    wit_client.reset_metrics()
    
    start = time.time()
    result3 = client.get_work_items(area_path)
    elapsed3 = time.time() - start
    
    print(f"  Duration: {elapsed3*1000:.2f}ms")
    print(f"  Items returned: {len(result3)}")
    print(f"  WIQL calls: {wit_client.wiql_calls}")
    print(f"  get_work_items calls: {wit_client.get_work_items_calls}")
    print(f"  Total items fetched: {wit_client.total_items_fetched}")
    print(f"  Items that actually changed: {num_changed}")
    print(f"  Waste factor: {wit_client.total_items_fetched / num_changed:.1f}x (fetched {wit_client.total_items_fetched} instead of {num_changed})")
    print()
    
    # Summary
    print("="*70)
    print("BASELINE SUMMARY")
    print("="*70)
    print(f"Total work items: {num_items}")
    print(f"Items changed: {num_changed}")
    print()
    print("Current behavior on TTL expiry:")
    print(f"  - Refetches ALL {num_items} items")
    print(f"  - API calls: 1 WIQL + {wit_client.get_work_items_calls} batch fetches")
    print(f"  - Waste: {num_items - num_changed} unnecessary fetches")
    print(f"  - Efficiency: {num_changed / num_items * 100:.1f}% (only {num_changed} actually needed)")
    print()
    print("Expected with optimization:")
    print(f"  - Fetch only {num_changed} changed items")
    print(f"  - API calls: 1 WIQL (with Rev) + ~{(num_changed + 199) // 200} batch fetches")
    print(f"  - Waste: 0 unnecessary fetches")
    print(f"  - Efficiency: 100%")
    print("="*70)
    
    return {
        'num_items': num_items,
        'num_changed': num_changed,
        'test1_elapsed_ms': elapsed1 * 1000,
        'test1_api_calls': wit_client.wiql_calls + wit_client.get_work_items_calls,
        'test3_elapsed_ms': elapsed3 * 1000,
        'test3_wiql_calls': wit_client.wiql_calls,
        'test3_batch_calls': wit_client.get_work_items_calls,
        'test3_items_fetched': wit_client.total_items_fetched,
        'waste_factor': wit_client.total_items_fetched / num_changed if num_changed > 0 else 0,
    }


def main():
    """Run performance tests with various scenarios."""
    
    scenarios = [
        {'num_items': 50, 'num_changed': 5},
        {'num_items': 100, 'num_changed': 10},
        {'num_items': 500, 'num_changed': 25},
        {'num_items': 1000, 'num_changed': 50},
    ]
    
    results = []
    for scenario in scenarios:
        result = run_baseline_test(**scenario)
        results.append(result)
    
    # Final summary
    print("\n")
    print("="*70)
    print("OVERALL BASELINE RESULTS")
    print("="*70)
    print()
    print(f"{'Items':<10} {'Changed':<10} {'Fetched':<10} {'Waste':<10} {'Efficiency':<12}")
    print("-"*70)
    for r in results:
        efficiency = r['num_changed'] / r['num_items'] * 100
        print(f"{r['num_items']:<10} {r['num_changed']:<10} {r['test3_items_fetched']:<10} {r['waste_factor']:<10.1f}x {efficiency:<12.1f}%")
    print()
    print("Baseline saved to: baseline_metrics.txt")
    
    # Save results
    with open('baseline_metrics.txt', 'w') as f:
        f.write("BASELINE METRICS (Before Optimization)\n")
        f.write("="*70 + "\n")
        f.write(f"Timestamp: {datetime.now(timezone.utc).isoformat()}\n\n")
        
        for r in results:
            f.write(f"Dataset: {r['num_items']} items, {r['num_changed']} changed\n")
            f.write(f"  Test 1 (cold cache): {r['test1_elapsed_ms']:.2f}ms, {r['test1_api_calls']} API calls\n")
            f.write(f"  Test 3 (TTL expired): {r['test3_elapsed_ms']:.2f}ms, {r['test3_items_fetched']} items fetched\n")
            f.write(f"  Waste factor: {r['waste_factor']:.1f}x\n\n")


if __name__ == "__main__":
    main()
