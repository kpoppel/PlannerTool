"""Unit tests for CachingBackend caching semantics.

- Cache miss delegates to inner backend
- Cache hit does NOT call inner backend again
- write_task evicts fetch_tasks__* entries; next fetch re-queries inner
- invalidate_cache clears all entries; next fetch re-queries inner
- CachingBackend transparently mirrors inner backend's protocols
"""
from __future__ import annotations

import pytest
from datetime import timedelta

from tests.fakes.fake_backend import FakeBackend
from planner_lib.storage.memory_backend import MemoryStorage

AREA = 'MyOrg\\\\TeamA'
AREA_B = 'MyOrg\\\\TeamB'
CRED = {'token': 'tok', 'user_id': 'u@example.com'}

_TASK = {'id': '1', 'title': 'T', 'type': 'Feature', 'state': 'Active',
         'project': 'p', 'relations': [], 'capacity': []}


@pytest.fixture
def inner():
    b = FakeBackend()
    b.set_tasks(AREA, [dict(_TASK)])
    b.set_tasks(AREA_B, [dict(_TASK, id='2', title='T2')])
    return b


@pytest.fixture
def storage():
    return MemoryStorage()


@pytest.fixture
def caching(inner, storage):
    from planner_lib.backend.caching import CachingBackend, CacheTTLConfig
    ttl = CacheTTLConfig(default=timedelta(hours=1), fetch_tasks=timedelta(hours=1),
                         fetch_history=timedelta(hours=1), fetch_teams=timedelta(hours=1),
                         fetch_plans=timedelta(hours=1), fetch_markers=timedelta(hours=1),
                         fetch_iterations=timedelta(hours=1))
    return CachingBackend(inner=inner, storage=storage, ttl_config=ttl)


# ---------------------------------------------------------------------------
# Cache miss / hit semantics
# ---------------------------------------------------------------------------

def test_first_fetch_delegates_to_inner(caching, inner):
    result = caching.fetch_tasks(AREA)
    assert len(result) == 1
    assert len(inner.fetch_tasks_calls) == 1


def test_second_fetch_served_from_cache(caching, inner):
    caching.fetch_tasks(AREA)          # miss → populates cache
    caching.fetch_tasks(AREA)          # hit  → no new inner call
    assert len(inner.fetch_tasks_calls) == 1


def test_repository_serves_complete_snapshot_when_seed_payload_changes(inner, tmp_path):
    from unittest.mock import MagicMock
    from planner_lib.backend.caching import CachingBackend
    from planner_lib.repository.task_repository import TaskRepository
    from planner_lib.storage.diskcache_backend import DiskCacheStorage

    inner.is_remote = True
    projects = MagicMock()
    projects.get_project_map.return_value = [{'id': 'p', 'area_path': AREA}]
    store = DiskCacheStorage(tmp_path / 'cache')
    try:
        backend = CachingBackend(inner, store)
        repository = TaskRepository(backend, projects, MagicMock())
        original = repository.read(credential=CRED)
        inner.set_tasks(AREA, [dict(_TASK, title='Changed in ADO')])
        plan_key = backend._make_key('fetch_plan_tasks', (), {
            'plan': projects.get_project_map.return_value[0], 'credential': CRED,
        })
        store.save('backend_domain', plan_key, [dict(_TASK, title='Changed in ADO')])

        assert repository.read(credential={'token': 'other', 'user_id': 'other'}) == original
        assert len(inner.fetch_tasks_calls) == 1
        restarted_backend = CachingBackend(inner, store)
        restarted_repository = TaskRepository(restarted_backend, projects, MagicMock())
        assert restarted_repository.read() == original
        assert len(inner.fetch_tasks_calls) == 1
        restarted_backend.close()
    finally:
        store.close()


@pytest.fixture
def snapshot_repository(inner, storage):
    from unittest.mock import MagicMock
    from planner_lib.backend.caching import CachingBackend
    from planner_lib.repository.task_repository import TaskRepository

    inner.is_remote = True
    projects = MagicMock()
    projects.get_project_map.return_value = [{'id': 'p', 'area_path': AREA}]
    backend = CachingBackend(inner, storage)
    repository = TaskRepository(backend, projects, MagicMock())
    yield repository, backend, projects
    backend.close()


