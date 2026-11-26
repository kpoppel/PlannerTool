"""Batch write boundary and field-conflict result contract."""
from types import SimpleNamespace

from planner_lib.backend.port import BatchTaskBackend, TaskBackend
from planner_lib.repository.task_repository import TaskRepository
from tests.helpers import register_service_on_client


class _PerTaskBackend:
    CAPABILITIES = frozenset({'task_read', 'task_publish'})
    is_remote = False

    def __init__(self):
        self.calls = []

    def fetch_plan_tasks(self, plan, credential=None):
        return []

    def fetch_task_context(self, seeds, credential=None):
        return seeds

    def write_task(self, task_id, updates, credential):
        self.calls.append((task_id, updates))
        return {'ok': True, 'updated': 1, 'errors': []}

    def invalidate_cache(self):
        return {}


class _BatchBackend(_PerTaskBackend):
    def __init__(self, conflicts=()):
        super().__init__()
        self.batches = []
        self._conflicts = list(conflicts)

    def write_tasks(self, updates, credential, *, actor_id, validate):
        self.batches.append((updates, actor_id))
        if self._conflicts:
            return {'updated': 0, 'errors': [], 'conflicts': self._conflicts}
        return {'updated': len(updates), 'errors': [], 'conflicts': []}


def _repository(backend):
    return TaskRepository(backend, SimpleNamespace(get_project_map=lambda: []),
                          SimpleNamespace(get_credential=lambda user_id: None))


def test_protocols_distinguish_batch_backends():
    assert isinstance(_BatchBackend(), BatchTaskBackend)
    assert not isinstance(_PerTaskBackend(), BatchTaskBackend)
    assert isinstance(_PerTaskBackend(), TaskBackend)


def test_per_task_backends_keep_existing_result_shape():
    backend = _PerTaskBackend()
    result = _repository(backend).write([{'id': '1', 'start': '2026-01-01'},
                                         {'id': '2', 'end': '2026-02-01'}], 'actor')
    assert result == {'updated': 2, 'errors': []}
    assert [task_id for task_id, _ in backend.calls] == ['1', '2']


def test_batch_backends_receive_one_atomic_batch_with_actor_and_base():
    backend = _BatchBackend()
    updates = [{'id': '1', 'start': '2026-01-01',
                'base': {'revision': 3, 'fields': {'start': '2025-12-01'}}}]
    result = _repository(backend).write(updates, 'actor')
    assert result == {'updated': 1, 'errors': [], 'conflicts': []}
    assert backend.batches == [(updates, 'actor')]
    assert backend.calls == []


def test_batch_conflicts_are_returned_without_partial_writes():
    conflict = {'taskId': '1', 'field': 'start', 'base': '2025-12-01',
                'current': '2025-12-15', 'proposed': '2026-01-01'}
    backend = _BatchBackend([conflict])
    result = _repository(backend).write([{'id': '1', 'start': '2026-01-01'}], 'actor')
    assert result == {'updated': 0, 'errors': [], 'conflicts': [conflict]}


def test_http_publication_returns_409_for_field_conflicts(authenticated_client):
    conflict = {'taskId': '1', 'field': 'start', 'base': 'a', 'current': 'b', 'proposed': 'c'}
    repository = SimpleNamespace(write=lambda updates, user_id: {
        'updated': 0, 'errors': [], 'conflicts': [conflict]})
    register_service_on_client(authenticated_client, 'task_repository', repository)
    response = authenticated_client.post('/api/tasks', json=[{'id': '1', 'start': 'c'}])
    assert response.status_code == 409
    assert response.json() == {'error': 'task_conflict', 'message': 'Tasks changed since the reviewed revision',
                               'conflicts': [conflict]}
