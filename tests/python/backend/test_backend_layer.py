"""Unit tests for the new backend layer and repositories.

Covers:
  - CachingBackend: cache hit/miss/invalidation
  - StaticBackend: YAML loading, filtering
  - TaskRepository: read, write, list_markers, list_iterations, refresh
  - HistoryRepository: read with pagination and date filters
  - AccountManagerCredentialProvider: credential lookup
"""
import pytest
from collections.abc import Iterator
from pathlib import Path
from unittest.mock import MagicMock

from planner_lib.backend.errors import BackendAuthError, BackendConfigError, BackendUnavailableError
from tests.fakes.fake_backend import FakeBackend, FakeCredentialProvider
from planner_lib.domain.tasks import DomainTask, WriteResult
from planner_lib.domain.history import DomainHistoryEntry
from planner_lib.storage.diskcache_backend import DiskCacheStorage
from tests.python.azure.test_process_catalogue import catalogue_storage


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
    result = backend.fetch_tasks('P1\\TeamA', task_types=["Feature", "Epic"])
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
    cred = {'kind': 'pat', 'token': 'pat', 'user_id': 'user@test.com'}
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
    cred = {'kind': 'pat', 'token': 'pat', 'user_id': 'u'}
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
    account_mgr.get_account_by_id.return_value = {'email': 'user@test.com'}
    account_mgr.pat_error.return_value = None
    account_mgr.load.return_value = {'ok': True, 'email': 'user@test.com', 'pat': 'secret-pat'}

    provider = AccountManagerCredentialProvider(account_mgr)
    cred = provider.get_credential('11111111-1111-4111-8111-111111111111')

    assert cred is not None
    assert cred['token'] == 'secret-pat'
    assert cred['user_id'] == '11111111-1111-4111-8111-111111111111'
    account_mgr.get_account_by_id.assert_called_once_with('11111111-1111-4111-8111-111111111111')
    account_mgr.load.assert_called_once_with('user@test.com')


def test_credential_provider_returns_none_when_no_pat():
    from planner_lib.backend.credential import AccountManagerCredentialProvider

    account_mgr = MagicMock()
    account_mgr.get_account_by_id.return_value = {'email': 'user@test.com'}
    account_mgr.pat_error.return_value = None
    account_mgr.load.return_value = {'ok': True, 'email': 'user@test.com', 'pat': None}

    provider = AccountManagerCredentialProvider(account_mgr)
    assert provider.get_credential('11111111-1111-4111-8111-111111111111') is None


@pytest.mark.parametrize('error', ['pat_required', 'pat_invalid'])
def test_credential_policy_does_not_load_unusable_pat(error):
    from planner_lib.backend.credential import AccountManagerCredentialProvider

    accounts = MagicMock()
    accounts.get_account_by_id.return_value = {'email': 'user@example.com'}
    accounts.pat_error.return_value = error

    assert AccountManagerCredentialProvider(accounts).get_credential('account-id') is None
    accounts.load.assert_not_called()


def test_credential_provider_returns_none_on_load_exception():
    from planner_lib.backend.credential import AccountManagerCredentialProvider

    account_mgr = MagicMock()
    account_mgr.get_account_by_id.side_effect = KeyError('unknown account')

    provider = AccountManagerCredentialProvider(account_mgr)
    assert provider.get_credential('22222222-2222-4222-8222-222222222222') is None


@pytest.mark.parametrize('user_id,email', [
    ('11111111-1111-4111-8111-111111111111', 'first@example.com'),
    ('22222222-2222-4222-8222-222222222222', 'second@example.com'),
])
def test_pat_policy_resolves_only_the_acting_account(user_id, email):
    from planner_lib.backend.credential import PatCredentialPolicy

    accounts = MagicMock()
    accounts.get_account_by_id.return_value = {'email': email}
    accounts.pat_error.return_value = 'pat_required'
    policy = PatCredentialPolicy(accounts)
    credential = {'kind': 'pat', 'token': 'operation-pat', 'user_id': user_id}

    assert policy.credential_error(user_id) == 'pat_required'
    accounts.pat_error.assert_called_once_with(email)
    assert policy.authentication_failed(credential) == 'pat_invalid'
    accounts.reject_pat.assert_called_once_with(email, 'operation-pat')
    assert accounts.get_account_by_id.call_args_list == [((user_id,),), ((user_id,),)]