def test_stale_snapshot_returns_without_waiting_and_refreshes_once(snapshot_repository, inner, storage):
    from threading import Event
    from unittest.mock import Mock
    from planner_lib.backend.task_snapshot import META_KEY, NAMESPACE

    repository, backend, projects = snapshot_repository
    original = repository.read(credential=CRED)
    metadata = storage.load(NAMESPACE, META_KEY)
    storage.save(NAMESPACE, META_KEY, dict(metadata, fresh_until=0))
    inner.set_tasks(AREA, [dict(_TASK, title='Latest')])
    entered, release = Event(), Event()
    original_context = inner.fetch_task_context

    def blocked_context(seeds, credential):
        entered.set()
        assert release.wait(5)
        return original_context(seeds, credential)

    inner.fetch_task_context = Mock(side_effect=blocked_context)
    try:
        assert repository.read(credential=CRED) == original
        assert entered.wait(5)
        thread = backend._task_snapshot._thread
        assert repository.read(credential=CRED) == original
        assert repository.request_refresh(CRED) == {'status': 'already_running'}
        assert 'updating in background' in repository.snapshot_diagnostics()[0]['message']
        assert len(inner.fetch_tasks_calls) == 2
    finally:
        release.set()
        backend.close()
    assert not thread.is_alive()
    assert repository.read()[0]['title'] == 'Latest'
    assert storage.load(NAMESPACE, META_KEY)['completed_at'] >= metadata['completed_at']


@pytest.mark.parametrize('change', ['write', 'invalidate', 'configuration'])
def test_snapshot_refresh_cannot_commit_over_newer_changes(snapshot_repository, inner, storage, change):
    from threading import Event
    from planner_lib.backend.task_snapshot import NAMESPACE, SNAPSHOT_KEY

    repository, backend, projects = snapshot_repository
    original = repository.read(credential=CRED)
    entered, release = Event(), Event()
    original_context = inner.fetch_task_context

    def blocked_context(seeds, credential):
        result = original_context(seeds, credential)
        entered.set()
        assert release.wait(5)
        return result

    inner.fetch_task_context = blocked_context
    try:
        assert repository.request_refresh(CRED) == {'status': 'queued'}
        assert entered.wait(5)
        if change == 'write':
            backend.write_task('1', {'start': '2026-10-17'}, CRED)
        elif change == 'invalidate':
            backend.invalidate_cache()
        else:
            projects.get_project_map.return_value = [{'id': 'different', 'area_path': AREA}]
    finally:
        release.set()
        backend.close()
    if change == 'write':
        assert repository.read()[0]['start'] == '2026-10-17'
    elif change == 'invalidate':
        assert not storage.exists(NAMESPACE, SNAPSHOT_KEY)
    else:
        assert storage.load(NAMESPACE, SNAPSHOT_KEY) == original
        assert repository.snapshot_diagnostics() == []


def test_snapshot_refresh_failure_preserves_data_and_throttles_retries(snapshot_repository, inner, storage):
    from unittest.mock import Mock
    from planner_lib.backend.errors import BackendAuthError
    from planner_lib.backend.task_snapshot import META_KEY, NAMESPACE

    repository, backend, projects = snapshot_repository
    original = repository.read(credential=CRED)
    metadata = storage.load(NAMESPACE, META_KEY)
    storage.save(NAMESPACE, META_KEY, dict(metadata, fresh_until=0))
    inner.fetch_task_context = Mock(side_effect=BackendAuthError('private credential failure'))
    repository.read(credential=CRED)
    backend.close()

    assert repository.read(credential=CRED) == original
    inner.fetch_task_context.assert_called_once()
    current = storage.load(NAMESPACE, META_KEY)
    assert current['completed_at'] == metadata['completed_at']
    assert current['error'] == 'BackendAuthError'
    assert 'private credential failure' not in str(current)
    assert 'user_id' not in current and 'token' not in current
    assert repository.snapshot_diagnostics()[0]['severity'] == 'warning'


def test_changed_configuration_can_commit_an_empty_complete_snapshot(snapshot_repository):
    repository, backend, projects = snapshot_repository
    assert repository.read(credential=CRED)
    projects.get_project_map.return_value = []

    assert repository.read(credential=CRED) == []
    assert repository.read() == []


@pytest.mark.parametrize('method', ['fetch_tasks', 'fetch_plan_tasks', 'fetch_task_context'])
@pytest.mark.parametrize('field,value', [('start', '2026-03-05'), ('end', '2026-03-20')])
def test_published_date_becomes_explicit_in_every_task_cache(caching, storage, method, field, value):
    key = f'{method}__dates'
    task = dict(_TASK, start='2026-03-01', end='2026-03-14',
                _inferred_start=True, _inferred_end=True)
    storage.save('backend_domain', key, [task])

    result = caching.write_task('1', {field: value}, CRED)

    assert result['ok']
    cached, = storage.load('backend_domain', key)
    assert cached[field] == value
    assert cached[f'_inferred_{field}'] is False
    other = 'end' if field == 'start' else 'start'
    assert cached[f'_inferred_{other}'] is True


