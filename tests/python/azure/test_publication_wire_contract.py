"""Publication contracts at the prepared HTTP boundary, never against live ADO."""
import json
from types import SimpleNamespace

import pytest
import requests
from azure.devops.v7_1.work_item_tracking.work_item_tracking_client import WorkItemTrackingClient
from msrest.authentication import BasicAuthentication

from planner_lib.backend.azure import AzureDevOpsBackend
from planner_lib.projects.capacity_service import CapacityService
from planner_lib.repository.task_repository import WorkforceTaskRepository
from planner_lib.repository.team_repository import TeamRepository
from planner_lib.storage.memory_backend import MemoryStorage
from tests.helpers import register_service_on_client


BASE_URL = 'https://dev.azure.com/publication-contract'
CREDENTIAL = {'kind': 'pat', 'token': 'fixture-pat', 'user_id': 'fixture-user'}


@pytest.fixture
def publication_wire(monkeypatch):
    """Use real writers and SDK serialization with fixed discovery and blocked HTTP."""
    requests_sent = []
    fields = {'System.TeamProject': 'Platform', 'System.Description': '<p>Keep this.</p>'}
    failures = set()

    def send(session, request, **kwargs):
        assert request.url.startswith(BASE_URL + '/_apis/wit/workItems/'), request.url
        body = None if request.body is None else json.loads(request.body)
        requests_sent.append({'method': request.method, 'url': request.url,
                              'headers': dict(request.headers), 'body': body})
        response = requests.Response()
        response.request = request
        response.headers['Content-Type'] = 'application/json'
        failed = request.method == 'PATCH' and body[0]['path'] in failures
        response.status_code = 400 if failed else 200
        payload = {'message': 'Fixture rejected field'} if failed else {
            'id': 42, 'rev': 7, 'fields': fields, 'relations': [],
        }
        response._content = json.dumps(payload).encode()
        return response

    monkeypatch.setattr(requests.Session, 'send', send)
    sdk = WorkItemTrackingClient(BASE_URL, BasicAuthentication('', CREDENTIAL['token']))
    location = SimpleNamespace(
        area='wit', resource_name='workItems',
        route_template='{project}/_apis/{area}/{resource}/{id}',
        min_version=1.0, max_version=7.1, released_version=7.0, resource_version=3,
    )
    monkeypatch.setattr(sdk, '_get_resource_location', lambda *args: location)
    storage = MemoryStorage()
    team = {'id': 'team-a', 'name': 'Alpha', 'short_name': 'Alpha', 'allocation_token': 'ALP',
            'archived': False, 'group_id': None}
    storage.save('config', 'teams', {'schema_version': 3, 'teams': [team], 'groups': []})
    teams = TeamRepository(SimpleNamespace(fetch_config_teams=lambda **kwargs: [team]))
    backend = AzureDevOpsBackend('publication-contract', storage, teams, CapacityService(teams))

    def connect(pat):
        assert pat == CREDENTIAL['token']
        backend._conn.conn = SimpleNamespace(base_url=BASE_URL, clients=SimpleNamespace(
            get_work_item_tracking_client=lambda: sdk))
        backend._conn._connected = True

    monkeypatch.setattr(backend._conn, '_connect_with_pat', connect)
    return SimpleNamespace(backend=backend, requests=requests_sent, fields=fields,
                           failures=failures, storage=storage)


def assert_patch(request, task_id, document):
    assert request['method'] == 'PATCH'
    assert request['url'] == f'{BASE_URL}/_apis/wit/workItems/{task_id}'
    assert request['headers']['Content-Type'] == 'application/json-patch+json; charset=utf-8'
    assert request['headers']['Accept'] == 'application/json;api-version=7.1-preview.3'
    assert request['body'] == document


def test_publish_dates_reaches_serialized_ado_http_boundary(publication_wire):
    result = publication_wire.backend.write_task('42', {
        'start': '2026-10-01', 'end': '2026-10-31',
    }, CREDENTIAL)

    assert result == {'ok': True, 'updated': 1, 'errors': []}
    assert len(publication_wire.requests) == 1
    assert_patch(publication_wire.requests[0], 42, [
        {'op': 'replace', 'path': '/fields/Microsoft.VSTS.Scheduling.StartDate', 'value': '2026-10-01'},
        {'op': 'replace', 'path': '/fields/Microsoft.VSTS.Scheduling.TargetDate', 'value': '2026-10-31'},
    ])


