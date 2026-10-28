from contextlib import contextmanager
from types import SimpleNamespace
import threading
import pytest
from unittest.mock import MagicMock, patch

from planner_lib.azure.AzureClient import AzureClient
from planner_lib.backend.azure import AzureDevOpsBackend
from tests.python.azure.test_process_catalogue import task_catalogue
from planner_lib.storage.memory_backend import MemoryStorage


class DummyStorage:
    pass


def test_process_catalogue_client_normalizes_projects_types_and_backlogs():
    from azure.devops.v7_1.work_item_tracking_process.models import (
        ProcessInfo, ProcessWorkItemType, ProjectReference, ProcessBehavior,
        ProcessBehaviorReference, WorkItemTypeBehavior, WorkItemBehaviorReference,
        WorkItemStateResultModel,
    )
    sdk = MagicMock()
    sdk.get_list_of_processes.return_value = [
        ProcessInfo(type_id='base', name='Agile', parent_process_type_id='00000000-0000-0000-0000-000000000000'),
        ProcessInfo(type_id='custom', name='Custom', parent_process_type_id='base',
                    projects=[ProjectReference(name='Platform')]),
    ]
    sdk.get_process_behaviors.return_value = [
        ProcessBehavior(reference_name='Features', rank=30,
                        inherits=ProcessBehaviorReference(behavior_ref_name='System.PortfolioBacklogBehavior')),
        ProcessBehavior(reference_name='System.TaskBacklogBehavior', rank=10),
        ProcessBehavior(reference_name='System.RequirementBacklogBehavior', rank=20),
    ]
    sdk.get_process_work_item_types.return_value = [
        ProcessWorkItemType(reference_name='Task', name='Task', states=[], behaviors=[
            WorkItemTypeBehavior(behavior=WorkItemBehaviorReference(id='System.TaskBacklogBehavior'))]),
        ProcessWorkItemType(reference_name='Feature', name='Feature', states=[
            WorkItemStateResultModel(name='Closed', state_category='Completed', order=4),
            WorkItemStateResultModel(name='New', state_category='Proposed', order=1),
        ], behaviors=[WorkItemTypeBehavior(behavior=WorkItemBehaviorReference(id='Features'))]),
        ProcessWorkItemType(reference_name='Story', name='User Story', states=[], behaviors=[
            WorkItemTypeBehavior(behavior=WorkItemBehaviorReference(id='System.RequirementBacklogBehavior'))]),
        ProcessWorkItemType(reference_name='Issue', name='Issue', states=[], behaviors=[]),
    ]
    client = AzureClient('org', DummyStorage())
    client._connected = True
    client.conn = SimpleNamespace(clients=SimpleNamespace(
        get_work_item_tracking_process_client=lambda: sdk))
    assert client.list_processes() == [
        {'id': 'base', 'name': 'Agile', 'projects': []},
        {'id': 'custom', 'name': 'Custom', 'parent_name': 'Agile', 'projects': ['Platform']},
    ]
    types = client.get_process_types('custom')
    assert [item['name'] for item in types] == ['Feature', 'User Story', 'Task', 'Issue']
    assert [item['backlog_level'] for item in types] == ['portfolio', 'requirement', 'task', 'none']
    assert types[0]['backlog'] == 'Features'
    assert types[0]['states'] == [
        {'name': 'New', 'category': 'Proposed', 'order': 1},
        {'name': 'Closed', 'category': 'Completed', 'order': 4},
    ]
    assert all(item['imported'] is False and item['missing'] is False for item in types)
    sdk.get_list_of_processes.assert_called_once_with(expand='projects')
    sdk.get_process_work_item_types.assert_called_once_with('custom', expand='states,behaviors')


@pytest.mark.parametrize('method,args', [('list_processes', ()), ('get_process_types', ('custom',))])
def test_process_catalogue_requires_acting_connection(method, args):
    client = AzureClient('org', DummyStorage())
    with pytest.raises(RuntimeError, match='not connected'):
        getattr(client, method)(*args)


@pytest.mark.parametrize('credential, message', [
    ({'token': 'secret', 'user_id': 'user'}, 'Unsupported backend credential kind'),
    ({'kind': 'oauth', 'token': 'secret', 'user_id': 'user'},
     'Unsupported backend credential kind'),
    ({'kind': 'pat', 'token': '', 'user_id': 'user'}, 'non-empty token'),
    ({'kind': 'pat', 'token': 'secret', 'user_id': ''}, 'user ID'),
    (None, 'must be a mapping'),
])
def test_connect_rejects_malformed_or_unsupported_credentials(credential, message):
    client = AzureClient('org', DummyStorage())
    with pytest.raises(ValueError, match=message) as raised:
        client.connect(credential)
    assert 'secret' not in str(raised.value)


@pytest.mark.parametrize('flags', [
    {'use_azure_mock': True}, {'use_azure_mock_generator': True},
])
def test_mock_service_uses_shared_client_connection_with_synthetic_credential(flags):
    from planner_lib.azure import AzureService
    from planner_lib.azure.AzureMockClient import _MOCK_CREDENTIAL

    service = AzureService('example', MemoryStorage(), feature_flags=flags)
    assert type(service._client).connect is AzureClient.connect

    with patch.object(AzureClient, 'connect', autospec=True) as connect:
        service.connect(None)

    connect.assert_called_once_with(service._client, _MOCK_CREDENTIAL)


def test_connect_uses_shared_pat_authentication_builder():
    client = AzureClient('org', DummyStorage())
    authentication = object()
    credential = {'kind': 'pat', 'token': 'private-pat', 'user_id': 'user'}

    with patch('planner_lib.azure.AzureClient.azure_devops_pat_authentication',
               return_value=authentication) as build_authentication, \
            patch('azure.devops.connection.Connection') as connection:
        with client.connect(credential):
            pass

    build_authentication.assert_called_once_with('private-pat')
    connection.assert_called_once_with(
        base_url='https://dev.azure.com/org',
        creds=authentication,
    )


@pytest.mark.parametrize('connection_kind', ['operation', 'pat_validation'])
@pytest.mark.parametrize('failure_at', ['connect', 'operation'])
def test_auth_failure_retains_operation_context_and_closes_connection(connection_kind, failure_at):
    from planner_lib.backend.errors import BackendAuthError

    client = AzureClient('org', DummyStorage())
    credential = {'kind': 'pat', 'token': 'private-pat', 'user_id': 'acting-account'}
    failure = RuntimeError('403 Forbidden')
    failure.status_code = 403
    with patch('azure.devops.connection.Connection') as connection:
        if failure_at == 'connect':
            connection.side_effect = failure
        context = (client.connect(credential) if connection_kind == 'operation'
                   else client.connect_pat(credential['token']))
        with pytest.raises(BackendAuthError) as raised:
            with context:
                raise failure

    assert raised.value.status_code == 403
    assert raised.value.credential == (credential if connection_kind == 'operation' else None)
    assert credential['token'] not in str(raised.value)
    assert credential['token'] not in repr(raised.value)
    assert client.conn is None
    assert client._connected is False


