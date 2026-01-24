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


def _make_task_service():
    class TaskSvc:
        def __init__(self):
            self.last_args = None

        def list_tasks(self, pat=None, project_id=None):
            self.last_args = dict(pat=pat, project_id=project_id)
            if project_id:
                return [{'id': 't-p-' + str(project_id)}]
            return [{'id': 't-all-1'}, {'id': 't-all-2'}]

        def update_tasks(self, payload, pat=None):
            self.last_args = dict(payload=payload, pat=pat)
            if not payload:
                return {'ok': True, 'updated': 0}
            # If any item has error flag, return errors
            for it in payload:
                if it.get('error'):
                    return {'ok': False, 'errors': ['bad item']}
            return {'ok': True, 'updated': len(payload)}

    return TaskSvc()


def test_teams_happy_path(client):
    svc = _make_team_service([{'id': 1, 'name': 'TeamA'}])
    register_service_on_client(client, 'team_service', svc)
    r = client.get('/api/teams', headers={'X-Session-Id': 'test-session'})
    assert r.status_code == 200
    assert r.json() == [{'id': 1, 'name': 'TeamA'}]


def test_teams_missing_service(client):
    # Ensure service is not present in the container
    if getattr(client.app.state, 'container', None) and 'team_service' in client.app.state.container._singletons:
        del client.app.state.container._singletons['team_service']
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
    task_svc = _make_task_service()
    register_service_on_client(client, 'task_service', task_svc)
    # Provide a lightweight fake session manager for the test
    class FakeSessionMgr:
        def exists(self, sid):
            return True

        def get(self, sid):
            return {'email': 'test@example.com', 'pat': 'token'}

        def create(self, email: str):
            return 'test-session'

        def get_val(self, sid, key):
            return 'token'

    register_service_on_client(client, 'session_manager', FakeSessionMgr())

    r = client.get('/api/tasks', headers={'X-Session-Id': 'test-session'})
    assert r.status_code == 200
    assert isinstance(r.json(), list) and len(r.json()) == 2

    r2 = client.get('/api/tasks?project=42', headers={'X-Session-Id': 'test-session'})
    assert r2.status_code == 200
    assert r2.json() == [{'id': 't-p-42'}]
    # ensure the task service saw the project_id
    assert task_svc.last_args['project_id'] == '42'


def test_tasks_update_success_and_errors(client):
    task_svc = _make_task_service()
    register_service_on_client(client, 'task_service', task_svc)
    class FakeSessionMgr:
        def exists(self, sid):
            return True

        def get(self, sid):
            return {'email': 'test@example.com', 'pat': 'token'}

        def create(self, email: str):
            return 'test-session'

        def get_val(self, sid, key):
            return 'token'

    register_service_on_client(client, 'session_manager', FakeSessionMgr())

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
    if getattr(client.app.state, 'container', None) and 'task_service' in client.app.state.container._singletons:
        del client.app.state.container._singletons['task_service']
    from fastapi.testclient import TestClient
    c = TestClient(client.app, raise_server_exceptions=False)
    r = c.get('/api/tasks', headers={'X-Session-Id': 'test-session'})
    assert r.status_code == 500
