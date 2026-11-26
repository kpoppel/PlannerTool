"""Azure DevOps task authoring at the serialized HTTP boundary, never against live ADO."""
import json
from types import SimpleNamespace

import pytest
import requests
from azure.devops.v7_1.work_item_tracking.work_item_tracking_client import WorkItemTrackingClient
from msrest.authentication import BasicAuthentication

from planner_lib.backend.azure import AzureDevOpsBackend
from planner_lib.backend.mock import MockFixtureBackend, MockGeneratorBackend
from planner_lib.backend.port import TaskCreationBackend, TaskDeletionBackend, TaskEditorBackend
from planner_lib.domain.tasks import TaskConflictError
from planner_lib.projects.capacity_service import CapacityService
from planner_lib.repository.team_repository import TeamRepository
from planner_lib.storage.memory_backend import MemoryStorage

BASE_URL = 'https://dev.azure.com/authoring-contract'
CREDENTIAL = {'kind': 'bearer', 'token': 'fixture-token', 'user_id': 'fixture-user'}
PLAN = {'id': 'plan', 'name': 'Platform plan', 'type': 'project', 'area_path': 'Platform\\Team',
        'task_types': ['Feature'], 'closed_history_days': 0}
CATALOGUE = {'schema_version': 1, 'processes': [{
    'id': 'proc', 'name': 'Agile', 'projects': ['Platform'], 'loaded_at': '2026-01-01',
    'types': [
        {'reference_name': 'Agile.Epic', 'name': 'Epic', 'backlog_level': 'portfolio', 'imported': True,
         'missing': False, 'states': [{'name': 'New', 'category': 'Proposed', 'order': 1}]},
        {'reference_name': 'Agile.Feature', 'name': 'Feature', 'backlog_level': 'portfolio', 'imported': True,
         'missing': False, 'states': [{'name': 'Active', 'category': 'InProgress', 'order': 2},
                                      {'name': 'New', 'category': 'Proposed', 'order': 1}]},
        {'reference_name': 'Agile.Story', 'name': 'Story', 'backlog_level': 'requirement', 'imported': False,
         'missing': False, 'states': [{'name': 'New', 'category': 'Proposed', 'order': 1}]},
    ],
}]}
ENTRY = 'proc/Agile.Feature'


@pytest.fixture
def authoring(monkeypatch):
    sent = []
    item = {'fields': {'System.TeamProject': 'Platform', 'System.Rev': 3, 'System.WorkItemType': 'Feature',
                       'System.Title': 'Existing', 'System.State': 'New', 'System.AreaPath': 'Platform\\Team',
                       'System.Description': '<p>Old</p>\n[PlannerTool Team Capacity]\nALP: 40\n'
                                             '[/PlannerTool Team Capacity]'}}

    def send(session, request, **kwargs):
        body = None if request.body is None else json.loads(request.body)
        sent.append({'method': request.method, 'url': request.url.split('?')[0], 'body': body})
        response = requests.Response()
        response.request = request
        response.headers['Content-Type'] = 'application/json'
        response.status_code = 200
        if '/workItemTypes/' in request.url:
            response._content = json.dumps({'transitions': {
                '': [{'to': 'New'}], 'New': [{'to': 'Active'}], 'Active': [],
            }}).encode()
            return response
        fields = dict(item['fields'])
        if request.method == 'POST':
            fields.update({operation['path'].removeprefix('/fields/'): operation['value'] for operation in body})
            fields['System.Rev'] = 1
        response._content = json.dumps({'id': 42, 'rev': fields['System.Rev'], 'fields': fields, 'relations': [],
                                        'url': f'{BASE_URL}/Platform/_apis/wit/workItems/42'}).encode()
        return response

    monkeypatch.setattr(requests.Session, 'send', send)
    sdk = WorkItemTrackingClient(BASE_URL, BasicAuthentication('', CREDENTIAL['token']))
    templates = {'62d3d110-0047-428c-ad3c-4fe872c91c74': '{project}/_apis/{area}/{resource}/${type}'}

    def location(*args):
        location_id = args[-1]
        if location_id == '7c8d7a76-4a09-43e8-b5df-bd792f4ac6aa':
            return SimpleNamespace(area='wit', resource_name='workItemTypes',
                                   route_template='{project}/_apis/{area}/{resource}/{type}',
                                   min_version=1.0, max_version=7.1, released_version=7.0, resource_version=3)
        return SimpleNamespace(area='wit', resource_name='workItems',
                               route_template=templates.get(location_id, '{project}/_apis/{area}/{resource}/{id}'),
                               min_version=1.0, max_version=7.1, released_version=7.0, resource_version=3)

    monkeypatch.setattr(sdk, '_get_resource_location', location)
    storage = MemoryStorage()
    storage.save('config', 'ado_processes', CATALOGUE)
    team = {'id': 'team-a', 'name': 'Alpha', 'short_name': 'Alpha', 'allocation_token': 'ALP',
            'archived': False, 'group_id': None}
    teams = TeamRepository(SimpleNamespace(fetch_config_teams=lambda **kwargs: [team]))
    config = SimpleNamespace(fetch_project_map=lambda: [PLAN])
    backend = AzureDevOpsBackend('authoring-contract', storage, teams, CapacityService(teams), local_backend=config)

    def connect(authentication):
        assert authentication.signed_session().headers['Authorization'] == f"Bearer {CREDENTIAL['token']}"
        backend._conn.conn = SimpleNamespace(base_url=BASE_URL, clients=SimpleNamespace(
            get_work_item_tracking_client=lambda: sdk))
        backend._conn._connected = True

    monkeypatch.setattr(backend._conn, '_connect_with_authentication', connect)
    return SimpleNamespace(backend=backend, sent=sent, item=item)


