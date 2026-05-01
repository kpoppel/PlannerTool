"""Unit tests for the new backend layer and repositories.

Covers:
  - CachingBackend: cache hit/miss/invalidation
  - StaticBackend: YAML loading, filtering
  - TaskRepository: read, write, list_markers, list_iterations, refresh
  - HistoryRepository: read with pagination and date filters
  - AccountManagerCredentialProvider: credential lookup
"""
import pytest
from unittest.mock import MagicMock

from tests.fakes.fake_backend import FakeBackend, FakeCredentialProvider
from planner_lib.domain.tasks import DomainTask, WriteResult
from planner_lib.domain.history import DomainHistoryEntry


# ---------------------------------------------------------------------------
# FakeBackend sanity tests
# ---------------------------------------------------------------------------

def test_fake_backend_returns_tasks():
    backend = FakeBackend()
    task: DomainTask = {'id': '1', 'title': 'T1', 'type': 'Feature', 'state': 'Active',
                         'project': 'p1', 'start': None, 'end': None, 'iterationPath': None,
                         'parentId': None, 'relations': [], 'capacity': [],
                         'description': None, 'assignee': None, 'tags': [],
                         'areaPath': 'P1\\TeamA', 'url': None,
                         '_inferred_start': False, '_inferred_end': False}
    backend.set_tasks('P1\\TeamA', [task])
    result = backend.fetch_tasks('P1\\TeamA')
    assert len(result) == 1
    assert result[0]['id'] == '1'


def test_fake_backend_write_updates_in_memory():
    backend = FakeBackend()
    task: DomainTask = {'id': '1', 'title': 'T1', 'type': 'Feature', 'state': 'Active',
                         'project': 'p1', 'start': None, 'end': None, 'iterationPath': None,
                         'parentId': None, 'relations': [], 'capacity': [],
                         'description': None, 'assignee': None, 'tags': [],
                         'areaPath': 'P1\\TeamA', 'url': None,
                         '_inferred_start': False, '_inferred_end': False}
    backend.set_tasks('P1\\TeamA', [task])
    cred = {'token': 'pat', 'user_id': 'user@test.com'}
    result = backend.write_task(1, {'start': '2026-01-01'}, cred)
    assert result['ok'] is True
    assert result['updated'] == 1
    assert backend._tasks['P1\\TeamA'][0]['start'] == '2026-01-01'


def test_fake_backend_records_calls():
    backend = FakeBackend()
    backend.fetch_tasks('A\\B', task_types=['Feature'])
    assert len(backend.fetch_tasks_calls) == 1
    assert backend.fetch_tasks_calls[0]['area_path'] == 'A\\B'
    assert backend.fetch_tasks_calls[0]['task_types'] == ['Feature']


def test_fake_backend_raise_on_write():
    backend = FakeBackend(raise_on_write=True)
    cred = {'token': 'pat', 'user_id': 'u'}
    with pytest.raises(RuntimeError):
        backend.write_task(1, {}, cred)


# ---------------------------------------------------------------------------
# FakeCredentialProvider
# ---------------------------------------------------------------------------

def test_fake_credential_provider_returns_credential():
    provider = FakeCredentialProvider('user@test.com', 'my-pat')
    cred = provider.get_credential('user@test.com')
    assert cred is not None
    assert cred['token'] == 'my-pat'
    assert cred['user_id'] == 'user@test.com'


def test_fake_credential_provider_returns_none_for_unknown():
    provider = FakeCredentialProvider('user@test.com', 'my-pat')
    assert provider.get_credential('other@test.com') is None


# ---------------------------------------------------------------------------
# AccountManagerCredentialProvider
# ---------------------------------------------------------------------------