def test_pat_policy_does_not_reject_another_credential_kind():
    from planner_lib.backend.credential import PatCredentialPolicy

    accounts = MagicMock()
    policy = PatCredentialPolicy(accounts)
    credential = {'kind': 'unsupported', 'token': 'never-expose-this', 'user_id': 'account-id'}

    with pytest.raises(ValueError) as error:
        policy.authentication_failed(credential)

    assert credential['token'] not in str(error.value)
    accounts.get_account_by_id.assert_not_called()
    accounts.reject_pat.assert_not_called()


def test_pat_policy_missing_credential_does_not_mutate_account():
    from planner_lib.backend.credential import PatCredentialPolicy

    accounts = MagicMock()
    assert PatCredentialPolicy(accounts).authentication_failed(None) == 'pat_invalid'
    accounts.reject_pat.assert_not_called()
    accounts.load.assert_not_called()


@pytest.mark.parametrize('status_code', [401, 403])
@pytest.mark.parametrize('location', ['exception', 'response'])
def test_auth_classification_preserves_status_without_changing_pat_semantics(status_code, location):
    from types import SimpleNamespace
    from planner_lib.backend.errors import classify_ado_exception

    failure = RuntimeError(f'{status_code} access denied')
    if location == 'exception':
        failure.status_code = status_code
    else:
        failure.response = SimpleNamespace(status_code=status_code)

    classified = classify_ado_exception(failure)

    assert isinstance(classified, BackendAuthError)
    assert classified.status_code == status_code
    assert classify_ado_exception(classified) is classified


# ---------------------------------------------------------------------------
# StaticBackend
# ---------------------------------------------------------------------------

def test_static_backend_returns_empty_for_missing_file(tmp_path):
    from planner_lib.backend.static import StaticBackend

    backend = StaticBackend(str(tmp_path / 'nonexistent.yml'), storage=catalogue_storage(["MyOrg", "MyProject", "SomeArea", "P", "A", "Unknown"]))
    result = backend.fetch_tasks('SomeArea', task_types=["Feature", "Epic"])
    assert result == []


def test_static_backend_loads_json(tmp_path):
    import json
    data_file = tmp_path / 'tasks.json'
    tasks = [{'id': '10', 'title': 'T10', 'type': 'Feature', 'state': 'Active'}]
    data_file.write_text(json.dumps({'MyProject\\\\TeamA': tasks}))

    from planner_lib.backend.static import StaticBackend
    backend = StaticBackend(str(data_file), storage=catalogue_storage(["MyOrg", "MyProject", "SomeArea", "P", "A", "Unknown"]))
    result = backend.fetch_tasks('MyProject\\\\TeamA', task_types=["Feature", "Epic"])
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
    backend = StaticBackend(str(data_file), storage=catalogue_storage(["MyOrg", "MyProject", "SomeArea", "P", "A", "Unknown"]))
    result = backend.fetch_tasks('P\\T', task_types=['Feature'], closed_history_days=0)
    assert len(result) == 1
    assert result[0]['state'] == 'Active'


def test_static_backend_write_raises():
    from planner_lib.backend.static import StaticBackend
    backend = StaticBackend('nofile.json', storage=catalogue_storage(["A"]))
    with pytest.raises(NotImplementedError):
        backend.write_task(1, {}, {'kind': 'pat', 'token': 'x', 'user_id': 'u'})


