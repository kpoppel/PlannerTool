from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from planner_lib.admin import api as admin_api
from planner_lib.admin.service import AdminService
from planner_lib.storage import create_storage
from tests.python.azure.test_process_catalogue import catalogue, plan


@pytest.fixture
def setup(monkeypatch):
    from planner_lib.middleware import admin as permissions
    from planner_lib.admin import config_routes, process_routes
    store = create_storage(backend='memory')
    store.save('config', 'projects', {'project_map': [plan()]})
    store.save('config', 'ado_processes', catalogue())
    store.save('config', 'global_settings', {
        'schema_version': 2, 'process_order': [], 'type_tiers': {}})
    service = AdminService(store, None, None, None)
    granted = {'manage_projects'}
    accounts = SimpleNamespace(has_permission=lambda email, permission: permission in granted)
    azure = MagicMock()
    connected = azure.connect.return_value.__enter__.return_value
    connected.list_processes.return_value = [
        {key: value for key, value in catalogue()['processes'][0].items()
         if key not in ('types', 'loaded_at')}]
    connected.get_process_types.return_value = catalogue()['processes'][0]['types']
    services = {'admin_service': service, 'account_manager': accounts,
                'azure_client': azure, 'storage': store, 'task_repository': MagicMock()}
    app = FastAPI()
    app.state.container = SimpleNamespace(get=lambda name: services[name])
    app.include_router(admin_api.router)
    monkeypatch.setattr(permissions, 'get_session_id_from_request', lambda request: 'session')
    monkeypatch.setattr(permissions, 'get_session_context_from_request',
                        lambda request: {'email': 'acting@example.test'})
    monkeypatch.setattr(process_routes, 'get_session_credentials_from_request',
                        lambda request: {'pat': 'acting-pat'})
    monkeypatch.setattr(config_routes, 'get_session_credentials_from_request',
                        lambda request: {'pat': 'acting-pat', 'account_id': 'acting-account'})
    with TestClient(app) as client:
        yield client, store, service, granted, azure


def test_plan_refresh_counts_presented_items_with_acting_credentials(setup):
    client, store, service, granted, azure = setup
    repository = client.app.state.container.get('task_repository')
    repository.rebuild_now.return_value = [
        {'id': '1', 'presentationPlanIds': ['plan']},
        {'id': '2', 'presentationPlanIds': []},
        {'id': '3', 'presentationPlanIds': ['other', 'plan']},
    ]
    response = client.post('/admin/v1/projects/plan/refresh')
    assert response.status_code == 200, response.text
    assert response.json()['plan_id'] == 'plan'
    assert response.json()['item_count'] == 2
    assert response.json()['completed_at']
    repository.rebuild_now.assert_called_once_with({'token': 'acting-pat', 'user_id': 'acting-account'})


@pytest.mark.parametrize('code,status', [
    ('process_not_imported', 409), ('type_not_imported', 409),
    ('area_not_readable', 403), ('backend_unavailable', 503),
])
def test_plan_refresh_reports_explicit_errors(setup, code, status):
    from planner_lib.azure.catalogue import CatalogueError
    from planner_lib.backend.errors import AreaNotReadableError, BackendUnavailableError

    client, store, service, granted, azure = setup
    error = CatalogueError(code, 'Plan metadata unavailable')
    if code == 'area_not_readable':
        error = AreaNotReadableError('Platform\\Area')
    if code == 'backend_unavailable':
        error = BackendUnavailableError('Superseded')
    repository = client.app.state.container.get('task_repository')
    repository.rebuild_now.side_effect = error
    response = client.post('/admin/v1/projects/plan/refresh')
    assert response.status_code == status, response.text
    assert response.json()['detail']['error'] == code
    assert response.json()['detail']['plan_id'] == 'plan'


