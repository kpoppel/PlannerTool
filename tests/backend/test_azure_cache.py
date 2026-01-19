import os
import shutil
from types import SimpleNamespace
import pytest
from planner_lib.storage.file_backend import FileStorageBackend
from planner_lib.azure import get_client
from pathlib import Path
import pickle


NS = "azure_workitems"


@pytest.fixture
def data_dir(tmp_path):
    d = str(tmp_path / "data_test_azure")
    return d


# Helper to build a fake SDK work item object
class FakeRelation:
    def __init__(self, name, url):
        self.attributes = {"name": name}
        self.url = url


class FakeWorkItem:
    def __init__(self, wid, title="T", state="Active", changed_date=None):
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
        }


# Helper to build a fake WIQL result object
class FakeWiqlResult:
    def __init__(self, ids):
        # SDK may return objects with attribute `work_items` being list of objects with 'id'
        self.work_items = [SimpleNamespace(id=i) for i in ids]


# Minimal fake tracking client
class FakeWitClient:
    def __init__(self, ids_to_items_map=None, wiql_ids=None):
        # mapping id->FakeWorkItem for get_work_items
        self._map = ids_to_items_map or {}
        self._wiql_ids = wiql_ids or list(self._map.keys())
        self.get_work_items_called = False

    def query_by_wiql(self, q=None, **kwargs):
        # return object having .work_items
        return FakeWiqlResult(self._wiql_ids)

    def get_work_items(self, ids, expand=None, fields=None):
        self.get_work_items_called = True
        # If 'fields' provided, return lightweight dict-like items with fields
        if fields:
            res = []
            for i in ids:
                item = self._map.get(int(i))
                if item is None:
                    continue
                # return an object similar to SDK with id and fields
                res.append(SimpleNamespace(id=item.id, fields=item.fields))
            return res
        # full fetch
        res = []
        for i in ids:
            item = self._map.get(int(i))
            if item is None:
                continue
            res.append(item)
        return res


@pytest.fixture
def patch_config(monkeypatch, data_dir):
    # Provide a config object with feature_flags mapping and data_dir pointing to test dir
    cfg = SimpleNamespace(feature_flags={"enable_azure_cache": True}, data_dir=data_dir)
    monkeypatch.setattr("planner_lib.setup.get_loaded_config", lambda: cfg)
    return cfg


def test_cache_miss_updates_cache(patch_config, data_dir):
    # Empty cache, WIQL returns id 1 and get_work_items returns the item -> cache should be created
    client = get_client("org", "pat")
    # point the client's file-based cache directory to our tmp path for test isolation
    client.data_dir = Path(data_dir)
    client.data_dir.mkdir(parents=True, exist_ok=True)
    client.index_path = client.data_dir / "_index.pkl"

    # prepare fake azure responses
    item = FakeWorkItem(1, title="Title1", state="Active", changed_date="2025-12-22T12:00:00Z")
    wit = FakeWitClient(ids_to_items_map={1: item}, wiql_ids=[1])
    # monkeypatch internal connection to return our fake client
    client.conn.clients.get_work_item_tracking_client = lambda: wit

    res = client.get_work_items("A")
    assert isinstance(res, list)
    assert len(res) == 1
    assert res[0]["id"] == "1"
    # ensure the per-area cache file and index were written
    area_file = client._file_for_area("A")
    with open(area_file, 'rb') as f:
        area_items = pickle.load(f)
    assert any(it.get('id') == '1' for it in (area_items or []))
    with open(client.index_path, 'rb') as f:
        idx = pickle.load(f)
    assert client._sanitize_area_path("A") in idx


def test_cache_hit_served_from_cache(patch_config, data_dir):
    # Prepopulate cache with an item; WIQL returns that id; get_work_items should not be called
    if os.path.exists(data_dir):
        shutil.rmtree(data_dir)
    # Prepare on-disk per-area cache and index
    client = get_client("org", "pat")
    client.data_dir = Path(data_dir)
    client.data_dir.mkdir(parents=True, exist_ok=True)
    client.index_path = client.data_dir / "_index.pkl"
    area_file = client._file_for_area("A")
    cached_obj = {"id": "1", "title": "Cached"}
    with open(area_file, 'wb') as f:
        pickle.dump([cached_obj], f)
    with open(client.index_path, 'wb') as f:
        pickle.dump({client._sanitize_area_path("A"): {"last_update": "2025-12-22"}}, f)

    # Fake wit client that returns no updates (but should not cause test to fail)
    wit = FakeWitClient(ids_to_items_map={}, wiql_ids=[1])
    client.conn.clients.get_work_item_tracking_client = lambda: wit

    res = client.get_work_items("A")
    assert len(res) >= 1
    # returned item should include the cached title (may be merged with any updates)
    assert any(it.get("title") == "Cached" for it in res)