def test_static_backend_invalidate_clears_cache(tmp_path):
    import json
    data_file = tmp_path / 'tasks.json'
    data_file.write_text(json.dumps({'A\\B': [{'id': '1', 'type': 'Feature', 'state': 'Active'}]}))

    from planner_lib.backend.static import StaticBackend
    backend = StaticBackend(str(data_file), storage=catalogue_storage(["MyOrg", "MyProject", "SomeArea", "P", "A", "Unknown"]))
    # Load once
    backend.fetch_tasks('A\\B', task_types=["Feature", "Epic"])
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


def _canonical_task_repository(storage):
    """Build a canonical publication fixture with one configured source and explicit membership."""
    from planner_lib.repository.task_repository import WorkforceTaskRepository

    storage.save('config', 'teams', {'schema_version': 3, 'teams': [
        {'id': 'A', 'name': 'Alpha', 'short_name': 'Alpha', 'allocation_token': 'ALP',
         'archived': False, 'group_id': 'G'},
    ], 'groups': [
        {'id': 'G', 'name': 'Group', 'short_name': 'Group', 'allocation_token': 'GRP', 'archived': False},
    ]})
    features = [
        {'id': 'parent', 'project': 'plan', 'start': '2026-01-01', 'end': '2026-01-31',
         'capacity': [{'team': 'A', 'capacity': 80}], 'parentId': None, 'relations': []},
        {'id': 'child', 'project': 'plan', 'start': None, 'end': None,
         'capacity': [{'team': 'G', 'capacity': 40}], 'parentId': 'parent', 'relations': []},
    ]
    backend = MagicMock()
    backend.fetch_plan_tasks.return_value = features
    backend.fetch_task_context.return_value = features
    backend.write_task.return_value = {'updated': 1, 'errors': []}
    projects = MagicMock()
    projects.get_project_map.return_value = [{'id': 'plan'}]
    projects.list_projects.return_value = [
        {'id': 'plan', 'type': 'Plan', 'allocation_defaults': {'Plan': ['A', 'G']}},
    ]
    credentials = MagicMock()
    credentials.get_credential.return_value = {'kind': 'pat', 'token': 'fixture-pat', 'user_id': 'fixture-user'}
    repository = WorkforceTaskRepository(backend, projects, credentials,
                                         storage=storage, task_storage=storage)
    return repository, backend


@pytest.fixture
def publication_storage(tmp_path: Path) -> Iterator[DiskCacheStorage]:
    """Use a disposable transactional store at the canonical publication boundary."""
    storage = DiskCacheStorage(tmp_path / 'publication')
    yield storage
    storage._cache.close()


@pytest.mark.parametrize('updates,message', [
    ([{'id': 'child', 'start': '2026-01-10', 'end': '2026-01-20'}], 'Allocation conflict'),
    ([{'id': 'parent', 'capacity': [{'team': 'A', 'capacity': 80}, {'team': 'G', 'capacity': 20}]}],
     'Allocation conflict'),
    ([{'id': 'parent', 'start': '2026-01-02'},
      {'id': 'child', 'capacity': [{'team': 'missing', 'capacity': 20}]}], 'not offered'),
])
def test_canonical_publication_validates_entire_batch_before_writes(publication_storage, updates, message) -> None:
    """Invalid candidate graphs or choices cannot partially reach the backend."""
    repository, backend = _canonical_task_repository(publication_storage)
    with pytest.raises(ValueError, match=message):
        repository.write(updates, 'fixture-user')
    backend.write_task.assert_not_called()


def test_canonical_publication_rejects_partial_source_reads(publication_storage) -> None:
    """Publication cannot certify a graph after skipping an unreachable configured source."""
    repository, backend = _canonical_task_repository(publication_storage)
    backend.fetch_plan_tasks.side_effect = BackendUnavailableError('fixture offline')
    with pytest.raises(BackendUnavailableError):
        repository.write([{'id': 'parent', 'start': '2026-01-02'}], 'fixture-user')
    backend.write_task.assert_not_called()


