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


def test_wit_client_query_by_wiql_calls_sdk():
    """wit_client property returns the SDK WIT client; callers use it directly."""
    c = ConcreteAzure('org', DummyStorage())

    class FakeWit:
        def query_by_wiql(self, q):
            return SimpleNamespace(work_items=[SimpleNamespace(id=1), SimpleNamespace(id=2)])

        def get_work_items(self, ids, fields=None):
            return [SimpleNamespace(id=i) for i in ids]

    clients = SimpleNamespace(get_work_item_tracking_client=lambda: FakeWit(), get_core_client=lambda: None)
    c._connected = True
    c.conn = SimpleNamespace(clients=clients)

    from azure.devops.v7_1.work_item_tracking.models import Wiql
    res = c.wit_client.query_by_wiql(Wiql(query='select 1'))
    assert hasattr(res, 'work_items')
    ids = [wi.id for wi in res.work_items]
    items = c.wit_client.get_work_items(ids, fields=['System.Title'])
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
    assert result == {'types': [], 'states': [], 'states_by_type': {}, 'state_categories': {}}


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
    assert result == {'types': [], 'states': [], 'states_by_type': {}, 'state_categories': {}}


def test_area_path_metadata_falls_back_when_empty_mappings():
    """If backlog config has no type mappings, fall back to WIQL scan."""
    teams = [{'id': 'tid-1', 'name': 'Team Gamma'}]
    backlog = SimpleNamespace(work_item_type_mapped_states=[])
    c = _make_area_path_client(team_ids=['tid-1'], teams=teams, backlog_config=backlog)

    result = c.get_area_path_used_metadata('Proj', 'Proj\\Gamma')
    assert result == {'types': [], 'states': [], 'states_by_type': {}, 'state_categories': {}}


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


# ===========================================================================
# AzureMockClient persistence tests
# ===========================================================================

FIXTURE_DIR = "data/azure_mock"
# A fixture area that exists in the real fixture files.
_FIXTURE_AREA = "Platform_Development\\eSW_D13"
_FIXTURE_AREA_KEY = "Platform_Development__eSW_D13"


def _copy_fixtures_to(tmp_path):
    """Copy sdk_work_items__*.json (and supporting fixtures) for the test area to tmp_path."""
    import shutil
    from pathlib import Path
    src = Path(FIXTURE_DIR)
    for f in src.glob("sdk_*.json"):
        shutil.copy2(f, tmp_path / f.name)
    # Also copy the manifest if present
    manifest = src / "_manifest.json"
    if manifest.exists():
        shutil.copy2(manifest, tmp_path / "_manifest.json")