def test_cache_forwards_provider_diagnostics_alongside_its_own(storage):
    from types import SimpleNamespace
    from unittest.mock import MagicMock
    from planner_lib.backend.caching import CachingBackend

    inner = SimpleNamespace(consume_diagnostics=MagicMock(return_value=[{
        'code': 'schedule_metadata_missing', 'severity': 'warning', 'message': '2 schedules missing.',
    }]))
    caching = CachingBackend(inner, storage)
    caching._record_warning(code='tasks_stale', message='Showing cached tasks.', user_id=CRED['user_id'])

    diagnostics = caching.consume_diagnostics(user_id=CRED['user_id'])

    assert [diagnostic['code'] for diagnostic in diagnostics] == ['tasks_stale', 'schedule_metadata_missing']
    inner.consume_diagnostics.assert_called_once_with(user_id=CRED['user_id'])


def test_different_type_filter_is_separate_cache_key(caching, inner):
    caching.fetch_tasks(AREA, task_types=['Feature'])
    caching.fetch_tasks(AREA, task_types=['Epic'])
    assert len(inner.fetch_tasks_calls) == 2


def test_different_state_filter_is_separate_cache_key(caching, inner):
    caching.fetch_tasks(AREA, include_states=['Active'])
    caching.fetch_tasks(AREA, include_states=['Closed'])
    assert len(inner.fetch_tasks_calls) == 2


def test_different_area_is_separate_cache_key(caching, inner):
    caching.fetch_tasks(AREA)
    caching.fetch_tasks(AREA_B)
    assert len(inner.fetch_tasks_calls) == 2


def test_credential_excluded_from_cache_key(caching, inner):
    """Task cache entries are shared across users for the same query args."""
    cred_a = {'token': 'aaa', 'user_id': 'a@example.com'}
    cred_b = {'token': 'bbb', 'user_id': 'b@example.com'}
    caching.fetch_tasks(AREA, credential=cred_a)
    caching.fetch_tasks(AREA, credential=cred_b)
    assert len(inner.fetch_tasks_calls) == 1


@pytest.mark.parametrize('task_ttl', [timedelta(minutes=5), None])
def test_plan_fetch_uses_the_existing_task_ttl(task_ttl):
    from planner_lib.backend.caching import CacheTTLConfig

    config = CacheTTLConfig(default=timedelta(hours=4), fetch_tasks=task_ttl)

    assert config.ttl_for('fetch_plan_tasks') == task_ttl
    assert config.ttl_for('fetch_task_context') == task_ttl


def test_plan_task_cache_keeps_private_metadata_but_repository_does_not_expose_it(storage):
    from unittest.mock import MagicMock
    from planner_lib.backend.caching import CachingBackend
    from planner_lib.repository.task_repository import TaskRepository

    plan = {'id': 'plan-a', 'backendData': {'query': 'backend-owned-query'}}
    private_data = {'externalKey': 'issue-1', 'versionToken': 'backend-owned-token'}
    task = {**_TASK, 'project': 'plan-a', 'backendData': private_data}
    inner = MagicMock(spec=['fetch_plan_tasks', 'fetch_task_context', 'write_task'])
    inner.fetch_plan_tasks.return_value = [task]
    inner.fetch_task_context.side_effect = lambda seeds, credential: seeds
    inner.write_task.return_value = {'ok': True, 'updated': 1, 'errors': []}
    caching = CachingBackend(inner, storage)
    projects = MagicMock()
    projects.get_project_map.return_value = [plan]
    repo = TaskRepository(caching, projects, MagicMock())

    public_task, = repo.read()
    assert 'backendData' not in public_task
    assert task['backendData'] == private_data
    key = caching._make_key('fetch_plan_tasks', (), {'plan': plan, 'credential': None})
    assert storage.load('backend_domain', key)[0]['backendData'] == private_data

    caching.write_task(1, {'state': 'Closed'}, CRED)

    public_task, = repo.read()
    assert public_task['state'] == 'Closed'
    assert 'backendData' not in public_task
    assert storage.load('backend_domain', key)[0]['backendData'] == private_data
    inner.fetch_plan_tasks.assert_called_once_with(plan=plan, credential=None)


def test_repository_private_context_reuses_cached_seeds_and_forest(storage):
    from unittest.mock import MagicMock
    from planner_lib.backend.caching import CachingBackend
    from planner_lib.repository.task_repository import TaskRepository

    plans = [{'id': 'plan-a'}, {'id': 'plan-b'}]
    seed = {**_TASK, 'backendData': {'sourceKey': 'external-1'}}
    linked = {**_TASK, 'id': 'linked', 'project': 'internal-owner',
              'sourcePlanIds': ['plan-a', 'plan-b'], 'presentationPlanIds': [],
              'backendData': {'sourceKey': 'external-2'}}
    inner = MagicMock(spec=['fetch_plan_tasks', 'fetch_task_context', 'write_task'])
    inner.fetch_plan_tasks.return_value = [seed]
    inner.fetch_task_context.return_value = [
        {**seed, 'sourcePlanIds': ['plan-a', 'plan-b']}, linked,
    ]
    inner.write_task.return_value = {'ok': True, 'updated': 1, 'errors': []}
    caching = CachingBackend(inner, storage)
    projects = MagicMock()
    projects.get_project_map.return_value = plans
    repo = TaskRepository(caching, projects, MagicMock())

    repo._fetch_context(CRED)
    cached = repo._fetch_context({'token': 'different', 'user_id': 'other'})

    assert cached[1] == linked
    inner.fetch_task_context.assert_called_once_with([
        {**seed, 'sourcePlanIds': ['plan-a', 'plan-b']},
    ], credential=CRED)
    assert inner.fetch_plan_tasks.call_count == 2
    assert all('backendData' in task for task in cached)
    assert all('backendData' not in task for task in repo._project_tasks(cached))

    caching.write_task('linked', {'state': 'Closed'}, CRED)
    updated = repo._fetch_context(CRED)
    assert updated[1]['state'] == 'Closed'
    assert updated[1]['backendData'] == linked['backendData']
    assert updated[1]['sourcePlanIds'] == ['plan-a', 'plan-b']
    inner.fetch_task_context.assert_called_once()