def test_plan_refresh_rejects_archived_and_unauthorized_plans(setup):
    client, store, service, granted, azure = setup
    store.save('config', 'projects', {'project_map': [{**plan(), 'archived': True}]})
    assert client.post('/admin/v1/projects/plan/refresh').status_code == 400
    granted.clear()
    granted.add('manage_iterations')
    assert client.post('/admin/v1/projects/plan/refresh').status_code == 403
    client.app.state.container.get('task_repository').rebuild_now.assert_not_called()


def test_global_settings_round_trip_uses_catalogue_contract(setup):
    client, store, service, granted, azure = setup
    content = {'schema_version': 2, 'process_order': ['agile'],
               'type_tiers': {'agile': [['Epic'], ['Feature', 'User Story']]}}
    response = client.post('/admin/v1/global-settings', json={'content': content})
    assert response.status_code == 200
    assert client.get('/admin/v1/global-settings').json()['content'] == content


@pytest.mark.parametrize('tiers', [[['Feature']], [['Epic', 'Feature', 'Feature', 'User Story']],
                                   [['Epic'], [], ['Feature', 'User Story']]])
def test_global_settings_rejects_incomplete_or_duplicate_tiers(setup, tiers):
    client, store, service, granted, azure = setup
    response = client.post('/admin/v1/global-settings', json={'content': {
        'schema_version': 2, 'process_order': ['agile'], 'type_tiers': {'agile': tiers},
    }})
    assert response.status_code == 400


def test_plan_schema_does_not_fetch_live_metadata(setup):
    client, store, service, granted, azure = setup
    assert client.get('/admin/v1/schema/projects').status_code == 200
    azure.connect.assert_not_called()


def valid_projects():
    return {'schema_version': 4, 'container_types': ['project'],
            'allocation_defaults': {'project': []}, 'project_map': [{
                **plan(), 'type': 'project', 'closed_history_days': 0,
            }]}


def test_plan_save_imports_selected_types_and_canonicalizes_names(setup):
    client, store, service, granted, azure = setup
    content = valid_projects()
    content['project_map'][0]['task_types'] = ['bug']
    response = client.post('/admin/v1/projects', json={
        'content': content, 'process_imports': {'agile': ['Bug']},
    })
    assert response.status_code == 200, response.text
    assert store.load('config', 'projects')['project_map'][0]['task_types'] == ['Bug']
    assert store.load('config', 'ado_processes')['processes'][0]['types'][3]['imported']
    assert store.load('config', 'global_settings')['type_tiers']['agile'][-1] == ['User Story', 'Bug']


def test_plan_save_imports_selected_types_before_validating_when_not_preloaded(setup):
    client, store, service, granted, azure = setup
    stored = catalogue()
    stored['processes'][0]['types'][1]['imported'] = False
    store.save('config', 'ado_processes', stored)
    content = valid_projects()
    content['project_map'][0]['task_types'] = ['Feature']

    response = client.post('/admin/v1/projects', json={'content': content})

    assert response.status_code == 200, response.text
    process = store.load('config', 'ado_processes')['processes'][0]
    assert process['types'][1]['imported'] is True
    assert store.load('config', 'projects')['project_map'][0]['task_types'] == ['Feature']


@pytest.mark.parametrize('change', [
    {'name': ''}, {'type': 'unknown'}, {'task_types': []}, {'task_types': ['Task']},
    {'closed_history_days': -1}, {'closed_history_days': True}, {'closed_history_days': 1.5},
    {'display_states': ['New']}, {'area_path': 'Unknown\\Area'},
])
def test_invalid_plan_save_does_not_commit_imports(setup, change):
    client, store, service, granted, azure = setup
    before = deepcopy({key: store.load('config', key)
                       for key in ('projects', 'ado_processes', 'global_settings')})
    content = valid_projects()
    content['project_map'][0].update(change)
    response = client.post('/admin/v1/projects', json={
        'content': content, 'process_imports': {'agile': ['Bug']},
    })
    assert response.status_code == 400, response.text
    assert {key: store.load('config', key) for key in before} == before