class TestAzureMockClientPersistence:
    """Verify that AzureMockClient persists mutations back to fixture files when enabled."""

    # ------------------------------------------------------------------
    # Schema tests
    # ------------------------------------------------------------------

    def test_azure_mock_persist_enabled_in_schema(self):
        from planner_lib.admin.schema import get_schema
        schema = get_schema('system')
        ff = schema['properties']['feature_flags']['properties']
        assert 'azure_mock_persist_enabled' in ff, (
            "azure_mock_persist_enabled must appear in feature_flags schema"
        )
        flag = ff['azure_mock_persist_enabled']
        assert flag['type'] == 'boolean'
        assert flag.get('default') is False

    def test_azure_mock_persist_enabled_showwhen(self):
        """Flag should only be visible when use_azure_mock is on."""
        from planner_lib.admin.schema import get_schema
        schema = get_schema('system')
        ff = schema['properties']['feature_flags']['properties']
        assert ff['azure_mock_persist_enabled'].get('x-showWhen') == 'use_azure_mock'

    # ------------------------------------------------------------------
    # Client construction
    # ------------------------------------------------------------------

    def test_persist_enabled_false_by_default(self):
        from planner_lib.azure.AzureMockClient import AzureMockClient
        from planner_lib.storage import create_storage
        client = AzureMockClient(
            "anonymous-org",
            storage=create_storage(backend='memory', serializer='json'),
        )
        assert client._persist_enabled is False

    def test_persist_enabled_stored_on_client(self):
        from planner_lib.azure.AzureMockClient import AzureMockClient
        from planner_lib.storage import create_storage
        client = AzureMockClient(
            "anonymous-org",
            storage=create_storage(backend='memory', serializer='json'),
            persist_enabled=True,
        )
        assert client._persist_enabled is True

    def test_feature_flag_wires_persist_enabled(self):
        """AzureService with azure_mock_persist_enabled=True creates client with persist_enabled."""
        from planner_lib.azure import AzureService
        from planner_lib.storage import create_storage
        svc = AzureService(
            organization_url="anonymous-org",
            storage=create_storage(backend='memory', serializer='json'),
            feature_flags={
                "use_azure_mock": True,
                "azure_mock_persist_enabled": True,
                "azure_mock_data_dir": FIXTURE_DIR,
            },
        )
        from planner_lib.azure.AzureMockClient import AzureMockClient
        assert isinstance(svc._client, AzureMockClient)
        assert svc._client._persist_enabled is True

    def test_feature_flag_false_does_not_set_persist(self):
        from planner_lib.azure import AzureService
        from planner_lib.storage import create_storage
        svc = AzureService(
            organization_url="anonymous-org",
            storage=create_storage(backend='memory', serializer='json'),
            feature_flags={
                "use_azure_mock": True,
                "azure_mock_persist_enabled": False,
                "azure_mock_data_dir": FIXTURE_DIR,
            },
        )
        assert svc._client._persist_enabled is False

    # ------------------------------------------------------------------
    # Empty PAT
    # ------------------------------------------------------------------

    def test_empty_pat_no_error_with_persist_enabled(self):
        """An empty PAT must not raise ValueError when mock client is active."""
        from planner_lib.azure.AzureMockClient import AzureMockClient
        from planner_lib.storage import create_storage
        client = AzureMockClient(
            "anonymous-org",
            storage=create_storage(backend='memory', serializer='json'),
            fixture_dir=FIXTURE_DIR,
            persist_enabled=True,
        )
        with client.connect("") as c:
            teams = c.get_all_teams("Platform_Development")
        assert isinstance(teams, list)

    # ------------------------------------------------------------------
    # Mutation persistence (using copied fixtures in tmp_path)
    # ------------------------------------------------------------------

    def test_persist_disabled_does_not_write(self, tmp_path):
        """With persist_enabled=False, the fixture file is NOT rewritten after update."""
        import json as _json
        from planner_lib.azure.AzureMockClient import AzureMockClient
        from planner_lib.storage import create_storage

        _copy_fixtures_to(tmp_path)

        # Record mtime before
        target_file = tmp_path / f"sdk_work_items__{_FIXTURE_AREA_KEY}.json"
        mtime_before = target_file.stat().st_mtime

        # Get a work item id from the file
        items = _json.loads(target_file.read_text())
        assert items, "Fixture file must contain at least one item"
        wid = int(items[0]['id'])

        client = AzureMockClient(
            "anonymous-org",
            storage=create_storage(backend='memory', serializer='json'),
            fixture_dir=str(tmp_path),
            persist_enabled=False,
        )
        with client.connect("") as c:
            c.update_work_item_dates(wid, start="2026-01-01T00:00:00Z", end="2026-12-31T00:00:00Z")

        mtime_after = target_file.stat().st_mtime
        assert mtime_after == mtime_before, (
            "File should NOT be rewritten when persist_enabled=False"
        )

    def test_persist_enabled_writes_on_mutation(self, tmp_path):
        """With persist_enabled=True, the fixture file IS rewritten after update_work_item_dates."""
        import json as _json
        from planner_lib.azure.AzureMockClient import AzureMockClient
        from planner_lib.storage import create_storage

        _copy_fixtures_to(tmp_path)

        target_file = tmp_path / f"sdk_work_items__{_FIXTURE_AREA_KEY}.json"
        items = _json.loads(target_file.read_text())
        assert items, "Fixture file must contain at least one item"
        wid = int(items[0]['id'])

        new_start = "2026-03-01T00:00:00Z"
        new_end   = "2026-06-01T00:00:00Z"

        client = AzureMockClient(
            "anonymous-org",
            storage=create_storage(backend='memory', serializer='json'),
            fixture_dir=str(tmp_path),
            persist_enabled=True,
        )
        with client.connect("") as c:
            c.update_work_item_dates(wid, start=new_start, end=new_end)

        # Read updated file from disk
        updated_items = _json.loads(target_file.read_text())
        updated = next((i for i in updated_items if int(i['id']) == wid), None)
        assert updated is not None, f"WI#{wid} not found in the fixture file after update"
        assert updated['fields'].get('Microsoft.VSTS.Scheduling.StartDate') == new_start
        assert updated['fields'].get('Microsoft.VSTS.Scheduling.TargetDate') == new_end

    def test_persist_enabled_second_mutation_accumulates(self, tmp_path):
        """Multiple mutations on different items are all reflected in the file."""
        import json as _json
        from planner_lib.azure.AzureMockClient import AzureMockClient
        from planner_lib.storage import create_storage

        _copy_fixtures_to(tmp_path)

        target_file = tmp_path / f"sdk_work_items__{_FIXTURE_AREA_KEY}.json"
        raw_items = _json.loads(target_file.read_text())
        assert len(raw_items) >= 2, "Need at least 2 items in the fixture to test accumulation"
        wid1 = int(raw_items[0]['id'])
        wid2 = int(raw_items[1]['id'])

        start1, end1 = "2026-01-01T00:00:00Z", "2026-03-01T00:00:00Z"
        start2, end2 = "2026-04-01T00:00:00Z", "2026-07-01T00:00:00Z"

        client = AzureMockClient(
            "anonymous-org",
            storage=create_storage(backend='memory', serializer='json'),
            fixture_dir=str(tmp_path),
            persist_enabled=True,
        )
        with client.connect("") as c:
            c.update_work_item_dates(wid1, start=start1, end=end1)
            c.update_work_item_dates(wid2, start=start2, end=end2)

        persisted = {int(i['id']): i for i in _json.loads(target_file.read_text())}
        assert persisted[wid1]['fields'].get('Microsoft.VSTS.Scheduling.StartDate') == start1
        assert persisted[wid2]['fields'].get('Microsoft.VSTS.Scheduling.StartDate') == start2