def test_context_cache_write_through_preserves_private_identity_and_scope(storage):
    from unittest.mock import MagicMock
    from planner_lib.backend.caching import CachingBackend

    inner = MagicMock(spec=['fetch_task_context', 'write_task'])
    task = {**_TASK, 'sourcePlanIds': ['plan-a', 'plan-b'],
            'presentationPlanIds': ['plan-a'], 'backendData': {'sourceKey': 'external-1'}}
    seeds = [dict(_TASK)]
    inner.fetch_task_context.return_value = [task]
    inner.write_task.return_value = {'ok': True, 'updated': 1, 'errors': []}
    caching = CachingBackend(inner, storage)

    caching.fetch_task_context(seeds, credential=CRED)
    caching.write_task(1, {'state': 'Closed'}, CRED)
    cached, = caching.fetch_task_context(seeds, credential=CRED)

    assert cached['state'] == 'Closed'
    assert cached['backendData'] == task['backendData']
    assert cached['sourcePlanIds'] == ['plan-a', 'plan-b']
    assert cached['presentationPlanIds'] == ['plan-a']
    inner.fetch_task_context.assert_called_once_with(seeds, credential=CRED)


def test_invalid_pat_serves_stale_tasks_snapshot_and_records_warning(storage):
    """On a soft-expired entry, an auth failure keeps and serves existing content.

    No shadow snapshot is used: the single cached entry persists and is served
    when the live refresh raises a BackendAuthError.
    """
    import time
    from planner_lib.backend.caching import CachingBackend
    from planner_lib.backend.errors import BackendAuthError

    import threading

    class _CredentialSensitiveBackend:
        is_remote = True

        def __init__(self):
            self.fetch_tasks_calls = []
            self.refresh_attempted = threading.Event()

        def fetch_tasks(self, area_path, task_types=None, include_states=None, credential=None, **kwargs):
            self.fetch_tasks_calls.append({
                'area_path': area_path,
                'credential': credential,
            })
            token = (credential or {}).get('token')
            if token == 'expired-token':
                self.refresh_attempted.set()
                raise BackendAuthError('invalid_pat')
            return [dict(_TASK)]

        def write_task(self, task_id, updates, credential):
            return {'ok': True, 'updated': 1, 'errors': []}

        def invalidate_cache(self):
            return {'ok': True, 'invalidated': [], 'errors': []}

    inner = _CredentialSensitiveBackend()
    caching = CachingBackend(inner=inner, storage=storage)

    warm = caching.fetch_tasks(AREA, credential={'token': 'valid-token', 'user_id': 'u1@example.com'})
    assert len(warm) == 1

    # Force a soft-expiry without deleting the cached data (no shadow copy).
    meta_key = caching._meta_key('fetch_tasks', (AREA,), {})
    storage.save('backend_domain', meta_key, {'fresh_until': time.time() - 1})

    # The cached data entry must still be present (single copy, not purged).
    data_keys = [k for k in storage.list_keys('backend_domain') if k.startswith('fetch_tasks__')]
    assert len(data_keys) == 1
    stale_keys = [k for k in storage.list_keys('backend_domain') if k.startswith('stale__')]
    assert stale_keys == []

    second = caching.fetch_tasks(AREA, credential={'token': 'expired-token', 'user_id': 'u2@example.com'})
    assert len(second) == 1
    assert inner.refresh_attempted.wait(timeout=1.0)
    assert len(inner.fetch_tasks_calls) == 2

    warnings = caching.consume_diagnostics(user_id='u2@example.com')
    assert warnings
    assert warnings[-1]['code'] == 'tasks_stale_invalid_pat'