def test_canonical_publication_accepts_valid_retained_and_offered_capacity(publication_storage) -> None:
    """Known-team edits retain ordinary publication behavior after candidate validation."""
    repository, backend = _canonical_task_repository(publication_storage)
    result = repository.write([{'id': 'parent', 'capacity': [{'team': 'A', 'capacity': 60}]}], 'fixture-user')
    assert result == {'updated': 1, 'errors': []}
    assert backend.write_task.call_count == 1


def test_canonical_seed_dedup_ignores_opaque_backend_metadata(publication_storage) -> None:
    """Private payload differences never determine repository identity or graph consistency."""
    repository, backend = _canonical_task_repository(publication_storage)
    repository._project_service.get_project_map.return_value = [{'id': 'plan'}, {'id': 'other'}]
    task = {'id': 'item', 'project': 'plan', 'revision': 1, 'capacity': [], 'start': None, 'end': None}
    backend.fetch_plan_tasks.side_effect = [
        [{**task, 'backendData': {'private': 'first'}}],
        [{**task, 'backendData': {'private': 'second'}}],
    ]
    seeds = repository._fetch_seeds(None)
    assert len(seeds) == 1
    assert seeds[0]['sourcePlanIds'] == ['other', 'plan']


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


@pytest.mark.parametrize('reverse', [False, True])
def test_task_repository_preserves_actual_owner_and_merges_seed_provenance(reverse):
    from planner_lib.repository.task_repository import TaskRepository

    projects = [
        {'id': 'plan-a', 'backendData': {'query': 'external-query-a'}},
        {'id': 'plan-b', 'backendData': {'query': 'external-query-b'}},
    ]
    original = {'id': 'external-1', 'project': 'plan-b', 'type': 'Feature',
                'state': 'Active', 'revision': 1, 'title': 'Old',
                'backendData': {'externalKey': 'issue-17', 'rev': 'opaque-token'}}
    newer = {**original, 'revision': 2, 'title': 'Newest'}
    orphan = {'id': 'external-2', 'project': 'internal-context-owner',
              'type': 'Feature', 'state': 'Active',
              'backendData': {'source': 'external-workspace', 'rev': 'not-an-integer'}}
    backend = MagicMock()
    payloads = {'plan-a': [original, orphan], 'plan-b': [newer, orphan]}
    backend.fetch_plan_tasks.side_effect = lambda plan, credential: payloads[plan['id']]
    backend.fetch_task_context.side_effect = lambda seeds, credential: seeds
    repo = TaskRepository(backend, _make_project_service(projects[::-1] if reverse else projects),
                          FakeCredentialProvider())

    tasks = {task['id']: task for task in repo.read()}

    assert len(tasks) == 2
    assert tasks['external-1']['project'] == 'plan-b'
    assert tasks['external-1']['title'] == 'Newest'
    assert tasks['external-1']['sourcePlanIds'] == ['plan-a', 'plan-b']
    assert tasks['external-2']['project'] == 'internal-context-owner'
    assert all('backendData' not in task for task in tasks.values())
    assert orphan['backendData'] == {'source': 'external-workspace', 'rev': 'not-an-integer'}
    assert tasks['external-2']['sourcePlanIds'] == ['plan-a', 'plan-b']
    assert original['project'] == 'plan-b'
    assert 'sourcePlanIds' not in orphan
    assert [call.kwargs['plan'] for call in backend.fetch_plan_tasks.call_args_list] == (
        projects[::-1] if reverse else projects
    )
    backend.fetch_tasks.assert_not_called()


