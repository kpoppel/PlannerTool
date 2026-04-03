from types import SimpleNamespace
import pytest

from planner_lib.azure.AzureClient import AzureClient
from planner_lib.azure.AzureNativeClient import AzureNativeClient


class DummyStorage:
    pass


class ConcreteAzure(AzureClient):
    def get_work_items(self, area_path: str, task_types=None, include_states=None):
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


def test_safe_date():
    c = ConcreteAzure('org', DummyStorage())
    assert c._safe_date(None) is None
    assert isinstance(c._safe_date('2020-01-01T12:00:00Z'), str)


def test_work_item_type_passthrough():
    """Work item types must be stored as the exact Azure DevOps string.

    After removing _safe_type() normalization, the 'type' field in returned work
    items must reflect the raw value from System.WorkItemType — e.g. 'Feature',
    'User Story', 'Bug' — not a lowercased or remapped proxy like 'feature'.
    """
    nc = AzureNativeClient('org', DummyStorage())

    type_cases = [
        ('Feature', 'Feature'),
        ('Epic', 'Epic'),
        ('User Story', 'User Story'),
        ('Bug', 'Bug'),
        ('Task', 'Task'),
        ('CustomType', 'CustomType'),
    ]

    for azure_type, expected in type_cases:
        class FakeItem:
            def __init__(self):
                self.id = 1
                self.fields = {
                    'System.Title': 'Test',
                    'System.WorkItemType': azure_type,
                    'System.AssignedTo': {'displayName': 'Alice'},
                    'System.State': 'Active',
                    'System.Tags': '',
                    'System.Description': '',
                    'Microsoft.VSTS.Scheduling.StartDate': None,
                    'Microsoft.VSTS.Scheduling.TargetDate': None,
                    'System.AreaPath': 'Proj\\Team',
                    'System.IterationPath': 'Iter',
                }
                self.relations = []
                self.url = 'https://dev.azure.com/x/y/_apis/wit/workItems/1'

        class FakeWit:
            def query_by_wiql(self, wiql):
                return SimpleNamespace(work_items=[SimpleNamespace(id=1)])

            def get_work_items(self, ids, expand=None):
                return [FakeItem()]

        nc._connected = True
        nc.conn = SimpleNamespace(clients=SimpleNamespace(get_work_item_tracking_client=lambda: FakeWit()))
        results = nc.get_work_items('Proj\\Team')
        assert len(results) == 1, f'Expected 1 result for type {azure_type}'
        assert results[0]['type'] == expected, (
            f"Expected type '{expected}' but got '{results[0]['type']}' for Azure type '{azure_type}'"
        )


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


# ---------------------------------------------------------------------------
# get_area_path_used_metadata — backlog-config path
# ---------------------------------------------------------------------------

def _make_mapping(type_name, states_dict):
    """Return a SimpleNamespace mimicking WorkItemTypeStateInfo."""
    return SimpleNamespace(work_item_type_name=type_name, states=states_dict)


def _make_area_path_client(team_ids, teams, backlog_config, wit_items=None):
    """Build a ConcreteAzure whose internals are wired for area-path-metadata tests.

    Args:
        team_ids:      List of team ID strings returned by get_team_from_area_path.
        teams:         List of {'id':str,'name':str} dicts returned by get_all_teams.
        backlog_config: Object with .work_item_type_mapped_states.
        wit_items:     Optional list of work items for the WIQL-fallback path.
    """
    c = ConcreteAzure('org', DummyStorage())

    class FakeTeamPlanOps:
        def get_all_teams(self, project):
            return teams

        def get_team_from_area_path(self, project, area_path):
            return team_ids

    class FakeWorkClient:
        def get_backlog_configurations(self, team_context):
            return backlog_config

    wit_items = wit_items or []

    class FakeWit:
        def query_by_wiql(self, wiql):
            return SimpleNamespace(work_items=wit_items)

        def get_work_items(self, ids, fields=None):
            return []

    c._team_plan_ops = FakeTeamPlanOps()
    c._connected = True
    c.conn = SimpleNamespace(
        clients=SimpleNamespace(
            get_work_client=lambda: FakeWorkClient(),
            get_work_item_tracking_client=lambda: FakeWit(),
        )
    )
    return c


def test_area_path_metadata_uses_backlog_config_when_team_found():
    """Happy path: team resolved → backlog config used → types and states extracted."""
    teams = [{'id': 'tid-1', 'name': 'Team Alpha'}]
    mappings = [
        _make_mapping('Feature', {'Active': 'InProgress', 'Done': 'Completed', 'New': 'Proposed'}),
        _make_mapping('Bug', {'Active': 'InProgress', 'Closed': 'Completed'}),
    ]
    backlog = SimpleNamespace(work_item_type_mapped_states=mappings)
    c = _make_area_path_client(team_ids=['tid-1'], teams=teams, backlog_config=backlog)

    result = c.get_area_path_used_metadata('Proj', 'Proj\\Team Alpha')

    assert set(result['types']) == {'Feature', 'Bug'}
    # States come from the keys of the states dicts
    assert 'Active' in result['states']
    assert 'Done' in result['states']
    assert 'Closed' in result['states']
    # states_by_type must be populated
    assert 'Active' in result['states_by_type']['Feature']
    assert 'Active' in result['states_by_type']['Bug']


