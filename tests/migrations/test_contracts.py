import pytest

from planner_lib.migrations.contracts import (
    BASELINE_REVISION,
    TARGET_REVISION,
    Migration,
    SchemaError,
    schema_state,
    validate_registry,
    validate_schema_state,
)


def test_fresh_metadata_has_no_invented_history():
    state = schema_state(TARGET_REVISION, initialized=True)
    assert state == {
        'schema_revision': TARGET_REVISION,
        'last_applied_migration': None,
        'initialized_at_revision': TARGET_REVISION,
    }
    validate_schema_state(state)


@pytest.mark.parametrize('revision', [BASELINE_REVISION - 1, TARGET_REVISION + 1])
def test_unsupported_metadata_is_rejected(revision):
    with pytest.raises(SchemaError):
        validate_schema_state(schema_state(revision))


def test_metadata_must_agree_with_registry():
    state = schema_state(TARGET_REVISION)
    state['last_applied_migration'] = 'unverified'
    with pytest.raises(SchemaError):
        validate_schema_state(state)


def test_registry_rejects_missing_transition_and_duplicate_ids():
    upgrade = lambda storage: None
    with pytest.raises(SchemaError):
        validate_registry([Migration(25, 24, '0025.example', upgrade)])
    chain = [Migration(revision, revision - 1, 'duplicate', upgrade)
             for revision in range(BASELINE_REVISION + 1, TARGET_REVISION + 1)]
    with pytest.raises(SchemaError):
        validate_registry(chain)


def test_registry_cannot_jump_directly_from_baseline_to_target():
    with pytest.raises(SchemaError):
        validate_registry([Migration(33, 24, '0033.harmonise-plugin-runtime-config', lambda storage: None)])