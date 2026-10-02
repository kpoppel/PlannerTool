import pytest
import json
from pathlib import Path

from planner_lib.migrations.contracts import MIGRATION_IDS, SchemaError
from planner_lib.migrations.revisions import BASELINE_IDS, admit_legacy, initialize, validate_candidate
from planner_lib.storage.diskcache_backend import DiskCacheStorage


@pytest.fixture
def legacy(tmp_path):
    storage = DiskCacheStorage(tmp_path / 'cache')
    storage.save('config', 'server_config', {'schema_version': 2, 'feature_flags': {}})
    storage.save('config', 'projects', {'schema_version': 3, 'projects': []})
    storage.save('config', 'people', {'schema_version': 1, 'database': {'people': []}})
    yield storage
    storage.close()


def test_version_without_baseline_evidence_is_rejected(legacy):
    with pytest.raises(SchemaError):
        admit_legacy(legacy, {'current_version': '4.2.1', 'applied': []})
    assert not legacy.exists('system', 'schema_state')


def test_supported_obsolete_markers_admit_baseline(legacy):
    assert admit_legacy(legacy, {'applied': list(BASELINE_IDS)}) == 24


def test_archived_v421_ledger_admits_baseline_despite_stale_version_fields(legacy):
    ledger = json.loads((Path(__file__).parent / 'fixtures' / 'legacy_v421_ledger.json').read_text())
    assert admit_legacy(legacy, ledger) == 24


def test_archived_ledger_cannot_admit_missing_internalized_config(legacy):
    ledger = json.loads((Path(__file__).parent / 'fixtures' / 'legacy_v421_ledger.json').read_text())
    legacy.delete('config', 'server_config')
    with pytest.raises(SchemaError):
        admit_legacy(legacy, ledger)
    assert not legacy.exists('system', 'schema_state')


def test_partial_contiguous_chain_has_deterministic_revision(legacy):
    assert admit_legacy(legacy, {'applied': [*BASELINE_IDS, MIGRATION_IDS[26]]}) == 26


@pytest.mark.parametrize('markers', [
    ['0027.add-missing-group-metadata-to-scenarios'],
    ['0027.add-missing-group-metadata-to-scenarios', MIGRATION_IDS[27]],
    [MIGRATION_IDS[27], '0027.add-missing-group-metadata-to-scenarios'],
])
def test_development_marker_rename_admits_contiguous_chain(legacy, markers):
    assert admit_legacy(legacy, {
        'applied': [*BASELINE_IDS, MIGRATION_IDS[26], *markers],
    }) == 27


@pytest.mark.parametrize('markers', [
    [MIGRATION_IDS[27], MIGRATION_IDS[27]],
    ['0027.add-missing-group-metadata-to-scenarios'] * 2,
    ['0027.unknown-development-migration'],
])
def test_duplicate_or_unknown_development_markers_are_rejected(legacy, markers):
    with pytest.raises(SchemaError):
        admit_legacy(legacy, {'applied': [*BASELINE_IDS, MIGRATION_IDS[26], *markers]})
    assert not legacy.exists('system', 'schema_state')


def test_development_marker_rename_cannot_hide_missing_transition(legacy):
    with pytest.raises(SchemaError, match='missing transition'):
        admit_legacy(legacy, {'applied': [
            *BASELINE_IDS, '0027.add-missing-group-metadata-to-scenarios', MIGRATION_IDS[27],
        ]})


def test_missing_transition_is_rejected(legacy):
    with pytest.raises(SchemaError):
        admit_legacy(legacy, {'applied': [*BASELINE_IDS, MIGRATION_IDS[28]]})


def test_contradictory_account_ids_rejected(legacy):
    legacy.save('accounts', 'person@example.test', {'email': 'person@example.test',
                 'pat': 'invalid', 'permissions': []})
    with pytest.raises(SchemaError):
        admit_legacy(legacy, {'applied': [*BASELINE_IDS, *list(MIGRATION_IDS.values())[:3]]})


def test_fresh_initialization_is_current_without_upgrades(tmp_path):
    storage = DiskCacheStorage(tmp_path / 'cache')
    try:
        initialize(storage)
        validate_candidate(storage)
        assert storage.load('system', 'schema_state')['initialized_at_revision'] == 33
        assert storage.load('system', 'schema_state')['last_applied_migration'] is None
    finally:
        storage.close()


def test_current_candidate_rejects_incomplete_enrollment_credentials(tmp_path):
    storage = DiskCacheStorage(tmp_path / 'cache')
    try:
        initialize(storage)
        account_id = '11111111-1111-4111-8111-111111111111'
        storage.save('accounts', 'owner@example.test', {
            'email': 'owner@example.test', 'account_id': account_id, 'permissions': [],
        })
        storage.save('account_auth', account_id, {'enrolled': True})
        with pytest.raises(SchemaError):
            validate_candidate(storage)
    finally:
        storage.close()