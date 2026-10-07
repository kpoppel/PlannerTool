from contextlib import contextmanager
from unittest.mock import MagicMock

import pytest

from planner_lib.backend.adapter import AzureAdapter
from planner_lib.backend.azure import AzureDevOpsBackend
from planner_lib.backend.errors import BackendAuthError, BackendConfigError, BackendUnavailableError
from planner_lib.backend.mock import MockFixtureBackend, MockGeneratorBackend


class _FakeConfig:
    def __init__(self, project_map, iterations_config):
        self._project_map = project_map
        self._iterations_config = iterations_config

    def fetch_project_map(self):
        return list(self._project_map)

    def fetch_iterations_config(self):
        return self._iterations_config


def _make_backend(config):
    backend = AzureDevOpsBackend(
        organization_url='MyOrg',
        storage=MagicMock(),
        team_repository=MagicMock(),
        capacity_service=MagicMock(),
        local_backend=config,
    )
    return backend


def test_build_iteration_map_uses_project_iteration_uuid_and_iteration_set():
    config = _FakeConfig(
        project_map=[
            {
                'id': 'project-a',
                'name': 'Team A',
                'area_path': 'MyADO\\TeamA',
                'iteration_uuid': 'set-a',
            }
        ],
        iterations_config={
            'iteration_sets': [
                {
                    'id': 'set-a',
                    'source_project': 'IterationsProject',
                    'root_path': 'Platform',
                }
            ]
        },
    )
    backend = _make_backend(config)
    client = MagicMock()
    client.get_iterations.return_value = [
        {
            'path': 'IterationsProject\\Iteration\\Platform\\Sprint 1',
            'startDate': '2026-01-01',
            'finishDate': '2026-01-14',
            'name': 'Sprint 1',
        }
    ]

    result = backend._build_iteration_map(client, 'MyADO\\TeamA', 'MyADO')

    client.get_iterations.assert_called_once_with(
        'IterationsProject',
        root_path='IterationsProject\\Iteration\\Platform',
    )
    assert result == {
        'Platform\\Sprint 1': {
            'startDate': '2026-01-01',
            'finishDate': '2026-01-14',
            'name': 'Sprint 1',
        }
    }


def test_build_iteration_map_skips_projects_without_iteration_set_association():
    config = _FakeConfig(
        project_map=[
            {
                'id': 'project-a',
                'name': 'Team A',
                'area_path': 'MyADO\\TeamA',
                'iteration_uuid': '',
            }
        ],
        iterations_config={'iteration_sets': []},
    )
    backend = _make_backend(config)
    client = MagicMock()

    result = backend._build_iteration_map(client, 'MyADO\\TeamA', 'MyADO')

    client.get_iterations.assert_not_called()
    assert result == {}


def test_fetch_tasks_attaches_failed_area_path_to_configuration_error():
    """The cache warning must identify the configured Azure DevOps path that failed."""
    from contextlib import contextmanager
    from types import SimpleNamespace
    import pytest
    from planner_lib.backend.errors import BackendConfigError

    backend = _make_backend(_FakeConfig(project_map=[], iterations_config={'iteration_sets': []}))

    class _FailingClient:
        def get_work_items(self, *args, **kwargs):
            raise RuntimeError('TF401232: area path does not exist')

    @contextmanager
    def _connect(_pat):
        yield _FailingClient()

    backend._conn = SimpleNamespace(connect=_connect)

    with pytest.raises(BackendConfigError) as raised:
        backend.fetch_tasks('MyADO\\MissingArea', credential={'token': 'valid'})

    assert raised.value.failed_path == 'MyADO\\MissingArea'


def test_fetch_tasks_preserves_source_identity_revision_and_link_diagnostics():
    config = _FakeConfig(project_map=[], iterations_config={'iteration_sets': []})
    backend = _make_backend(config)
    client = MagicMock()
    client.get_work_items.return_value = [{
        'id': '42', 'title': 'Linked item', 'type': 'Requirement', 'state': 'Active',
        'areaPath': 'OtherADO\\WrongArea', 'adoProject': 'OtherADO', 'rev': 7,
        'url': 'https://dev.azure.com/MyOrg/OtherADO/_workitems/edit/42',
        'excludedChildIds': ['43'], 'unresolvedChildIds': ['44'],
    }]

    @contextmanager
    def connect(_pat):
        yield client

    backend._conn = MagicMock(connect=connect)
    task, = backend.fetch_tasks('MyADO\\TeamA', credential={'token': 'test', 'user_id': 'test'})

    assert task['backendData'] == {'adoProject': 'OtherADO', 'rev': 7, 'type': 'Requirement'}
    assert task['revision'] == 7
    assert task['areaPath'] == 'OtherADO\\WrongArea'
    assert task['url'].endswith('/edit/42')
    assert task['excludedChildIds'] == ['43']
    assert task['unresolvedChildIds'] == ['44']