def test_plan_save_rejects_duplicate_area_including_archived(setup):
    client, store, service, granted, azure = setup
    content = valid_projects()
    content['project_map'].append({**content['project_map'][0], 'id': 'another',
                                  'archived': True, 'area_path': 'PLATFORM\\TEAM'})
    assert client.post('/admin/v1/projects', json={'content': content}).status_code == 400


@pytest.mark.parametrize('references', [['Task'], ['unknown'], ['Bug']])
def test_plan_imports_reject_ineligible_references(setup, references):
    client, store, service, granted, azure = setup
    stored = catalogue()
    stored['processes'][0]['types'][3]['missing'] = True
    store.save('config', 'ado_processes', stored)
    response = client.post('/admin/v1/projects', json={
        'content': valid_projects(), 'process_imports': {'agile': references},
    })
    assert response.status_code == 400
    assert store.load('config', 'ado_processes') == stored


def test_plan_save_rolls_back_all_three_configs_on_write_failure(setup, monkeypatch):
    client, store, service, granted, azure = setup
    before = deepcopy({key: store.load('config', key)
                       for key in ('projects', 'ado_processes', 'global_settings')})
    save = store.save

    def fail_display(namespace, key, value, ttl_seconds=None):
        if key == 'global_settings':
            raise RuntimeError('Write failed')
        return save(namespace, key, value, ttl_seconds)

    monkeypatch.setattr(store, 'save', fail_display)
    response = client.post('/admin/v1/projects', json={
        'content': valid_projects(), 'process_imports': {'agile': ['Bug']},
    })
    assert response.status_code == 500
    assert {key: store.load('config', key) for key in before} == before


def test_catalogue_get_save_and_refresh_with_acting_pat(setup):
    client, store, service, granted, azure = setup
    assert client.get('/admin/v1/ado-processes').json()['content'] == catalogue()
    submitted = catalogue()
    submitted['processes'][0]['types'][3]['imported'] = True
    response = client.post('/admin/v1/ado-processes', json={'content': submitted})
    assert response.status_code == 200
    assert store.load('config', 'global_settings')['type_tiers']['agile'][-1] == ['User Story', 'Bug']
    response = client.post('/admin/v1/ado-processes/refresh')
    assert response.status_code == 200
    azure.connect.assert_called_once_with('acting-pat')
    assert response.json()['content']['processes'][0]['types'][3]['imported'] is True


@pytest.mark.parametrize('action', ['get', 'refresh', 'resolve'])
def test_existing_plan_types_are_automatically_persisted_as_imported(setup, action):
    client, store, service, granted, azure = setup
    stored = catalogue()
    for item in stored['processes'][0]['types']:
        item['imported'] = item['name'] == 'Bug'
    store.save('config', 'ado_processes', stored)
    store.save('config', 'projects', {'project_map': [plan(), {
        **plan(), 'id': 'archived', 'name': 'Archived plan', 'area_path': '\\PLATFORM/Archive',
        'task_types': ['user story'], 'archived': True,
    }]})
    if action == 'get':
        response = client.get('/admin/v1/ado-processes')
    else:
        response = client.post(f'/admin/v1/ado-processes/{action}', json={'project': 'Platform'})
    assert response.status_code == 200
    process = response.json()['content'] if action == 'resolve' else response.json()['content']['processes'][0]
    assert {item['name'] for item in process['types'] if item['imported']} == {
        'Feature', 'User Story', 'Bug'}
    assert store.load('config', 'ado_processes')['processes'][0] == process
    assert store.load('config', 'global_settings')['type_tiers']['agile'] == [
        ['Feature'], ['User Story', 'Bug']]


def test_auto_import_does_not_make_task_or_missing_types_eligible(setup):
    client, store, service, granted, azure = setup
    stored = catalogue()
    for item in stored['processes'][0]['types']:
        item['imported'] = False
    stored['processes'][0]['types'][3]['missing'] = True
    store.save('config', 'ado_processes', stored)
    store.save('config', 'projects', {'project_map': [{
        **plan(), 'task_types': ['Feature', 'Task', 'Bug'],
    }]})
    response = client.get('/admin/v1/ado-processes')
    assert response.status_code == 200
    assert {item['name'] for item in response.json()['content']['processes'][0]['types']
            if item['imported']} == {'Feature'}