def test_task_repository_passes_private_combined_seeds_to_context_before_projection():
    from planner_lib.repository.task_repository import TaskRepository

    projects = [{'id': 'plan-a'}, {'id': 'plan-b'}]
    older = {'id': 'external-1', 'project': 'plan-a', 'revision': 1,
             'backendData': {'source': 'old'}}
    newer = {**older, 'revision': 2, 'backendData': {'source': 'current'}}
    second = {'id': 'external-2', 'project': 'plan-b',
              'backendData': {'source': 'other'}}
    backend = MagicMock()
    backend.fetch_plan_tasks.side_effect = [[older], [newer, second]]
    context = [
        {**newer, 'sourcePlanIds': ['plan-a', 'plan-b'],
         'presentationPlanIds': ['plan-a', 'plan-b']},
        {**second, 'sourcePlanIds': ['plan-b'], 'presentationPlanIds': ['plan-b']},
        {'id': 'linked-3', 'project': 'internal-owner',
         'sourcePlanIds': ['plan-a', 'plan-b'], 'presentationPlanIds': [],
         'backendData': {'source': 'linked'}},
    ]
    backend.fetch_task_context.return_value = context
    credential = {'kind': 'pat', 'token': 'test', 'user_id': 'test'}
    repo = TaskRepository(backend, _make_project_service(projects), FakeCredentialProvider())

    private_context = repo._fetch_context(credential=credential)
    result = repo._project_tasks(private_context)

    backend.fetch_task_context.assert_called_once_with([
        {**newer, 'sourcePlanIds': ['plan-a', 'plan-b']},
        {**second, 'sourcePlanIds': ['plan-b']},
    ], credential=credential)
    assert {task['id'] for task in result} == {'external-1', 'external-2', 'linked-3'}
    assert all('backendData' not in task for task in result)
    assert 'sourcePlanIds' not in older
    assert 'sourcePlanIds' not in newer
    assert all('backendData' in task for task in context)
    assert private_context == context


def test_task_repository_public_read_projects_the_normalized_forest():
    from planner_lib.repository.task_repository import TaskRepository

    backend = MagicMock()
    seed = {'id': 'seed', 'project': 'plan-a', 'backendData': {'identity': 'private'}}
    backend.fetch_plan_tasks.return_value = [seed]
    backend.fetch_task_context.return_value = [
        {**seed, 'sourcePlanIds': ['plan-a'], 'presentationPlanIds': ['plan-a']},
        {'id': 'linked', 'project': 'internal-owner', 'sourcePlanIds': ['plan-a'],
         'presentationPlanIds': [], 'backendData': {'identity': 'linked-private'}},
    ]
    repo = TaskRepository(backend, _make_project_service([{'id': 'plan-a'}]),
                          FakeCredentialProvider())

    assert repo.read() == [
        {'id': 'seed', 'project': 'plan-a', 'sourcePlanIds': ['plan-a'],
         'presentationPlanIds': ['plan-a']},
        {'id': 'linked', 'project': 'internal-owner', 'sourcePlanIds': ['plan-a'],
         'presentationPlanIds': []},
    ]
    backend.fetch_task_context.assert_called_once_with([
        {**seed, 'sourcePlanIds': ['plan-a']},
    ], credential=None)
    assert 'sourcePlanIds' not in seed


@pytest.mark.parametrize('error', [BackendAuthError, BackendConfigError, BackendUnavailableError])
def test_task_repository_private_context_failures_propagate(error):
    from planner_lib.repository.task_repository import TaskRepository

    backend = MagicMock()
    backend.fetch_plan_tasks.return_value = [{'id': 'seed', 'project': 'plan-a'}]
    backend.fetch_task_context.side_effect = error('Context normalization failed')
    repo = TaskRepository(backend, _make_project_service([{'id': 'plan-a'}]),
                          FakeCredentialProvider())

    with pytest.raises(error, match='Context normalization failed'):
        repo._fetch_context()


def test_task_repository_private_context_handles_an_empty_combined_forest():
    from planner_lib.repository.task_repository import TaskRepository

    backend = FakeBackend()
    repo = TaskRepository(backend, _make_project_service([]), FakeCredentialProvider())

    assert repo._fetch_context() == []
    assert backend.fetch_tasks_calls == []