@pytest.mark.parametrize('backend_class', [AzureDevOpsBackend, MockFixtureBackend, MockGeneratorBackend])
def test_ado_backends_convert_domain_ids_at_the_native_boundary(backend_class):
    client = MagicMock()

    @contextmanager
    def connect(_pat):
        yield client

    backend = MagicMock()
    backend._adapter = AzureAdapter()
    backend._conn.connect = connect
    backend._client.connect = connect

    result = backend_class.write_task(backend, '42', {'start': '2026-01-01'},
                                      {'token': 'test', 'user_id': 'test'})

    assert result['ok']
    client.update_work_item_dates.assert_called_once_with(42, start='2026-01-01')


def test_fetch_task_context_preserves_source_owner_and_unions_seed_provenance():
    config = _FakeConfig([
        {'id': 'plan-a', 'area_path': 'ADOA\\Seeds', 'task_types': ['Epic', 'Feature']},
        {'id': 'plan-b', 'area_path': 'ADOB\\Actual', 'task_types': ['Feature']},
    ], {'iteration_sets': []})
    backend = _make_backend(config)
    backend._capacity_service.parse.return_value = [{'team': 'Team One', 'capacity': 0.25}]
    backend._team_repository.name_to_id.return_value = 'team-one'
    seeds = [
        {'id': '1', 'project': 'plan-a', 'type': 'Epic', 'title': 'Root A',
         'state': 'Active', 'revision': 2, 'areaPath': 'ADOA\\Seeds',
         'capacity': [{'team': 'team-one', 'capacity': 0.5}],
         'sourcePlanIds': ['plan-a'], 'relations': [{'type': 'Child', 'id': '3'}],
         'backendData': {'adoProject': 'ADOA', 'rev': 2, 'type': 'Epic'}},
        {'id': '2', 'project': 'plan-b', 'type': 'Feature', 'title': 'Root B',
         'state': 'Active', 'revision': 1, 'areaPath': 'ADOB\\Actual',
         'sourcePlanIds': ['plan-b'], 'relations': [{'type': 'Child', 'id': '3'}],
         'backendData': {'adoProject': 'ADOB', 'rev': 1, 'type': 'Feature'}},
    ]
    client = MagicMock()
    linked = [
        {'id': '3', 'rev': 7, 'adoProject': 'ADOB', 'type': 'Requirement',
         'title': 'Wrong-area child', 'state': 'Closed', 'areaPath': 'ADOB\\Actual',
         'parentId': '1', 'iterationPath': 'ADOB\\Sprint 1', 'startDate': None,
         'finishDate': None, 'url': 'https://dev.azure.com/MyOrg/ADOB/_workitems/edit/3',
         'relations': [{'type': 'Child', 'id': '4'}, {'type': 'Child', 'id': '5'}],
         'excludedChildIds': ['5'], 'unresolvedChildIds': [], 'traversalBoundary': False},
        {'id': '4', 'rev': 3, 'adoProject': 'ADOC', 'type': 'Feature',
         'title': 'Unconfigured area', 'state': 'Active', 'areaPath': 'ADOC\\Mistyped',
         'parentId': '3', 'iterationPath': 'ADOC\\Sprint 1',
         'startDate': '2026-02-01', 'finishDate': '2026-02-14',
         'relations': [], 'excludedChildIds': [], 'unresolvedChildIds': ['99'],
         'traversalBoundary': False},
    ]
    client.get_linked_work_items.side_effect = lambda roots: [
        *[{**root, 'excludedChildIds': [], 'unresolvedChildIds': [],
           'traversalBoundary': False} for root in roots], *linked,
    ]
    backend._build_iteration_map = MagicMock(side_effect=lambda client, area, project: {
        'ADOB\\Sprint 1': {'startDate': '2026-01-01', 'finishDate': '2026-01-14'}
    } if area == 'ADOB\\Actual' else {})

    @contextmanager
    def connect(_pat):
        yield client

    backend._conn = MagicMock(connect=connect)

    tasks = {task['id']: task for task in backend.fetch_task_context(seeds, credential={
        'token': 'test', 'user_id': 'test',
    })}

    assert tasks['3']['project'] == 'plan-b'
    assert tasks['3']['areaPath'] == 'ADOB\\Actual'
    assert tasks['3']['state'] == 'Closed'
    assert tasks['3']['start'] == '2026-01-01'
    assert tasks['3']['end'] == '2026-01-14'
    assert tasks['3']['sourcePlanIds'] == ['plan-a', 'plan-b']
    assert tasks['3']['presentationPlanIds'] == []
    assert tasks['3']['excludedChildIds'] == ['5']
    assert tasks['3']['backendData'] == {'adoProject': 'ADOB', 'rev': 7, 'type': 'Requirement'}
    assert tasks['4']['project'].startswith('context-')
    assert tasks['4']['project'] not in {'plan-a', 'plan-b'}
    assert tasks['4']['sourcePlanIds'] == ['plan-a', 'plan-b']
    assert tasks['4']['presentationPlanIds'] == ['plan-a', 'plan-b']
    assert tasks['4']['unresolvedChildIds'] == ['99']
    assert tasks['4']['capacity'] == [{'team': 'team-one', 'capacity': 0.25}]
    assert tasks['1']['capacity'] == seeds[0]['capacity']
    assert seeds[0]['sourcePlanIds'] == ['plan-a']
    assert 'excludedChildIds' not in seeds[0]
    client.get_linked_work_items.assert_called_once()
    roots = client.get_linked_work_items.call_args.args[0]
    assert [(root['adoProject'], root['rev']) for root in roots] == [('ADOA', 2), ('ADOB', 1)]
    assert [call.args[1:] for call in backend._build_iteration_map.call_args_list] == [
        ('ADOB\\Actual', 'ADOB'), ('ADOC\\Mistyped', 'ADOC'),
    ]