def test_required_type_reconciliation_does_not_rewrite_unchanged_configuration(setup, monkeypatch):
    client, store, service, granted, azure = setup
    stored = catalogue()
    stored['processes'][0]['types'][1]['imported'] = False
    store.save('config', 'ado_processes', stored)
    writes = MagicMock(wraps=store.save)
    monkeypatch.setattr(store, 'save', writes)
    assert client.get('/admin/v1/ado-processes').status_code == 200
    assert writes.called
    writes.reset_mock()
    assert client.get('/admin/v1/ado-processes').status_code == 200
    writes.assert_not_called()


def test_required_type_reconciliation_rolls_back_on_display_write_failure(setup, monkeypatch):
    client, store, service, granted, azure = setup
    stored = catalogue()
    stored['processes'][0]['types'][1]['imported'] = False
    store.save('config', 'ado_processes', stored)
    previous = deepcopy(store.load('config', 'global_settings'))
    save = store.save

    def failGlobal(namespace, key, value, ttl_seconds=None):
        if key == 'global_settings':
            raise RuntimeError('Write failed')
        return save(namespace, key, value, ttl_seconds)

    monkeypatch.setattr(store, 'save', failGlobal)
    with pytest.raises(RuntimeError, match='Write failed'):
        client.get('/admin/v1/ado-processes')
    assert store.load('config', 'ado_processes') == stored
    assert store.load('config', 'global_settings') == previous


def test_resolve_cached_project_without_ado_calls(setup):
    client, store, service, granted, azure = setup
    response = client.post('/admin/v1/ado-processes/resolve', json={'project': 'PLATFORM'})
    assert response.status_code == 200
    assert response.json()['content'] == catalogue()['processes'][0]
    azure.connect.assert_not_called()


def test_resolve_loads_only_selected_process_and_preserves_unrelated_metadata(setup):
    client, store, service, granted, azure = setup
    connected = azure.connect.return_value.__enter__.return_value
    fresh = {'id': 'scrum', 'name': 'Scrum', 'projects': ['Other', 'Second']}
    connected.list_processes.return_value.append(fresh)
    response = client.post('/admin/v1/ado-processes/resolve', json={'project': 'other'})
    assert response.status_code == 200
    process = response.json()['content']
    assert process['id'] == 'scrum'
    assert not any(item['imported'] for item in process['types'])
    assert store.load('config', 'ado_processes')['processes'][0] == catalogue()['processes'][0]
    connected.get_process_types.assert_called_once_with('scrum')
    azure.connect.assert_called_once_with('acting-pat')
    azure.reset_mock()
    second = client.post('/admin/v1/ado-processes/resolve', json={'project': 'Second'})
    assert second.json()['content'] == process
    azure.connect.assert_not_called()


def test_resolve_reuses_known_process_types_for_new_project_mapping(setup):
    client, store, service, granted, azure = setup
    connected = azure.connect.return_value.__enter__.return_value
    connected.list_processes.return_value[0]['projects'].append('Second')
    response = client.post('/admin/v1/ado-processes/resolve', json={'project': 'Second'})
    assert response.status_code == 200
    assert response.json()['content']['types'] == catalogue()['processes'][0]['types']
    assert response.json()['content']['projects'] == ['Platform', 'Second']
    connected.get_process_types.assert_not_called()


def test_refresh_fetches_only_known_processes(setup):
    client, store, service, granted, azure = setup
    connected = azure.connect.return_value.__enter__.return_value
    connected.list_processes.return_value.append(
        {'id': 'unused', 'name': 'Unused', 'projects': ['Other']})
    response = client.post('/admin/v1/ado-processes/refresh')
    assert response.status_code == 200
    assert [process['id'] for process in response.json()['content']['processes']] == ['agile']
    connected.get_process_types.assert_called_once_with('agile')


