from types import SimpleNamespace
import pytest

from planner_lib.azure.AzureClient import AzureClient
from planner_lib.azure.AzureNativeClient import AzureNativeClient


class DummyStorage:
    pass


class ConcreteAzure(AzureClient):
    def get_work_items(self, area_path: str):
        raise NotImplementedError()

    def invalidate_work_items(self, work_item_ids):
        raise NotImplementedError()


def make_dummy_conn_for_projects():
    core = SimpleNamespace(get_projects=lambda: SimpleNamespace(value=[SimpleNamespace(name='ProjA'), SimpleNamespace(name='ProjB')]))
    clients = SimpleNamespace(get_core_client=lambda: core, get_work_item_tracking_client=lambda: None)
    return SimpleNamespace(clients=clients)


def test_api_url_to_ui_link_valid_and_invalid():
    c = ConcreteAzure('org', DummyStorage())
    ui = c.api_url_to_ui_link('https://dev.azure.com/myorg/myproj/_apis/wit/workItems/123')
    assert ui.endswith('/_workitems/edit/123')
    with pytest.raises(ValueError):
        c.api_url_to_ui_link('https://example.com/not/azure')


def test_sanitize_and_flatten_area_nodes():
    c = ConcreteAzure('org', DummyStorage())
    node = SimpleNamespace(path='Area/Sub', children=[SimpleNamespace(name='Leaf')])
    flat = c._flatten_area_nodes(node)
    assert 'Area/Sub' in flat or 'Leaf' in flat
    assert c._sanitize_area_path('Area\\Sub') == 'Sub'


def test_safe_type_and_date():
    c = ConcreteAzure('org', DummyStorage())
    assert c._safe_type('Epic') == 'epic'
    assert c._safe_type('SomeFeature') == 'feature'
    assert c._safe_type(None) == 'feature'
    assert c._safe_date(None) is None
    assert isinstance(c._safe_date('2020-01-01T12:00:00Z'), str)


def test_get_projects_uses_connection():
    c = ConcreteAzure('org', DummyStorage())
    c._connected = True
    c.conn = make_dummy_conn_for_projects()
    projs = c.get_projects()
    assert 'ProjA' in projs and 'ProjB' in projs


def test_query_and_get_work_items_by_wiql_calls_wit():
    c = ConcreteAzure('org', DummyStorage())
    # Create fake wit client with expected methods
    class FakeWit:
        def query_by_wiql(self, q):
            return SimpleNamespace(work_items=[SimpleNamespace(id=1), SimpleNamespace(id=2)])

        def get_work_items(self, ids, fields=None):
            return [SimpleNamespace(id=i, fields={'System.Title': f'T{i}'}, url=f'https://dev.azure.com/x/y/_apis/wit/workItems/{i}', relations=[] ) for i in ids]

    clients = SimpleNamespace(get_work_item_tracking_client=lambda: FakeWit(), get_core_client=lambda: None)
    c._connected = True
    c.conn = SimpleNamespace(clients=clients)

    res = c.query_by_wiql('proj', 'select 1')
    assert hasattr(res, 'work_items')
    items = c.get_work_items_by_wiql('proj', 'select 1', fields=['System.Title'])
    assert items


def test_update_work_item_description_and_dates_require_connected():
    c = ConcreteAzure('org', DummyStorage())
    with pytest.raises(RuntimeError):
        c.update_work_item_description(1, '<p>desc</p>')
    with pytest.raises(RuntimeError):
        c.update_work_item_dates(1, start='2020-01-01')


def test_azure_native_client_get_work_items_parses_items():
    nc = AzureNativeClient('org', DummyStorage())
    # Build fake wit client
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

    class FakeWit:
        def query_by_wiql(self, wiql):
            return SimpleNamespace(work_items=[SimpleNamespace(id=10), SimpleNamespace(id=11)])

        def get_work_items(self, ids, expand=None):
            return [FakeItem(i) for i in ids]

    nc._connected = True
    nc.conn = SimpleNamespace(clients=SimpleNamespace(get_work_item_tracking_client=lambda: FakeWit()))
    res = nc.get_work_items('Area/Sub')
    assert isinstance(res, list)
    assert any(r['id'] == '10' for r in res)