@pytest.mark.parametrize('removed_state', ['Removed', 'Discarded'])
def test_context_respects_display_states_without_treating_terminated_as_removed(removed_state):
    plan = {'id': 'plan-a', 'area_path': 'A\\plan-a',
            'task_types': ['Feature', 'Change Request'],
            'display_states': ['Active', 'Terminated']}
    seeds = [_context_seed(1, 'plan-a', (2, 3, 4))]
    backend, client = _context_backend(seeds)
    backend._config = _FakeConfig([plan], {'iteration_sets': []})
    children = [
        {**_context_seed(2, 'plan-a'), 'state': removed_state},
        {**_context_seed(3, 'plan-a', item_type='Change Request'), 'state': 'Terminated'},
        {**_context_seed(4, 'plan-a'), 'state': 'Closed'},
    ]
    client.get_linked_work_items.side_effect = lambda roots: [
        {**item, 'adoProject': 'A', 'rev': 1, 'excludedChildIds': [],
         'unresolvedChildIds': [], 'traversalBoundary': False}
        for item in [*roots, *children]
    ]
    backend._metadata_service = MagicMock()
    backend._metadata_service.get_cached.return_value = {
        'state_categories': {'Active': 'InProgress', removed_state: 'Removed',
                             'Terminated': 'Completed', 'Closed': 'Completed'},
    }

    tasks = {task['id']: task for task in backend.fetch_task_context(
        seeds, {'token': 'test', 'user_id': 'test'},
    )}

    assert '2' not in tasks
    assert tasks['1']['excludedChildIds'] == ['2']
    assert tasks['3']['sourcePlanIds'] == ['plan-a']
    assert tasks['3']['presentationPlanIds'] == ['plan-a']
    assert tasks['4']['sourcePlanIds'] == ['plan-a']
    assert tasks['4']['presentationPlanIds'] == []


def test_plan_seeds_can_be_passed_directly_to_context_loading():
    plan = {'id': 'plan-a', 'area_path': 'A\\Seeds', 'task_types': ['Feature']}
    backend = _make_backend(_FakeConfig([plan], {'iteration_sets': []}))
    backend._build_type_canonical = MagicMock(return_value={'feature': 'Feature'})
    client = MagicMock()
    client.get_work_items.return_value = [{
        'id': '1', 'rev': 3, 'adoProject': 'A', 'areaPath': 'A\\Seeds',
        'type': 'feature', 'title': 'Seed', 'state': 'Active', 'relations': [],
    }]
    client.get_linked_work_items.side_effect = lambda roots: [
        {**root, 'excludedChildIds': [], 'unresolvedChildIds': [], 'traversalBoundary': False}
        for root in roots
    ]

    @contextmanager
    def connect(_pat):
        yield client

    backend._conn = MagicMock(connect=connect)
    credential = {'token': 'test', 'user_id': 'test'}

    seeds = backend.fetch_plan_tasks(plan, credential)
    tasks = backend.fetch_task_context(seeds, credential)

    assert tasks[0]['sourcePlanIds'] == ['plan-a']
    assert tasks[0]['presentationPlanIds'] == ['plan-a']
    assert tasks[0]['type'] == 'Feature'
    assert tasks[0]['backendData']['type'] == 'feature'
    assert client.get_linked_work_items.call_args.args[0][0]['type'] == 'feature'
    client.get_work_items.assert_called_once_with('A\\Seeds', task_types=['Feature'], include_states=None)


def _context_seed(item_id, plan_id, children=(), item_type='Feature', revision=1):
    return {
        'id': str(item_id), 'project': plan_id, 'type': item_type, 'title': str(item_id),
        'state': 'Active', 'revision': revision, 'areaPath': f'A\\{plan_id}',
        'relations': [{'type': 'Child', 'id': str(child)} for child in children],
        'sourcePlanIds': [plan_id],
        'backendData': {'adoProject': 'A', 'rev': revision, 'type': item_type},
    }


