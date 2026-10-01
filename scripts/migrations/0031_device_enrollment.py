"""Mark existing accounts for one-time trusted device enrollment."""

from pathlib import Path

MIGRATION_ID = '0031.device-enrollment'


def upgrade(dry_run=False, backup=False):
    from planner_lib.storage.diskcache_backend import DiskCacheStorage

    root = Path(__file__).resolve().parents[2]
    cache_dir = root / 'data' / 'cache'
    if not cache_dir.exists():
        return
    storage = DiskCacheStorage(cache_dir)
    try:
        with storage._cache.transact():
            for email in storage.list_keys('accounts'):
                account = storage.load('accounts', email)
                account_id = account['account_id']
                if not storage.exists('account_auth', account_id) and not dry_run:
                    storage.save('account_auth', account_id, {'enrolled': False})
        print('[OK] Accounts prepared for trusted first-use device enrollment.')
    finally:
        storage.close()