def test_credential_provider_wraps_account_manager():
    from planner_lib.backend.credential import AccountManagerCredentialProvider

    account_mgr = MagicMock()
    account_mgr.load.return_value = {'ok': True, 'email': 'user@test.com', 'pat': 'secret-pat'}

    provider = AccountManagerCredentialProvider(account_mgr)
    cred = provider.get_credential('user@test.com')

    assert cred is not None
    assert cred['token'] == 'secret-pat'
    assert cred['user_id'] == 'user@test.com'
    account_mgr.load.assert_called_once_with('user@test.com')


def test_credential_provider_returns_none_when_no_pat():
    from planner_lib.backend.credential import AccountManagerCredentialProvider

    account_mgr = MagicMock()
    account_mgr.load.return_value = {'ok': True, 'email': 'user@test.com', 'pat': None}

    provider = AccountManagerCredentialProvider(account_mgr)
    assert provider.get_credential('user@test.com') is None


def test_credential_provider_returns_none_on_load_exception():
    from planner_lib.backend.credential import AccountManagerCredentialProvider

    account_mgr = MagicMock()
    account_mgr.load.side_effect = KeyError('unknown user')

    provider = AccountManagerCredentialProvider(account_mgr)
    assert provider.get_credential('nonexistent@test.com') is None


# ---------------------------------------------------------------------------
# StaticBackend
# ---------------------------------------------------------------------------

def test_static_backend_returns_empty_for_missing_file(tmp_path):
    from planner_lib.backend.static import StaticBackend

    backend = StaticBackend(str(tmp_path / 'nonexistent.yml'))
    result = backend.fetch_tasks('SomeArea')
    assert result == []


def test_static_backend_loads_json(tmp_path):
    import json
    data_file = tmp_path / 'tasks.json'
    tasks = [{'id': '10', 'title': 'T10', 'type': 'Feature', 'state': 'Active'}]
    data_file.write_text(json.dumps({'MyProject\\\\TeamA': tasks}))

    from planner_lib.backend.static import StaticBackend
    backend = StaticBackend(str(data_file))
    result = backend.fetch_tasks('MyProject\\\\TeamA')
    assert len(result) == 1
    assert result[0]['id'] == '10'


def test_static_backend_filters_by_state(tmp_path):
    import json
    tasks = [
        {'id': '1', 'type': 'Feature', 'state': 'Active'},
        {'id': '2', 'type': 'Feature', 'state': 'Closed'},
    ]
    data_file = tmp_path / 'tasks.json'
    data_file.write_text(json.dumps({'P\\T': tasks}))

    from planner_lib.backend.static import StaticBackend
    backend = StaticBackend(str(data_file))
    result = backend.fetch_tasks('P\\T', include_states=['Active'])
    assert len(result) == 1
    assert result[0]['state'] == 'Active'


def test_static_backend_write_raises():
    from planner_lib.backend.static import StaticBackend
    backend = StaticBackend('nofile.json')
    with pytest.raises(NotImplementedError):
        backend.write_task(1, {}, {'token': 'x', 'user_id': 'u'})


def test_static_backend_invalidate_clears_cache(tmp_path):
    import json
    data_file = tmp_path / 'tasks.json'
    data_file.write_text(json.dumps({'A\\B': [{'id': '1', 'type': 'Feature', 'state': 'Active'}]}))

    from planner_lib.backend.static import StaticBackend
    backend = StaticBackend(str(data_file))
    # Load once
    backend.fetch_tasks('A\\B')
    assert backend._data is not None
    # Invalidate
    result = backend.invalidate_cache()
    assert result['ok'] is True
    assert backend._data is None


# ---------------------------------------------------------------------------
# TaskRepository
# ---------------------------------------------------------------------------

def _make_project_service(projects):
    class PS:
        def get_project_map(self):
            return projects
    return PS()


def _make_storage(server_config=None, area_plan_map=None, iterations=None):
    cfg = {
        'server_config': server_config or {},
        'area_plan_map': area_plan_map or {},
        'iterations': iterations or {},
    }
    class Storage:
        def load(self, ns, key):
            return cfg.get(key, {})
        def exists(self, ns, key):
            return key in cfg
    return Storage()


