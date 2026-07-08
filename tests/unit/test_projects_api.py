import pytest
from tests.helpers import register_service_on_client


def _make_team_service(teams):
    class TeamSvc:
        def list_teams(self):
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
                    'sourceProject': 'ADO',
                    'roots': ['Root'],
                    'iterations': [],
                }
            }

    return TaskRepo()


def _make_session_mgr(pat='token', email='test@example.com'):
    """Session manager stub that returns the given pat and email."""
    class FakeSessionMgr:
        def exists(self, sid):
            return True

        def get(self, sid):
            return {'email': email, 'pat': pat}

        def create(self, email_: str):
            return 'test-session'

        def get_val(self, sid, key):
            if key == 'pat':
                return pat
            if key == 'email':
                return email
            return None

    return FakeSessionMgr()


def _make_backend_with_warning():
    class BackendWithWarning:
        def consume_warnings(self, user_id=None):
            return [{
                'code': 'tasks_stale_invalid_pat',
                'message': 'PAT is invalid or expired. Showing cached task data that may be out of date.',
                'user_id': user_id,
            }]

    return BackendWithWarning()


def test_teams_happy_path(client):
    svc = _make_team_service([{'id': 1, 'name': 'TeamA'}])
    register_service_on_client(client, 'team_repository', svc)
    r = client.get('/api/teams', headers={'X-Session-Id': 'test-session'})
    assert r.status_code == 200
    assert r.json() == [{'id': 1, 'name': 'TeamA'}]


def test_teams_missing_service(client):
    # Ensure service is not present in the container (clear both singletons and factories)
    container = getattr(client.app.state, 'container', None)
    if container is not None:
        container._singletons.pop('team_repository', None)
        container._factories.pop('team_repository', None)
    # Use a client that does not raise server exceptions so we can assert 500
    from fastapi.testclient import TestClient
    c = TestClient(client.app, raise_server_exceptions=False)
    r = c.get('/api/teams', headers={'X-Session-Id': 'test-session'})
    assert r.status_code == 500


def test_projects_happy_path(client):
    svc = _make_project_service([{'id': 'p1', 'name': 'Proj1'}])
    register_service_on_client(client, 'project_repository', svc)
    r = client.get('/api/projects', headers={'X-Session-Id': 'test-session'})
    assert r.status_code == 200
    assert r.json() == [{'id': 'p1', 'name': 'Proj1'}]


def test_tasks_list_and_project_param(client):
    task_repo = _make_task_repository()
    register_service_on_client(client, 'task_repository', task_repo)
    register_service_on_client(client, 'session_manager', _make_session_mgr())

    r = client.get('/api/tasks', headers={'X-Session-Id': 'test-session'})
    assert r.status_code == 200
    assert isinstance(r.json(), list) and len(r.json()) == 2

    r2 = client.get('/api/tasks?project=42', headers={'X-Session-Id': 'test-session'})
    assert r2.status_code == 200
    assert r2.json() == [{'id': 't-p-42'}]
    # ensure the repository saw the project_id
    assert task_repo.last_read_args['project_id'] == '42'


def test_tasks_returns_warning_headers_when_stale_fallback_used(client):
    task_repo = _make_task_repository()
    register_service_on_client(client, 'task_repository', task_repo)
    register_service_on_client(client, 'session_manager', _make_session_mgr(email='warn@example.com'))
    register_service_on_client(client, 'backend', _make_backend_with_warning())

    r = client.get('/api/tasks', headers={'X-Session-Id': 'test-session'})
    assert r.status_code == 200
    assert r.headers.get('X-Tasks-Data-Stale') == 'true'
    assert r.headers.get('X-Tasks-Warning-Code') == 'tasks_stale_invalid_pat'
    assert 'PAT is invalid or expired' in (r.headers.get('X-Tasks-Warning-Message') or '')


def test_tasks_invalid_pat_without_stale_returns_401(client):
    from planner_lib.backend.errors import BackendAuthError

    class TaskRepo:
        def read(self, project_id=None, credential=None):
            raise BackendAuthError('invalid_pat')

    register_service_on_client(client, 'task_repository', TaskRepo())
    register_service_on_client(client, 'session_manager', _make_session_mgr())

    r = client.get('/api/tasks', headers={'X-Session-Id': 'test-session'})
    assert r.status_code == 401
    assert 'invalid_pat' in r.text