def test_api_outage_serves_stale_tasks_and_records_outage_warning(storage):
    """A BackendUnavailableError on refresh keeps cached content and flags an outage."""
    import time
    from planner_lib.backend.caching import CachingBackend
    from planner_lib.backend.errors import BackendUnavailableError

    import threading

    class _OutageBackend:
        is_remote = True

        def __init__(self):
            self.calls = 0
            self.refresh_attempted = threading.Event()

        def fetch_tasks(self, area_path, task_types=None, include_states=None, credential=None, **kwargs):
            self.calls += 1
            if self.calls == 1:
                return [dict(_TASK)]
            self.refresh_attempted.set()
            raise BackendUnavailableError('connection timed out')

        def write_task(self, task_id, updates, credential):
            return {'ok': True, 'updated': 1, 'errors': []}

        def invalidate_cache(self):
            return {'ok': True, 'invalidated': [], 'errors': []}

    inner = _OutageBackend()
    caching = CachingBackend(inner=inner, storage=storage)

    warm = caching.fetch_tasks(AREA, credential={'token': 'valid', 'user_id': 'u@example.com'})
    assert len(warm) == 1

    meta_key = caching._meta_key('fetch_tasks', (AREA,), {})
    storage.save('backend_domain', meta_key, {'fresh_until': time.time() - 1})

    again = caching.fetch_tasks(AREA, credential={'token': 'valid', 'user_id': 'u@example.com'})
    assert len(again) == 1  # kept existing content despite the outage
    assert inner.refresh_attempted.wait(timeout=1.0)
    assert inner.calls == 2

    warnings = caching.consume_diagnostics(user_id='u@example.com')
    assert warnings
    assert warnings[-1]['code'] == 'tasks_stale_api_outage'


def test_invalid_query_configuration_serves_stale_tasks_with_specific_warning(storage):
    """An invalid configured Azure DevOps path must not be described as an outage."""
    import time
    import threading
    from planner_lib.backend.caching import CachingBackend
    from planner_lib.backend.errors import BackendConfigError

    class _InvalidPathBackend:
        is_remote = True

        def __init__(self):
            self.calls = 0
            self.refresh_attempted = threading.Event()

        def fetch_tasks(self, area_path, task_types=None, include_states=None, credential=None, **kwargs):
            self.calls += 1
            if self.calls == 1:
                return [dict(_TASK)]
            self.refresh_attempted.set()
            raise BackendConfigError(
                'TF401232: area path does not exist',
                failed_path=area_path,
            )

        def write_task(self, task_id, updates, credential):
            return {'ok': True, 'updated': 1, 'errors': []}

        def invalidate_cache(self):
            return {'ok': True, 'invalidated': [], 'errors': []}

    inner = _InvalidPathBackend()
    caching = CachingBackend(inner=inner, storage=storage)
    caching.fetch_tasks(AREA, credential={'token': 'valid', 'user_id': 'u@example.com'})

    meta_key = caching._meta_key('fetch_tasks', (AREA,), {})
    storage.save('backend_domain', meta_key, {'fresh_until': time.time() - 1})
    cached = caching.fetch_tasks(AREA, credential={'token': 'valid', 'user_id': 'u@example.com'})

    assert cached == [dict(_TASK)]
    assert inner.refresh_attempted.wait(timeout=1.0)
    warnings = caching.consume_diagnostics(user_id='u@example.com')
    assert warnings[-1]['code'] == 'tasks_stale_invalid_query_config'
    assert warnings[-1]['message'] == (
        f'Azure DevOps rejected the configured work-item query for area path "{AREA}", so '
        'cached work items could not be refreshed. An administrator should verify the project, '
        'area-path, and iteration-path configuration.'
    )


def test_remote_backend_error_propagates_when_no_cache(storage):
    """With no cached content, a BackendError must propagate (no silent empty board)."""
    from planner_lib.backend.caching import CachingBackend
    from planner_lib.backend.errors import BackendUnavailableError

    class _ColdOutageBackend:
        is_remote = True

        def fetch_tasks(self, area_path, task_types=None, include_states=None, credential=None, **kwargs):
            raise BackendUnavailableError('connection refused')

        def write_task(self, task_id, updates, credential):
            return {'ok': True, 'updated': 1, 'errors': []}

        def invalidate_cache(self):
            return {'ok': True, 'invalidated': [], 'errors': []}

    caching = CachingBackend(inner=_ColdOutageBackend(), storage=storage)
    with pytest.raises(BackendUnavailableError):
        caching.fetch_tasks(AREA, credential={'token': 'valid', 'user_id': 'u@example.com'})


