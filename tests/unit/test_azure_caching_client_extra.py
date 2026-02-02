from types import SimpleNamespace
from datetime import datetime, timezone, timedelta

from planner_lib.storage.memory_backend import MemoryStorage
from planner_lib.azure.AzureCachingClient import AzureCachingClient


class FakeWitNoCall:
    def query_by_wiql(self, *a, **k):
        raise AssertionError("query_by_wiql should not be called on cache hit")

    def get_work_items(self, *a, **k):
        raise AssertionError("get_work_items should not be called on cache hit")


class FakeItem:
    def __init__(self, i):
        self.id = i
        self.fields = {
            'System.Title': f'T{i}',
            'System.WorkItemType': 'Feature',
            'System.AssignedTo': {'displayName': 'Alice'},
            'System.State': 'Active',
            'System.Tags': 'tag1',
            'System.Description': 'desc',
            'Microsoft.VSTS.Scheduling.StartDate': '2020-01-01T00:00:00Z',
            'Microsoft.VSTS.Scheduling.TargetDate': '2020-02-01T00:00:00Z',
            'System.AreaPath': 'Area\\Sub',
            'System.IterationPath': 'Iter',
        }
        self.relations = []
        self.url = f'https://dev.azure.com/x/y/_apis/wit/workItems/{i}'


class FakeWitFetch:
    def query_by_wiql(self, wiql):
        return SimpleNamespace(work_items=[SimpleNamespace(id=2)])

    def get_work_items(self, ids, expand=None):
        return [FakeItem(i) for i in ids]


def make_client():
    storage = MemoryStorage()
    client = AzureCachingClient('org', storage)
    return client


def test_cache_hit_returns_cached_items():
    client = make_client()
    area_path = 'Area/Sub'
    area_key = client._sanitize_area_path(area_path)

    # prepopulate cache and index with a fresh timestamp
    cache_key = client._key_for_area(area_key)
    client._cache.write(cache_key, [{'id': '1', 'title': 'T1'}])
    client._cache.update_timestamp(cache_key)

    client._connected = True
    client.conn = SimpleNamespace(clients=SimpleNamespace(get_work_item_tracking_client=lambda: FakeWitNoCall()))

    res = client.get_work_items(area_path)
    assert isinstance(res, list)
    assert any(item.get('id') == '1' for item in res)


def test_force_refresh_fetches_and_updates_cache():
    client = make_client()
    area_path = 'Area/Sub'
    area_key = client._sanitize_area_path(area_path)

    # prepopulate cache with an old timestamp to force full refresh
    cache_key = client._key_for_area(area_key)
    client._cache.write(cache_key, [{'id': '1', 'title': 'OLD'}])
    old_ts = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    # Set stale timestamp
    index = client._cache._read_index()
    index[cache_key] = {'last_update': old_ts}
    index['_invalidated'] = {}
    client._cache._write_index(index)

    client._connected = True
    client.conn = SimpleNamespace(clients=SimpleNamespace(get_work_item_tracking_client=lambda: FakeWitFetch()))

    res = client.get_work_items(area_path)
    # after forced refresh, the new item id '2' should be present
    assert any(r.get('id') == '2' for r in res)

    # ensure area cache in storage was updated
    stored = client._cache.read(cache_key) or []
    assert any(it.get('id') == '2' for it in stored)


def test_invalidate_work_items_maps_per_area():
    client = make_client()
    area_path = 'Area/Sub'
    area_key = client._sanitize_area_path(area_path)

    cache_key = client._key_for_area(area_key)
    client._cache.write(cache_key, [{'id': '5', 'title': 'T5'}])
    client._cache.update_timestamp(cache_key)

    client.invalidate_work_items([5])
    idx = client._cache._read_index()
    assert '_invalidated' in idx
    assert cache_key in idx['_invalidated']
    assert 5 in idx['_invalidated'][cache_key]


def test_update_area_cache_item_inlines():
    client = make_client()
    area_path = 'Area/Sub'
    area_key = client._sanitize_area_path(area_path)

    # Test that we can update items in cache directly
    cache_key = client._key_for_area(area_key)
    client._cache.write(cache_key, [{'id': '1', 'title': 'old'}])
    # Update by writing new data
    area_list = client._cache.read(cache_key) or []
    area_map = {it.get('id'): it for it in area_list}
    area_map['1'] = {'id': '1', 'title': 'new'}
    client._cache.write(cache_key, list(area_map.values()))
    client._cache.update_timestamp(cache_key)
    
    stored = client._cache.read(cache_key) or []
    assert any(it.get('title') == 'new' for it in stored)