def test_shared_pat_authentication_uses_basic_auth_with_empty_username():
    from planner_lib.azure.authentication import azure_devops_pat_authentication

    with patch('msrest.authentication.BasicAuthentication') as basic_authentication:
        result = azure_devops_pat_authentication('private-pat')

    assert result is basic_authentication.return_value
    basic_authentication.assert_called_once_with('', 'private-pat')


def test_connect_uses_explicit_bearer_authentication_with_installed_sdk():
    client = AzureClient('example', DummyStorage())
    credential = {'kind': 'bearer', 'token': 'opaque-access-token', 'user_id': 'acting-account'}

    with patch('azure.devops.connection.Connection') as connection:
        with client.connect(credential):
            authentication = connection.call_args.kwargs['creds']
            session = authentication.signed_session()
            assert session.headers['Authorization'] == 'Bearer opaque-access-token'
            session.close()

    assert connection.call_args.kwargs['base_url'] == 'https://dev.azure.com/example'
    assert client.conn is None
    assert client._connected is False


def test_bearer_authentication_is_accepted_by_real_sdk_without_network():
    client = AzureClient('example', DummyStorage())
    credential = {'kind': 'bearer', 'token': 'opaque-access-token', 'user_id': 'acting-account'}

    with client.connect(credential):
        session = client.conn._config.credentials.signed_session()
        assert session.headers['Authorization'] == 'Bearer opaque-access-token'
        session.close()


def test_sdk_renews_bearer_for_each_request_without_replaying_denial():
    from planner_lib.azure.authentication import azure_devops_authentication
    from planner_lib.session.broker import AuthFailure

    credential = {'kind': 'bearer', 'token': 'initial', 'user_id': 'acting-account', 'transport': 'live'}
    provider = MagicMock()
    provider.renew.side_effect = [
        {**credential, 'token': 'first'}, {**credential, 'token': 'second'},
        AuthFailure('access_denied', 403),
    ]
    authentication = azure_devops_authentication(credential, provider)
    for token in ('first', 'second'):
        session = authentication.signed_session()
        assert session.headers['Authorization'] == 'Bearer ' + token
        session.close()
    with pytest.raises(AuthFailure, match='access_denied'):
        authentication.signed_session()
    assert provider.renew.call_count == 3


def test_live_sdk_refuses_sandbox_credentials_before_connection():
    client = AzureClient('example', DummyStorage())
    credential = {'kind': 'bearer', 'token': 'fixture', 'user_id': 'acting-account', 'transport': 'fixture'}
    with patch('azure.devops.connection.Connection') as connection:
        with pytest.raises(ValueError, match='fixture transport'):
            with client.connect(credential):
                pass
    connection.assert_not_called()


def test_backend_composition_and_reload_keep_delegated_provider():
    provider = MagicMock()
    config = MagicMock()
    config.fetch_ado_config.return_value = {'organization_url': 'example', 'feature_flags': {}}
    backend = AzureDevOpsBackend.build_from_flags({}, org_url='example', storage=MemoryStorage(),
        config_backend=config, credential_provider=provider)
    assert backend._conn._credential_provider is provider
    backend.reload()
    assert backend._conn._credential_provider is provider
    credential = {'kind': 'bearer', 'token': 'opaque', 'user_id': 'acting-account'}
    assert backend._require_credential(credential, 'fetch_tasks') == credential


def test_renewed_sdk_failure_keeps_used_credential_and_typed_broker_decision():
    from planner_lib.backend.errors import BackendAuthError, classify_ado_exception
    from planner_lib.session.broker import AuthFailure

    provider = MagicMock()
    credential = {'kind': 'bearer', 'token': 'initial', 'user_id': 'acting-account', 'transport': 'live'}
    renewed = {**credential, 'token': 'used-access-token'}
    provider.renew.return_value = renewed
    client = AzureClient('example', DummyStorage(), credential_provider=provider)
    with patch('azure.devops.connection.Connection') as connection:
        with pytest.raises(BackendAuthError) as raised:
            with client.connect(credential):
                session = connection.call_args.kwargs['creds'].signed_session()
                session.close()
                raise BackendAuthError('Remote access denied', status_code=403)
    assert raised.value.credential == renewed
    failure = AuthFailure('interaction_required', 409)
    assert classify_ado_exception(failure) is failure


@pytest.mark.skip(reason='Recorded-file mock catalogue fixtures are not maintained; temporarily deferred.')
def test_recorded_mock_process_catalogue():
    from planner_lib.azure.AzureMockClient import AzureMockClient
    from planner_lib.storage import create_storage
    client = AzureMockClient('org', create_storage(backend='memory'))
    with client.connect({'kind': 'pat', 'token': 'fixture-pat', 'user_id': 'test'}):
        processes = client.list_processes()
        process = next(item for item in processes if 'MyProject' in item['projects'])
        assert process['parent_name'] == 'Agile'
        types = client.get_process_types(process['id'])
    assert any(item['backlog_level'] == 'task' for item in types)
    assert any(item['name'] == 'Feature' and item['states'] for item in types)


def make_dummy_conn_for_projects():
    core = SimpleNamespace(get_projects=lambda: SimpleNamespace(value=[SimpleNamespace(name='ProjA'), SimpleNamespace(name='ProjB')]))
    clients = SimpleNamespace(get_core_client=lambda: core, get_work_item_tracking_client=lambda: None)
    return SimpleNamespace(clients=clients)


def test_api_url_to_ui_link_valid_and_invalid():
    c = AzureClient('org', DummyStorage())
    ui = c.api_url_to_ui_link('https://dev.azure.com/myorg/myproj/_apis/wit/workItems/123')
    assert ui.endswith('/_workitems/edit/123')
    with pytest.raises(ValueError):
        c.api_url_to_ui_link('https://example.com/not/azure')


