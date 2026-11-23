"""planner.sqlite owner: confinement, ledger, constraints, copy and logical rows."""
import os
import sqlite3

import pytest

from planner_lib.database import DATABASE_NAME, SCHEMA_TARGET, PlannerDatabase
from planner_lib.database import schema as schema_module
from planner_lib.migrations.contracts import SchemaError


@pytest.fixture
def database(tmp_path):
    return PlannerDatabase.create(tmp_path / DATABASE_NAME, root=tmp_path)


def _seed_plan(connection, plan_id='plan-1'):
    connection.execute("INSERT INTO plan_kind_definitions VALUES ('project', 0)")
    connection.execute("INSERT INTO plan_definitions (plan_id, backend_id, name, kind, display_order) "
                       "VALUES (?, 'local', 'Local', 'project', 0)", (plan_id,))


def test_create_applies_schema_with_private_permissions_and_wal(database):
    assert database.validate() == SCHEMA_TARGET
    assert os.stat(database.path).st_mode & 0o777 == 0o600
    with database.connect() as connection:
        assert connection.execute('PRAGMA journal_mode').fetchone()[0] == 'wal'
        assert connection.execute('PRAGMA foreign_keys').fetchone()[0] == 1
        assert [row[0] for row in connection.execute('SELECT backend_id FROM backend_definitions')] == ['ado', 'local']


def test_migrate_is_idempotent(database):
    database.migrate()
    assert database.schema_version() == SCHEMA_TARGET


@pytest.mark.parametrize('relative', ['../outside.sqlite', '/tmp/elsewhere/planner.sqlite'])
def test_paths_outside_the_data_root_are_rejected(tmp_path, relative):
    root = tmp_path / 'data'
    root.mkdir()
    with pytest.raises(SchemaError, match='beneath'):
        PlannerDatabase(root / relative, root=root)


def test_symlinked_database_paths_are_rejected(tmp_path):
    root = tmp_path / 'data'
    (root / 'real').mkdir(parents=True)
    (root / 'link').symlink_to(root / 'real')
    with pytest.raises(SchemaError, match='symlink'):
        PlannerDatabase(root / 'link' / DATABASE_NAME, root=root)


def test_constraints_and_foreign_keys_are_enforced(database):
    with pytest.raises(sqlite3.IntegrityError):
        with database.write() as connection:
            connection.execute("INSERT INTO plan_definitions (plan_id, backend_id, name, kind, display_order) "
                               "VALUES ('p', 'local', 'Plan', 'missing-kind', 0)")
    with pytest.raises(sqlite3.IntegrityError):
        with database.write() as connection:
            connection.execute("INSERT INTO plan_kind_definitions VALUES ('project', 0)")
            connection.execute("INSERT INTO plan_definitions (plan_id, backend_id, name, kind, display_order, area_path) "
                               "VALUES ('p', 'local', 'Plan', 'project', 0, 'Project\\Area')")
    with database.connect() as connection:
        assert connection.execute('SELECT count(*) FROM plan_kind_definitions').fetchone()[0] == 0


def test_workflow_allows_one_initial_state(database):
    with pytest.raises(sqlite3.IntegrityError):
        with database.write() as connection:
            connection.execute("INSERT INTO states VALUES ('s1', 'local', 'New', 'Proposed', 0)")
            connection.execute("INSERT INTO states VALUES ('s2', 'local', 'Done', 'Completed', 1)")
            connection.execute("INSERT INTO workflows VALUES ('w', 'local', 'Default')")
            connection.execute("INSERT INTO workflow_states VALUES ('w', 's1', 0, 1)")
            connection.execute("INSERT INTO workflow_states VALUES ('w', 's2', 1, 1)")


def test_tampered_ledger_fails_validation(database):
    with database.write() as connection:
        connection.execute("UPDATE schema_migrations SET migration_id = 'other'")
    with pytest.raises(SchemaError, match='ledger'):
        database.validate()


def test_unknown_future_migration_requires_upgrade(database, monkeypatch):
    monkeypatch.setattr(schema_module, 'MIGRATIONS', schema_module.MIGRATIONS + (
        (SCHEMA_TARGET + 1, '9999.future', 'CREATE TABLE future (id INTEGER);'),))
    import planner_lib.database.planner_database as owner
    monkeypatch.setattr(owner, 'MIGRATIONS', schema_module.MIGRATIONS)
    monkeypatch.setattr(owner, 'SCHEMA_TARGET', SCHEMA_TARGET + 1)
    with pytest.raises(SchemaError, match='current schema'):
        database.validate()
    database.migrate()
    assert database.validate() == SCHEMA_TARGET + 1


def test_copy_is_a_consistent_independent_database(database, tmp_path):
    with database.write() as connection:
        _seed_plan(connection)
    (tmp_path / 'copy').mkdir()
    copied = database.copy_to(tmp_path / 'copy' / DATABASE_NAME, root=tmp_path)
    assert copied.validate() == SCHEMA_TARGET
    with copied.connect() as connection:
        assert connection.execute('SELECT name FROM plan_definitions').fetchone()[0] == 'Local'
    assert os.stat(copied.path).st_mode & 0o777 == 0o600


def test_logical_rows_round_trip_and_invalid_payloads_write_nothing(database, tmp_path):
    with database.write() as connection:
        _seed_plan(connection)
    exported = database.export_rows()
    assert exported['schema_version'] == SCHEMA_TARGET
    assert exported['tables']['plan_definitions'][0]['plan_id'] == 'plan-1'
    assert 'schema_migrations' not in exported['tables']

    other = PlannerDatabase.create(tmp_path / 'other.sqlite', root=tmp_path)
    other.replace_rows(exported)
    assert other.export_rows() == exported

    dangling = {**exported, 'tables': {**exported['tables'], 'plan_kind_definitions': []}}
    with pytest.raises(ValueError, match='constraints|dangling'):
        other.replace_rows(dangling)
    assert other.export_rows() == exported
    for broken in ({**exported, 'schema_version': 0},
                   {**exported, 'tables': {'plan_definitions': []}},
                   {**exported, 'tables': {**exported['tables'], 'plan_definitions': [{'plan_id': 'x'}]}}):
        with pytest.raises(ValueError):
            other.replace_rows(broken)
    assert other.export_rows() == exported


def test_in_memory_database_is_isolated_and_current():
    first, second = PlannerDatabase.in_memory(), PlannerDatabase.in_memory()
    try:
        with first.write() as connection:
            _seed_plan(connection)
        assert first.validate() == SCHEMA_TARGET
        assert second.export_rows()['tables']['plan_definitions'] == []
    finally:
        first.close()
        second.close()
