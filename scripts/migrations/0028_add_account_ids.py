"""Migration: add stable anonymous IDs to account records."""

import sys
from pathlib import Path
from uuid import UUID, uuid4


MIGRATION_ID = '0028.add-account-ids'

_root = Path(__file__).resolve().parents[2]
if str(_root) not in sys.path:
    sys.path.insert(0, str(_root))


def upgrade(dry_run=False, backup=False):
    """Backfill a unique UUID account_id on every persisted account."""
    from planner_lib.storage.diskcache_backend import DiskCacheStorage

    cache_dir = _root / 'data' / 'cache'
    if not cache_dir.exists():
        print(f'[INFO] {cache_dir} does not exist; nothing to migrate.')
        return

    storage = DiskCacheStorage(str(cache_dir))
    try:
        account_keys = sorted(storage.list_keys('accounts'))
        existing_ids = set()
        missing_keys = []
        for email in account_keys:
            record = storage.load('accounts', email)
            if not isinstance(record, dict):
                raise ValueError(f'Account record must be an object: {email}')
            account_id = record.get('account_id')
            if account_id is None:
                missing_keys.append(email)
                continue
            canonical_id = str(UUID(account_id))
            if canonical_id != account_id:
                raise ValueError(f'Account ID must be a canonical UUID: {email}')
            if account_id in existing_ids:
                raise ValueError(f'Duplicate account ID: {account_id}')
            existing_ids.add(account_id)

        if dry_run:
            print(f'[DRY RUN] Would assign account IDs to {len(missing_keys)} account(s).')
            return

        for email in missing_keys:
            record = dict(storage.load('accounts', email))
            if backup:
                storage.save('accounts_pre_account_id_backup', email, record)
            account_id = str(uuid4())
            while account_id in existing_ids:
                account_id = str(uuid4())
            existing_ids.add(account_id)
            record['account_id'] = account_id
            storage.save('accounts', email, record)

        print(f'[OK] Assigned account IDs to {len(missing_keys)} account(s).')
    finally:
        storage.close()


def downgrade():
    """No-op: account IDs are now part of the persisted account contract."""
    pass