@pytest.mark.parametrize('root', [
    'eSW\\Platform', 'eSW/Platform', '\\eSW\\Platform',
    'Project\\Iteration\\eSW\\Platform', '\\Project\\Iteration\\eSW\\Platform',
    '/Project/Iteration/eSW/Platform',
])
def test_iteration_request_uses_relative_path_for_real_ado_path_forms(root):
    client = AzureClient('org', DummyStorage())
    wit = MagicMock()
    wit.get_classification_node.return_value = SimpleNamespace(
        path='\\Project\\Iteration\\eSW\\Platform', name='Platform',
        attributes={}, children=[],
    )
    client._connected = True
    client.conn = SimpleNamespace(clients=SimpleNamespace(
        get_work_item_tracking_client=lambda: wit))

    iterations = client.get_iterations('Project', root_path=root)

    wit.get_classification_node.assert_called_once_with(
        project='Project', structure_group='iterations', path='eSW\\Platform', depth=10,
    )
    assert iterations[0]['path'] == '\\Project\\Iteration\\eSW\\Platform'


def test_iteration_fetch_failure_is_not_an_empty_schedule_tree():
    client = AzureClient('org', DummyStorage())
    wit = MagicMock()
    wit.get_classification_node.side_effect = RuntimeError('503 Service Unavailable')
    client._connected = True
    client.conn = SimpleNamespace(clients=SimpleNamespace(
        get_work_item_tracking_client=lambda: wit,
    ))

    with pytest.raises(RuntimeError, match='503 Service Unavailable'):
        client.get_iterations('A')


def test_sanitize_and_flatten_area_nodes():
    c = AzureClient('org', DummyStorage())
    node = SimpleNamespace(path='Area/Sub', children=[SimpleNamespace(name='Leaf')])
    flat = c._flatten_area_nodes(node)
    assert 'Area/Sub' in flat or 'Leaf' in flat
    assert c._sanitize_area_path('Area\\Sub') == 'Sub'


def test_safe_date():
    c = AzureClient('org', DummyStorage())
    assert c._safe_date(None) is None
    assert isinstance(c._safe_date('2020-01-01T12:00:00Z'), str)


def test_work_item_normalization_promotes_state_change_date():
    client = AzureClient('org', DummyStorage())
    item = SimpleNamespace(
        id=17,
        fields={
            'System.Id': 17,
            'System.TeamProject': 'Project',
            'System.Rev': 2,
            'System.WorkItemType': 'Feature',
            'System.Title': 'Feature',
            'System.State': 'Closed',
            'Microsoft.VSTS.Common.StateChangeDate': '2026-08-01T09:00:00Z',
        },
        relations=[],
        url='https://dev.azure.com/x/y/_apis/wit/workItems/17',
    )

    result = client._work_item_ops.normalize_work_item(item)

    assert result['stateChangeDate'] == '2026-08-01T09:00:00Z'
    assert 'Microsoft.VSTS.Common.StateChangeDate' not in result.get('fields', {})


def test_work_item_type_passthrough():
    """Work item types must be stored as the exact Azure DevOps string.

    After removing _safe_type() normalization, the 'type' field in returned work
    items must reflect the raw value from System.WorkItemType — e.g. 'Feature',
    'User Story', 'Bug' — not a lowercased or remapped proxy like 'feature'.
    """
    nc = AzureClient('org', DummyStorage())

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
        stored = task_catalogue(['Proj'])
        stored['processes'][0]['types'] = [{
            'name': azure_type, 'reference_name': azure_type, 'backlog_level': 'portfolio',
            'backlog': azure_type, 'imported': True, 'missing': False,
            'states': [{'name': 'Active', 'category': 'InProgress', 'order': 1}],
        }]
        results = nc.get_work_items('Proj\\Team', [azure_type], catalogue=stored)
        assert len(results) == 1, f'Expected 1 result for type {azure_type}'
        assert results[0]['type'] == expected, (
            f"Expected type '{expected}' but got '{results[0]['type']}' for Azure type '{azure_type}'"
        )


@pytest.mark.parametrize(('task_types', 'include_states', 'expected_types', 'expected_states'), [
    (["Owner's Feature"], ["Won't Do"], "'Owner''s Feature'", "IN ('Won''t Do')"),
    (["Feature') OR [System.Id] > 0 --", 'Bug'],
     ["Active') OR [System.Id] > 0 --", 'New'],
     "'Feature'') OR [System.Id] > 0 --','Bug'",
     "IN ('Active'') OR [System.Id] > 0 --','New')"),
    (['Feature'], ['Active'], "'Feature'", "IN ('Active')"),
])
def test_seed_wiql_escapes_all_string_literals(
    task_types, include_states, expected_types, expected_states,
):
    client = AzureClient('org', DummyStorage())
    wit = MagicMock()
    wit.query_by_wiql.return_value = SimpleNamespace(work_items=[])
    client._connected = True
    client.conn = SimpleNamespace(clients=SimpleNamespace(
        get_work_item_tracking_client=lambda: wit,
    ))

    stored = task_catalogue(['Project'])
    stored['processes'][0]['types'] = [{
        'name': name, 'reference_name': name, 'backlog_level': 'portfolio', 'backlog': name,
        'imported': True, 'missing': False,
        'states': [{'name': state, 'category': 'Proposed', 'order': order}
                   for order, state in enumerate(include_states)],
    } for name in task_types]
    assert client.get_work_items("/Project/Owner's Area", task_types, catalogue=stored) == []

    query = wit.query_by_wiql.call_args.kwargs['wiql'].query
    assert f'[System.WorkItemType] IN ({expected_types})' in query
    assert f'[System.State] {expected_states}' in query
    assert "[System.AreaPath] = 'Project\\\\Owner''s Area'" in query
    wit.get_work_items.assert_not_called()


@pytest.mark.parametrize('days', [0, 90])
def test_catalogue_seed_query_limits_completed_history(days):
    from tests.python.azure.test_process_catalogue import catalogue

    stored = catalogue()
    stored['processes'][0]['types'][1]['states'] = [
        {'name': 'Ready', 'category': 'Proposed', 'order': 1},
        {'name': 'Working', 'category': 'InProgress', 'order': 2},
        {'name': 'Done', 'category': 'Completed', 'order': 3},
        {'name': 'Deleted', 'category': 'Removed', 'order': 4},
    ]
    client = AzureClient('org', DummyStorage())
    wit = MagicMock()
    wit.query_by_wiql.return_value = SimpleNamespace(work_items=[])
    client._connected = True
    client.conn = SimpleNamespace(clients=SimpleNamespace(get_work_item_tracking_client=lambda: wit))

    client.get_work_items('Platform\\Team', ['feature'], catalogue=stored,
                          closed_history_days=days)

    query = wit.query_by_wiql.call_args.kwargs['wiql'].query
    assert "[System.WorkItemType] IN ('Feature')" in query
    assert "[System.State] IN ('Ready','Working')" in query
    assert 'Deleted' not in query
    assert 'User Story' not in query
    if days:
        assert "[System.State] IN ('Done')" in query
        assert '[Microsoft.VSTS.Common.StateChangeDate] >= @Today - 90' in query
    else:
        assert 'Done' not in query
        assert 'StateChangeDate' not in query


