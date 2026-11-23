"""Generation-owned planner.sqlite: creation, validation, copy, failure and restore."""
import os

import pytest

from planner_lib.database import DATABASE_NAME, SCHEMA_TARGET, PlannerDatabase
from planner_lib.database import planner_database as owner
from planner_lib.database import schema as database_schema
from planner_lib.migrations import revisions
from planner_lib.migrations.contracts import SchemaError, TARGET_REVISION, schema_state
from planner_lib.migrations.coordinator import Database
from planner_lib.storage.memory_backend import MemoryStorage


def _generation(handle):
    return handle.storage.data_dir.parent


def _seed_kind(database, kind='project'):
    with database.write() as connection:
        connection.execute('INSERT INTO server_feature_flags VALUES (?, 1)', (kind,))


def _kinds(database):
    with database.connect() as connection:
        return [row[0] for row in connection.execute('SELECT flag_name FROM server_feature_flags')]


def _downgrade(root, revision):
    """Mark the active generation as an older DiskCache revision."""
    handle = Database(root).prepare()
    handle.storage.save('system', 'schema_state', schema_state(revision, initialized=True))
    generation = _generation(handle)
    handle.close()
    return generation


def test_upgrade_removes_stand_alone_mode_and_validation_rejects_it():
    storage = MemoryStorage()
    revisions.initialize(storage)
    server = storage.load('config', 'server_config')
    storage.save('config', 'server_config', {
        **server, 'feature_flags': {'stand_alone_mode': True, 'enable_cache': True}})
    revisions.upgrade_47(storage)
    assert storage.load('config', 'server_config')['feature_flags'] == {'enable_cache': True}
    storage.save('config', 'server_config', {**server, 'feature_flags': {'stand_alone_mode': False}})
    with pytest.raises(SchemaError, match='Stand-alone'):
        revisions.validate_records(storage, TARGET_REVISION)


@pytest.mark.parametrize('custom', [False, True])
def test_fresh_installation_owns_a_confined_current_database(tmp_path, custom):
    root = tmp_path / 'custom-data' if custom else tmp_path
    handle = Database(root).prepare()
    try:
        database = handle.planner_database
        assert database.path == _generation(handle) / DATABASE_NAME
        assert root.resolve() in database.path.resolve().parents
        assert database.validate() == SCHEMA_TARGET
        assert os.stat(database.path).st_mode & 0o777 == 0o600
    finally:
        handle.close()


def test_current_generation_missing_database_fails_without_recreating(tmp_path):
    handle = Database(tmp_path).prepare()
    path = handle.planner_database.path
    handle.close()
    path.unlink()
    with pytest.raises(SchemaError, match='planner.sqlite is missing'):
        Database(tmp_path).prepare()
    assert not path.exists()


def test_invalid_database_in_current_generation_fails(tmp_path):
    handle = Database(tmp_path).prepare()
    with handle.planner_database.write() as connection:
        connection.execute("UPDATE schema_migrations SET migration_id = 'tampered' WHERE version = 1")
    handle.close()
    with pytest.raises(SchemaError, match='ledger'):
        Database(tmp_path).prepare()


def test_pre_database_generation_gains_database_in_new_candidate(tmp_path):
    previous = _downgrade(tmp_path, 46)
    (previous / DATABASE_NAME).unlink()
    handle = Database(tmp_path).prepare()
    try:
        assert _generation(handle) != previous
        assert handle.storage.load('system', 'schema_state')['schema_revision'] == TARGET_REVISION
        assert handle.planner_database.validate() == SCHEMA_TARGET
    finally:
        handle.close()
    assert not previous.exists()


def test_generation_switch_copies_database_rows(tmp_path):
    handle = Database(tmp_path).prepare()
    _seed_kind(handle.planner_database)
    handle.close()
    previous = _downgrade(tmp_path, 46)
    handle = Database(tmp_path).prepare()
    try:
        assert _generation(handle) != previous
        assert _kinds(handle.planner_database) == ['project']
    finally:
        handle.close()


def test_failed_staging_leaves_previous_generation_and_database_selected(tmp_path):
    handle = Database(tmp_path).prepare()
    _seed_kind(handle.planner_database)
    handle.close()
    previous = _downgrade(tmp_path, 46)

    def fault(name):
        if name == 'migration-47':
            raise RuntimeError('interrupted')

    with pytest.raises(SchemaError):
        Database(tmp_path, build='failing', fault=fault).prepare()
    assert (tmp_path / 'active-generation.json').read_text().count(previous.name) == 1
    survivor = PlannerDatabase(previous / DATABASE_NAME, root=tmp_path)
    assert _kinds(survivor) == ['project']
    handle = Database(tmp_path, build='fixed').prepare()
    try:
        assert _kinds(handle.planner_database) == ['project']
    finally:
        handle.close()
    assert len(list((tmp_path / 'generations').iterdir())) == 1


def test_pending_database_migration_stages_a_new_generation(tmp_path, monkeypatch):
    handle = Database(tmp_path).prepare()
    _seed_kind(handle.planner_database)
    previous = _generation(handle)
    handle.close()
    future = database_schema.MIGRATIONS + (
        (SCHEMA_TARGET + 1, '9999.future-table', 'CREATE TABLE future_table (id INTEGER PRIMARY KEY);'),)
    monkeypatch.setattr(owner, 'MIGRATIONS', future)
    monkeypatch.setattr(owner, 'SCHEMA_TARGET', SCHEMA_TARGET + 1)
    import planner_lib.migrations.coordinator as coordinator
    monkeypatch.setattr(coordinator, 'DATABASE_SCHEMA_TARGET', SCHEMA_TARGET + 1)
    handle = Database(tmp_path, build='next').prepare()
    try:
        assert _generation(handle) != previous
        assert handle.planner_database.schema_version() == SCHEMA_TARGET + 1
        assert _kinds(handle.planner_database) == ['project']
    finally:
        handle.close()


def test_offline_restore_copies_the_backup_database(tmp_path):
    backup = tmp_path / 'independent-backup'
    handle = Database(backup).prepare()
    _seed_kind(handle.planner_database, 'restored')
    handle.close()
    root = tmp_path / 'installation'
    handle = Database(root).prepare()
    _seed_kind(handle.planner_database, 'current')
    handle.close()
    Database(root).restore(backup, confirmed=True)
    handle = Database(root).prepare()
    try:
        assert _kinds(handle.planner_database) == ['restored']
    finally:
        handle.close()
    restored_backup = Database(backup).prepare()
    try:
        assert _kinds(restored_backup.planner_database) == ['restored']
    finally:
        restored_backup.close()


def test_legacy_export_includes_the_database(tmp_path):
    root = tmp_path / 'installation'
    handle = Database(root).prepare()
    _seed_kind(handle.planner_database)
    handle.close()
    exported = Database(root).export_legacy(tmp_path / 'export')
    assert _kinds(PlannerDatabase(exported / DATABASE_NAME, root=exported)) == ['project']