@pytest.mark.parametrize('imported,associated,plan_used', [
    (False, False, False), (True, False, False), (False, True, False), (False, True, True),
])
def test_refresh_prunes_unimported_processes_without_plans(setup, imported, associated, plan_used):
    client, store, service, granted, azure = setup
    stored = catalogue()
    unused = deepcopy(stored['processes'][0])
    unused.update(id='unused', name='Unused', projects=['Former project'])
    for item in unused['types']:
        item['imported'] = imported and item['name'] == 'Feature'
    stored['processes'].append(unused)
    store.save('config', 'ado_processes', stored)
    if plan_used:
        store.save('config', 'projects', {'project_map': [plan(), {
            **plan(), 'id': 'other', 'name': 'Other plan', 'area_path': '\\oThEr/Team',
            'archived': True,
        }]})
    connected = azure.connect.return_value.__enter__.return_value
    connected.list_processes.return_value.append({
        'id': 'unused', 'name': 'Unused', 'projects': ['Other'] if associated else [],
    })
    response = client.post('/admin/v1/ado-processes/refresh')
    assert response.status_code == 200
    content = response.json()['content']
    expected = ['agile', 'unused'] if imported or plan_used else ['agile']
    assert [process['id'] for process in content['processes']] == expected
    assert store.load('config', 'ado_processes') == content
    assert [call.args[0] for call in connected.get_process_types.call_args_list] == expected
    if imported or plan_used:
        feature = next(item for item in content['processes'][1]['types'] if item['name'] == 'Feature')
        assert feature['imported'] is (imported or plan_used)


def test_refresh_can_clean_entire_unused_catalogue(setup):
    client, store, service, granted, azure = setup
    stored = catalogue()
    for item in stored['processes'][0]['types']:
        item['imported'] = False
    store.save('config', 'ado_processes', stored)
    store.save('config', 'projects', {'project_map': []})
    connected = azure.connect.return_value.__enter__.return_value
    response = client.post('/admin/v1/ado-processes/refresh')
    assert response.status_code == 200
    assert response.json()['content']['processes'] == []
    assert store.load('config', 'ado_processes')['processes'] == []
    connected.get_process_types.assert_not_called()


def test_refresh_does_not_commit_cleanup_if_metadata_fetch_fails(setup):
    client, store, service, granted, azure = setup
    stored = catalogue()
    unused = {'id': 'unused', 'name': 'Unused', 'projects': [],
              'loaded_at': '2026-10-17T00:00:00Z', 'types': []}
    stored['processes'].insert(0, unused)
    store.save('config', 'ado_processes', stored)
    connected = azure.connect.return_value.__enter__.return_value
    connected.list_processes.return_value.insert(0, {
        'id': 'unused', 'name': 'Unused', 'projects': [],
    })
    connected.get_process_types.side_effect = RuntimeError('Metadata unavailable')
    with pytest.raises(RuntimeError, match='Metadata unavailable'):
        client.post('/admin/v1/ado-processes/refresh')
    assert store.load('config', 'ado_processes') == stored


def test_refresh_empty_catalogue_does_not_contact_ado(setup):
    client, store, service, granted, azure = setup
    empty = {'schema_version': 1, 'processes': []}
    store.save('config', 'ado_processes', empty)
    response = client.post('/admin/v1/ado-processes/refresh')
    assert response.status_code == 200
    assert response.json()['content'] == empty
    azure.connect.assert_not_called()


@pytest.mark.parametrize('body', [{}, {'project': ''}, {'project': 1}, [],
                                  {'project': 'Platform', 'unexpected': True}])
def test_resolve_rejects_invalid_project_input(setup, body):
    client, store, service, granted, azure = setup
    assert client.post('/admin/v1/ado-processes/resolve', json=body).status_code == 400
    azure.connect.assert_not_called()