def test_area_path_metadata_falls_back_to_wiql_when_no_team():
    """If no team owns the area path, fall back to WIQL scan (which returns empty here)."""
    c = _make_area_path_client(team_ids=[], teams=[], backlog_config=None)
    result = c.get_area_path_used_metadata('Proj', 'Proj\\Orphan')
    # WIQL fake returns no items → empty lists
    assert result == {'types': [], 'states': [], 'states_by_type': {}}


def test_area_path_metadata_falls_back_when_backlog_config_throws():
    """If get_backlog_configurations raises, fall back to WIQL scan."""
    teams = [{'id': 'tid-1', 'name': 'Team Beta'}]

    class FailingWorkClient:
        def get_backlog_configurations(self, team_context):
            raise RuntimeError('API unavailable')

    class FakeTeamPlanOps:
        def get_all_teams(self, project):
            return teams

        def get_team_from_area_path(self, project, area_path):
            return ['tid-1']

    class FakeWit:
        def query_by_wiql(self, wiql):
            return SimpleNamespace(work_items=[])

        def get_work_items(self, ids, fields=None):
            return []

    c = ConcreteAzure('org', DummyStorage())
    c._team_plan_ops = FakeTeamPlanOps()
    c._connected = True
    c.conn = SimpleNamespace(
        clients=SimpleNamespace(
            get_work_client=lambda: FailingWorkClient(),
            get_work_item_tracking_client=lambda: FakeWit(),
        )
    )

    result = c.get_area_path_used_metadata('Proj', 'Proj\\Beta')
    assert result == {'types': [], 'states': [], 'states_by_type': {}}


def test_area_path_metadata_falls_back_when_empty_mappings():
    """If backlog config has no type mappings, fall back to WIQL scan."""
    teams = [{'id': 'tid-1', 'name': 'Team Gamma'}]
    backlog = SimpleNamespace(work_item_type_mapped_states=[])
    c = _make_area_path_client(team_ids=['tid-1'], teams=teams, backlog_config=backlog)

    result = c.get_area_path_used_metadata('Proj', 'Proj\\Gamma')
    assert result == {'types': [], 'states': [], 'states_by_type': {}}


def test_native_client_passes_task_types_to_wiql():
    """AzureNativeClient.get_work_items must include configured task_types in the WIQL query.

    When task_types=['Story', 'Task'] is supplied the underlying WIQL query must
    contain those type strings and must NOT default to ['epic', 'feature'].
    """
    nc = AzureNativeClient('org', DummyStorage())
    captured_wiql = {}

    class FakeItem:
        def __init__(self):
            self.id = 1
            self.fields = {
                'System.Title': 'Test',
                'System.WorkItemType': 'Story',
                'System.AssignedTo': {'displayName': 'Alice'},
                'System.State': 'Active',
                'System.Tags': '',
                'System.Description': '',
                'Microsoft.VSTS.Scheduling.StartDate': None,
                'Microsoft.VSTS.Scheduling.TargetDate': None,
                'System.AreaPath': 'Proj\\Team',
                'System.IterationPath': 'Iter',
            }
            self.relations = []
            self.url = 'https://dev.azure.com/x/y/_apis/wit/workItems/1'

    class FakeWit:
        def query_by_wiql(self, wiql):
            captured_wiql['query'] = wiql.query
            return SimpleNamespace(work_items=[SimpleNamespace(id=1)])

        def get_work_items(self, ids, expand=None):
            return [FakeItem()]

    nc._connected = True
    nc.conn = SimpleNamespace(clients=SimpleNamespace(get_work_item_tracking_client=lambda: FakeWit()))
    nc.get_work_items('Proj\\Team', task_types=['Story', 'Task'])

    assert 'captured_query' not in captured_wiql or captured_wiql  # query was captured
    q = captured_wiql.get('query', '')
    assert 'Story' in q, f"Expected 'Story' in WIQL query, got: {q}"
    assert 'Task' in q, f"Expected 'Task' in WIQL query, got: {q}"
    assert 'Epic' not in q, f"'Epic' should not appear when task_types overrides the default"
    assert 'Feature' not in q, f"'Feature' should not appear when task_types overrides the default"


def test_native_client_defaults_task_types_when_none():
    """When task_types is None AzureNativeClient should use the built-in default (epic, feature)."""
    nc = AzureNativeClient('org', DummyStorage())
    captured_wiql = {}

    class FakeWit:
        def query_by_wiql(self, wiql):
            captured_wiql['query'] = wiql.query
            return SimpleNamespace(work_items=[])

        def get_work_items(self, ids, expand=None):
            return []

    nc._connected = True
    nc.conn = SimpleNamespace(clients=SimpleNamespace(get_work_item_tracking_client=lambda: FakeWit()))
    nc.get_work_items('Proj\\Team')  # no task_types → default

    q = captured_wiql.get('query', '')
    assert 'Epic' in q or 'epic' in q, f"Default WIQL should contain 'Epic', got: {q}"
    assert 'Feature' in q or 'feature' in q, f"Default WIQL should contain 'Feature', got: {q}"
