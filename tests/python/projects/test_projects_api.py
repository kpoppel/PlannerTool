import pytest
from tests.helpers import register_service_on_client


def _make_team_service(teams):
    class TeamSvc:
        def list_teams(self, *, include_archived=False):
            return teams

    return TeamSvc()


def _make_project_service(projects):
    class ProjectSvc:
        def list_projects(self):
            return projects

    return ProjectSvc()


def _make_task_repository():
    """Lightweight TaskRepository stub for API tests."""
    class TaskRepo:
        def __init__(self):
            self.last_read_args = None
            self.last_write_args = None
            self.last_iteration_args = None

        def read(self, project_id=None, credential=None):
            self.last_read_args = dict(project_id=project_id)
            if project_id:
                return [{'id': 't-p-' + str(project_id)}]
            return [{'id': 't-all-1'}, {'id': 't-all-2'}]

        def snapshot_diagnostics(self):
            return []

        def request_refresh(self, credential):
            self.last_refresh_credential = credential
            return {'status': 'queued'}

        def write(self, updates, user_id=None):
            self.last_write_args = dict(updates=updates, user_id=user_id)
            if not updates:
                return {'ok': True, 'updated': 0, 'errors': []}
            for it in updates:
                if it.get('error'):
                    return {'ok': False, 'updated': 0, 'errors': ['bad item']}
            return {'ok': True, 'updated': len(updates), 'errors': []}

        def list_markers(self, project_id=None, user_id=None):
            return []

        def list_iterations(self, project_id=None, user_id=None):
            self.last_iteration_args = dict(project_id=project_id, user_id=user_id)
            project_key = project_id or 'project-a'
            return {
                project_key: {
                    'projectId': project_key,
                    'projectName': 'Proj',
                    'iterationSetId': None,
                    'sourceProject': 'ADO',
                    'roots': ['Root'],
                    'iterations': [],
                }
            }

        def list_iteration_sets(self, user_id=None):
            return {
                'set-1': {
                    'id': 'set-1',
                    'name': 'Set 1',
                    'sourceProject': 'ADO',
                    'rootPath': 'Root',
                    'cachedAt': None,
                    'iterations': [],
                }
            }

    return TaskRepo()


def _make_session_mgr(authenticated_client, pat='token', email='test@example.com', account_id='test-account-id'):
    """Session identity stub with credentials persisted in the account manager."""
    from types import SimpleNamespace
    from planner_lib.accounts.config import AccountCredentialsPayload
    authenticated_client.app.state.container.get('account_manager').update_credentials(
        AccountCredentialsPayload(email=email, pat=pat)
    )
    register_service_on_client(authenticated_client, 'credential_provider', SimpleNamespace(
        get_credential=lambda user_id: (
            {'kind': 'pat', 'token': pat, 'user_id': user_id} if pat else None
        ),
    ))
    register_service_on_client(authenticated_client, 'backend', SimpleNamespace(is_remote=True))
    register_service_on_client(authenticated_client, 'credential_policy', SimpleNamespace(
        credential_error=lambda user_id: None,
        authentication_failed=lambda credential: 'pat_invalid',
    ))
    class FakeSessionMgr:
        def get(self, sid):
            return {'account_id': account_id, 'email': email}

        def create(self, email_: str):
            return 'test-session'

    return FakeSessionMgr()


def test_backend_credential_uses_account_id(authenticated_client):
    from planner_lib.projects.api import _get_credential
    from starlette.requests import Request

    register_service_on_client(authenticated_client, 'session_manager', _make_session_mgr(authenticated_client,
        email='owner@example.com', account_id='11111111-1111-4111-8111-111111111111',
    ))
    request = Request({'type': 'http', 'app': authenticated_client.app,
                       'headers': [(b'cookie', b'sessionId=test-session')]})
    credential, user_id = _get_credential(request)
    assert user_id == '11111111-1111-4111-8111-111111111111'
    assert credential['user_id'] == user_id


def _make_backend_with_warning():
    class BackendWithWarning:
        is_remote = True

        def consume_diagnostics(self, user_id=None):
            return [{
                'code': 'tasks_stale_invalid_pat',
                'message': 'PAT is invalid or expired. Showing cached task data that may be out of date.',
                'severity': 'warning',
                'user_id': user_id,
            }]

    return BackendWithWarning()


def test_teams_happy_path(authenticated_client):
    svc = _make_team_service([{'id': 1, 'name': 'TeamA'}])
    register_service_on_client(authenticated_client, 'team_repository', svc)
    r = authenticated_client.get('/api/teams')
    assert r.status_code == 200
    assert r.json() == [{'id': 1, 'name': 'TeamA'}]