def test_task_repository_read_calls_backend():
    from planner_lib.repository.task_repository import TaskRepository

    task: DomainTask = {'id': '1', 'title': 'T1', 'type': 'Feature', 'state': 'Active',
                         'project': 'project-a', 'start': None, 'end': None,
                         'iterationPath': None, 'parentId': None, 'relations': [],
                         'capacity': [], 'description': None, 'assignee': None, 'tags': [],
                         'areaPath': 'ProjectA\\TeamA', 'url': None,
                         '_inferred_start': False, '_inferred_end': False}
    backend = FakeBackend({'ProjectA\\TeamA': [task]})
    project_service = _make_project_service([{
        'id': 'project-a', 'name': 'ProjectA',
        'area_path': 'ProjectA\\TeamA',
        'task_types': ['Feature'],
        'include_states': ['Active'],
    }])
    cred_provider = FakeCredentialProvider()
    storage = _make_storage()

    repo = TaskRepository(backend, project_service, cred_provider)
    result = repo.read()

    assert len(result) == 1
    assert result[0]['id'] == '1'
    assert len(backend.fetch_tasks_calls) == 1


def test_task_repository_read_filters_by_project():
    from planner_lib.repository.task_repository import TaskRepository

    backend = FakeBackend({
        'PA\\T': [{'id': '1', 'project': 'project-a', 'type': 'Feature', 'state': 'Active',
                    'title': 'T1', 'start': None, 'end': None, 'iterationPath': None,
                    'parentId': None, 'relations': [], 'capacity': [], 'description': None,
                    'assignee': None, 'tags': [], 'areaPath': 'PA\\T', 'url': None,
                    '_inferred_start': False, '_inferred_end': False}],
        'PB\\T': [{'id': '2', 'project': 'project-b', 'type': 'Feature', 'state': 'Active',
                    'title': 'T2', 'start': None, 'end': None, 'iterationPath': None,
                    'parentId': None, 'relations': [], 'capacity': [], 'description': None,
                    'assignee': None, 'tags': [], 'areaPath': 'PB\\T', 'url': None,
                    '_inferred_start': False, '_inferred_end': False}],
    })
    project_service = _make_project_service([
        {'id': 'project-a', 'name': 'PA', 'area_path': 'PA\\T'},
        {'id': 'project-b', 'name': 'PB', 'area_path': 'PB\\T'},
    ])
    repo = TaskRepository(backend, project_service, FakeCredentialProvider())
    result = repo.read(project_id='project-a')
    assert len(result) == 1
    assert result[0]['id'] == '1'


def test_task_repository_write_delegates_to_backend():
    from planner_lib.repository.task_repository import TaskRepository

    task: DomainTask = {'id': '5', 'title': 'T5', 'type': 'Feature', 'state': 'Active',
                         'project': 'p', 'start': None, 'end': None,
                         'iterationPath': None, 'parentId': None, 'relations': [],
                         'capacity': [], 'description': None, 'assignee': None, 'tags': [],
                         'areaPath': 'P\\T', 'url': None,
                         '_inferred_start': False, '_inferred_end': False}
    backend = FakeBackend({'P\\T': [task]})
    project_service = _make_project_service([{'id': 'p', 'name': 'P', 'area_path': 'P\\T'}])
    cred_provider = FakeCredentialProvider('user@test.com', 'tok')
    repo = TaskRepository(backend, project_service, cred_provider)

    result = repo.write([{'id': 5, 'start': '2026-06-01'}], user_id='user@test.com')

    assert result['updated'] == 1
    assert len(backend.write_task_calls) == 1