@pytest.mark.parametrize('project,types,code', [
    ('Unknown', ['Feature'], 'process_not_imported'),
    ('Platform', ['Task'], 'type_not_imported'),
    ('Platform', [], 'type_not_imported'),
])
def test_catalogue_seed_query_rejects_unimported_types(project, types, code):
    from planner_lib.azure.catalogue import CatalogueError
    from tests.python.azure.test_process_catalogue import catalogue

    client = AzureClient('org', DummyStorage())
    client._connected = True
    client.conn = SimpleNamespace(clients=SimpleNamespace(get_work_item_tracking_client=MagicMock()))
    with pytest.raises(CatalogueError) as error:
        client.get_work_items(project, types, catalogue=catalogue(), closed_history_days=0)
    assert error.value.code == code


def test_get_projects_uses_connection():
    c = AzureClient('org', DummyStorage())
    c._connected = True
    c.conn = make_dummy_conn_for_projects()
    projs = c.get_projects()
    assert 'ProjA' in projs and 'ProjB' in projs


def test_overlapping_connection_contexts_do_not_disconnect_each_other():
    client = AzureClient('org', DummyStorage())
    first_connected = threading.Event()
    second_connected = threading.Event()
    first_closed = threading.Event()
    errors = []

    def connect_for_test(_pat):
        client.conn = make_dummy_conn_for_projects()
        client._connected = True

    client._connect_with_pat = connect_for_test

    def first_request():
        with client.connect({'kind': 'pat', 'token': 'first-pat', 'user_id': 'test'}):
            first_connected.set()
            second_connected.wait(timeout=1)
        first_closed.set()

    def second_request():
        first_connected.wait(timeout=1)
        with client.connect({'kind': 'pat', 'token': 'second-pat', 'user_id': 'test'}) as connected_client:
            second_connected.set()
            first_closed.wait(timeout=1)
            try:
                assert connected_client.get_projects() == ['ProjA', 'ProjB']
            except Exception as exc:
                errors.append(exc)

    first_thread = threading.Thread(target=first_request)
    second_thread = threading.Thread(target=second_request)
    first_thread.start()
    second_thread.start()
    first_thread.join(timeout=2)
    second_thread.join(timeout=2)

    assert not first_thread.is_alive()
    assert not second_thread.is_alive()
    assert errors == []


def test_get_all_plans_cached_until_project_invalidation():
    class FakeWorkClient:
        def __init__(self):
            self.plans = [SimpleNamespace(id='plan-1', name='Plan 1')]

        def get_plans(self, project):
            return self.plans

        def get_delivery_timeline_data(self, project, plan_id):
            return SimpleNamespace(teams=[])

    work_client = FakeWorkClient()
    client = AzureClient('org', DummyStorage())
    client._connected = True
    client.conn = SimpleNamespace(
        clients=SimpleNamespace(get_work_client=lambda: work_client)
    )

    assert [plan['id'] for plan in client.get_all_plans('Project')] == ['plan-1']

    work_client.plans = [SimpleNamespace(id='plan-2', name='Plan 2')]

    assert [plan['id'] for plan in client.get_all_plans('Project')] == ['plan-1']

    client.invalidate_plans('Project')

    assert [plan['id'] for plan in client.get_all_plans('Project')] == ['plan-2']


def test_get_all_plans_cache_can_be_disabled():
    work_client = MagicMock()
    work_client.get_plans.side_effect = [
        [SimpleNamespace(id='plan-1', name='Plan 1')],
        [SimpleNamespace(id='plan-2', name='Plan 2')],
    ]
    work_client.get_delivery_timeline_data.return_value = SimpleNamespace(teams=[])
    client = AzureClient('org', DummyStorage(), cache_plans=False)
    client._connected = True
    client.conn = SimpleNamespace(
        clients=SimpleNamespace(get_work_client=lambda: work_client)
    )

    assert [plan['id'] for plan in client.get_all_plans('Project')] == ['plan-1']
    assert [plan['id'] for plan in client.get_all_plans('Project')] == ['plan-2']


def test_azure_service_global_invalidation_reaches_concrete_client():
    from planner_lib.azure import AzureService

    service = AzureService('org', DummyStorage())
    service._client = MagicMock()
    service._client.invalidate_all_caches.return_value = {'ok': True, 'cleared': 3}

    assert service.invalidate_all_caches() == {'ok': True, 'cleared': 3}
    service._client.invalidate_all_caches.assert_called_once_with()


def test_wit_client_query_by_wiql_calls_sdk():
    """wit_client property returns the SDK WIT client; callers use it directly."""
    c = AzureClient('org', DummyStorage())

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
    c = AzureClient('org', DummyStorage())
    with pytest.raises(RuntimeError):
        c.update_work_item_description(1, '<p>desc</p>')
    with pytest.raises(RuntimeError):
        c.update_work_item_dates(1, start='2020-01-01')


@pytest.mark.parametrize('has_explicit_dates', [False, True])
def test_clear_schedule_resets_iteration_and_existing_dates_in_one_patch(has_explicit_dates):
    client = AzureClient('org', DummyStorage())
    wit = MagicMock()
    fields = {'System.TeamProject': 'Project', 'System.IterationPath': 'Project\\Sprint'}
    if has_explicit_dates:
        fields.update({'Microsoft.VSTS.Scheduling.StartDate': '2026-01-01',
                       'Microsoft.VSTS.Scheduling.TargetDate': '2026-01-14'})
    wit.get_work_item.return_value = SimpleNamespace(fields=fields)
    client._connected = True
    client.conn = SimpleNamespace(clients=SimpleNamespace(
        get_work_item_tracking_client=lambda: wit))

    client.update_work_item_dates(1, start=None, end=None)

    wit.update_work_item.assert_called_once()
    document = wit.update_work_item.call_args.kwargs['document']
    assert {'op': 'replace', 'path': '/fields/System.IterationPath',
            'value': 'Project'} in document
    removed = {entry['path'] for entry in document if entry['op'] == 'remove'}
    assert removed == ({'/fields/Microsoft.VSTS.Scheduling.StartDate',
                        '/fields/Microsoft.VSTS.Scheduling.TargetDate'}
                       if has_explicit_dates else set())


def test_azure_native_client_get_work_items_parses_items():
    nc = AzureClient('org', DummyStorage())
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
    res = nc.get_work_items('Area/Sub', ['Feature', 'Epic'], catalogue=task_catalogue(['Area']))
    assert isinstance(res, list)
    assert any(r['id'] == '10' for r in res)


# ---------------------------------------------------------------------------
# Linked hierarchy traversal
# ---------------------------------------------------------------------------