def test_teams_bootstrap_requests_complete_catalogue(authenticated_client) -> None:
    """Historical identity resolution requires archives in bootstrap, not only new choices."""
    from unittest.mock import MagicMock

    repository = MagicMock()
    repository.list_teams.return_value = [{'id': 'archived', 'archived': True}]
    register_service_on_client(authenticated_client, 'team_repository', repository)
    response = authenticated_client.get('/api/teams')
    assert response.json() == [{'id': 'archived', 'archived': True}]
    repository.list_teams.assert_called_once_with(include_archived=True)


def test_tasks_publication_reports_allocation_validation_error(authenticated_client) -> None:
    """An invalid candidate is a structured client error, not an uncaught server error."""
    from unittest.mock import MagicMock
    from fastapi.testclient import TestClient

    repository = MagicMock()
    repository.write.side_effect = ValueError('Allocation conflict: fixture')
    register_service_on_client(authenticated_client, 'task_repository', repository)
    register_service_on_client(authenticated_client, 'session_manager', _make_session_mgr(authenticated_client))
    client = TestClient(authenticated_client.app, raise_server_exceptions=False,
                        cookies=authenticated_client.cookies)
    response = client.post('/api/tasks', json=[{'id': 'item', 'capacity': []}])
    assert response.status_code == 422
    assert response.json()['error'] == 'invalid_allocation'


def test_teams_missing_service(authenticated_client, monkeypatch):
    # Ensure service is not present in the container (clear both singletons and factories)
    container = getattr(authenticated_client.app.state, 'container', None)
    if container is not None:
        monkeypatch.delitem(container._singletons, 'team_repository', raising=False)
        monkeypatch.delitem(container._factories, 'team_repository', raising=False)
    # Use a client that does not raise server exceptions so we can assert 500.
    from fastapi.testclient import TestClient
    c = TestClient(authenticated_client.app, raise_server_exceptions=False,
                   cookies=authenticated_client.cookies)
    r = c.get('/api/teams')
    assert r.status_code == 500


def test_projects_happy_path(authenticated_client):
    svc = _make_project_service([{'id': 'p1', 'name': 'Proj1', 'iteration_uuid': None}])
    register_service_on_client(authenticated_client, 'project_repository', svc)
    r = authenticated_client.get('/api/projects')
    assert r.status_code == 200
    assert r.json() == [{'id': 'p1', 'name': 'Proj1', 'iteration_uuid': None}]


def test_projects_returns_iteration_uuid_from_repository(authenticated_client):
    svc = _make_project_service([{'id': 'p1', 'name': 'Proj1', 'iteration_uuid': 'set-abc'}])
    register_service_on_client(authenticated_client, 'project_repository', svc)
    r = authenticated_client.get('/api/projects')
    assert r.status_code == 200
    assert r.json() == [{'id': 'p1', 'name': 'Proj1', 'iteration_uuid': 'set-abc'}]


def test_tasks_list_and_project_param(authenticated_client):
    task_repo = _make_task_repository()
    register_service_on_client(authenticated_client, 'task_repository', task_repo)
    register_service_on_client(authenticated_client, 'session_manager', _make_session_mgr(authenticated_client))

    r = authenticated_client.get('/api/tasks')
    assert r.status_code == 200
    assert isinstance(r.json(), list) and len(r.json()) == 2

    r2 = authenticated_client.get('/api/tasks?project=42')
    assert r2.status_code == 200
    assert r2.json() == [{'id': 't-p-42'}]
    # ensure the repository saw the project_id
    assert task_repo.last_read_args['project_id'] == '42'


def test_tasks_returns_stale_data_with_pat_warning(authenticated_client):
    import json

    task_repo = _make_task_repository()
    register_service_on_client(authenticated_client, 'task_repository', task_repo)
    register_service_on_client(authenticated_client, 'session_manager', _make_session_mgr(authenticated_client, email='warn@example.com'))
    register_service_on_client(authenticated_client, 'backend', _make_backend_with_warning())

    r = authenticated_client.get('/api/tasks')
    assert r.status_code == 200
    assert len(r.json()) == 2
    diagnostics = json.loads(r.headers['X-Backend-Diagnostics'])
    assert diagnostics[0]['code'] == 'tasks_stale_invalid_pat'


