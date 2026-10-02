from uuid import UUID

import pytest

from planner_lib.migrations.contracts import SchemaError
from planner_lib.migrations.revisions import upgrade_28
from planner_lib.storage.diskcache_backend import DiskCacheStorage


def test_upgrade_assigns_stable_unique_account_ids(tmp_path):
    storage = DiskCacheStorage(str(tmp_path / 'data' / 'cache'))
    storage.save('accounts', 'first@example.com', {'email': 'first@example.com', 'permissions': []})
    storage.save('accounts', 'second@example.com', {'email': 'second@example.com', 'permissions': ['admin']})

    upgrade_28(storage)

    first_id = storage.load('accounts', 'first@example.com')['account_id']
    second_id = storage.load('accounts', 'second@example.com')['account_id']
    UUID(first_id)
    UUID(second_id)
    assert first_id != second_id

    upgrade_28(storage)
    assert storage.load('accounts', 'first@example.com')['account_id'] == first_id
    assert storage.load('accounts', 'second@example.com')['account_id'] == second_id
    storage.close()


def test_upgrade_rejects_duplicate_account_ids(tmp_path):
    storage = DiskCacheStorage(str(tmp_path / 'data' / 'cache'))
    try:
        for email in ('first@example.com', 'second@example.com'):
            storage.save('accounts', email, {
                'email': email, 'account_id': '11111111-1111-4111-8111-111111111111',
            })
        with pytest.raises(SchemaError, match='canonical and unique'):
            upgrade_28(storage)
    finally:
        storage.close()