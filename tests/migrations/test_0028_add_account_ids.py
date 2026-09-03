import importlib.util
from pathlib import Path
from uuid import UUID

from planner_lib.storage.diskcache_backend import DiskCacheStorage


MIGRATION_PATH = (
    Path(__file__).resolve().parents[2] / 'scripts' / 'migrations' / '0028_add_account_ids.py'
)


def _load_migration(tmp_path):
    spec = importlib.util.spec_from_file_location('migration_0028', MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module._root = tmp_path
    return module


def test_upgrade_assigns_stable_unique_account_ids(tmp_path):
    storage = DiskCacheStorage(str(tmp_path / 'data' / 'cache'))
    storage.save('accounts', 'first@example.com', {'email': 'first@example.com', 'permissions': []})
    storage.save('accounts', 'second@example.com', {'email': 'second@example.com', 'permissions': ['admin']})
    storage.close()
    migration = _load_migration(tmp_path)

    migration.upgrade()

    storage = DiskCacheStorage(str(tmp_path / 'data' / 'cache'))
    first_id = storage.load('accounts', 'first@example.com')['account_id']
    second_id = storage.load('accounts', 'second@example.com')['account_id']
    UUID(first_id)
    UUID(second_id)
    assert first_id != second_id

    migration.upgrade()
    assert storage.load('accounts', 'first@example.com')['account_id'] == first_id
    assert storage.load('accounts', 'second@example.com')['account_id'] == second_id
    storage.close()


def test_dry_run_does_not_assign_account_ids(tmp_path):
    storage = DiskCacheStorage(str(tmp_path / 'data' / 'cache'))
    storage.save('accounts', 'user@example.com', {'email': 'user@example.com', 'permissions': []})
    storage.close()
    migration = _load_migration(tmp_path)

    migration.upgrade(dry_run=True)

    storage = DiskCacheStorage(str(tmp_path / 'data' / 'cache'))
    assert 'account_id' not in storage.load('accounts', 'user@example.com')
    storage.close()