def test_query_by_wiql_failure_returns_empty():
    client = make_client()
    area_path = 'Area/Sub'
    area_key = client._sanitize_area_path(area_path)

    # empty index ensures WIQL path will be used
    cache_key = client._key_for_area(area_key)
    client._cache._write_index({})
    client._cache.write(cache_key, [])

    class BadWit:
        def query_by_wiql(self, *a, **k):
            raise RuntimeError('azure failure')

        def get_work_items(self, *a, **k):
            return []

    client._connected = True
    client.conn = SimpleNamespace(clients=SimpleNamespace(get_work_item_tracking_client=lambda: BadWit()))
    res = client.get_work_items(area_path)
    assert res == []


def test_relations_and_assigned_handling():
    client = make_client()
    area_path = 'Area/Sub'
    area_key = client._sanitize_area_path(area_path)

    class Relation:
        def __init__(self, name, url):
            self.attributes = {'name': name}
            self.url = url

    class FakeWit:
        def query_by_wiql(self, wiql):
            return SimpleNamespace(work_items=[SimpleNamespace(id=20)])

        def get_work_items(self, ids, expand=None):
            class It:
                def __init__(self):
                    self.id = 20
                    self.fields = {
                        'System.Title': 'T20',
                        'System.WorkItemType': 'Feature',
                        'System.AssignedTo': {'displayName': 'Bob'},
                        'System.State': 'Active',
                        'System.Tags': 'tag',
                        'System.Description': 'd',
                        'Microsoft.VSTS.Scheduling.StartDate': None,
                        'Microsoft.VSTS.Scheduling.TargetDate': None,
                        'System.AreaPath': 'Area\\Sub',
                        'System.IterationPath': 'I',
                    }
                    self.relations = [Relation('Parent', 'https://dev.azure.com/x/y/_apis/wit/workItems/99')]
                    self.url = 'https://dev.azure.com/x/y/_apis/wit/workItems/20'

            return [It()]

    client._connected = True
    client.conn = SimpleNamespace(clients=SimpleNamespace(get_work_item_tracking_client=lambda: FakeWit()))
    res = client.get_work_items(area_path)
    assert isinstance(res, list)
    assert any(isinstance(it.get('relations'), list) and it.get('relations') for it in res)


def test_prune_if_needed_removes_old_entries():
    client = make_client()
    # create many index entries and corresponding area cache files
    idx = {}
    for i in range(60):
        key = f'area{i}'
        idx[key] = {'last_update': datetime.now(timezone.utc).isoformat()}
        cache_key = client._key_for_area(key)
        client._cache.write(cache_key, [{'id': str(i)}])
    
    client._cache._write_index(idx)
    client._fetch_count = 99
    removed = client._cache.prune_old_entries(keep_count=50)
    # should have pruned some entries (kept 50)
    assert isinstance(removed, list)
    assert len(removed) > 0


def test_chunked_fetch_processing():
    client = make_client()
    area_path = 'Area/Many'

    # WIQL should return many ids to force chunking
    ids = list(range(1, 401))

    class FakeWitMany:
        def query_by_wiql(self, wiql):
            return SimpleNamespace(work_items=[SimpleNamespace(id=i) for i in ids])

        def get_work_items(self, ids_batch, expand=None):
            return [FakeItem(i) for i in ids_batch]

    client._connected = True
    client.conn = SimpleNamespace(clients=SimpleNamespace(get_work_item_tracking_client=lambda: FakeWitMany()))
    res = client.get_work_items(area_path)
    assert isinstance(res, list)
    # should have fetched many items and updated cache
    assert any(item.get('id') == '1' for item in res)


def test_update_methods_invalidate_called(monkeypatch):
    client = make_client()

    # monkeypatch base class update methods to avoid SDK calls
    monkeypatch.setattr('planner_lib.azure.AzureClient.AzureClient.update_work_item_dates', lambda self, wid, start=None, end=None: 'ok')
    monkeypatch.setattr('planner_lib.azure.AzureClient.AzureClient.update_work_item_description', lambda self, wid, description: 'ok')

    called = {'dates': False, 'desc': False}

    def fake_invalidate(ids):
        if ids and isinstance(ids, list):
            if ids[0] == 42:
                called['dates'] = True
            if ids[0] == 43:
                called['desc'] = True

    monkeypatch.setattr(client, 'invalidate_work_items', fake_invalidate)

    r1 = client.update_work_item_dates(42, start='2020-01-01')
    r2 = client.update_work_item_description(43, '<p>d</p>')
    assert r1 == 'ok' and r2 == 'ok'
    assert called['dates'] and called['desc']
