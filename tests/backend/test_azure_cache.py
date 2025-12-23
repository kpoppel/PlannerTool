import os
import shutil
from types import SimpleNamespace
import pytest
from planner_lib.storage.file_backend import FileStorageBackend
from planner_lib.azure import AzureClient


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
    cfg = SimpleNamespace(feature_flags={"azure_cache_enabled": True}, data_dir=data_dir)
    monkeypatch.setattr("planner_lib.setup.get_loaded_config", lambda: cfg)
    return cfg


def test_cache_miss_updates_cache(patch_config, data_dir):
    # Empty cache, WIQL returns id 1 and get_work_items returns the item -> cache should be created
    client = AzureClient("org", "pat")
    # attach fresh file backend explicitly
    client._cache = FileStorageBackend(data_dir=data_dir)

    # prepare fake azure responses
    item = FakeWorkItem(1, title="Title1", state="Active", changed_date="2025-12-22T12:00:00Z")
    wit = FakeWitClient(ids_to_items_map={1: item}, wiql_ids=[1])
    # monkeypatch internal connection to return our fake client
    client.conn.clients.get_work_item_tracking_client = lambda: wit

    res = client.get_work_items("P", "A")
    assert isinstance(res, list)
    assert len(res) == 1
    assert res[0]["id"] == "1"
    # ensure the single-file cache dict contains the item and index updated
    fb = FileStorageBackend(data_dir=data_dir)
    cache_dict = fb.load(NS, "azure_cache.pkl")
    assert "1" in cache_dict
    idx = fb.load(NS, "_index")
    assert "1" in idx


def test_cache_hit_served_from_cache(patch_config, data_dir):
    # Prepopulate cache with an item; WIQL returns that id; get_work_items should not be called
    if os.path.exists(data_dir):
        shutil.rmtree(data_dir)
    fb = FileStorageBackend(data_dir=data_dir)
    # precreate a cached object and index
    cached_obj = {"id": "1", "title": "Cached"}
    # precreate single-file cache dict and index
    fb.save(NS, "azure_cache.pkl", {"1": cached_obj})
    fb.save(NS, "_index", {"1": {"changed_date": "2025-12-22T12:00:00Z", "project": "P", "areaPath": "A"}})

    client = AzureClient("org", "pat")
    client._cache = fb
    # Fake wit client that would raise if called for get_work_items
    wit = FakeWitClient(ids_to_items_map={}, wiql_ids=[1])
    def bad_get_work_items(ids, expand=None, fields=None):
        raise AssertionError("get_work_items should not be called on cache hit")
    wit.get_work_items = bad_get_work_items
    client.conn.clients.get_work_item_tracking_client = lambda: wit

    res = client.get_work_items("P", "A")
    assert len(res) == 1
    assert res[0]["title"] == "Cached"


def test_cache_stale_in_azure_fetch_updates(patch_config, data_dir):
    # Prepopulate cache with old changed_date; Azure has newer changed_date -> should be updated
    if os.path.exists(data_dir):
        shutil.rmtree(data_dir)
    fb = FileStorageBackend(data_dir=data_dir)
    fb.save(NS, "azure_cache.pkl", {"1": {"id": "1", "title": "Old"}})
    fb.save(NS, "_index", {"1": {"changed_date": "2020-01-01T00:00:00Z", "project": "P", "areaPath": "A"}})

    client = AzureClient("org", "pat")
    client._cache = fb
    # Azure has newer version
    item_new = FakeWorkItem(1, title="NewTitle", state="Active", changed_date="2025-12-22T13:00:00Z")
    wit = FakeWitClient(ids_to_items_map={1: item_new}, wiql_ids=[1])
    client.conn.clients.get_work_item_tracking_client = lambda: wit

    res = client.get_work_items("P", "A")
    assert len(res) == 1
    assert res[0]["title"] == "NewTitle"
    # Ensure cache updated in the single-file cache dict
    cache_dict = fb.load(NS, "azure_cache.pkl")
    assert cache_dict["1"]["title"] == "NewTitle"


def test_cache_prune_removed_state(patch_config, data_dir):
    # Prepopulate cache with id 2, but WIQL returns only id 1 -> id 2 should be removed from cache
    if os.path.exists(data_dir):
        shutil.rmtree(data_dir)
    fb = FileStorageBackend(data_dir=data_dir)
    fb.save(NS, "azure_cache.pkl", {"2": {"id": "2", "title": "ToBeRemoved"}})
    fb.save(NS, "_index", {"2": {"changed_date": "2025-12-22T12:00:00Z", "project": "P", "areaPath": "A"}})

    client = AzureClient("org", "pat")
    client._cache = fb
    # Azure returns only id 1
    item1 = FakeWorkItem(1, title="T1", state="Active", changed_date="2025-12-22T12:00:00Z")
    wit = FakeWitClient(ids_to_items_map={1: item1}, wiql_ids=[1])
    client.conn.clients.get_work_item_tracking_client = lambda: wit

    res = client.get_work_items("P", "A")
    # cached id 2 should be pruned from the single-file cache dict
    cache_dict = fb.load(NS, "azure_cache.pkl")
    assert "2" not in cache_dict
    idx = fb.load(NS, "_index")
    assert "2" not in idx

