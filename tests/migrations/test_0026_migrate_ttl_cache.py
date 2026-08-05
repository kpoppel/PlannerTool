"""Tests for migration 0026: move the CachingBackend TTL cache into data/remote_cache.

Loads the migration module directly from its file path (matching the pattern
used by other migration tests) and points its module-level ``_root`` at a
temporary directory so real repository data is never touched.
"""
import importlib.util
from pathlib import Path

import pytest

from planner_lib.storage.diskcache_backend import DiskCacheStorage

MIGRATION_PATH = (
    Path(__file__).resolve().parents[2] / 'scripts' / 'migrations' / '0026_migrate_ttl_cache.py'
)


def _load_migration(tmp_path):
    spec = importlib.util.spec_from_file_location('migration_0026', MIGRATION_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod._root = tmp_path
    return mod


@pytest.fixture
def mod(tmp_path):
    return _load_migration(tmp_path)


def _seed_old_cache(tmp_path):
    old = DiskCacheStorage(str(tmp_path / 'data' / 'cache'))
    old.save('backend_domain', 'fetch_history__abc', [{'rev': 1}])
    old.save('backend_domain', 'taskmeta__abc', {'fresh_until': 123.0})
    # Authoritative data living alongside the legacy cache entries — must survive.
    old.save('config', 'projects', {'project_map': []})
    old.close()


def test_dry_run_moves_nothing(tmp_path, mod):
    _seed_old_cache(tmp_path)

    mod.upgrade(dry_run=True)

    old = DiskCacheStorage(str(tmp_path / 'data' / 'cache'))
    assert set(old.list_keys('backend_domain')) == {'fetch_history__abc', 'taskmeta__abc'}
    old.close()
    assert not (tmp_path / 'data' / 'remote_cache').exists()


def test_upgrade_moves_backend_domain_keys_and_preserves_config(tmp_path, mod):
    _seed_old_cache(tmp_path)

    mod.upgrade(dry_run=False, backup=False)

    old = DiskCacheStorage(str(tmp_path / 'data' / 'cache'))
    assert list(old.list_keys('backend_domain')) == []
    assert old.load('config', 'projects') == {'project_map': []}
    old.close()

    new = DiskCacheStorage(str(tmp_path / 'data' / 'remote_cache'))
    assert new.load('backend_domain', 'fetch_history__abc') == [{'rev': 1}]
    assert new.load('backend_domain', 'taskmeta__abc') == {'fresh_until': 123.0}
    new.close()


def test_upgrade_is_idempotent(tmp_path, mod):
    _seed_old_cache(tmp_path)

    mod.upgrade(dry_run=False, backup=False)
    # Second run should find nothing left to migrate and not raise.
    mod.upgrade(dry_run=False, backup=False)

    new = DiskCacheStorage(str(tmp_path / 'data' / 'remote_cache'))
    assert new.load('backend_domain', 'fetch_history__abc') == [{'rev': 1}]
    new.close()


def test_backup_keeps_old_entries_in_place(tmp_path, mod):
    _seed_old_cache(tmp_path)

    mod.upgrade(dry_run=False, backup=True)

    old = DiskCacheStorage(str(tmp_path / 'data' / 'cache'))
    assert set(old.list_keys('backend_domain')) == {'fetch_history__abc', 'taskmeta__abc'}
    old.close()

    new = DiskCacheStorage(str(tmp_path / 'data' / 'remote_cache'))
    assert new.load('backend_domain', 'fetch_history__abc') == [{'rev': 1}]
    new.close()


def test_existing_entry_in_new_store_wins_and_old_copy_is_dropped(tmp_path, mod):
    _seed_old_cache(tmp_path)
    new = DiskCacheStorage(str(tmp_path / 'data' / 'remote_cache'))
    new.save('backend_domain', 'fetch_history__abc', [{'rev': 99, 'from': 'live traffic'}])
    new.close()

    mod.upgrade(dry_run=False, backup=False)

    new = DiskCacheStorage(str(tmp_path / 'data' / 'remote_cache'))
    assert new.load('backend_domain', 'fetch_history__abc') == [{'rev': 99, 'from': 'live traffic'}]
    new.close()

    old = DiskCacheStorage(str(tmp_path / 'data' / 'cache'))
    assert list(old.list_keys('backend_domain')) == []
    old.close()


def test_no_cache_dir_is_a_noop(tmp_path, mod):
    # No data/cache directory at all (fresh install) — must not raise.
    mod.upgrade(dry_run=False, backup=False)
    assert not (tmp_path / 'data' / 'remote_cache').exists()