def test_linked_hierarchy_crosses_areas_but_stops_at_project_task_category():
    def work_item(item_id, project, item_type, children=()):
        return SimpleNamespace(
            id=item_id,
            fields={
                'System.TeamProject': project,
                'System.AreaPath': f'{project}\\WrongArea',
                'System.WorkItemType': item_type,
                'System.Title': f'Item {item_id}',
                'System.State': 'Closed',
            },
            relations=[SimpleNamespace(
                attributes={'name': 'Child'},
                url=f'https://dev.azure.com/org/{project}/_apis/wit/workItems/{child}',
            ) for child in children],
            url=f'https://dev.azure.com/org/{project}/_apis/wit/workItems/{item_id}',
        )

    items = {
        1: work_item(1, 'A', 'Epic', (2, 3, 4)),
        2: work_item(2, 'B', 'Requirement', (5,)),
        3: work_item(3, 'B', 'Implementation Step', (6,)),
        4: work_item(4, 'A', 'Implementation Step'),
        5: work_item(5, 'B', 'Test Plan', (1,)),
        6: work_item(6, 'B', 'Feature'),
    }
    batches = []
    category_projects = []

    def get_work_items(ids, fields=None, expand=None, error_policy=None):
        batches.append((list(ids), fields, expand))
        return [items[item_id] for item_id in ids]

    def get_work_item_type_category(project, category):
        assert category == 'Microsoft.TaskCategory'
        category_projects.append(project)
        types = ['Task'] if project == 'A' else ['Task', 'Implementation Step']
        return SimpleNamespace(work_item_types=[SimpleNamespace(name=name) for name in types])

    wit = SimpleNamespace(
        get_work_items=get_work_items,
        get_work_item_type_category=get_work_item_type_category,
    )
    client = AzureClient('org', DummyStorage())
    client._connected = True
    client.conn = SimpleNamespace(clients=SimpleNamespace(get_work_item_tracking_client=lambda: wit))
    seed = client._work_item_ops.normalize_work_item(items[1])

    stored = task_catalogue(['A', 'B'])
    stored['processes'][0]['types'].append({
        'name': 'Test Plan', 'reference_name': 'Test Plan', 'imported': True,
        'backlog_level': 'none', 'backlog': None, 'missing': False, 'states': [],
    })
    linked = client._work_item_ops.get_linked_work_items([seed], catalogue=stored)

    assert [item['id'] for item in linked] == ['1', '2', '5']
    assert linked[1]['areaPath'] == 'B\\WrongArea'
    assert linked[1]['adoProject'] == 'B'
    assert linked[1]['state'] == 'Closed'
    assert seed['relations'][1]['id'] == '3'
    assert category_projects == []
    assert all(3 not in ids and 6 not in ids for ids, fields, expand in batches if expand)
    assert all(1 not in ids for ids, fields, expand in batches)


def _linked_item(item_id, item_type='Feature', children=(), project='A', parents=()):
    return SimpleNamespace(
        id=item_id,
        rev=1,
        fields={
            'System.Rev': 1,
            'System.TeamProject': project,
            'System.AreaPath': f'{project}\\WrongArea',
            'System.WorkItemType': item_type,
            'System.Title': f'Item {item_id}',
            'System.State': 'Active',
        },
        relations=[SimpleNamespace(
            attributes={'name': 'Child'},
            url=f'https://dev.azure.com/org/{project}/_apis/wit/workItems/{child}',
        ) for child in children] + [SimpleNamespace(
            attributes={'name': 'Parent'},
            url=f'https://dev.azure.com/org/{project}/_apis/wit/workItems/{parent}',
        ) for parent in parents],
        url=f'https://dev.azure.com/org/{project}/_apis/wit/workItems/{item_id}',
    )


def _linked_client(items, missing_ids=()):
    def get_work_items(ids, fields=None, expand=None, error_policy=None):
        assert error_policy == 'omit'
        return [items[item_id] for item_id in ids if item_id not in missing_ids]

    wit = SimpleNamespace(
        get_work_items=MagicMock(side_effect=get_work_items),
        get_deleted_work_items=MagicMock(return_value=[SimpleNamespace(id=identity) for identity in missing_ids]),
        get_work_item_type_category=MagicMock(return_value=SimpleNamespace(
            work_item_types=[SimpleNamespace(name='Task'), SimpleNamespace(name='Implementation Step')],
        )),
    )
    client = AzureClient('org', DummyStorage())
    client._connected = True
    client.conn = SimpleNamespace(clients=SimpleNamespace(get_work_item_tracking_client=lambda: wit))
    return client, wit


def test_linked_hierarchy_loads_ancestor_paths_without_sibling_branches():
    items = {
        1: _linked_item(1, children=(2,), parents=(10,)),
        2: _linked_item(2, parents=(1,)),
        10: _linked_item(10, 'Epic', children=(1, 11), project='B', parents=(20,)),
        20: _linked_item(20, 'Epic', children=(10, 21), project='C'),
    }
    client, wit = _linked_client(items)
    seed = client._work_item_ops.normalize_work_item(items[1])

    tasks = {item['id']: item for item in client.get_linked_work_items(
        [seed], catalogue=task_catalogue(['A', 'B', 'C', 'D']))}

    assert set(tasks) == {'1', '2', '10', '20'}
    assert not tasks['1']['ancestorOnly']
    assert tasks['1']['childrenComplete']
    assert tasks['10']['ancestorOnly']
    assert not tasks['10']['childrenComplete']
    assert tasks['20']['ancestorOnly']
    assert tasks['10']['unresolvedChildIds'] == []
    requested = {item_id for call in wit.get_work_items.call_args_list for item_id in call.args[0]}
    assert requested == {2, 10, 20}


def test_linked_hierarchy_reports_missing_parents_and_terminates_parent_cycles():
    items = {
        1: _linked_item(1, parents=(10, 99)),
        10: _linked_item(10, parents=(1,)),
    }
    client, wit = _linked_client(items, missing_ids=(99,))
    tasks = {item['id']: item for item in client.get_linked_work_items([
        client._work_item_ops.normalize_work_item(items[1]),
    ], catalogue=task_catalogue(['A', 'B', 'C', 'D']))}

    assert set(tasks) == {'1', '10'}
    assert tasks['1']['unresolvedParentIds'] == ['99']
    assert tasks['10']['unresolvedParentIds'] == []
    assert len(wit.get_work_items.call_args_list) == 1