@pytest.mark.parametrize('project_id, expected_ids', [
    (None, {'seed-a', 'seed-b', 'linked'}),
    ('plan-a', {'seed-a', 'linked'}),
    ('plan-b', {'seed-b', 'linked'}),
])
def test_task_repository_filters_by_provenance_after_combined_forest_normalization(
    project_id, expected_ids,
):
    from planner_lib.repository.task_repository import TaskRepository

    plans = [{'id': 'plan-a'}, {'id': 'plan-b'}]
    backend = MagicMock()
    backend.fetch_plan_tasks.side_effect = [
        [{'id': 'seed-a', 'project': 'plan-a'}],
        [{'id': 'seed-b', 'project': 'plan-b'}],
    ]
    backend.fetch_task_context.return_value = [
        {'id': 'seed-a', 'project': 'plan-a', 'sourcePlanIds': ['plan-a']},
        {'id': 'seed-b', 'project': 'plan-b', 'sourcePlanIds': ['plan-b']},
        {'id': 'linked', 'project': 'context-internal',
         'sourcePlanIds': ['plan-a', 'plan-b'], 'presentationPlanIds': []},
    ]
    repo = TaskRepository(backend, _make_project_service(plans), FakeCredentialProvider())

    assert {task['id'] for task in repo.read(project_id)} == expected_ids
    assert backend.fetch_plan_tasks.call_count == 2
    backend.fetch_task_context.assert_called_once_with([
        {'id': 'seed-a', 'project': 'plan-a', 'sourcePlanIds': ['plan-a']},
        {'id': 'seed-b', 'project': 'plan-b', 'sourcePlanIds': ['plan-b']},
    ], credential=None)


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


def test_task_repository_read_rejects_misconfigured_sources():
    from planner_lib.repository.task_repository import TaskRepository

    class PartialFailureBackend(FakeBackend):
        def fetch_tasks(self, area_path, task_types=None, include_states=None, credential=None, **kwargs):
            if area_path == 'PB\\MissingArea':
                raise BackendConfigError(f'TF401232: area path {area_path} does not exist')
            return super().fetch_tasks(
                area_path,
                task_types=task_types,
                include_states=include_states,
                credential=credential,
                **kwargs,
            )

    backend = PartialFailureBackend({
        'PA\\Team': [
            {
                'id': '1',
                'project': 'project-a',
                'type': 'Feature',
                'state': 'Active',
                'title': 'T1',
                'start': None,
                'end': None,
                'iterationPath': None,
                'parentId': None,
                'relations': [],
                'capacity': [],
                'description': None,
                'assignee': None,
                'tags': [],
                'areaPath': 'PA\\Team',
                'url': None,
                '_inferred_start': False,
                '_inferred_end': False,
            }
        ],
    })
    project_service = _make_project_service([
        {'id': 'project-a', 'name': 'PA', 'area_path': 'PA\\Team'},
        {'id': 'project-b', 'name': 'PB', 'area_path': 'PB\\MissingArea'},
    ])
    repo = TaskRepository(backend, project_service, FakeCredentialProvider())

    with pytest.raises(BackendConfigError, match='MissingArea'):
        repo.read()
    assert len(backend.fetch_tasks_calls) == 1


def test_task_repository_read_raises_auth_error():
    from planner_lib.repository.task_repository import TaskRepository

    class AuthFailureBackend(FakeBackend):
        def fetch_tasks(self, area_path, task_types=None, include_states=None, credential=None, **kwargs):
            raise BackendAuthError('invalid_pat')

    backend = AuthFailureBackend({'PA\\Team': []})
    project_service = _make_project_service([
        {'id': 'project-a', 'name': 'PA', 'area_path': 'PA\\Team'},
    ])
    repo = TaskRepository(backend, project_service, FakeCredentialProvider())

    with pytest.raises(BackendAuthError):
        repo.read()


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