def test_resolve_unknown_project_leaves_catalogue_unchanged(setup):
    client, store, service, granted, azure = setup
    response = client.post('/admin/v1/ado-processes/resolve', json={'project': 'Unknown'})
    assert response.status_code == 404
    assert response.json()['detail']['error'] == 'project_process_not_found'
    assert store.load('config', 'ado_processes') == catalogue()
    azure.connect.return_value.__enter__.return_value.get_process_types.assert_not_called()


@pytest.mark.parametrize('backend', ['recorded', 'generator'])
def test_resolve_from_empty_catalogue_with_sdk_mocks(setup, tmp_path, backend):
    from planner_lib.azure.AzureMockClient import AzureMockClient
    from planner_lib.azure.AzureMockGeneratorClient import AzureMockGeneratorClient
    from tests.python.azure.test_mock_generator import _populate_mock_config
    client, store, service, granted, azure = setup
    if backend == 'generator':
        _populate_mock_config(store)
        mock = AzureMockGeneratorClient('org', store, data_dir=str(tmp_path),
                                        config_dict={'default_items_per_area': 2})
    else:
        mock = AzureMockClient('org', store)
    store.save('config', 'ado_processes', {'schema_version': 1, 'processes': []})
    store.save('config', 'global_settings', {
        'schema_version': 2, 'process_order': [], 'type_tiers': {},
    })
    azure.connect.side_effect = mock.connect
    response = client.post('/admin/v1/ado-processes/resolve', json={'project': 'MyProject'})
    assert response.status_code == 200
    process = response.json()['content']
    assert process['parent_name'] == 'Agile'
    assert 'MyProject' in process['projects']
    expected = {'Epic', 'Feature', 'User Story', 'Bug'} if backend == 'generator' else set()
    assert {item['name'] for item in process['types'] if item['imported']} == expected
    assert next(item for item in process['types'] if item['name'] == 'Task')['backlog_level'] == 'task'
    assert store.load('config', 'ado_processes')['processes'] == [process]
    assert store.load('config', 'global_settings')['process_order'] == (
        [process['id']] if expected else [])


def test_targeted_metadata_commit_rolls_back_both_configs(setup, monkeypatch):
    client, store, service, granted, azure = setup
    previous = deepcopy(store.load('config', 'global_settings'))
    save = store.save

    def failGlobal(namespace, key, value, ttl_seconds=None):
        if key == 'global_settings':
            raise RuntimeError('Write failed')
        return save(namespace, key, value, ttl_seconds)

    monkeypatch.setattr(store, 'save', failGlobal)
    process = {**deepcopy(catalogue()['processes'][0]), 'id': 'new', 'projects': ['Other']}
    with pytest.raises(RuntimeError, match='Write failed'):
        service.load_ado_process(process)
    assert store.load('config', 'ado_processes') == catalogue()
    assert store.load('config', 'global_settings') == previous


def test_refresh_failure_after_first_process_preserves_entire_catalogue(setup):
    client, store, service, granted, azure = setup
    stored = catalogue()
    second = {**deepcopy(stored['processes'][0]), 'id': 'scrum', 'projects': ['Other']}
    stored['processes'].append(second)
    store.save('config', 'ado_processes', stored)
    connected = azure.connect.return_value.__enter__.return_value
    connected.list_processes.return_value.append(
        {'id': 'scrum', 'name': 'Scrum', 'projects': ['Other']})
    connected.get_process_types.side_effect = [[], RuntimeError('Not readable')]
    with pytest.raises(RuntimeError, match='Not readable'):
        client.post('/admin/v1/ado-processes/refresh')
    assert store.load('config', 'ado_processes') == stored