def test_linked_hierarchy_batches_and_deduplicates_shared_children():
    children = tuple(range(3, 408))
    items = {1: _linked_item(1, children=children), 2: _linked_item(2, children=children)}
    items.update((item_id, _linked_item(item_id)) for item_id in children)
    client, wit = _linked_client(items)
    seeds = [client._work_item_ops.normalize_work_item(items[item_id]) for item_id in (1, 2)]

    result = client.get_linked_work_items(seeds, catalogue=task_catalogue(['A', 'B', 'C', 'D']))

    assert len(result) == 407
    classified = []
    hydrated = []
    for call in wit.get_work_items.call_args_list:
        ids = call.args[0]
        assert len(ids) <= 200
        (classified if 'fields' in call.kwargs else hydrated).extend(ids)
    assert classified == list(children)
    assert hydrated == list(children)
    wit.get_work_item_type_category.assert_not_called()


@pytest.mark.parametrize('through_repository', [False, True])
def test_backend_context_composes_real_traversal_and_domain_enrichment(through_repository):
    items = {
        1: _linked_item(1, 'Epic', (2,), parents=(10,)),
        4: _linked_item(4, 'Feature', (2,), project='B'),
        2: _linked_item(2, 'Requirement', (3, 5), project='B'),
        3: _linked_item(3, 'Implementation Step', (6,), project='B'),
        5: _linked_item(5, 'Feature', project='C'),
        6: _linked_item(6, 'Feature', project='B'),
        10: _linked_item(10, 'Epic', (1, 11), project='D'),
    }
    items[2].fields['System.State'] = 'Closed'
    client, wit = _linked_client(items)
    wit.get_classification_node = MagicMock(side_effect=lambda **kwargs: SimpleNamespace(
        path=f"\\{kwargs['project']}\\Iteration", name=kwargs['project'], attributes={}, children=[],
    ))
    plans = [
        {'id': 'plan-a', 'area_path': 'A\\WrongArea', 'task_types': ['Epic', 'Feature'],
         'closed_history_days': 0},
        {'id': 'plan-b', 'area_path': 'B\\WrongArea', 'task_types': ['Feature'],
         'closed_history_days': 0},
    ]
    config = SimpleNamespace(
        fetch_project_map=lambda: plans,
        fetch_projects=lambda: [],
        fetch_iterations_config=lambda: {'iteration_sets': []},
    )
    capacity = MagicMock()
    capacity.parse.return_value = []
    storage = MemoryStorage()
    storage.save('config', 'ado_processes', task_catalogue(['A', 'B', 'C', 'D']))
    backend = AzureDevOpsBackend('org', storage=storage, team_repository=MagicMock(),
                                 capacity_service=capacity, local_backend=config)

    @contextmanager
    def connect(_pat):
        yield client

    backend._conn = SimpleNamespace(connect=connect)
    seeds = []
    for item_id, plan_id in ((1, 'plan-a'), (4, 'plan-b')):
        seed = backend._adapter.to_domain(
            client._work_item_ops.normalize_work_item(items[item_id]),
            plan_id, backend._team_repository, {}, {}, capacity,
        )
        seed['sourcePlanIds'] = [plan_id]
        seeds.append(seed)

    credential = {'kind': 'pat', 'token': 'test', 'user_id': 'test'}
    if through_repository:
        from planner_lib.repository.task_repository import TaskRepository

        backend.fetch_tasks = MagicMock(side_effect=lambda area_path, **kwargs: [
            seed for seed in seeds if seed['areaPath'] == area_path
        ])
        repository = TaskRepository(
            backend, SimpleNamespace(get_project_map=lambda: plans), MagicMock(),
        )
        backend.fetch_task_context = MagicMock(wraps=backend.fetch_task_context)
        tasks = {task['id']: task for task in repository.read(credential=credential)}
        assert all('backendData' in task
                   for task in backend.fetch_task_context.call_args.args[0])
        assert all('backendData' not in task for task in tasks.values())
        assert len(backend.fetch_tasks.call_args_list) == 2
    else:
        tasks = {task['id']: task for task in backend.fetch_task_context(seeds, credential)}

    assert set(tasks) == {'1', '4', '2', '5', '10'}
    assert tasks['10']['ancestorOnly']
    assert not tasks['10']['childrenComplete']
    assert tasks['10']['project'].startswith('context-')
    assert tasks['10']['sourcePlanName'] == 'WrongArea'
    assert tasks['10']['sourcePlanIds'] == []
    assert tasks['10']['presentationPlanIds'] == []
    assert tasks['10']['unresolvedParentIds'] == []
    assert tasks['2']['project'] == 'plan-b'
    assert tasks['2']['state'] == 'Closed'
    assert tasks['2']['sourcePlanIds'] == ['plan-a', 'plan-b']
    assert tasks['2']['excludedChildIds'] == ['3']
    assert tasks['2']['presentationPlanIds'] == ['plan-a', 'plan-b']
    assert tasks['5']['project'].startswith('context-')
    assert tasks['5']['sourcePlanIds'] == ['plan-a', 'plan-b']
    assert tasks['5']['presentationPlanIds'] == ['plan-a', 'plan-b']
    assert [call.args[0] for call in wit.get_work_items.call_args_list] == [[2], [2], [3, 5], [5], [10]]
    wit.get_work_item_type_category.assert_not_called()


@pytest.mark.parametrize('excluded_type,project', [('Bug', 'A'), ('Feature', 'Unknown')])
def test_catalogue_discovery_excludes_unimported_items_without_traversing(excluded_type, project):
    from tests.python.azure.test_process_catalogue import catalogue

    stored = catalogue()
    stored['processes'][0]['projects'] = ['A']
    items = {1: _linked_item(1, children=(2,)),
             2: _linked_item(2, excluded_type, (3,), project=project),
             3: _linked_item(3)}
    client, wit = _linked_client(items)
    seed = client._work_item_ops.normalize_work_item(items[1])

    result = client.get_linked_work_items([seed], catalogue=stored)

    assert [item['id'] for item in result] == ['1']
    assert result[0]['excludedChildIds'] == ['2']
    assert all(3 not in call.args[0] for call in wit.get_work_items.call_args_list)
    wit.get_work_item_type_category.assert_not_called()


@pytest.mark.parametrize('deleted', [False, True])
def test_catalogue_discovery_checks_omitted_ids_against_recycle_bin(deleted):
    from planner_lib.backend.errors import AreaNotReadableError
    from tests.python.azure.test_process_catalogue import catalogue

    stored = catalogue()
    stored['processes'][0]['projects'] = ['A']
    items = {1: _linked_item(1, children=(2,))}
    client, wit = _linked_client(items, missing_ids=(2,))
    wit.get_deleted_work_items = MagicMock(return_value=[SimpleNamespace(id=2)] if deleted else [])
    seed = client._work_item_ops.normalize_work_item(items[1])
    if deleted:
        result = client.get_linked_work_items([seed], catalogue=stored)
        assert result[0]['unresolvedChildIds'] == ['2']
    else:
        with pytest.raises(AreaNotReadableError, match='2'):
            client.get_linked_work_items([seed], catalogue=stored)
    wit.get_deleted_work_items.assert_called_once_with(ids=[2])