def test_non_task_method_survives_outage_after_soft_expiry(storage):
    """Regression: fetch_history (and any other cached fetch_*) must not hard-fail
    once its TTL lapses while the remote backend is unreachable.

    Before generalizing the soft-freshness sidecar beyond fetch_tasks, methods
    like fetch_history/fetch_teams/fetch_plans/fetch_markers/fetch_iterations
    were persisted with a real diskcache `expire=`, so diskcache would delete
    the row outright at TTL and the next read would propagate whatever error
    the remote backend raised — instead of serving the still-useful stale data.
    """
    import time
    import threading
    from planner_lib.backend.caching import CachingBackend
    from planner_lib.backend.errors import BackendUnavailableError

    class _OutageBackend:
        is_remote = True

        def __init__(self):
            self.calls = 0
            self.refresh_attempted = threading.Event()

        def fetch_history(self, work_item_id, credential=None, **kwargs):
            self.calls += 1
            if self.calls == 1:
                return [{'rev': 1}]
            self.refresh_attempted.set()
            raise BackendUnavailableError('connection timed out')

        def invalidate_cache(self):
            return {'ok': True, 'invalidated': [], 'errors': []}

    inner = _OutageBackend()
    caching = CachingBackend(inner=inner, storage=storage)

    warm = caching.fetch_history(42, credential=CRED)
    assert warm == [{'rev': 1}]

    meta_key = caching._meta_key('fetch_history', (42,), {})
    storage.save('backend_domain', meta_key, {'fresh_until': time.time() - 1})

    again = caching.fetch_history(42, credential=CRED)
    assert again == [{'rev': 1}]  # stale data kept, not an exception
    assert inner.refresh_attempted.wait(timeout=1.0)
    assert inner.calls == 2

    warnings = caching.consume_diagnostics(user_id=CRED['user_id'])
    assert warnings
    assert warnings[-1]['code'] == 'tasks_stale_api_outage'


def test_empty_refresh_keeps_existing_task_content(storage):
    """A refresh that returns no data must not overwrite populated cache content."""
    import time
    from planner_lib.backend.caching import CachingBackend

    import threading

    class _FlakyBackend:
        is_remote = True

        def __init__(self):
            self.calls = 0
            self.refresh_attempted = threading.Event()

        def fetch_tasks(self, area_path, task_types=None, include_states=None, credential=None, **kwargs):
            self.calls += 1
            # First call returns data; later refreshes return nothing.
            if self.calls > 1:
                self.refresh_attempted.set()
            return [dict(_TASK)] if self.calls == 1 else []

        def write_task(self, task_id, updates, credential):
            return {'ok': True, 'updated': 1, 'errors': []}

        def invalidate_cache(self):
            return {'ok': True, 'invalidated': [], 'errors': []}

    inner = _FlakyBackend()
    caching = CachingBackend(inner=inner, storage=storage)

    warm = caching.fetch_tasks(AREA, credential={'token': 'valid', 'user_id': 'u@example.com'})
    assert len(warm) == 1

    meta_key = caching._meta_key('fetch_tasks', (AREA,), {})
    storage.save('backend_domain', meta_key, {'fresh_until': time.time() - 1})

    again = caching.fetch_tasks(AREA, credential={'token': 'valid', 'user_id': 'u@example.com'})
    assert len(again) == 1  # kept existing content, not the empty refresh
    assert inner.refresh_attempted.wait(timeout=1.0)
    assert inner.calls == 2

    warnings = caching.consume_diagnostics(user_id='u@example.com')
    assert warnings
    assert warnings[-1]['code'] == 'tasks_stale_no_data'
    assert warnings[-1]['message'] == (
        'Azure DevOps returned no work items while refreshing the cached work items. '
        'Latest cached results will be used instead.'
    )


def test_empty_cached_content_does_not_emit_stale_warning(storage):
    """Empty cached snapshots must not trigger stale warnings on empty refresh."""
    import time
    from planner_lib.backend.caching import CachingBackend

    class _AlwaysEmptyBackend:
        is_remote = True

        def __init__(self):
            self.calls = 0

        def fetch_tasks(self, area_path, task_types=None, include_states=None, credential=None, **kwargs):
            self.calls += 1
            return []

        def write_task(self, task_id, updates, credential):
            return {'ok': True, 'updated': 1, 'errors': []}

        def invalidate_cache(self):
            return {'ok': True, 'invalidated': [], 'errors': []}

    inner = _AlwaysEmptyBackend()
    caching = CachingBackend(inner=inner, storage=storage)

    first = caching.fetch_tasks(AREA, credential={'token': 'valid', 'user_id': 'u@example.com'})
    assert first == []

    meta_key = caching._meta_key('fetch_tasks', (AREA,), {})
    storage.save('backend_domain', meta_key, {'fresh_until': time.time() - 1})

    second = caching.fetch_tasks(AREA, credential={'token': 'valid', 'user_id': 'u@example.com'})
    assert second == []
    assert inner.calls == 2
    assert caching.consume_diagnostics(user_id='u@example.com') == []