def _context_backend(seeds, boundary_ids=()):
    plans = [{'id': plan_id, 'area_path': f'A\\{plan_id}', 'task_types': ['Feature', 'Task']}
             for plan_id in ('plan-a', 'plan-b')]
    backend = _make_backend(_FakeConfig(plans, {'iteration_sets': []}))
    client = MagicMock()
    client.get_linked_work_items.side_effect = lambda roots: [
        {**root, 'excludedChildIds': [relation['id'] for relation in root['relations']
                                    if relation['type'] == 'Child' and relation['id'] in boundary_ids],
         'unresolvedChildIds': [], 'traversalBoundary': root['id'] in boundary_ids}
        for root in roots
    ]

    @contextmanager
    def connect(_pat):
        yield client

    backend._conn = MagicMock(connect=MagicMock(side_effect=connect))
    return backend, client


def test_context_provenance_stops_at_task_boundaries_and_ignores_lateral_links():
    seeds = [_context_seed(1, 'plan-a', (2,)), _context_seed(2, 'plan-a', (3,), 'Task'),
             _context_seed(3, 'plan-b', (4,)), _context_seed(4, 'plan-b', (3,))]
    seeds[0]['relations'].append({'type': 'Related', 'id': '3'})
    backend, client = _context_backend(seeds, boundary_ids=('2',))

    tasks = {task['id']: task for task in backend.fetch_task_context(
        seeds, {'token': 'test', 'user_id': 'test'},
    )}

    assert tasks['1']['sourcePlanIds'] == ['plan-a']
    assert tasks['2']['sourcePlanIds'] == ['plan-a']
    assert tasks['3']['sourcePlanIds'] == ['plan-b']
    assert tasks['4']['sourcePlanIds'] == ['plan-b']
    assert tasks['1']['excludedChildIds'] == ['2']
    client.get_linked_work_items.assert_called_once()


@pytest.mark.parametrize('reverse', [False, True])
def test_context_uses_newest_seed_revision_without_losing_other_seed_provenance(reverse):
    seeds = [_context_seed(1, 'plan-a', (99,)), _context_seed(1, 'plan-b', revision=2)]
    if reverse:
        seeds.reverse()
    backend, client = _context_backend(seeds)

    task, = backend.fetch_task_context(seeds, {'token': 'test', 'user_id': 'test'})

    assert task['revision'] == 2
    assert task['project'] == 'plan-b'
    assert task['sourcePlanIds'] == ['plan-a', 'plan-b']
    roots, = client.get_linked_work_items.call_args.args
    assert len(roots) == 1
    assert roots[0]['rev'] == 2
    assert roots[0]['relations'] == []


@pytest.mark.parametrize('message,error_type', [
    ('401 Unauthorized', BackendAuthError),
    ('503 Service Unavailable', BackendUnavailableError),
    ('TF401232: invalid category metadata', BackendConfigError),
])
def test_context_failure_is_not_returned_as_a_partial_forest(message, error_type):
    seeds = [_context_seed(1, 'plan-a')]
    backend, client = _context_backend(seeds)
    client.get_linked_work_items.side_effect = RuntimeError(message)

    with pytest.raises(error_type):
        backend.fetch_task_context(seeds, {'token': 'test', 'user_id': 'test'})


def test_context_empty_forest_does_not_need_credentials_or_contact_ado():
    backend, client = _context_backend([])

    assert backend.fetch_task_context([]) == []
    backend._conn.connect.assert_not_called()
    client.get_linked_work_items.assert_not_called()


def test_context_resolves_moved_seed_owner_and_reinfers_only_inferred_dates():
    seed = _context_seed(1, 'plan-a')
    seed.update({
        'areaPath': 'a/PLAN-B/', 'iterationPath': 'Sprint B',
        'start': '1999-01-01', '_inferred_start': True,
        'end': '2026-03-31', '_inferred_end': False,
    })
    backend, client = _context_backend([seed])
    backend._build_iteration_map = MagicMock(return_value={
        'Sprint B': {'startDate': '2026-03-01', 'finishDate': '2026-03-14'},
    })

    task, = backend.fetch_task_context([seed], {'token': 'test', 'user_id': 'test'})

    assert task['project'] == 'plan-b'
    assert task['areaPath'] == 'a/PLAN-B/'
    assert task['sourcePlanIds'] == ['plan-a']
    assert task['start'] == '2026-03-01'
    assert task['end'] == '2026-03-31'
    assert seed['start'] == '1999-01-01'
    backend._build_iteration_map.assert_called_once_with(client, 'a/PLAN-B/', 'A')