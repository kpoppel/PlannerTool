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


def test_invalid_pat_serves_stale_tasks_snapshot_and_records_warning(storage):
    """On a soft-expired entry, an auth failure keeps and serves existing content.

    No shadow snapshot is used: the single cached entry persists and is served
    when the live refresh raises a BackendAuthError.
    """
    import time
    from planner_lib.backend.caching import CachingBackend
    from planner_lib.backend.errors import BackendAuthError

    class _CredentialSensitiveBackend:
        is_remote = True

        def __init__(self):
            self.fetch_tasks_calls = []

        def fetch_tasks(self, area_path, task_types=None, include_states=None, credential=None, **kwargs):
            self.fetch_tasks_calls.append({
                'area_path': area_path,
                'credential': credential,
            })
            token = (credential or {}).get('token')
            if token == 'expired-token':
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
    assert len(inner.fetch_tasks_calls) == 2

    warnings = caching.consume_warnings(user_id='u2@example.com')
    assert warnings
    assert warnings[-1]['code'] == 'tasks_stale_invalid_pat'


def test_api_outage_serves_stale_tasks_and_records_outage_warning(storage):
    """A BackendUnavailableError on refresh keeps cached content and flags an outage."""
    import time
    from planner_lib.backend.caching import CachingBackend
    from planner_lib.backend.errors import BackendUnavailableError

    class _OutageBackend:
        is_remote = True

        def __init__(self):
            self.calls = 0

        def fetch_tasks(self, area_path, task_types=None, include_states=None, credential=None, **kwargs):
            self.calls += 1
            if self.calls == 1:
                return [dict(_TASK)]
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
    assert inner.calls == 2

    warnings = caching.consume_warnings(user_id='u@example.com')
    assert warnings
    assert warnings[-1]['code'] == 'tasks_stale_api_outage'


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


def test_empty_refresh_keeps_existing_task_content(storage):
    """A refresh that returns no data must not overwrite populated cache content."""
    import time
    from planner_lib.backend.caching import CachingBackend

    class _FlakyBackend:
        is_remote = True

        def __init__(self):
            self.calls = 0

        def fetch_tasks(self, area_path, task_types=None, include_states=None, credential=None, **kwargs):
            self.calls += 1
            # First call returns data; later refreshes return nothing.
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
    assert inner.calls == 2

    warnings = caching.consume_warnings(user_id='u@example.com')
    assert warnings
    assert warnings[-1]['code'] == 'tasks_stale_no_data'


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
    assert caching.consume_warnings(user_id='u@example.com') == []


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
    assert caching.consume_warnings(user_id='u@example.com') == []


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


def test_fetch_plans_delegated_to_inner(caching, inner):
    inner.set_plans('ProjectX', [{'id': 'p1', 'name': 'Q1'}])
    result = caching.fetch_plans('ProjectX')
    assert result == [{'id': 'p1', 'name': 'Q1'}]


def test_fetch_markers_delegated_to_inner(caching, inner):
    result = caching.fetch_markers(AREA)
    assert isinstance(result, list)


def test_fetch_iterations_delegated_to_inner(caching, inner):
    inner.set_iterations('ProjectX', {'S1': {'startDate': '2026-01-01'}})
    result = caching.fetch_iterations('ProjectX')
    assert 'S1' in result
