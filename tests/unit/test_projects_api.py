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
            return []

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


def test_teams_happy_path(client):
    svc = _make_team_service([{'id': 1, 'name': 'TeamA'}])
    register_service_on_client(client, 'team_service', svc)
    r = client.get('/api/teams', headers={'X-Session-Id': 'test-session'})
    assert r.status_code == 200
    assert r.json() == [{'id': 1, 'name': 'TeamA'}]


def test_teams_missing_service(client):
    # Ensure service is not present in the container (clear both singletons and factories)
    container = getattr(client.app.state, 'container', None)
    if container is not None:
        container._singletons.pop('team_service', None)
        container._factories.pop('team_service', None)
    # Use a client that does not raise server exceptions so we can assert 500
    from fastapi.testclient import TestClient
    c = TestClient(client.app, raise_server_exceptions=False)
    r = c.get('/api/teams', headers={'X-Session-Id': 'test-session'})
    assert r.status_code == 500


def test_projects_happy_path(client):
    svc = _make_project_service([{'id': 'p1', 'name': 'Proj1'}])
    register_service_on_client(client, 'project_service', svc)
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