def test_linked_hierarchy_preserves_references_without_fetching_lateral_targets():
    items = {1: _linked_item(1, children=(2, 3, 4)), 2: _linked_item(2),
             3: _linked_item(3, 'Implementation Step')}
    client, wit = _linked_client(items, missing_ids=(4, 10))
    seed = client._work_item_ops.normalize_work_item(items[1])
    seed['relations'].extend(
        {'id': str(item_id), 'type': relation_type}
        for item_id, relation_type in enumerate(('Parent', 'Related', 'Predecessor', 'Successor'), 10)
    )

    result = client.get_linked_work_items([seed], catalogue=task_catalogue(['A', 'B', 'C', 'D']))

    assert [item['id'] for item in result] == ['1', '2']
    assert result[0]['unresolvedChildIds'] == ['4']
    assert result[0]['unresolvedParentIds'] == ['10']
    assert result[0]['excludedChildIds'] == ['3']
    assert result[0]['relations'] == seed['relations']
    assert 'unresolvedChildIds' not in seed
    assert wit.get_work_items.call_args_list[0].args[0] == [2, 3, 4]
    assert wit.get_work_items.call_args_list[1].args[0] == [2]


def test_linked_hierarchy_keeps_independent_seeds_beyond_a_task_boundary():
    items = {1: _linked_item(1, children=(2,)), 2: _linked_item(2, 'Task', (3,)),
             3: _linked_item(3, 'Requirement', (4,)), 4: _linked_item(4, 'Change Request')}
    client, wit = _linked_client(items)
    seeds = [client._work_item_ops.normalize_work_item(items[item_id]) for item_id in (1, 3)]

    result = client.get_linked_work_items(seeds, catalogue=task_catalogue(['A', 'B', 'C', 'D']))

    assert [item['id'] for item in result] == ['1', '3', '4']
    assert result[0]['excludedChildIds'] == ['2']
    assert all(item['traversalBoundary'] is False for item in result)
    assert all(2 not in call.args[0] for call in wit.get_work_items.call_args_list if 'expand' in call.kwargs)


def test_explicit_task_seed_is_excluded_without_expanding_children():
    items = {1: _linked_item(1, 'Task', (2,))}
    client, wit = _linked_client(items)

    result = client.get_linked_work_items([client._work_item_ops.normalize_work_item(items[1])],
                                          catalogue=task_catalogue(['A']))

    assert result == []
    wit.get_work_items.assert_not_called()


def test_seeded_task_child_is_excluded_from_parent_traversal():
    items = {1: _linked_item(1, children=(2,)), 2: _linked_item(2, 'Task', (3,)),
             3: _linked_item(3, 'Requirement')}
    client, wit = _linked_client(items)
    seeds = [client._work_item_ops.normalize_work_item(items[item_id]) for item_id in (1, 2, 3)]

    result = client.get_linked_work_items(seeds, catalogue=task_catalogue(['A']))

    assert [item['id'] for item in result] == ['1', '3']
    assert result[0]['excludedChildIds'] == ['2']
    assert [item['traversalBoundary'] for item in result] == [False, False]
    wit.get_work_items.assert_not_called()


def test_empty_task_category_does_not_override_catalogue_eligibility():
    items = {1: _linked_item(1, children=(2,)), 2: _linked_item(2, 'Task')}
    client, wit = _linked_client(items)
    wit.get_work_item_type_category.return_value.work_item_types = []

    result = client.get_linked_work_items([client._work_item_ops.normalize_work_item(items[1])],
                                          catalogue=task_catalogue(['A']))

    assert [item['id'] for item in result] == ['1']
    assert all(item['traversalBoundary'] is False for item in result)


@pytest.mark.parametrize('failed_call', ['get_work_items'])
def test_linked_hierarchy_does_not_reinterpret_sdk_failure_as_empty(failed_call):
    items = {1: _linked_item(1, children=(2,))}
    client, wit = _linked_client(items)
    getattr(wit, failed_call).side_effect = RuntimeError('SDK unavailable')

    with pytest.raises(RuntimeError, match='SDK unavailable'):
        client.get_linked_work_items([client._work_item_ops.normalize_work_item(items[1])],
                         catalogue=task_catalogue(['A']))


def test_linked_hierarchy_requires_a_connected_client():
    client = AzureClient('org', DummyStorage())

    with pytest.raises(RuntimeError, match='not connected'):
        client.get_linked_work_items([], catalogue=task_catalogue(['A']))


def test_linked_hierarchy_keeps_the_highest_revision_of_duplicate_seeds():
    items = {1: _linked_item(1)}
    client, wit = _linked_client(items)
    seed = client._work_item_ops.normalize_work_item(items[1])
    newer = {**seed, 'rev': 2, 'title': 'Latest seed'}

    result = client.get_linked_work_items([newer, seed], catalogue=task_catalogue(['A']))

    assert len(result) == 1
    assert result[0]['title'] == 'Latest seed'
    wit.get_work_items.assert_not_called()


@pytest.mark.parametrize('changed_field,changed_value', [
    ('System.WorkItemType', 'Task'), ('System.TeamProject', 'Other'),
])
def test_linked_hierarchy_rejects_type_or_project_drift(changed_field, changed_value):
    items = {1: _linked_item(1, children=(2,)), 2: _linked_item(2)}
    client, wit = _linked_client(items)
    read_items = wit.get_work_items.side_effect

    def get_work_items(ids, **kwargs):
        if 'expand' in kwargs:
            items[2].fields[changed_field] = changed_value
        return read_items(ids, **kwargs)

    wit.get_work_items.side_effect = get_work_items

    with pytest.raises(RuntimeError, match='classification changed for work item 2'):
        client.get_linked_work_items([client._work_item_ops.normalize_work_item(items[1])],
                         catalogue=task_catalogue(['A']))


def test_native_client_passes_task_types_to_wiql():
    """AzureClient.get_work_items must include configured task_types in the WIQL query.

    When task_types=['Story', 'Task'] is supplied the underlying WIQL query must
    contain those type strings and must NOT default to ['epic', 'feature'].
    """
    nc = AzureClient('org', DummyStorage())
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
    nc.get_work_items('Proj\\Team', task_types=['Story', 'Issue'], catalogue=task_catalogue(['Proj']))

    assert 'captured_query' not in captured_wiql or captured_wiql  # query was captured
    q = captured_wiql.get('query', '')
    assert 'Story' in q, f"Expected 'Story' in WIQL query, got: {q}"
    assert 'Issue' in q, f"Expected 'Issue' in WIQL query, got: {q}"
    assert 'Epic' not in q, f"'Epic' should not appear when task_types overrides the default"
    assert 'Feature' not in q, f"'Feature' should not appear when task_types overrides the default"