def test_non_remote_backend_does_not_serve_stale_on_failure(storage):
    """Local/static/mock backends (is_remote falsy) must NOT mask errors with stale data.

    The stale-on-failure resilience is scoped to the live ADO backend only;
    a local backend's exception should propagate instead of serving cached data.
    """
    import time
    from planner_lib.backend.caching import CachingBackend

    class _LocalBackend:
        # No is_remote attribute → treated as local.
        def __init__(self):
            self.calls = 0

        def fetch_tasks(self, area_path, task_types=None, include_states=None, credential=None, **kwargs):
            self.calls += 1
            if self.calls == 1:
                return [dict(_TASK)]
            raise RuntimeError('transient local error')

        def write_task(self, task_id, updates, credential):
            return {'ok': True, 'updated': 1, 'errors': []}

        def invalidate_cache(self):
            return {'ok': True, 'invalidated': [], 'errors': []}

    inner = _LocalBackend()
    caching = CachingBackend(inner=inner, storage=storage)

    warm = caching.fetch_tasks(AREA, credential={'token': 'x', 'user_id': 'u@example.com'})
    assert len(warm) == 1

    # Soft-expire so the next read attempts a refresh.
    meta_key = caching._meta_key('fetch_tasks', (AREA,), {})
    storage.save('backend_domain', meta_key, {'fresh_until': time.time() - 1})

    with pytest.raises(RuntimeError):
        caching.fetch_tasks(AREA, credential={'token': 'x', 'user_id': 'u@example.com'})

    # No stale warning should have been queued for a local backend.
    assert caching.consume_diagnostics(user_id='u@example.com') == []


def test_soft_expired_remote_cache_returns_immediately_and_refreshes_in_background(storage):
    """Soft-expired remote entries are returned immediately while refresh runs async."""
    import threading
    import time
    from concurrent.futures import ThreadPoolExecutor
    from planner_lib.backend.caching import CachingBackend

    class _SlowRefreshBackend:
        is_remote = True

        def __init__(self):
            self.calls = 0
            self.release_refresh = threading.Event()
            self.refresh_entered = threading.Event()

        def fetch_tasks(self, area_path, task_types=None, include_states=None, credential=None, **kwargs):
            self.calls += 1
            if self.calls == 1:
                return [dict(_TASK, title='warm')]
            self.refresh_entered.set()
            self.release_refresh.wait(timeout=5.0)
            return [dict(_TASK, title='fresh')]

        def write_task(self, task_id, updates, credential):
            return {'ok': True, 'updated': 1, 'errors': []}

        def invalidate_cache(self):
            return {'ok': True, 'invalidated': [], 'errors': []}

    inner = _SlowRefreshBackend()
    caching = CachingBackend(inner=inner, storage=storage)

    warm = caching.fetch_tasks(AREA, credential={'token': 'valid', 'user_id': 'u@example.com'})
    assert warm[0]['title'] == 'warm'

    meta_key = caching._meta_key('fetch_tasks', (AREA,), {})
    storage.save('backend_domain', meta_key, {'fresh_until': time.time() - 1})

    with ThreadPoolExecutor(max_workers=1) as callers:
        pending = callers.submit(
            caching.fetch_tasks, AREA, credential={'token': 'valid', 'user_id': 'u@example.com'},
        )
        try:
            stale = pending.result(timeout=2.0)
            assert stale[0]['title'] == 'warm'
            assert inner.refresh_entered.wait(timeout=2.0)
            assert not inner.release_refresh.is_set()
        finally:
            inner.release_refresh.set()

    # Allow the background refresh to publish the updated snapshot.
    for _ in range(30):
        latest = caching.fetch_tasks(AREA, credential={'token': 'valid', 'user_id': 'u@example.com'})
        if latest and latest[0].get('title') == 'fresh':
            break
        time.sleep(0.02)
    else:
        pytest.fail('background refresh did not publish fresh task snapshot in time')


# ---------------------------------------------------------------------------
# write_task: write-through patch
# ---------------------------------------------------------------------------

def test_write_task_patches_cache_keeps_it_hot(caching, inner):
    """After write_task the cache is still hot — inner must NOT be called again."""
    caching.fetch_tasks(AREA)
    assert len(inner.fetch_tasks_calls) == 1

    caching.write_task(1, {'state': 'Closed'}, CRED)

    # Cache should still be a HIT; inner must not be called a second time.
    tasks = caching.fetch_tasks(AREA)
    assert len(inner.fetch_tasks_calls) == 1

    # The patched task must carry the new state.
    patched = next((t for t in tasks if str(t.get('id')) == '1'), None)
    assert patched is not None
    assert patched['state'] == 'Closed'


@pytest.mark.parametrize('field,value', [
    ('start', '2026-05-19'),
    ('end', '2026-05-20'),
    ('state', 'Active'),
    ('iterationPath', 'MyOrg\\TeamA\\Sprint 1'),
])
def test_write_task_clears_anchor_presentation_after_semantic_edit(caching, storage, field, value):
    key = 'fetch_task_context__anchor'
    task = {
        **_TASK,
        'iterationPath': 'MyOrg',
        'presentation': {
            'renderType': 'anchor', 'date': '2026-05-19',
            'reason': 'completed-unscheduled', 'sourceState': 'Closed',
        },
    }
    storage.save('backend_domain', key, [task])

    result = caching.write_task('1', {field: value}, CRED)

    assert result['ok']
    cached, = storage.load('backend_domain', key)
    assert field in cached
    assert 'presentation' not in cached