@pytest.mark.parametrize('field,ado_field', [
    ('start', 'Microsoft.VSTS.Scheduling.StartDate'),
    ('end', 'Microsoft.VSTS.Scheduling.TargetDate'),
])
@pytest.mark.parametrize('value', ['2026-11-02', None])
def test_publish_one_date_never_writes_the_omitted_date(publication_wire, field, ado_field, value):
    publication_wire.fields[ado_field] = '2026-10-01'
    result = publication_wire.backend.write_task('42', {field: value}, CREDENTIAL)

    assert result['ok']
    expected = {'op': 'replace', 'path': f'/fields/{ado_field}', 'value': value}
    if value is None:
        expected = {'op': 'remove', 'path': f'/fields/{ado_field}'}
        assert publication_wire.requests[0]['method'] == 'GET'
    assert_patch(publication_wire.requests[-1], 42, [expected])
    assert len(publication_wire.requests) == (2 if value is None else 1)


@pytest.mark.parametrize('explicit_dates', [False, True])
def test_clear_schedule_resets_iteration_and_only_removes_existing_dates(publication_wire, explicit_dates):
    if explicit_dates:
        publication_wire.fields.update({
            'Microsoft.VSTS.Scheduling.StartDate': '2026-10-01',
            'Microsoft.VSTS.Scheduling.TargetDate': '2026-10-31',
        })
    result = publication_wire.backend.write_task('42', {'start': None, 'end': None}, CREDENTIAL)

    assert result['ok']
    document = [{'op': 'replace', 'path': '/fields/System.IterationPath', 'value': 'Platform'}]
    if explicit_dates:
        document.extend([
            {'op': 'remove', 'path': '/fields/Microsoft.VSTS.Scheduling.StartDate'},
            {'op': 'remove', 'path': '/fields/Microsoft.VSTS.Scheduling.TargetDate'},
        ])
    assert len(publication_wire.requests) == 2
    assert_patch(publication_wire.requests[1], 42, document)


@pytest.mark.parametrize('updates,document', [
    ({'state': 'Active'}, [{'op': 'add', 'path': '/fields/System.State', 'value': 'Active'}]),
    ({'tags': 'one; two'}, [{'op': 'add', 'path': '/fields/System.Tags', 'value': 'one; two'}]),
    ({'tags': None}, [{'op': 'add', 'path': '/fields/System.Tags', 'value': ''}]),
    ({'tags': ''}, [{'op': 'add', 'path': '/fields/System.Tags', 'value': ''}]),
    ({'iterationPath': 'Platform\\Release 1\\Sprint 2'}, [
        {'op': 'replace', 'path': '/fields/System.IterationPath', 'value': 'Platform\\Release 1\\Sprint 2'},
    ]),
    ({'iterationPath': None}, [
        {'op': 'replace', 'path': '/fields/System.IterationPath', 'value': 'Platform'},
    ]),
])
def test_publish_scalar_fields_have_exact_wire_values(publication_wire, updates, document):
    result = publication_wire.backend.write_task('42', updates, CREDENTIAL)

    assert result['ok']
    assert_patch(publication_wire.requests[-1], 42, document)
    assert len(publication_wire.requests) == (2 if updates == {'iterationPath': None} else 1)


@pytest.mark.parametrize('existing,capacity,expected', [
    ('<p>Keep this.</p>', [{'team': 'team-a', 'capacity': 12.375}],
     '<p>Keep this.</p>\n[PlannerTool Team Capacity]\nALP: 12.375\n[/PlannerTool Team Capacity]'),
    ('<p>Before</p>\n[PlannerTool Team Capacity]\nALP: 80\n[/PlannerTool Team Capacity]\n<p>After</p>',
     [{'team': 'team-a', 'capacity': 0.125}],
     '<p>Before</p>\n[PlannerTool Team Capacity]\nALP: 0.125\n[/PlannerTool Team Capacity]\n<p>After</p>'),
    ('<p>Keep this.</p>\n[PlannerTool Team Capacity]\nALP: 80\n[/PlannerTool Team Capacity]', [],
     '<p>Keep this.</p>'),
    ('<p>Keep this.</p>\n[PlannerTool Team Capacity]\nALP: 80\nLegacy: 12.50%\n[/PlannerTool Team Capacity]',
     [{'team': 'team-a', 'capacity': 25}, {'team': 'Legacy', 'capacity': 12.5}],
     '<p>Keep this.</p>\n[PlannerTool Team Capacity]\nALP: 25\nLegacy: 12.50%\n[/PlannerTool Team Capacity]'),
])
def test_capacity_wire_preserves_html_precision_and_unknown_source_rows(
    publication_wire, existing, capacity, expected,
):
    publication_wire.fields['System.Description'] = existing
    result = publication_wire.backend.write_task('42', {'capacity': capacity}, CREDENTIAL)

    assert result['ok']
    assert len(publication_wire.requests) == 2
    assert publication_wire.requests[0]['method'] == 'GET'
    assert_patch(publication_wire.requests[1], 42, [
        {'op': 'add', 'path': '/fields/System.Description', 'value': expected},
    ])


