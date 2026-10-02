"""Revision 26 discards disposable remote records from candidate storage."""

import pytest

from planner_lib.migrations.revisions import upgrade_26
from planner_lib.storage.diskcache_backend import DiskCacheStorage


@pytest.fixture
def candidate(tmp_path):
    storage = DiskCacheStorage(tmp_path / 'cache')
    storage.save('backend_domain', 'fetch_history__abc', [{'rev': 1}])
    storage.save('backend_domain', 'taskmeta__abc', {'fresh_until': 123.0})
    storage.save('config', 'projects', {'project_map': []})
    yield storage
    storage.close()


def test_upgrade_discards_remote_records_and_preserves_config(candidate):
    upgrade_26(candidate)
    assert list(candidate.list_keys('backend_domain')) == []
    assert candidate.load('config', 'projects') == {'project_map': []}
    assert set(candidate._cache.iterkeys()) == {candidate._composite_key('config', 'projects')}


def test_upgrade_is_idempotent(candidate):
    upgrade_26(candidate)
    upgrade_26(candidate)
    assert list(candidate.list_keys('backend_domain')) == []
    assert candidate.load('config', 'projects') == {'project_map': []}


def test_upgrade_handles_physically_present_expired_records(candidate):
    key = candidate._composite_key('backend_domain', 'expired')
    candidate._cache.set(key, {'stale': True})
    candidate._cache.touch(key, expire=-1)
    assert key in set(candidate._cache.iterkeys())
    upgrade_26(candidate)
    assert not candidate.exists('backend_domain', 'expired')
    assert candidate.load('config', 'projects') == {'project_map': []}


def test_empty_candidate_is_a_noop(tmp_path):
    storage = DiskCacheStorage(tmp_path / 'cache')
    try:
        upgrade_26(storage)
        assert list(storage._cache.iterkeys()) == []
    finally:
        storage.close()