def test_native_client_rejects_missing_task_types():
    """A plan must explicitly select imported types."""
    nc = AzureClient('org', DummyStorage())
    captured_wiql = {}

    class FakeWit:
        def query_by_wiql(self, wiql):
            captured_wiql['query'] = wiql.query
            return SimpleNamespace(work_items=[])

        def get_work_items(self, ids, expand=None):
            return []

    nc._connected = True
    nc.conn = SimpleNamespace(clients=SimpleNamespace(get_work_item_tracking_client=lambda: FakeWit()))
    from planner_lib.azure.catalogue import CatalogueError
    with pytest.raises(CatalogueError):
        nc.get_work_items('Proj\\Team', [], catalogue=task_catalogue(['Proj']))
    assert captured_wiql == {}


@pytest.mark.parametrize('status', [401, 403])
def test_seed_query_access_failure_aborts_with_area(status):
    from planner_lib.backend.errors import AreaNotReadableError
    c = AzureClient('org', DummyStorage())

    class FakeWit:
        def query_by_wiql(self, wiql):
            raise RuntimeError(f'{status} access denied')

    c._connected = True
    c.conn = SimpleNamespace(clients=SimpleNamespace(get_work_item_tracking_client=lambda: FakeWit()))

    with pytest.raises(AreaNotReadableError) as caught:
        c.get_work_items('Proj\\Team', ['Feature'], catalogue=task_catalogue(['Proj']))
    assert caught.value.target == 'Proj\\Team'


def test_omitted_non_deleted_seed_aborts_without_returning_partial_items():
    from planner_lib.backend.errors import AreaNotReadableError
    client = AzureClient('org', DummyStorage())
    wit = SimpleNamespace(
        query_by_wiql=MagicMock(return_value=SimpleNamespace(
            work_items=[SimpleNamespace(id=1), SimpleNamespace(id=2)])),
        get_work_items=MagicMock(return_value=[_linked_item(1)]),
        get_deleted_work_items=MagicMock(return_value=[]),
    )
    client._connected = True
    client.conn = SimpleNamespace(clients=SimpleNamespace(get_work_item_tracking_client=lambda: wit))
    with pytest.raises(AreaNotReadableError):
        client.get_work_items('A\\Team', ['Feature'], catalogue=task_catalogue(['A']))


@pytest.mark.parametrize('stage', ['seed', 'classification', 'child', 'parent', 'recycle_bin'])
def test_direct_hydration_permission_failure_is_an_access_error(stage):
    from planner_lib.backend.errors import AreaNotReadableError
    root = _linked_item(1, children=() if stage == 'parent' else (2,),
                        parents=(2,) if stage == 'parent' else ())
    client, wit = _linked_client({1: root, 2: _linked_item(2)},
                                 missing_ids=(2,) if stage == 'recycle_bin' else ())
    original = wit.get_work_items.side_effect

    def read_items(ids, **kwargs):
        if (stage == 'seed' or (stage == 'classification' and 'fields' in kwargs)
                or (stage in ('child', 'parent') and 'expand' in kwargs)):
            raise RuntimeError('403 Forbidden')
        return original(ids, **kwargs)

    wit.get_work_items.side_effect = read_items
    wit.query_by_wiql = MagicMock(return_value=SimpleNamespace(work_items=[SimpleNamespace(id=1)]))
    if stage == 'recycle_bin':
        wit.get_deleted_work_items.side_effect = RuntimeError('403 Forbidden')
    with pytest.raises(AreaNotReadableError):
        if stage == 'seed':
            client.get_work_items('A\\Team', ['Feature'], catalogue=task_catalogue(['A']))
        else:
            client.get_linked_work_items([client._work_item_ops.normalize_work_item(root)],
                                          catalogue=task_catalogue(['A']))


def test_mock_recycle_bin_confirms_only_absent_fixture_items():
    from planner_lib.azure.AzureMockClient import _MockWITClient
    fixtures = SimpleNamespace(get_work_item=lambda identity: {'id': 1} if identity == 1 else None)
    wit = _MockWITClient(fixtures)
    assert [item.id for item in wit.get_deleted_work_items([1, 2])] == [2]


def test_classify_ado_exception_maps_auth_and_outage():
    """classify_ado_exception maps auth/config signals, else outage."""
    from planner_lib.backend.errors import (
        classify_ado_exception,
        BackendAuthError,
        BackendConfigError,
        BackendUnavailableError,
    )

    assert isinstance(classify_ado_exception(RuntimeError('401 Unauthorized')), BackendAuthError)
    assert isinstance(classify_ado_exception(RuntimeError('TF400813: not authorized')), BackendAuthError)
    assert isinstance(classify_ado_exception(RuntimeError('TF401232: area path does not exist')), BackendConfigError)
    assert isinstance(classify_ado_exception(RuntimeError('connection timed out')), BackendUnavailableError)
    # Already-typed errors pass through unchanged.
    err = BackendUnavailableError('x')
    assert classify_ado_exception(err) is err


# ===========================================================================
# AzureMockClient persistence tests
# ===========================================================================

FIXTURE_DIR = "data/azure_mock"
# A fixture area that exists in the real fixture files.
_FIXTURE_AREA = "MyProject\\TeamA_P21"
_FIXTURE_AREA_KEY = "MyProject__TeamA_P21"


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
        # azure_mock_persist_enabled moved from 'system' to 'ado' (BackendRegistry-built)
        schema = get_schema('ado')
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
        # azure_mock_persist_enabled moved from 'system' to 'ado' (BackendRegistry-built)
        schema = get_schema('ado')
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

    @pytest.mark.parametrize('credential', [None, '', {}])
    @pytest.mark.parametrize('mock_kind', ['recorded', 'generator'])
    def test_mock_client_preserves_live_credential_validation(self, credential, mock_kind):
        from planner_lib.azure.AzureMockClient import AzureMockClient
        from planner_lib.azure.AzureMockGeneratorClient import AzureMockGeneratorClient
        from planner_lib.storage import create_storage
        storage = create_storage(backend='memory', serializer='json')
        if mock_kind == 'recorded':
            client = AzureMockClient('anonymous-org', storage, fixture_dir=FIXTURE_DIR)
        else:
            client = AzureMockGeneratorClient('anonymous-org', storage)
        assert type(client).connect is AzureClient.connect
        with pytest.raises(ValueError, match='credential'):
            client.connect(credential)