@pytest.mark.parametrize('relation,native_type', [
    ('Parent', 'System.LinkTypes.Hierarchy-Reverse'),
    ('Child', 'System.LinkTypes.Hierarchy-Forward'),
    ('Related', 'System.LinkTypes.Related'),
    ('Predecessor', 'System.LinkTypes.Dependency-Forward'),
    ('Successor', 'System.LinkTypes.Dependency-Reverse'),
])
def test_relation_add_pins_native_link_type_and_target(publication_wire, relation, native_type):
    result = publication_wire.backend.write_task('42', {
        'relations': [{'op': 'add', 'type': relation, 'id': '99'}],
    }, CREDENTIAL)

    assert result['ok']
    assert len(publication_wire.requests) == 2
    assert_patch(publication_wire.requests[1], 42, [{
        'op': 'add', 'path': '/relations/-', 'value': {
            'rel': native_type, 'url': f'{BASE_URL}/_apis/wit/workItems/99',
            'attributes': {'name': relation},
        },
    }])


def test_empty_update_sends_no_ado_requests(publication_wire):
    assert publication_wire.backend.write_task('42', {}, CREDENTIAL) == {
        'ok': True, 'updated': 0, 'errors': [],
    }
    assert publication_wire.requests == []


@pytest.mark.parametrize('failed_path', [
    '/fields/System.State',
    '/fields/Microsoft.VSTS.Scheduling.StartDate',
])
def test_partial_failure_is_reported_and_never_retries_successful_patches(
    publication_wire, failed_path,
):
    publication_wire.failures.add(failed_path)
    result = publication_wire.backend.write_task('42', {
        'start': '2026-10-01', 'state': 'Active',
    }, CREDENTIAL)

    assert result['ok'] is False
    assert result['updated'] == 1
    assert len(result['errors']) == 1
    assert 'Fixture rejected field' in result['errors'][0]
    assert len(publication_wire.requests) == 2
    assert_patch(publication_wire.requests[0], 42, [
        {'op': 'replace', 'path': '/fields/Microsoft.VSTS.Scheduling.StartDate', 'value': '2026-10-01'},
    ])
    assert_patch(publication_wire.requests[1], 42, [
        {'op': 'add', 'path': '/fields/System.State', 'value': 'Active'},
    ])


def test_total_ado_rejection_reports_no_updated_item(publication_wire):
    publication_wire.failures.add('/fields/System.State')
    result = publication_wire.backend.write_task('42', {'state': 'Active'}, CREDENTIAL)

    assert result['ok'] is False
    assert result['updated'] == 0
    assert len(result['errors']) == 1
    assert len(publication_wire.requests) == 1


@pytest.fixture
def publication_api(authenticated_client, publication_wire, monkeypatch):
    tasks = [{
        'id': identity, 'project': 'plan', 'title': f'Task {identity}', 'type': 'Feature',
        'process_id': 'process', 'state': 'Active', 'stateCategory': 'InProgress',
        'start': '2026-10-01', 'end': '2026-10-31', 'capacity': [],
        'parentId': None, 'relations': [], 'sourcePlanIds': ['plan'],
    } for identity in ('42', '43')]
    projects = SimpleNamespace(
        get_project_map=lambda: [{'id': 'plan'}],
        list_projects=lambda: [{
            'id': 'plan', 'type': 'Plan', 'allocation_defaults': {'Plan': ['team-a']},
            'work_item_display': [{'process_id': 'process', 'tiers': [[{
                'name': 'Feature', 'states': [{'name': 'Active', 'category': 'InProgress'}],
            }]]}],
        }],
    )
    monkeypatch.setattr(publication_wire.backend, 'fetch_plan_tasks', lambda *args, **kwargs: tasks)
    monkeypatch.setattr(publication_wire.backend, 'fetch_task_context', lambda *args, **kwargs: tasks)
    credentials = SimpleNamespace(get_credential=lambda user_id: CREDENTIAL)
    repository = WorkforceTaskRepository(
        publication_wire.backend, projects, credentials,
        storage=publication_wire.storage, task_storage=publication_wire.storage,
    )
    register_service_on_client(authenticated_client, 'task_repository', repository)
    register_service_on_client(authenticated_client, 'account_manager', SimpleNamespace(
        get_account_by_id=lambda user_id: {'email': 'user@example.com'},
        load=lambda email: {'pat': CREDENTIAL['token']}, pat_error=lambda email: None,
    ))
    return authenticated_client