def test_tasks_backend_outage_without_stale_returns_503(client):
    from planner_lib.backend.errors import BackendUnavailableError

    class TaskRepo:
        def read(self, project_id=None, credential=None):
            raise BackendUnavailableError('connection refused')

    register_service_on_client(client, 'task_repository', TaskRepo())
    register_service_on_client(client, 'session_manager', _make_session_mgr())

    r = client.get('/api/tasks', headers={'X-Session-Id': 'test-session'})
    assert r.status_code == 503
    assert 'backend_unavailable' in r.text


def test_tasks_backend_misconfigured_returns_500(client):
    from planner_lib.backend.errors import BackendConfigError

    class TaskRepo:
        def read(self, project_id=None, credential=None):
            raise BackendConfigError('TF401232: area path does not exist')

    register_service_on_client(client, 'task_repository', TaskRepo())
    register_service_on_client(client, 'session_manager', _make_session_mgr())

    r = client.get('/api/tasks', headers={'X-Session-Id': 'test-session'})
    assert r.status_code == 500
    assert 'backend_misconfigured' in r.text


def test_tasks_update_success_and_errors(client):
    task_repo = _make_task_repository()
    register_service_on_client(client, 'task_repository', task_repo)
    register_service_on_client(client, 'session_manager', _make_session_mgr())

    # success
    payload = [{'id': 1}, {'id': 2}]
    r = client.post('/api/tasks', json=payload, headers={'X-Session-Id': 'test-session'})
    assert r.status_code == 200
    assert r.json().get('ok') is True
    assert r.json().get('updated') == 2

    # error path
    bad = [{'id': 3, 'error': True}]
    r2 = client.post('/api/tasks', json=bad, headers={'X-Session-Id': 'test-session'})
    assert r2.status_code == 200
    assert r2.json().get('ok') is False
    assert 'errors' in r2.json()


def test_tasks_missing_service_returns_500(client):
    container = getattr(client.app.state, 'container', None)
    if container is not None:
        container._singletons.pop('task_repository', None)
        container._factories.pop('task_repository', None)
    from fastapi.testclient import TestClient
    c = TestClient(client.app, raise_server_exceptions=False)
    r = c.get('/api/tasks', headers={'X-Session-Id': 'test-session'})
    assert r.status_code == 500


def test_iterations_project_param_is_forwarded(client):
    task_repo = _make_task_repository()

    class AzureClientStub:
        requires_pat = False

    register_service_on_client(client, 'iteration_repository', task_repo)
    register_service_on_client(client, 'session_manager', _make_session_mgr())
    register_service_on_client(client, 'azure_client', AzureClientStub())

    r = client.get('/api/iterations?project=project-dalton', headers={'X-Session-Id': 'test-session'})

    assert r.status_code == 200
    assert r.json() == {
        'iterationsByProject': {
            'project-dalton': {
                'projectId': 'project-dalton',
                'projectName': 'Proj',
                'sourceProject': 'ADO',
                'roots': ['Root'],
                'iterations': [],
            }
        }
    }
    assert task_repo.last_iteration_args == {
        'project_id': 'project-dalton',
        'user_id': 'test@example.com',
    }


def test_iterations_without_filter_returns_grouped_payload(client):
    task_repo = _make_task_repository()

    class AzureClientStub:
        requires_pat = False

    register_service_on_client(client, 'iteration_repository', task_repo)
    register_service_on_client(client, 'session_manager', _make_session_mgr())
    register_service_on_client(client, 'azure_client', AzureClientStub())

    r = client.get('/api/iterations', headers={'X-Session-Id': 'test-session'})

    assert r.status_code == 200
    assert r.json() == {
        'iterationsByProject': {
            'project-a': {
                'projectId': 'project-a',
                'projectName': 'Proj',
                'sourceProject': 'ADO',
                'roots': ['Root'],
                'iterations': [],
            }
        }
    }