def test_write_task_result_is_forwarded(caching, inner):
    result = caching.write_task(1, {'state': 'Closed'}, CRED)
    assert result['ok'] is True
    assert result['updated'] == 1


def test_write_task_error_propagates(inner, storage):
    """CachingBackend does not swallow exceptions from the inner backend."""
    from planner_lib.backend.caching import CachingBackend
    bad_inner = FakeBackend(raise_on_write=True)
    caching = CachingBackend(inner=bad_inner, storage=storage)
    with pytest.raises(RuntimeError):
        caching.write_task(1, {}, CRED)


def test_write_task_failed_result_does_not_patch(caching, inner):
    """When write_task returns ok=False, cache entries are left unchanged."""
    caching.fetch_tasks(AREA)
    assert len(inner.fetch_tasks_calls) == 1

    # Make write_task return a failure
    def _fail(*a, **kw):
        return {'ok': False, 'updated': 0, 'errors': ['permission denied']}
    inner.write_task = _fail

    caching.write_task(1, {'state': 'Closed'}, CRED)

    # Cache should still be hot and unmodified
    tasks = caching.fetch_tasks(AREA)
    assert len(inner.fetch_tasks_calls) == 1
    original = next((t for t in tasks if str(t.get('id')) == '1'), None)
    assert original is not None
    assert original['state'] == 'Active'  # unchanged


# ---------------------------------------------------------------------------
# invalidate_cache
# ---------------------------------------------------------------------------

def test_invalidate_cache_forces_fresh_fetch(caching, inner):
    caching.fetch_tasks(AREA)
    assert len(inner.fetch_tasks_calls) == 1

    caching.invalidate_cache()

    caching.fetch_tasks(AREA)
    assert len(inner.fetch_tasks_calls) == 2


def test_invalidate_cache_returns_expected_shape(caching):
    result = caching.invalidate_cache()
    assert 'ok' in result
    assert 'invalidated' in result
    assert 'errors' in result


# ---------------------------------------------------------------------------
# Delegation of non-task methods
# ---------------------------------------------------------------------------

def test_fetch_history_delegated_to_inner(caching, inner):
    from planner_lib.domain.history import DomainHistoryEntry
    entry = DomainHistoryEntry(field='start', value='2026-01-01',
                               changed_at='2026-01-02', changed_by='u')
    inner.set_history(42, [entry])
    result = caching.fetch_history(42)
    assert len(result) == 1
    assert result[0]['field'] == 'start'


def test_fetch_teams_delegated_to_inner(caching, inner):
    inner.set_teams('ProjectX', [{'id': 't1', 'name': 'Arch'}])
    result = caching.fetch_teams('ProjectX')
    assert result == [{'id': 't1', 'name': 'Arch'}]


def test_fetch_plans_cached_until_invalidation(caching, inner):
    inner.set_plans('ProjectX', [{'id': 'p1', 'name': 'Q1'}])
    first = caching.fetch_plans('ProjectX')

    inner.set_plans('ProjectX', [{'id': 'p2', 'name': 'Q2'}])
    cached = caching.fetch_plans('ProjectX')

    assert first == [{'id': 'p1', 'name': 'Q1'}]
    assert cached == first

    caching.invalidate_cache()

    assert caching.fetch_plans('ProjectX') == [{'id': 'p2', 'name': 'Q2'}]


def test_fetch_markers_delegated_to_inner(caching, inner):
    result = caching.fetch_markers(AREA)
    assert isinstance(result, list)


def test_fetch_iterations_delegated_to_inner(caching, inner):
    inner.set_iterations('ProjectX', {'S1': {'startDate': '2026-01-01'}})
    result = caching.fetch_iterations('ProjectX')
    assert 'S1' in result


# ---------------------------------------------------------------------------
# fetch_projects / fetch_project_map bypass the TTL cache entirely.
#
# Project config already lives in diskcache via ConfigBackend (or, for the
# ADO backend, is enriched per-call from the separate metadata-service cache),
# so it is always fresh. The TTL layer exists to reduce load on the remote
# ADO API; wrapping already-cached config data in a second, indefinitely-TTL
# cache only adds staleness risk with no benefit.
# ---------------------------------------------------------------------------

def test_fetch_projects_always_calls_inner_not_cached(caching, inner):
    caching.fetch_projects()
    caching.fetch_projects()
    assert inner.fetch_projects_calls == 2


def test_fetch_project_map_always_calls_inner_not_cached(caching, inner):
    caching.fetch_project_map()
    caching.fetch_project_map()
    assert inner.fetch_project_map_calls == 2