def test_http_publication_reaches_exact_ado_patches(publication_api, publication_wire):
    response = publication_api.post('/api/tasks', json=[{
        'id': '42', 'start': '2026-11-02', 'end': '2026-11-30',
        'capacity': [{'team': 'team-a', 'capacity': 12.375}],
        'state': 'Active', 'iterationPath': 'Platform\\Release 1', 'tags': 'one; two',
    }])

    assert response.status_code == 200, response.text
    assert response.json() == {'updated': 1, 'errors': []}
    assert len(publication_wire.requests) == 6
    patches = [request for request in publication_wire.requests if request['method'] == 'PATCH']
    documents = [
        [
            {'op': 'replace', 'path': '/fields/Microsoft.VSTS.Scheduling.StartDate', 'value': '2026-11-02'},
            {'op': 'replace', 'path': '/fields/Microsoft.VSTS.Scheduling.TargetDate', 'value': '2026-11-30'},
        ],
        [{'op': 'add', 'path': '/fields/System.Description', 'value':
          '<p>Keep this.</p>\n[PlannerTool Team Capacity]\nALP: 12.375\n[/PlannerTool Team Capacity]'}],
        [{'op': 'add', 'path': '/fields/System.State', 'value': 'Active'}],
        [{'op': 'replace', 'path': '/fields/System.IterationPath', 'value': 'Platform\\Release 1'}],
        [{'op': 'add', 'path': '/fields/System.Tags', 'value': 'one; two'}],
    ]
    assert len(patches) == len(documents)
    for request, document in zip(patches, documents):
        assert_patch(request, 42, document)


@pytest.mark.parametrize('invalid_update', [
    {'id': '43', 'capacity': [{'team': 'missing', 'capacity': 20}]},
    {'id': '43', 'state': 'Not a configured state'},
    {'id': 'missing', 'start': '2026-11-02'},
    {'id': '42', 'end': '2026-11-30'},
    {'id': '43', 'backendData': {'private': 'must not publish'}},
    {'id': '43', 'relations': [{'op': 'add', 'type': 'Parent', 'id': 'missing'}]},
])
def test_invalid_http_batch_sends_zero_ado_requests(publication_api, publication_wire, invalid_update):
    response = publication_api.post('/api/tasks', json=[
        {'id': '42', 'start': '2026-11-02'}, invalid_update,
    ])

    assert response.status_code == 422, response.text
    assert response.json()['error'] == 'invalid_allocation'
    assert publication_wire.requests == []


def test_http_publication_exposes_partial_ado_failure(publication_api, publication_wire):
    publication_wire.failures.add('/fields/System.State')
    response = publication_api.post('/api/tasks', json=[{
        'id': '42', 'start': '2026-11-02', 'state': 'Active',
    }])

    assert response.status_code == 200, response.text
    result = response.json()
    assert result['updated'] == 1
    assert len(result['errors']) == 1
    assert '42 (state)' in result['errors'][0]
    assert 'Fixture rejected field' in result['errors'][0]
    assert len(publication_wire.requests) == 2


def test_http_batch_preserves_each_task_id_and_selected_fields(publication_api, publication_wire):
    response = publication_api.post('/api/tasks', json=[
        {'id': '42', 'start': '2026-11-02'},
        {'id': '43', 'tags': 'separate item'},
    ])

    assert response.status_code == 200, response.text
    assert response.json() == {'updated': 2, 'errors': []}
    assert len(publication_wire.requests) == 2
    assert_patch(publication_wire.requests[0], 42, [
        {'op': 'replace', 'path': '/fields/Microsoft.VSTS.Scheduling.StartDate', 'value': '2026-11-02'},
    ])
    assert_patch(publication_wire.requests[1], 43, [
        {'op': 'add', 'path': '/fields/System.Tags', 'value': 'separate item'},
    ])


def test_empty_http_publication_sends_no_ado_requests(publication_api, publication_wire):
    response = publication_api.post('/api/tasks', json=[])

    assert response.status_code == 200, response.text
    assert response.json() == {'updated': 0, 'errors': []}
    assert publication_wire.requests == []


def test_anonymous_http_publication_sends_no_ado_requests(publication_api, publication_wire):
    publication_api.cookies.clear()
    response = publication_api.post('/api/tasks', json=[{'id': '42', 'state': 'Active'}])

    assert response.status_code == 401, response.text
    assert publication_wire.requests == []