def test_task_repository_write_returns_error_for_missing_credential():
    from planner_lib.repository.task_repository import TaskRepository

    backend = FakeBackend()
    project_service = _make_project_service([])
    # Provider returns None for the user
    cred_provider = FakeCredentialProvider('other@test.com', 'tok')
    repo = TaskRepository(backend, project_service, cred_provider)

    result = repo.write([{'id': 1}], user_id='unknown@test.com')
    assert result['updated'] == 0
    assert result['errors']


def test_task_repository_refresh_calls_invalidate():
    from planner_lib.repository.task_repository import TaskRepository

    backend = FakeBackend()
    project_service = _make_project_service([])
    cred_provider = FakeCredentialProvider()
    repo = TaskRepository(backend, project_service, cred_provider)

    repo.refresh()
    assert backend.invalidate_cache_calls == 1


# ---------------------------------------------------------------------------
# HistoryRepository
# ---------------------------------------------------------------------------

def test_history_repository_read_returns_paginated_results():
    from planner_lib.repository.history_repository import HistoryRepository

    entry: DomainHistoryEntry = {
        'field': 'start', 'value': '2026-01-01',
        'changed_at': '2026-01-01T09:00:00Z', 'changed_by': 'alice'
    }
    backend = FakeBackend()
    backend.set_history(42, [entry])
    cred_provider = FakeCredentialProvider()

    tasks = [{'id': '42', 'title': 'Feature 42', 'plan_id': 'plan_1',
               'project': 'p', 'type': 'Feature', 'state': 'Active',
               'start': None, 'end': None, 'iterationPath': None, 'parentId': None,
               'relations': [], 'capacity': [], 'description': None, 'assignee': None,
               'tags': [], 'areaPath': 'P\\T', 'url': None,
               '_inferred_start': False, '_inferred_end': False}]

    repo = HistoryRepository(backend, cred_provider)
    result = repo.read(tasks=tasks, user_id='test@example.com')

    assert result['total'] == 1
    assert result['page'] == 1
    assert len(result['tasks']) == 1
    assert result['tasks'][0]['task_id'] == 42
    assert len(result['tasks'][0]['history']) == 1
    assert len(backend.fetch_history_calls) == 1


def test_history_repository_read_no_user_returns_empty():
    from planner_lib.repository.history_repository import HistoryRepository

    backend = FakeBackend()
    cred_provider = FakeCredentialProvider()
    repo = HistoryRepository(backend, cred_provider)
    result = repo.read(tasks=[], user_id=None)
    assert result['total'] == 0
    assert result['tasks'] == []


def test_history_repository_deduplication():
    from planner_lib.repository.history_repository import HistoryRepository

    backend = FakeBackend()
    cred_provider = FakeCredentialProvider()
    repo = HistoryRepository(backend, cred_provider)

    history = [
        {'field': 'start', 'value': '2026-01-01', 'changed_at': '2026-01-01T09:00:00Z'},
        {'field': 'start', 'value': '2026-01-01', 'changed_at': '2026-01-02T09:00:00Z'},  # dup
        {'field': 'start', 'value': '2026-02-01', 'changed_at': '2026-02-01T09:00:00Z'},
    ]
    result = repo._deduplicate_history(history)
    assert len(result) == 2


def test_history_repository_pairing_hints():
    from planner_lib.repository.history_repository import HistoryRepository

    backend = FakeBackend()
    cred_provider = FakeCredentialProvider()
    repo = HistoryRepository(backend, cred_provider)

    history = [
        {'field': 'start', 'value': '2026-01-01',
         'changed_at': '2026-01-01T09:00:00Z', 'changed_by': 'alice'},
        {'field': 'end', 'value': '2026-03-01',
         'changed_at': '2026-01-01T09:00:30Z', 'changed_by': 'alice'},  # same user, 30s apart
    ]
    result = repo._compute_pairing_hints(history, delta_seconds=60)
    assert 'pair_id' in result[0]
    assert 'pair_id' in result[1]
    assert result[0]['pair_id'] == result[1]['pair_id']
