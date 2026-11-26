import pytest

from planner_lib.migrations import revisions
from planner_lib.migrations.contracts import (
    MIGRATION_IDS, NO_PAT_REVISION, TARGET_REVISION, SchemaError, schema_state)
from planner_lib.migrations.coordinator import Database
from planner_lib.session.policy import initial_authentication, validate_authentication
from planner_lib.storage.memory_backend import MemoryStorage

ACCOUNT_ID = '11111111-1111-4111-8111-111111111111'
ACCOUNT = {'email': 'owner@example.test', 'account_id': ACCOUNT_ID, 'permissions': ['admin']}


def _policy(backend_credentials, active='enrollment'):
    return {'version': 1, 'selected': active, 'active': active,
            'backend_credentials': backend_credentials, 'epoch': 3}


def test_revision_49_is_registered_and_current():
    assert NO_PAT_REVISION == TARGET_REVISION == 49
    assert MIGRATION_IDS[49] == '0049.remove-ado-personal-access-tokens'


def test_upgrade_purges_pats_and_rewrites_pat_policy_to_none():
    storage = MemoryStorage()
    storage.save('accounts', 'owner@example.test', {**ACCOUNT, 'pat': 'encrypted', 'pat_invalid': True})
    storage.save('accounts', 'other@example.test', {
        'email': 'other@example.test', 'account_id': 'other', 'permissions': []})
    storage.save('config', 'authentication', _policy('pat'))
    revisions.upgrade_49(storage)
    assert storage.load('accounts', 'owner@example.test') == ACCOUNT
    assert storage.load('accounts', 'other@example.test') == {
        'email': 'other@example.test', 'account_id': 'other', 'permissions': []}
    assert storage.load('config', 'authentication') == _policy('none')
    revisions.upgrade_49(storage)
    assert storage.load('accounts', 'owner@example.test') == ACCOUNT


def test_upgrade_keeps_delegated_policy():
    storage = MemoryStorage()
    storage.save('config', 'authentication', _policy('delegated', 'entra'))
    revisions.upgrade_49(storage)
    assert storage.load('config', 'authentication') == _policy('delegated', 'entra')


def test_policy_validation_accepts_pat_only_before_revision_49():
    validate_authentication(_policy('pat'), NO_PAT_REVISION - 1)
    validate_authentication(_policy('none'))
    with pytest.raises(SchemaError):
        validate_authentication(_policy('pat'))
    with pytest.raises(SchemaError):
        validate_authentication(_policy('none'), NO_PAT_REVISION - 1)
    assert initial_authentication()['backend_credentials'] == 'none'


def _seed_account(storage, account):
    storage.save('accounts', account['email'], account)
    storage.save('account_auth', account['account_id'], {'enrolled': False})


def test_startup_purges_pats_from_revision_48(tmp_path):
    handle = Database(tmp_path).prepare()
    raw = handle.storage.retained
    raw.save('config', 'authentication', {**raw.load('config', 'authentication'), 'backend_credentials': 'pat'})
    raw.save('system', 'schema_state', schema_state(48, initialized=True))
    _seed_account(raw, {**ACCOUNT, 'pat': 'encrypted', 'pat_invalid': False})
    handle.close()
    upgraded = Database(tmp_path).prepare()
    try:
        assert upgraded.storage.load('accounts', 'owner@example.test') == ACCOUNT
        assert upgraded.storage.load('config', 'authentication')['backend_credentials'] == 'none'
        assert upgraded.storage.load('system', 'schema_state')['schema_revision'] == 49
    finally:
        upgraded.close()


@pytest.mark.parametrize('field', ['pat', 'pat_invalid'])
def test_revision_49_validation_rejects_pat_fields(tmp_path, field):
    handle = Database(tmp_path).prepare()
    _seed_account(handle.storage.retained, {**ACCOUNT, field: 'value'})
    handle.close()
    with pytest.raises(SchemaError, match='personal access tokens'):
        Database(tmp_path).prepare()
