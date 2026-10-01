"""Move persisted user-data ownership from email addresses to account IDs."""

from pathlib import Path
from uuid import UUID, uuid4


MIGRATION_ID = '0032.account-id-ownership'


def upgrade(dry_run=False, backup=False):
    from planner_lib.storage.diskcache_backend import DiskCacheStorage

    cache_dir = Path(__file__).resolve().parents[2] / 'data' / 'cache'
    if not cache_dir.exists():
        return
    storage = DiskCacheStorage(cache_dir)
    try:
        with storage._cache.transact():
            owners = {
                email: storage.load('accounts', email)['account_id']
                for email in storage.list_keys('accounts')
            }
            for namespace, register_key in (
                ('views', 'view_register'), ('scenarios', 'scenario_register'),
            ):
                register = storage.load(namespace, register_key) if storage.exists(namespace, register_key) else {}
                migrated_register = dict(register)
                keys = set(storage.list_keys(namespace)) | set(register)
                keys.discard(register_key)
                changed = False
                for key in sorted(keys):
                    if key in register:
                        metadata = register[key]
                        owner, item_id = metadata['user'], metadata['id']
                        if key != owner + '_' + item_id:
                            raise ValueError(f'Invalid user-data register key: {key}')
                    else:
                        owner, separator, item_id = key.partition('_')
                        if not separator:
                            raise ValueError(f'Invalid user-data key: {key}')
                        try:
                            UUID(owner)
                        except ValueError:
                            owner, _, item_id = key.rpartition('_')
                            for email in owners:
                                if key.startswith(email + '_'):
                                    owner, item_id = email, key[len(email) + 1:]
                                    break
                    if owner not in owners:
                        try:
                            account_id = str(UUID(owner))
                        except ValueError:
                            account_id = str(uuid4())
                        owners[owner] = account_id
                    account_id = owners[owner]
                    new_key = account_id + '_' + item_id
                    if new_key == key:
                        continue
                    if new_key in keys or new_key in migrated_register:
                        raise ValueError(f'User-data ownership collision: {new_key}')
                    changed = True
                    if key in register:
                        del migrated_register[key]
                        migrated_register[new_key] = {**register[key], 'user': account_id}
                    if dry_run:
                        continue
                    if storage.exists(namespace, key):
                        payload = storage.load(namespace, key)
                        if backup:
                            storage.save(namespace + '_account_id_backup', key, payload)
                        storage.save(namespace, new_key, payload)
                        storage.delete(namespace, key)
                if changed and not dry_run:
                    if backup:
                        storage.save(namespace + '_account_id_backup', register_key, register)
                    storage.save(namespace, register_key, migrated_register)
            if not dry_run:
                for key in list(storage.list_keys('auth_sessions')):
                    try:
                        session = storage.load('auth_sessions', key)
                    except KeyError:
                        continue
                    if 'account_id' not in session:
                        storage.delete('auth_sessions', key)
        print('[DRY RUN] Account-ID ownership migration checked.' if dry_run
              else '[OK] User data now belongs to account IDs.')
    finally:
        storage.close()