def test_task_repository_write_preserves_backend_neutral_task_ids():
    from planner_lib.repository.task_repository import TaskRepository

    backend = MagicMock()
    backend.write_task.return_value = {'ok': True, 'updated': 1, 'errors': []}
    credentials = FakeCredentialProvider('user@test.com', 'tok')
    repo = TaskRepository(backend, _make_project_service([]), credentials)
    update = {'id': 'issue-17', 'state': 'Active'}

    assert repo.write([update], 'user@test.com') == {'updated': 1, 'errors': []}
    backend.write_task.assert_called_once_with(
        'issue-17', update, credentials.get_credential('user@test.com')
    )


def test_task_repository_consumers_cannot_update_backend_metadata():
    from planner_lib.repository.task_repository import TaskRepository

    backend = MagicMock()
    repo = TaskRepository(backend, _make_project_service([]),
                          FakeCredentialProvider('user@test.com', 'tok'))

    result = repo.write([{'id': '1', 'backendData': {'externalKey': 'another-item'}}],
                        'user@test.com')

    assert result['updated'] == 0
    assert result['errors'] == ['Task 1: backendData is private to the backend']
    backend.write_task.assert_not_called()


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


@pytest.mark.parametrize('operation', ['request_refresh', 'rebuild_now'])
@pytest.mark.parametrize('remote', [False, True])
def test_task_repository_requires_refresh_credentials_only_for_remote(operation, remote):
    from planner_lib.backend.errors import BackendAuthError
    from planner_lib.repository.task_repository import TaskRepository

    backend = FakeBackend()
    backend.is_remote = remote
    backend.fetch_task_context = MagicMock(wraps=backend.fetch_task_context)
    provider = MagicMock()
    repository = TaskRepository(backend, _make_project_service([]), provider)

    if remote:
        with pytest.raises(BackendAuthError):
            getattr(repository, operation)(None)
        backend.fetch_task_context.assert_not_called()
    else:
        getattr(repository, operation)(None)
        backend.fetch_task_context.assert_called_once_with([], credential=None)
    provider.get_credential.assert_not_called()


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


@pytest.mark.parametrize('operation', ['write', 'list_markers', 'read'])
def test_local_repositories_do_not_acquire_credentials(operation):
    from planner_lib.repository.history_repository import HistoryRepository
    from planner_lib.repository.plan_repository import PlanRepository
    from planner_lib.repository.task_repository import TaskRepository

    backend = FakeBackend()
    backend.is_remote = False
    provider = MagicMock()
    projects = _make_project_service([])

    if operation == 'write':
        backend.write_task = MagicMock(return_value={'updated': 1, 'errors': []})
        repository = TaskRepository(backend, projects, provider)
        assert repository.write([{'id': '42'}], user_id='acting-account')['updated'] == 1
        backend.write_task.assert_called_once_with('42', {'id': '42'}, None)
    elif operation == 'list_markers':
        repository = PlanRepository(backend, projects, provider, MagicMock())
        assert repository.list_markers(user_id='acting-account') == []
    else:
        repository = HistoryRepository(backend, provider)
        assert repository.read(tasks=[{'id': '42'}], user_id='acting-account')['total'] == 1
    provider.get_credential.assert_not_called()


def test_history_repository_reuses_operation_credential():
    from planner_lib.repository.history_repository import HistoryRepository

    backend = FakeBackend()
    backend.fetch_history = MagicMock(wraps=backend.fetch_history)
    provider = MagicMock()
    credential = {'kind': 'pat', 'token': 'operation-pat', 'user_id': 'acting-account'}
    repository = HistoryRepository(backend, provider)

    result = repository.read(tasks=[{'id': '42'}], user_id='acting-account',
                             credential=credential)

    assert result['total'] == 1
    provider.get_credential.assert_not_called()
    assert backend.fetch_history.call_args.kwargs['credential'] is credential


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
