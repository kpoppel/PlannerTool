"""
Unit tests for the history service and API endpoint.
"""
import pytest
from typing import Any
from tests.helpers import register_service_on_client


def _make_history_repository_with_data():
    """Create a mock HistoryRepository with test data."""
    class MockHistoryRepo:
        def read(
            self,
            tasks,
            project_id=None,
            user_id=None,
            team_id=None,
            plan_id=None,
            since=None,
            until=None,
            page=1,
            per_page=100,
        ):
            if not user_id:
                return {'page': page, 'per_page': per_page, 'total': 0, 'tasks': []}

            # Return sample history data
            tasks_data = [
                {
                    'task_id': 12345,
                    'title': 'Sample Feature',
                    'plan_id': 'plan_1',
                    'history': [
                        {
                            'field': 'start',
                            'value': '2025-05-08',
                            'changed_at': '2025-05-08T09:10:00Z',
                            'changed_by': 'alice'
                        },
                        {
                            'field': 'end',
                            'value': '2025-05-25',
                            'changed_at': '2025-05-25T11:00:00Z',
                            'changed_by': 'bob'
                        },
                        {
                            'field': 'start',
                            'value': '2026-01-01',
                            'changed_at': '2026-01-01T07:00:00Z',
                            'changed_by': 'alice'
                        }
                    ]
                }
            ]

            # Apply filters
            if plan_id:
                tasks_data = [t for t in tasks_data if t['plan_id'] == plan_id]
            if since:
                for task in tasks_data:
                    task['history'] = [
                        h for h in task['history']
                        if h.get('changed_at', '')[:10] >= since
                    ]
            if until:
                for task in tasks_data:
                    task['history'] = [
                        h for h in task['history']
                        if h.get('changed_at', '')[:10] <= until
                    ]

            total = len(tasks_data)
            start_idx = (page - 1) * per_page
            tasks_data = tasks_data[start_idx: start_idx + per_page]

            return {'page': page, 'per_page': per_page, 'total': total, 'tasks': tasks_data}

    return MockHistoryRepo()


def _make_task_repository():
    class MockTaskRepo:
        def read(self, project_id=None, credential=None):
            return []

        def write(self, updates, user_id=None):
            return {'ok': True, 'updated': 0, 'errors': []}

        def list_markers(self, project_id=None, user_id=None):
            return []

        def list_iterations(self, project_id=None, user_id=None):
            return []

    return MockTaskRepo()


def _make_fake_session_manager():
    """Create a fake session manager for tests."""
    class FakeSessionMgr:
        def exists(self, sid):
            return True

        def get(self, sid):
            return {'email': 'test@example.com', 'pat': 'test-token'}

        def create(self, email: str):
            return 'test-session'

        def get_val(self, sid, key):
            if key == 'pat':
                return 'test-token'
            if key == 'email':
                return 'test@example.com'
            return None

    return FakeSessionMgr()


def test_history_api_happy_path(client):
    """Test the history API endpoint successfully returns task history."""
    history_repo = _make_history_repository_with_data()
    task_repo = _make_task_repository()
    session_mgr = _make_fake_session_manager()

    register_service_on_client(client, 'session_manager', session_mgr)
    register_service_on_client(client, 'task_repository', task_repo)
    register_service_on_client(client, 'history_repository', history_repo)

    # Make the request
    r = client.get('/api/history/tasks', headers={'X-Session-Id': 'test-session'})

    assert r.status_code == 200
    data = r.json()

    assert 'tasks' in data
    assert 'page' in data
    assert 'per_page' in data
    assert 'total' in data
    assert len(data['tasks']) == 1
    assert data['tasks'][0]['task_id'] == 12345
    assert len(data['tasks'][0]['history']) == 3


def test_history_api_with_project_filter(client):
    """Test the history API with project filter."""
    history_repo = _make_history_repository_with_data()
    task_repo = _make_task_repository()
    session_mgr = _make_fake_session_manager()

    register_service_on_client(client, 'session_manager', session_mgr)
    register_service_on_client(client, 'task_repository', task_repo)
    register_service_on_client(client, 'history_repository', history_repo)

    r = client.get(
        '/api/history/tasks?project=project-test',
        headers={'X-Session-Id': 'test-session'}
    )

    assert r.status_code == 200
    data = r.json()
    assert 'tasks' in data


def test_history_api_with_plan_filter(client):
    """Test the history API with plan filter."""
    history_repo = _make_history_repository_with_data()
    task_repo = _make_task_repository()
    session_mgr = _make_fake_session_manager()

    register_service_on_client(client, 'session_manager', session_mgr)
    register_service_on_client(client, 'task_repository', task_repo)
    register_service_on_client(client, 'history_repository', history_repo)

    r = client.get(
        '/api/history/tasks?plan=plan_1',
        headers={'X-Session-Id': 'test-session'}
    )

    assert r.status_code == 200
    data = r.json()
    assert data['tasks'][0]['plan_id'] == 'plan_1'


