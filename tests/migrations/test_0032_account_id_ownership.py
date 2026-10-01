import importlib.util
from pathlib import Path
from uuid import UUID

import pytest

from planner_lib.storage.diskcache_backend import DiskCacheStorage


ACCOUNT_ID = '11111111-1111-4111-8111-111111111111'


def load_migration(tmp_path):
    path = Path(__file__).resolve().parents[2] / 'scripts/migrations/0032_account_id_ownership.py'
    spec = importlib.util.spec_from_file_location('account_id_ownership_migration', path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    migration.__file__ = str(tmp_path / 'scripts/migrations/0032_account_id_ownership.py')
    return migration


@pytest.mark.parametrize('namespace, register_key', [
    ('views', 'view_register'), ('scenarios', 'scenario_register'),
])
def test_migration_preserves_data_and_detaches_orphaned_email_owners(
    tmp_path, namespace, register_key,
):
    migration = load_migration(tmp_path)
    storage = DiskCacheStorage(tmp_path / 'data/cache')
    try:
        storage.save('accounts', 'owner@example.com', {'account_id': ACCOUNT_ID})
        original_key = 'owner@example.com_item_with_underscores'
        payload = {'name': 'Saved data', 'pluginData': {'notes': 'private'}}
        register = {
            original_key: {'id': 'item_with_underscores', 'user': 'owner@example.com', 'name': 'Saved data'},
            'deleted@example.com_orphan': {'id': 'orphan', 'user': 'deleted@example.com'},
        }
        storage.save(namespace, original_key, payload)
        storage.save(namespace, 'deleted@example.com_orphan', {'name': 'Orphan data'})
        storage.save(namespace, 'owner@example.com_unregistered', {'name': 'Unregistered data'})
        storage.save(namespace, 'owner@example.com_unregistered_with_underscores', payload)
        storage.save(namespace, register_key, register)
        storage.save('auth_sessions', 'legacy', {'email': 'owner@example.com'})
        storage.save('auth_sessions', 'current', {'account_id': ACCOUNT_ID})

        migration.upgrade(dry_run=True)
        assert storage.load(namespace, register_key) == register
        assert storage.exists('auth_sessions', 'legacy')

        migration.upgrade(backup=True)
        migrated_key = ACCOUNT_ID + '_item_with_underscores'
        assert not storage.exists(namespace, original_key)
        assert storage.load(namespace, migrated_key) == payload
        assert storage.exists(namespace, ACCOUNT_ID + '_unregistered')
        migrated_register = storage.load(namespace, register_key)
        assert migrated_register[migrated_key]['user'] == ACCOUNT_ID
        orphan = next(record for record in migrated_register.values() if record['id'] == 'orphan')
        assert str(UUID(orphan['user'])) == orphan['user']
        assert orphan['user'] != ACCOUNT_ID
        assert not storage.exists(namespace, 'deleted@example.com_orphan')
        assert storage.load(namespace + '_account_id_backup', original_key) == payload
        assert not storage.exists('auth_sessions', 'legacy')
        assert storage.exists('auth_sessions', 'current')

        migration.upgrade()
        assert storage.load(namespace, register_key) == migrated_register
        assert storage.load(namespace, migrated_key) == payload
        assert storage.load(namespace, ACCOUNT_ID + '_unregistered_with_underscores') == payload
    finally:
        storage.close()


def test_unregistered_items_with_underscores_are_idempotent(tmp_path):
    migration = load_migration(tmp_path)
    storage = DiskCacheStorage(tmp_path / 'data/cache')
    try:
        storage.save('accounts', 'owner@example.com', {'account_id': ACCOUNT_ID})
        storage.save('views', 'owner@example.com_draft_with_underscores', {'name': 'Draft'})
        migration.upgrade()
        migrated_key = ACCOUNT_ID + '_draft_with_underscores'
        assert storage.load('views', migrated_key) == {'name': 'Draft'}
        migration.upgrade()
        assert storage.load('views', migrated_key) == {'name': 'Draft'}
        assert set(storage.list_keys('views')) == {'view_register', migrated_key}
    finally:
        storage.close()


def test_migration_collision_rolls_back(tmp_path):
    migration = load_migration(tmp_path)
    storage = DiskCacheStorage(tmp_path / 'data/cache')
    try:
        storage.save('accounts', 'owner@example.com', {'account_id': ACCOUNT_ID})
        storage.save('views', 'owner@example.com_item', {'name': 'Legacy'})
        storage.save('views', ACCOUNT_ID + '_item', {'name': 'Existing'})
        with pytest.raises(ValueError, match='collision'):
            migration.upgrade()
        assert storage.load('views', 'owner@example.com_item') == {'name': 'Legacy'}
        assert storage.load('views', ACCOUNT_ID + '_item') == {'name': 'Existing'}
    finally:
        storage.close()