@pytest.mark.parametrize('code,status', [
    ('interaction_required', 409), ('access_denied', 403), ('auth_unavailable', 503),
    ('ado_credential_unusable', 403),
    ('invalid_session', 401), ('auth_configuration_error', 503),
])
@pytest.mark.parametrize('cached', [None, [], [{'id': 'cached-task'}]])
def test_tasks_remote_auth_failure_reads_only_existing_cache(authenticated_client, code, status, cached):
    import json
    from types import SimpleNamespace
    from unittest.mock import Mock
    from planner_lib.session.broker import AuthFailure

    register_service_on_client(authenticated_client, 'session_manager', _make_session_mgr(authenticated_client))
    provider = Mock()
    provider.get_credential.side_effect = AuthFailure(code, status)
    register_service_on_client(authenticated_client, 'credential_provider', provider)
    repository = SimpleNamespace(
        read=Mock(side_effect=AssertionError('Remote reads must not run')),
        read_cached=Mock(return_value=cached), snapshot_diagnostics=lambda: [],
    )
    register_service_on_client(authenticated_client, 'task_repository', repository)

    response = authenticated_client.get('/api/tasks?project=42')
    if cached is not None and code in ('interaction_required', 'access_denied', 'auth_unavailable',
                                       'ado_credential_unusable'):
        assert response.status_code == 200
        assert response.json() == cached
        assert json.loads(response.headers['X-Backend-Diagnostics'])[0]['code'] == code
        if code == 'ado_credential_unusable':
            assert 'No Azure DevOps request was sent' in json.loads(
                response.headers['X-Backend-Diagnostics'])[0]['message']
        repository.read_cached.assert_called_once_with(project_id='42')
    else:
        assert response.status_code == status
        assert response.json() == {'error': code}
        if code in ('invalid_session', 'auth_configuration_error'):
            repository.read_cached.assert_not_called()
    repository.read.assert_not_called()
    provider.get_credential.assert_called_once_with('test-account-id')


def test_tasks_reports_shared_snapshot_freshness(authenticated_client):
    import json
    repository = _make_task_repository()
    repository.snapshot_diagnostics = lambda: [{
        'code': 'task_cache_freshness', 'severity': 'info',
        'message': 'Task cache updated 60s ago: updating in background.',
    }]
    register_service_on_client(authenticated_client, 'task_repository', repository)
    register_service_on_client(authenticated_client, 'session_manager', _make_session_mgr(authenticated_client))
    response = authenticated_client.get('/api/tasks')

    assert response.status_code == 200
    diagnostics = json.loads(response.headers['X-Backend-Diagnostics'])
    assert {item['code'] for item in diagnostics} == {'task_cache_freshness'}
    assert all(set(item) == {'code', 'severity', 'message'} for item in diagnostics)


def test_task_refresh_queues_work_without_reading_or_invalidating(authenticated_client):
    import json
    repository = _make_task_repository()
    register_service_on_client(authenticated_client, 'task_repository', repository)
    register_service_on_client(authenticated_client, 'session_manager', _make_session_mgr(authenticated_client))

    response = authenticated_client.post('/api/tasks/refresh')

    assert response.status_code == 202
    assert response.json() == {'status': 'queued'}
    assert repository.last_read_args is None
    assert repository.last_refresh_credential == {'kind': 'pat', 'token': 'token', 'user_id': 'test-account-id'}
    diagnostic, = json.loads(response.headers['X-Backend-Diagnostics'])
    assert diagnostic['code'] == 'task_refresh_requested'
    assert 'reload' in diagnostic['message'].lower()
    assert 'token' not in str(response.headers)


def test_tasks_returns_every_diagnostic_without_private_metadata(authenticated_client):
    import json
    from types import SimpleNamespace
    from unittest.mock import MagicMock

    diagnostics = [{
        'code': 'schedule_metadata_missing', 'severity': 'warning', 'message': '2 schedules missing.',
        'user_id': 'test-account-id', 'ts': 123, 'internal': 'private metadata',
    }, {
        'code': 'schedule_dates_missing', 'severity': 'info', 'message': '1 schedule has no dates.',
        'user_id': 'test-account-id', 'ts': 124,
    }]
    backend = SimpleNamespace(is_remote=True, consume_diagnostics=MagicMock(return_value=diagnostics))
    register_service_on_client(authenticated_client, 'task_repository', _make_task_repository())
    register_service_on_client(authenticated_client, 'session_manager', _make_session_mgr(authenticated_client))
    register_service_on_client(authenticated_client, 'backend', backend)

    response = authenticated_client.get('/api/tasks')

    assert response.status_code == 200
    assert json.loads(response.headers['X-Backend-Diagnostics']) == [
        {key: diagnostic[key] for key in ('code', 'severity', 'message')}
        for diagnostic in diagnostics
    ]
    backend.consume_diagnostics.assert_called_once_with(user_id='test-account-id')


