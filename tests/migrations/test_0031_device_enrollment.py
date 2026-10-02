from planner_lib.migrations.revisions import upgrade_31
from planner_lib.storage.diskcache_backend import DiskCacheStorage


def test_migration_preserves_existing_accounts_and_enrollment(tmp_path):
    storage = DiskCacheStorage(tmp_path / 'data/cache')
    original = {'account_id': 'account-1', 'email': 'admin@example.com',
                'permissions': ['admin'], 'pat': 'encrypted-pat'}
    storage.save('accounts', 'admin@example.com', original)
    assert not storage.exists('account_auth', 'account-1')
    upgrade_31(storage)
    assert storage.load('accounts', 'admin@example.com') == original
    assert storage.load('account_auth', 'account-1') == {'enrolled': False}
    enrolled = {'enrolled': True, 'name': 'Admin User', 'devices': {}}
    storage.save('account_auth', 'account-1', enrolled)
    upgrade_31(storage)
    assert storage.load('account_auth', 'account-1') == enrolled
    storage.close()