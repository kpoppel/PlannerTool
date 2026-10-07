from contextlib import contextmanager
from types import SimpleNamespace
import threading
import pytest
from unittest.mock import MagicMock

from planner_lib.azure.AzureClient import AzureClient
from planner_lib.backend.azure import AzureDevOpsBackend


class DummyStorage:
    pass


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
        results = nc.get_work_items('Proj\\Team')
        assert len(results) == 1, f'Expected 1 result for type {azure_type}'
        assert results[0]['type'] == expected, (
            f"Expected type '{expected}' but got '{results[0]['type']}' for Azure type '{azure_type}'"
        )


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
        with client.connect('first-pat'):
            first_connected.set()
            second_connected.wait(timeout=1)
        first_closed.set()

    def second_request():
        first_connected.wait(timeout=1)
        with client.connect('second-pat') as connected_client:
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
    res = nc.get_work_items('Area/Sub')
    assert isinstance(res, list)
    assert any(r['id'] == '10' for r in res)


# ---------------------------------------------------------------------------
# get_area_path_used_metadata — backlog-config path
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

    linked = client._work_item_ops.get_linked_work_items([seed])

    assert [item['id'] for item in linked] == ['1', '2', '4', '5']
    assert linked[1]['areaPath'] == 'B\\WrongArea'
    assert linked[1]['adoProject'] == 'B'
    assert linked[1]['state'] == 'Closed'
    assert seed['relations'][1]['id'] == '3'
    assert sorted(category_projects) == ['A', 'B']
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

    tasks = {item['id']: item for item in client.get_linked_work_items([seed])}

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
    ])}

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

    result = client.get_linked_work_items(seeds)

    assert len(result) == 407
    classified = []
    hydrated = []
    for call in wit.get_work_items.call_args_list:
        ids = call.args[0]
        assert len(ids) <= 200
        (classified if 'fields' in call.kwargs else hydrated).extend(ids)
    assert classified == list(children)
    assert hydrated == list(children)
    wit.get_work_item_type_category.assert_called_once_with('A', 'Microsoft.TaskCategory')


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
        {'id': 'plan-a', 'area_path': 'A\\WrongArea', 'task_types': ['Epic', 'Feature']},
        {'id': 'plan-b', 'area_path': 'B\\WrongArea', 'task_types': ['Feature']},
    ]
    config = SimpleNamespace(
        fetch_project_map=lambda: plans,
        fetch_projects=lambda: [],
        fetch_iterations_config=lambda: {'iteration_sets': []},
    )
    capacity = MagicMock()
    capacity.parse.return_value = []
    backend = AzureDevOpsBackend('org', storage=MagicMock(), team_repository=MagicMock(),
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

    credential = {'token': 'test', 'user_id': 'test'}
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
    assert tasks['2']['presentationPlanIds'] == []
    assert tasks['5']['project'].startswith('context-')
    assert tasks['5']['sourcePlanIds'] == ['plan-a', 'plan-b']
    assert tasks['5']['presentationPlanIds'] == ['plan-a', 'plan-b']
    assert [call.args[0] for call in wit.get_work_items.call_args_list] == [[2], [2], [3, 5], [5], [10]]
    assert wit.get_work_item_type_category.call_count == 4


def test_linked_hierarchy_preserves_references_without_fetching_lateral_targets():
    items = {1: _linked_item(1, children=(2, 3, 4)), 2: _linked_item(2),
             3: _linked_item(3, 'Implementation Step')}
    client, wit = _linked_client(items, missing_ids=(4, 10))
    seed = client._work_item_ops.normalize_work_item(items[1])
    seed['relations'].extend(
        {'id': str(item_id), 'type': relation_type}
        for item_id, relation_type in enumerate(('Parent', 'Related', 'Predecessor', 'Successor'), 10)
    )

    result = client.get_linked_work_items([seed])

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

    result = client.get_linked_work_items(seeds)

    assert [item['id'] for item in result] == ['1', '3', '4']
    assert result[0]['excludedChildIds'] == ['2']
    assert all(item['traversalBoundary'] is False for item in result)
    assert all(2 not in call.args[0] for call in wit.get_work_items.call_args_list if 'expand' in call.kwargs)


def test_explicit_task_seed_is_kept_without_expanding_children():
    items = {1: _linked_item(1, 'Task', (2,))}
    client, wit = _linked_client(items)

    result = client.get_linked_work_items([client._work_item_ops.normalize_work_item(items[1])])

    assert [item['id'] for item in result] == ['1']
    assert result[0]['traversalBoundary'] is True
    wit.get_work_items.assert_not_called()


def test_seeded_task_child_remains_loaded_but_excluded_from_parent_traversal():
    items = {1: _linked_item(1, children=(2,)), 2: _linked_item(2, 'Task', (3,)),
             3: _linked_item(3, 'Requirement')}
    client, wit = _linked_client(items)
    seeds = [client._work_item_ops.normalize_work_item(items[item_id]) for item_id in (1, 2, 3)]

    result = client.get_linked_work_items(seeds)

    assert [item['id'] for item in result] == ['1', '2', '3']
    assert result[0]['excludedChildIds'] == ['2']
    assert [item['traversalBoundary'] for item in result] == [False, True, False]
    wit.get_work_items.assert_not_called()


def test_empty_task_category_does_not_guess_from_a_type_name():
    items = {1: _linked_item(1, children=(2,)), 2: _linked_item(2, 'Task')}
    client, wit = _linked_client(items)
    wit.get_work_item_type_category.return_value.work_item_types = []

    result = client.get_linked_work_items([client._work_item_ops.normalize_work_item(items[1])])

    assert [item['id'] for item in result] == ['1', '2']
    assert all(item['traversalBoundary'] is False for item in result)


@pytest.mark.parametrize('failed_call', ['get_work_item_type_category', 'get_work_items'])
def test_linked_hierarchy_does_not_reinterpret_sdk_failure_as_empty(failed_call):
    items = {1: _linked_item(1, children=(2,))}
    client, wit = _linked_client(items)
    getattr(wit, failed_call).side_effect = RuntimeError('SDK unavailable')

    with pytest.raises(RuntimeError, match='SDK unavailable'):
        client.get_linked_work_items([client._work_item_ops.normalize_work_item(items[1])])


def test_linked_hierarchy_requires_a_connected_client():
    client = AzureClient('org', DummyStorage())

    with pytest.raises(RuntimeError, match='not connected'):
        client.get_linked_work_items([])


def test_linked_hierarchy_keeps_the_highest_revision_of_duplicate_seeds():
    items = {1: _linked_item(1)}
    client, wit = _linked_client(items)
    seed = client._work_item_ops.normalize_work_item(items[1])
    newer = {**seed, 'rev': 2, 'title': 'Latest seed'}

    result = client.get_linked_work_items([newer, seed])

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
        client.get_linked_work_items([client._work_item_ops.normalize_work_item(items[1])])


def _make_mapping(type_name, states_dict):
    """Return a SimpleNamespace mimicking WorkItemTypeStateInfo."""
    return SimpleNamespace(work_item_type_name=type_name, states=states_dict)


def _make_area_path_client(team_ids, teams, backlog_config, wit_items=None):
    """Build a AzureClient whose internals are wired for area-path-metadata tests.

    Args:
        team_ids:      List of team ID strings returned by get_team_from_area_path.
        teams:         List of {'id':str,'name':str} dicts returned by get_all_teams.
        backlog_config: Object with .work_item_type_mapped_states.
        wit_items:     Optional list of work items for the WIQL-fallback path.
    """
    c = AzureClient('org', DummyStorage())

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

    c = AzureClient('org', DummyStorage())
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
    nc.get_work_items('Proj\\Team', task_types=['Story', 'Task'])

    assert 'captured_query' not in captured_wiql or captured_wiql  # query was captured
    q = captured_wiql.get('query', '')
    assert 'Story' in q, f"Expected 'Story' in WIQL query, got: {q}"
    assert 'Task' in q, f"Expected 'Task' in WIQL query, got: {q}"
    assert 'Epic' not in q, f"'Epic' should not appear when task_types overrides the default"
    assert 'Feature' not in q, f"'Feature' should not appear when task_types overrides the default"


def test_native_client_defaults_task_types_when_none():
    """When task_types is None AzureClient should use the built-in default (epic, feature)."""
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
    nc.get_work_items('Proj\\Team')  # no task_types → default

    q = captured_wiql.get('query', '')
    assert 'Epic' in q or 'epic' in q, f"Default WIQL should contain 'Epic', got: {q}"
    assert 'Feature' in q or 'feature' in q, f"Default WIQL should contain 'Feature', got: {q}"


def test_get_work_items_propagates_raw_error_for_backend_to_classify():
    """The low-level client no longer swallows or classifies failures.

    It must propagate the raw SDK exception so the AzureDevOpsBackend boundary
    can translate it into a typed BackendError.
    """
    c = AzureClient('org', DummyStorage())

    class FakeWit:
        def query_by_wiql(self, wiql):
            raise RuntimeError('401 Unauthorized: TF400813')

    c._connected = True
    c.conn = SimpleNamespace(clients=SimpleNamespace(get_work_item_tracking_client=lambda: FakeWit()))

    with pytest.raises(RuntimeError):
        c.get_work_items('Proj\\Team')


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
            teams = c.get_all_teams("MyProject")
        assert isinstance(teams, list)