def test_refresh_keeps_removed_imported_types_marked_missing(setup):
    client, store, service, granted, azure = setup
    connected = azure.connect.return_value.__enter__.return_value
    connected.get_process_types.return_value = catalogue()['processes'][0]['types'][1:]
    response = client.post('/admin/v1/ado-processes/refresh')
    assert response.status_code == 200
    removed = next(item for item in response.json()['content']['processes'][0]['types']
                   if item['reference_name'] == 'Epic')
    assert removed['missing'] is True
    assert removed['imported'] is True


@pytest.mark.parametrize('action', ['resolve', 'refresh'])
def test_failed_metadata_fetch_leaves_configs_unchanged(setup, action):
    client, store, service, granted, azure = setup
    before = deepcopy(store.load('config', 'global_settings'))
    connected = azure.connect.return_value.__enter__.return_value
    connected.list_processes.return_value.append(
        {'id': 'scrum', 'name': 'Scrum', 'projects': ['Other']})
    connected.get_process_types.side_effect = RuntimeError('Metadata unavailable')
    with pytest.raises(RuntimeError, match='Metadata unavailable'):
        client.post(f'/admin/v1/ado-processes/{action}', json={'project': 'Other'})
    assert store.load('config', 'ado_processes') == catalogue()
    assert store.load('config', 'global_settings') == before


@pytest.mark.parametrize('permission,allowed', [('admin', True), ('manage_projects', True),
                                               ('manage_iterations', False), ('manage_workforce_teams', False)])
@pytest.mark.parametrize('method,path', [('get', '/admin/v1/ado-processes'),
                                       ('post', '/admin/v1/ado-processes'),
                                       ('post', '/admin/v1/ado-processes/resolve'),
                                       ('post', '/admin/v1/ado-processes/refresh'),
                                       ('get', '/admin/v1/global-settings'),
                                       ('post', '/admin/v1/global-settings')])
def test_catalogue_and_global_settings_permissions(setup, permission, allowed, method, path):
    client, store, service, granted, azure = setup
    granted.clear()
    granted.add(permission)
    kwargs = {'json': {'content': catalogue()}} if method == 'post' else {}
    if method == 'post' and path.endswith('/global-settings'):
        kwargs = {'json': {'content': {
            'schema_version': 2, 'process_order': ['agile'],
            'type_tiers': {'agile': [['Epic'], ['Feature'], ['User Story']]},
        }}}
    if path.endswith('/resolve'):
        kwargs = {'json': {'project': 'Platform'}}
    response = getattr(client, method)(path, **kwargs)
    assert (response.status_code == 200) is allowed
    if not allowed:
        assert response.status_code == 403
        azure.connect.assert_not_called()


def test_catalogue_save_errors_name_plan_and_do_not_write(setup):
    client, store, service, granted, azure = setup
    submitted = catalogue()
    submitted['processes'][0]['types'][1]['imported'] = False
    response = client.post('/admin/v1/ado-processes', json={'content': submitted})
    assert response.status_code == 400
    assert 'Platform plan' in response.json()['detail']['message']
    assert store.load('config', 'ado_processes') == catalogue()


def test_catalogue_pair_write_rolls_back(setup, monkeypatch):
    client, store, service, granted, azure = setup
    previous = deepcopy(store.load('config', 'global_settings'))
    save = store.save
    def failGlobal(namespace, key, value, ttl_seconds=None):
        if key == 'global_settings':
            raise RuntimeError('Write failed')
        return save(namespace, key, value, ttl_seconds)
    monkeypatch.setattr(store, 'save', failGlobal)
    submitted = catalogue()
    submitted['processes'][0]['types'][3]['imported'] = True
    with pytest.raises(RuntimeError, match='Write failed'):
        service.save_ado_processes(submitted)
    assert store.load('config', 'ado_processes') == catalogue()
    assert store.load('config', 'global_settings') == previous


def test_catalogue_schema_registered_and_in_backup(setup):
    from planner_lib.admin.schema import get_schema
    from planner_lib.admin.config_manager import ConfigManager
    assert get_schema('ado_processes')['properties']['schema_version']['const'] == 1
    assert 'ado_processes' in ConfigManager.CONFIG_KEYS