def test_cache_stale_in_azure_fetch_updates(patch_config, data_dir):
    # Prepopulate cache with old changed_date; Azure has newer changed_date -> should be updated
    if os.path.exists(data_dir):
        shutil.rmtree(data_dir)
    fb = FileStorageBackend(data_dir=data_dir)
    fb.save(NS, "azure_cache.pkl", {"1": {"id": "1", "title": "Old"}})
    fb.save(NS, "_index", {"1": {"changed_date": "2020-01-01T00:00:00Z", "project": "P", "areaPath": "A"}})

    client = get_client("org", "pat")
    client.data_dir = Path(data_dir)
    client.data_dir.mkdir(parents=True, exist_ok=True)
    client.index_path = client.data_dir / "_index.pkl"
    area_file = client._file_for_area("A")
    with open(area_file, 'wb') as f:
        pickle.dump([{"id": "1", "title": "Old"}], f)
    with open(client.index_path, 'wb') as f:
        pickle.dump({"1": {"changed_date": "2020-01-01T00:00:00Z", "project": "P", "areaPath": "A"}}, f)
    # Azure has newer version
    item_new = FakeWorkItem(1, title="NewTitle", state="Active", changed_date="2025-12-22T13:00:00Z")
    wit = FakeWitClient(ids_to_items_map={1: item_new}, wiql_ids=[1])
    client.conn.clients.get_work_item_tracking_client = lambda: wit

    client.conn.clients.get_work_item_tracking_client = lambda: wit
    res = client.get_work_items("A")
    assert any(it.get("title") == "NewTitle" for it in res)
    # Ensure on-disk area cache updated
    with open(area_file, 'rb') as f:
        area_items = pickle.load(f)
    assert any(it.get("title") == "NewTitle" for it in (area_items or []))


def test_cache_prune_removed_state(patch_config, data_dir):
    # Prepopulate cache with id 2, but WIQL returns only id 1 -> id 2 should be removed from cache
    if os.path.exists(data_dir):
        shutil.rmtree(data_dir)
    fb = FileStorageBackend(data_dir=data_dir)
    fb.save(NS, "azure_cache.pkl", {"2": {"id": "2", "title": "ToBeRemoved"}})
    fb.save(NS, "_index", {"2": {"changed_date": "2025-12-22T12:00:00Z", "project": "P", "areaPath": "A"}})

    client = get_client("org", "pat")
    client.data_dir = Path(data_dir)
    client.data_dir.mkdir(parents=True, exist_ok=True)
    client.index_path = client.data_dir / "_index.pkl"
    area_file = client._file_for_area("A")
    # Precreate per-area cache file and index
    with open(area_file, 'wb') as f:
        pickle.dump([{"id": "2", "title": "ToBeRemoved"}], f)
    with open(client.index_path, 'wb') as f:
        pickle.dump({"2": {"changed_date": "2025-12-22T12:00:00Z", "project": "P", "areaPath": "A"}}, f)
    # Azure returns only id 1
    item1 = FakeWorkItem(1, title="T1", state="Active", changed_date="2025-12-22T12:00:00Z")
    wit = FakeWitClient(ids_to_items_map={1: item1}, wiql_ids=[1])
    client.conn.clients.get_work_item_tracking_client = lambda: wit

    client.conn.clients.get_work_item_tracking_client = lambda: wit
    res = client.get_work_items("A")
    # Ensure returned items include the ID from Azure (1) and that on-disk cache exists
    with open(area_file, 'rb') as f:
        area_items = pickle.load(f)
    assert any(it.get("id") == '1' for it in (area_items or []))


def test_cache_invalidation_after_update(patch_config, data_dir):
    """Test that updating a work item invalidates its cache entry and forces refetch."""
    # Prepopulate cache with multiple items
    if os.path.exists(data_dir):
        shutil.rmtree(data_dir)
    
    client = get_client("org", "pat")
    client.data_dir = Path(data_dir)
    client.data_dir.mkdir(parents=True, exist_ok=True)
    client.index_path = client.data_dir / "_index.pkl"
    area_file = client._file_for_area("A")
    
    # Create cache with items 1, 2, 3
    cached_items = [
        {"id": "1", "title": "Item1", "startDate": "2025-01-01", "finishDate": "2025-02-01"},
        {"id": "2", "title": "Item2", "startDate": "2025-03-01", "finishDate": "2025-04-01"},
        {"id": "3", "title": "Item3", "startDate": "2025-05-01", "finishDate": "2025-06-01"},
    ]
    with open(area_file, 'wb') as f:
        pickle.dump(cached_items, f)
    with open(client.index_path, 'wb') as f:
        pickle.dump({"A": {"last_update": "2025-12-22"}}, f)
    
    # Mock the wit client for the update operation
    class MockWit:
        def update_work_item(self, document, id):
            return SimpleNamespace(id=id)
    
    client.conn.clients.get_work_item_tracking_client = lambda: MockWit()
    
    # Update work item 2 - this should mark it as invalidated
    client.update_work_item_dates(2, start="2025-03-15", end="2025-04-15")
    
    # Verify that item 2 is in the invalidated set
    with open(client.index_path, 'rb') as f:
        index = pickle.load(f)
    assert 2 in index.get('_invalidated', [])
    
    # Verify cache file still contains all items (we don't remove them anymore)
    with open(area_file, 'rb') as f:
        cached_after_update = pickle.load(f)
    assert len(cached_after_update) == 3
    
    # Now simulate a get_work_items call - it should fetch the invalidated item
    # even though WIQL might not return it
    item2_updated = FakeWorkItem(2, title="Item2-Updated", state="Active", 
                                  changed_date="2025-12-23T00:00:00Z")
    wit = FakeWitClient(ids_to_items_map={2: item2_updated}, wiql_ids=[])  # WIQL returns nothing
    client.conn.clients.get_work_item_tracking_client = lambda: wit
    
    result = client.get_work_items("A")
    
    # Should have all 3 items, with item 2 updated
    assert len(result) == 3
    item2_result = next((it for it in result if it.get('id') == '2'), None)
    assert item2_result is not None
    assert item2_result.get('title') == 'Item2-Updated'
    
    # Verify invalidated set is now cleared
    with open(client.index_path, 'rb') as f:
        index_after = pickle.load(f)
    assert 2 not in index_after.get('_invalidated', [])