def test_tasks_invalid_pat_without_stale_returns_403(authenticated_client):
    from planner_lib.backend.errors import BackendAuthError

    class TaskRepo:
        def read(self, project_id=None, credential=None):
            raise BackendAuthError('invalid_pat')

    register_service_on_client(authenticated_client, 'task_repository', TaskRepo())
    register_service_on_client(authenticated_client, 'session_manager', _make_session_mgr(authenticated_client))

    r = authenticated_client.get('/api/tasks')
    assert r.status_code == 403
    assert r.json() == {'error': 'pat_invalid'}


def test_tasks_backend_outage_without_stale_returns_503(authenticated_client):
    from planner_lib.backend.errors import BackendUnavailableError

    class TaskRepo:
        def read(self, project_id=None, credential=None):
            raise BackendUnavailableError('connection refused')

    register_service_on_client(authenticated_client, 'task_repository', TaskRepo())
    register_service_on_client(authenticated_client, 'session_manager', _make_session_mgr(authenticated_client))

    r = authenticated_client.get('/api/tasks')
    assert r.status_code == 503
    assert 'backend_unavailable' in r.text


def test_tasks_backend_misconfigured_returns_500(authenticated_client):
    from planner_lib.backend.errors import BackendConfigError

    class TaskRepo:
        def read(self, project_id=None, credential=None):
            raise BackendConfigError('TF401232: area path does not exist')

    register_service_on_client(authenticated_client, 'task_repository', TaskRepo())
    register_service_on_client(authenticated_client, 'session_manager', _make_session_mgr(authenticated_client))

    r = authenticated_client.get('/api/tasks')
    assert r.status_code == 500
    assert 'backend_misconfigured' in r.text


def test_tasks_update_success_and_errors(authenticated_client):
    task_repo = _make_task_repository()
    register_service_on_client(authenticated_client, 'task_repository', task_repo)
    register_service_on_client(authenticated_client, 'session_manager', _make_session_mgr(authenticated_client))

    # success
    payload = [{'id': 1}, {'id': 2}]
    r = authenticated_client.post('/api/tasks', json=payload)
    assert r.status_code == 200
    assert r.json().get('ok') is True
    assert r.json().get('updated') == 2

    # error path
    bad = [{'id': 3, 'error': True}]
    r2 = authenticated_client.post('/api/tasks', json=bad)
    assert r2.status_code == 200
    assert r2.json().get('ok') is False
    assert 'errors' in r2.json()


def test_tasks_missing_service_returns_500(authenticated_client, monkeypatch):
    register_service_on_client(authenticated_client, 'session_manager', _make_session_mgr(authenticated_client))
    container = getattr(authenticated_client.app.state, 'container', None)
    if container is not None:
        monkeypatch.delitem(container._singletons, 'task_repository', raising=False)
        monkeypatch.delitem(container._factories, 'task_repository', raising=False)
    from fastapi.testclient import TestClient
    c = TestClient(authenticated_client.app, raise_server_exceptions=False,
                   cookies=authenticated_client.cookies)
    r = c.get('/api/tasks')
    assert r.status_code == 500


def test_iterations_returns_set_id_keyed_payload(authenticated_client):
    task_repo = _make_task_repository()

    class AzureClientStub:
        requires_pat = False

    register_service_on_client(authenticated_client, 'iteration_repository', task_repo)
    register_service_on_client(authenticated_client, 'session_manager', _make_session_mgr(authenticated_client))
    register_service_on_client(authenticated_client, 'azure_client', AzureClientStub())

    r = authenticated_client.get('/api/iterations?project=project-dalton')

    assert r.status_code == 200
    assert r.json() == {
        'iterationSetsById': {
            'set-1': {
                'id': 'set-1',
                'name': 'Set 1',
                'sourceProject': 'ADO',
                'rootPath': 'Root',
                'cachedAt': None,
                'iterations': [],
            }
        },
    }
    assert task_repo.last_iteration_args is None


def test_iterations_without_filter_returns_set_id_keyed_payload(authenticated_client):
    task_repo = _make_task_repository()

    class AzureClientStub:
        requires_pat = False

    register_service_on_client(authenticated_client, 'iteration_repository', task_repo)
    register_service_on_client(authenticated_client, 'session_manager', _make_session_mgr(authenticated_client))
    register_service_on_client(authenticated_client, 'azure_client', AzureClientStub())

    r = authenticated_client.get('/api/iterations')

    assert r.status_code == 200
    assert r.json() == {
        'iterationSetsById': {
            'set-1': {
                'id': 'set-1',
                'name': 'Set 1',
                'sourceProject': 'ADO',
                'rootPath': 'Root',
                'cachedAt': None,
                'iterations': [],
            }
        },
    }
