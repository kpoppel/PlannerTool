"""Explicit supported schema history, independent of application versions."""

from dataclasses import dataclass
from typing import Callable

BASELINE_REVISION = 24
# Adding an upgrade:
# 1. Append a new revision/ID to MIGRATION_IDS and advance TARGET_REVISION.
# 2. Implement upgrade_<revision>(storage) in revisions.py and append it to REGISTRY
#    with the previous target as its predecessor; modify only supplied candidate storage.
# 3. Update initialize() and record/candidate validation for the new schema, preserving
#    validation of supported older revisions. Add migration and startup regression tests.
# Startup (including dev-server reload) applies pending revisions before serving HTTP.
# Never rewrite applied revisions or ledger entries: edits do not rerun an upgrade.
# Use a new revision for further changes, or isolated pre-upgrade data to test iterations.
TARGET_REVISION = 33
MIGRATION_IDS = {
    26: '0026.migrate-ttl-cache-to-remote-cache-storage',
    27: '0027.add-missing-scenario-metadata-to-scenarios',
    28: '0028.add-account-ids',
    29: '0029.migrate-view-expansion-to-context',
    30: '0030.add-plan-container-types',
    31: '0031.device-enrollment',
    32: '0032.account-id-ownership',
    33: '0033.harmonise-plugin-runtime-config',
}


class SchemaError(RuntimeError):
    """The database cannot be admitted by this binary."""


@dataclass(frozen=True)
class Migration:
    revision: int
    predecessor: int
    migration_id: str
    upgrade: Callable


def validate_registry(registry):
    registry = tuple(registry)
    if tuple((migration.revision, migration.migration_id) for migration in registry) != tuple(MIGRATION_IDS.items()):
        raise SchemaError('Migration registry must contain every declared supported transition')
    previous = BASELINE_REVISION
    seen = set()
    for migration in registry:
        if (type(migration.revision) is not int or type(migration.predecessor) is not int
            or migration.predecessor != previous or migration.revision <= previous
                or migration.migration_id in seen or not callable(migration.upgrade)):
            raise SchemaError('Invalid migration registry transition')
        seen.add(migration.migration_id)
        previous = migration.revision
    if previous != TARGET_REVISION:
        raise SchemaError('Migration registry does not reach the target schema')


def schema_state(revision, *, initialized=False):
    return {
        'schema_revision': revision,
        'last_applied_migration': None if initialized else MIGRATION_IDS.get(revision),
        'initialized_at_revision': revision if initialized else None,
    }


def validate_schema_state(state):
    if not isinstance(state, dict) or set(state) != {
        'schema_revision', 'last_applied_migration', 'initialized_at_revision'
    }:
        raise SchemaError('Invalid system/schema_state record')
    revision = state['schema_revision']
    if type(revision) is not int or revision not in {BASELINE_REVISION, *MIGRATION_IDS}:
        raise SchemaError('Unsupported schema revision; use a matching server or independent backup')
    initialized = state['initialized_at_revision']
    if initialized is not None and (type(initialized) is not int
                                    or initialized not in {BASELINE_REVISION, *MIGRATION_IDS}
                                    or initialized > revision):
        raise SchemaError('Invalid schema initialization history')
    expected = None if initialized == revision else MIGRATION_IDS.get(revision)
    if state['last_applied_migration'] != expected:
        raise SchemaError('Schema revision and migration ID disagree')
    return revision