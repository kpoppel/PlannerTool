import importlib.util
from pathlib import Path

from planner_lib.storage.diskcache_backend import DiskCacheStorage


def test_migration_preserves_existing_accounts_and_enrollment(tmp_path):
    path = Path(__file__).resolve().parents[2] / 'scripts/migrations/0031_device_enrollment.py'
    spec = importlib.util.spec_from_file_location('device_enrollment_migration', path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    migration.__file__ = str(tmp_path / 'scripts/migrations/0031_device_enrollment.py')
    storage = DiskCacheStorage(tmp_path / 'data/cache')
    original = {'account_id': 'account-1', 'email': 'admin@example.com',
                'permissions': ['admin'], 'pat': 'encrypted-pat'}
    storage.save('accounts', 'admin@example.com', original)
    migration.upgrade(dry_run=True)
    assert not storage.exists('account_auth', 'account-1')
    migration.upgrade()
    assert storage.load('accounts', 'admin@example.com') == original
    assert storage.load('account_auth', 'account-1') == {'enrolled': False}
    enrolled = {'enrolled': True, 'name': 'Admin User', 'devices': {}}
    storage.save('account_auth', 'account-1', enrolled)
    migration.upgrade()
    assert storage.load('account_auth', 'account-1') == enrolled
    storage.close()