def test_history_api_with_date_range(client):
    """Test the history API with date range filters."""
    history_repo = _make_history_repository_with_data()
    task_repo = _make_task_repository()
    session_mgr = _make_fake_session_manager()

    register_service_on_client(client, 'session_manager', session_mgr)
    register_service_on_client(client, 'task_repository', task_repo)
    register_service_on_client(client, 'history_repository', history_repo)

    r = client.get(
        '/api/history/tasks?since=2026-01-01&until=2026-12-31',
        headers={'X-Session-Id': 'test-session'}
    )

    assert r.status_code == 200
    data = r.json()
    # Should only have history entries from 2026
    if data['tasks']:
        history_entries = data['tasks'][0]['history']
        for entry in history_entries:
            assert entry['changed_at'].startswith('2026')


def test_history_api_pagination(client):
    """Test the history API pagination parameters."""
    history_repo = _make_history_repository_with_data()
    task_repo = _make_task_repository()
    session_mgr = _make_fake_session_manager()

    register_service_on_client(client, 'session_manager', session_mgr)
    register_service_on_client(client, 'task_repository', task_repo)
    register_service_on_client(client, 'history_repository', history_repo)

    r = client.get(
        '/api/history/tasks?page=2&per_page=50',
        headers={'X-Session-Id': 'test-session'}
    )

    assert r.status_code == 200
    data = r.json()
    assert data['page'] == 2
    assert data['per_page'] == 50


def test_history_api_no_pat(client):
    """Test the history API without PAT returns 401."""
    from fastapi.testclient import TestClient

    # Create a session manager that returns no PAT
    class NoPATSessionMgr:
        def exists(self, sid):
            return True
        def get_val(self, sid, key):
            return None

    register_service_on_client(client, 'session_manager', NoPATSessionMgr())

    # Create a client that doesn't raise server exceptions
    c = TestClient(client.app, raise_server_exceptions=False)
    r = c.get('/api/history/tasks', headers={'X-Session-Id': 'test-session'})

    assert r.status_code == 401


def test_history_service_deduplication():
    """Test that history repository deduplicates consecutive identical values."""
    from planner_lib.repository.history_repository import HistoryRepository

    # Test data with consecutive duplicates
    history = [
        {'field': 'start', 'value': '2025-01-01', 'changed_at': '2025-01-01T09:00:00Z'},
        {'field': 'start', 'value': '2025-01-01', 'changed_at': '2025-01-02T09:00:00Z'},  # Duplicate
        {'field': 'start', 'value': '2025-02-01', 'changed_at': '2025-02-01T09:00:00Z'},
        {'field': 'end', 'value': '2025-03-01', 'changed_at': '2025-03-01T09:00:00Z'},
        {'field': 'end', 'value': '2025-03-01', 'changed_at': '2025-03-02T09:00:00Z'},  # Duplicate
    ]

    result = HistoryRepository._deduplicate_history(history)

    # Should remove the duplicate entries
    assert len(result) == 3
    # Check that values are deduplicated per field
    start_values = [h['value'] for h in result if h['field'] == 'start']
    end_values = [h['value'] for h in result if h['field'] == 'end']
    assert start_values == ['2025-01-01', '2025-02-01']
    assert end_values == ['2025-03-01']


def test_history_service_pairing_hints():
    """Test that history repository adds pairing hints for simultaneous changes."""
    from planner_lib.repository.history_repository import HistoryRepository

    # Test data with changes at similar times
    history = [
        {
            'field': 'start',
            'value': '2025-01-01',
            'changed_at': '2025-01-01T09:00:00Z',
            'changed_by': 'alice'
        },
        {
            'field': 'end',
            'value': '2025-02-01',
            'changed_at': '2025-01-01T09:00:30Z',  # Within 60 seconds
            'changed_by': 'alice'
        },
        {
            'field': 'start',
            'value': '2025-03-01',
            'changed_at': '2025-03-01T10:00:00Z',
            'changed_by': 'bob'
        }
    ]

    result = HistoryRepository._compute_pairing_hints(history, delta_seconds=60)

    # First two should have pair_id (same user, within time delta)
    assert 'pair_id' in result[0] or 'pair_id' in result[1]
    # Third should not have pair_id or have a different one
    if 'pair_id' in result[2] and 'pair_id' in result[0]:
        assert result[2].get('pair_id') != result[0].get('pair_id')