def test_live_ado_declares_and_implements_task_authoring(authoring):
    backend = authoring.backend
    assert {'task_create', 'task_edit', 'task_delete'} <= backend.CAPABILITIES
    assert isinstance(backend, TaskCreationBackend)
    assert isinstance(backend, TaskDeletionBackend)
    assert isinstance(backend, TaskEditorBackend)


@pytest.mark.parametrize('cls', [MockFixtureBackend, MockGeneratorBackend])
def test_mock_transports_do_not_advertise_authoring(cls):
    assert not {'task_create', 'task_edit', 'task_delete'} & cls.CAPABILITIES


def test_editor_metadata_offers_plan_types_and_their_ordered_states(authoring):
    metadata = authoring.backend.task_editor_metadata(CREDENTIAL)
    assert metadata['plans'] == [{'id': 'plan', 'name': 'Platform plan', 'typeIds': [ENTRY]}]
    [process] = metadata['catalogue']['processes']
    assert [entry['name'] for entry in process['types']] == ['Epic', 'Feature']
    feature = next(entry for entry in process['types'] if entry['id'] == ENTRY)
    states = {state['id']: state['name'] for state in metadata['catalogue']['states']}
    workflow = next(entry for entry in metadata['catalogue']['workflows'] if entry['id'] == feature['workflow_id'])
    assert [states[state] for state in workflow['states']] == ['New', 'Active']
    assert states[workflow['initial']] == 'New'
    assert workflow['from_any'] == []
    assert [(states[edge['from']], states[edge['to']]) for edge in workflow['transitions']] == [('New', 'Active')]
    assert metadata['catalogue']['fields'] == []


def test_create_posts_one_work_item_and_returns_the_domain_task(authoring):
    task = authoring.backend.create_task({
        'project': 'plan', 'typeId': ENTRY, 'title': ' New feature ', 'description': '<p>Why</p>',
        'start': '2026-12-01', 'end': '2026-12-08', 'customFields': {},
    }, 'actor', CREDENTIAL)

    [request] = authoring.sent
    assert request['method'] == 'POST'
    assert request['url'] == f'{BASE_URL}/Platform/_apis/wit/workItems/$Feature'
    assert request['body'] == [
        {'op': 'add', 'path': '/fields/System.Title', 'value': 'New feature'},
        {'op': 'add', 'path': '/fields/System.AreaPath', 'value': 'Platform\\Team'},
        {'op': 'add', 'path': '/fields/System.Description', 'value': '<p>Why</p>'},
        {'op': 'add', 'path': '/fields/Microsoft.VSTS.Scheduling.StartDate', 'value': '2026-12-01'},
        {'op': 'add', 'path': '/fields/Microsoft.VSTS.Scheduling.TargetDate', 'value': '2026-12-08'},
    ]
    assert (task['id'], task['project'], task['type'], task['title'], task['revision'], task['process_id']) == (
        '42', 'plan', 'Feature', 'New feature', 1, 'proc')


@pytest.mark.parametrize('payload, message', [
    ({'project': 'other', 'typeId': ENTRY, 'title': 'x'}, 'plan'),
    ({'project': 'plan', 'typeId': 'proc/Agile.Story', 'title': 'x'}, 'type'),
    ({'project': 'plan', 'typeId': ENTRY, 'title': ' '}, 'title'),
    ({'project': 'plan', 'typeId': ENTRY, 'title': 'x', 'customFields': {'score': 1}}, 'field'),
    ({'project': 'plan', 'typeId': ENTRY, 'title': 'x', 'start': '2026-13-01'}, 'YYYY-MM-DD'),
])
def test_invalid_creation_sends_nothing(authoring, payload, message):
    with pytest.raises(ValueError, match=message):
        authoring.backend.create_task(payload, 'actor', CREDENTIAL)
    assert authoring.sent == []


def test_title_and_description_edits_keep_the_capacity_block(authoring):
    result = authoring.backend.write_task('42', {
        'title': 'Renamed', 'description': '<p>New</p>', 'base': {'revision': 3, 'fields': {}},
    }, CREDENTIAL)

    assert result == {'ok': True, 'updated': 1, 'errors': []}
    patches = [request for request in authoring.sent if request['method'] == 'PATCH']
    assert [request['body'] for request in patches] == [
        [{'op': 'add', 'path': '/fields/System.Title', 'value': 'Renamed'}],
        [{'op': 'add', 'path': '/fields/System.Description', 'value':
          '<p>New</p>\n[PlannerTool Team Capacity]\nALP: 40\n[/PlannerTool Team Capacity]'}],
    ]


def test_stale_base_revision_is_a_conflict_without_writes(authoring):
    result = authoring.backend.write_task('42', {
        'title': 'Renamed', 'base': {'revision': 2, 'fields': {'title': 'Existing'}},
    }, CREDENTIAL)

    assert result['ok'] is False and result['updated'] == 0
    assert result['conflicts'] == [{'taskId': '42', 'field': None, 'reason': 'overlap', 'revision': 3,
                                    'base': 2, 'current': 3, 'proposed': None}]
    assert [request['method'] for request in authoring.sent] == ['GET']


def test_delete_moves_the_reviewed_revision_to_the_recycle_bin(authoring):
    authoring.backend.delete_task('42', 3, 'actor', CREDENTIAL)
    assert [(request['method'], request['url']) for request in authoring.sent] == [
        ('GET', f'{BASE_URL}/_apis/wit/workItems/42'), ('DELETE', f'{BASE_URL}/_apis/wit/workItems/42')]


def test_delete_of_a_changed_task_is_a_conflict(authoring):
    with pytest.raises(TaskConflictError):
        authoring.backend.delete_task('42', 2, 'actor', CREDENTIAL)
    assert [request['method'] for request in authoring.sent] == ['GET']
