"""Owner of the generation-local relational database ``planner.sqlite``.

Connections are short-lived and per operation. Every connection enables
foreign keys and a bounded busy timeout; write transactions use
``BEGIN IMMEDIATE`` so validation and writes commit atomically.
"""
from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from planner_lib.migrations.contracts import SchemaError

from .schema import MIGRATIONS, SCHEMA_TARGET

DATABASE_NAME = 'planner.sqlite'
BUSY_TIMEOUT_MS = 5000
BACKUP_FORMAT_VERSION = 1
# Rows that belong to the database itself rather than to restorable data.
_INTERNAL_TABLES = {'schema_migrations', 'sqlite_sequence'}


class PlannerDatabaseBusy(RuntimeError):
    """The planner database could not acquire a lock within the busy timeout."""


def database_path(cache_directory: Path) -> Path:
    """The relational database is a sibling of the DiskCache directory it belongs to."""
    return Path(cache_directory).parent / DATABASE_NAME


class PlannerDatabase:
    """A ``planner.sqlite`` confined to an installation root."""

    def __init__(self, path, *, root):
        path = Path(path).absolute()
        root = Path(root).absolute()
        if path.is_symlink() or any(parent.is_symlink() for parent in path.parents
                                    if root in parent.parents or parent == root):
            raise SchemaError('The planner database path must not involve symlinks')
        if root not in path.resolve().parents:
            raise SchemaError('The planner database must live beneath the data directory')
        self.path = path
        self._uri = None
        self._keeper = None

    @classmethod
    def in_memory(cls):
        """Isolated shared-cache database for memory-storage application fixtures."""
        database = cls.__new__(cls)
        database.path = None
        database._uri = f'file:planner-{uuid4().hex}?mode=memory&cache=shared'
        # The shared in-memory database lives as long as one connection is open.
        database._keeper = database._open()
        database.migrate()
        return database

    @classmethod
    def create(cls, path, *, root):
        database = cls(path, root=root)
        if database.path.exists():
            raise SchemaError('The planner database already exists')
        os.close(os.open(database.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600))
        connection = database._open()
        try:
            connection.execute('PRAGMA journal_mode=WAL').fetchone()
        finally:
            connection.close()
        database.migrate()
        return database

    def exists(self):
        return self._uri is not None or self.path.is_file()

    def _open(self):
        if self._uri is not None:
            # The keep-alive connection may be closed from the shutdown thread.
            connection = sqlite3.connect(self._uri, uri=True, isolation_level=None,
                                         timeout=BUSY_TIMEOUT_MS / 1000, check_same_thread=False)
        else:
            if not self.path.is_file():
                raise SchemaError('The planner database is missing')
            connection = sqlite3.connect(self.path, isolation_level=None,
                                         timeout=BUSY_TIMEOUT_MS / 1000)
        connection.row_factory = sqlite3.Row
        connection.execute('PRAGMA foreign_keys=ON')
        connection.execute(f'PRAGMA busy_timeout={BUSY_TIMEOUT_MS}')
        return connection

    @contextmanager
    def connect(self):
        """Autocommit connection for reads; use ``write()`` for changes."""
        connection = self._open()
        try:
            yield connection
        finally:
            connection.close()

    @contextmanager
    def write(self):
        """One ``BEGIN IMMEDIATE`` transaction; any exception rolls everything back."""
        connection = self._open()
        try:
            connection.execute('BEGIN IMMEDIATE')
            try:
                yield connection
            except BaseException:
                connection.execute('ROLLBACK')
                raise
            connection.execute('COMMIT')
        except sqlite3.OperationalError as exc:
            if getattr(exc, 'sqlite_errorcode', 0) & 0xff == sqlite3.SQLITE_BUSY:
                raise PlannerDatabaseBusy('Planner database is busy; retry the operation') from exc
            raise
        finally:
            connection.close()

    def close(self):
        if self._keeper is not None:
            self._keeper.close()
            self._keeper = None

    # ------------------------------------------------------------------
    # Schema ledger
    # ------------------------------------------------------------------

    def _applied(self, connection):
        exists = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
        ).fetchone()
        if exists is None:
            return []
        return [(row['version'], row['migration_id']) for row in connection.execute(
            'SELECT version, migration_id FROM schema_migrations ORDER BY version')]

    def _check_ledger(self, applied):
        expected = [(version, migration_id) for version, migration_id, _ in MIGRATIONS]
        if applied != expected[:len(applied)]:
            raise SchemaError('The planner database ledger is not a supported migration history')

    def schema_version(self):
        with self.connect() as connection:
            applied = self._applied(connection)
        self._check_ledger(applied)
        return applied[-1][0] if applied else 0

    def migrate(self):
        """Apply pending schema migrations, each in its own transaction."""
        with self.connect() as connection:
            applied = self._applied(connection)
            self._check_ledger(applied)
            # SQLite's table-rebuild procedure: keys off, verified before commit.
            connection.execute('PRAGMA foreign_keys=OFF')
            for version, migration_id, script in MIGRATIONS[len(applied):]:
                timestamp = datetime.now(timezone.utc).isoformat()
                try:
                    connection.executescript(
                        'BEGIN IMMEDIATE;\n' + script
                        + f"\nINSERT INTO schema_migrations VALUES ({version}, '{migration_id}', '{timestamp}');"
                        + f'\nPRAGMA user_version = {version};')
                    if connection.execute('PRAGMA foreign_key_check').fetchone() is not None:
                        raise sqlite3.IntegrityError('dangling references')
                    connection.execute('COMMIT')
                except sqlite3.Error:
                    if connection.in_transaction:
                        connection.execute('ROLLBACK')
                    raise SchemaError(f'Planner database migration {migration_id} failed') from None

    def validate(self, *, require_current=True):
        """Integrity, foreign keys and ledger; optionally require the current schema."""
        with self.connect() as connection:
            if [row[0] for row in connection.execute('PRAGMA integrity_check')] != ['ok']:
                raise SchemaError('Planner database integrity check failed')
            if connection.execute('PRAGMA foreign_key_check').fetchone() is not None:
                raise SchemaError('Planner database has dangling references')
            applied = self._applied(connection)
            self._check_ledger(applied)
            version = applied[-1][0] if applied else 0
            if version != connection.execute('PRAGMA user_version').fetchone()[0]:
                raise SchemaError('Planner database version metadata disagrees with its ledger')
        if require_current and version != SCHEMA_TARGET:
            raise SchemaError('Planner database is not at the current schema')
        return version

    def checkpoint(self):
        with self.connect() as connection:
            busy = connection.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()[0]
        if busy:
            raise SchemaError('Planner database checkpoint is blocked by an active reader')

    def copy_to(self, destination, *, root):
        """Consistent online copy into a new confined file via the SQLite backup API."""
        target = PlannerDatabase(destination, root=root)
        if target.path.exists():
            raise SchemaError('Planner database copy destination already exists')
        os.close(os.open(target.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600))
        with self.connect() as source, target.connect() as copied:
            source.backup(copied)
            copied.execute('PRAGMA journal_mode=WAL').fetchone()
        target.checkpoint()
        return target

    # ------------------------------------------------------------------
    # Logical backup
    # ------------------------------------------------------------------

    def _tables(self, connection):
        """Data tables in foreign-key dependency order (parents first)."""
        names = [row[0] for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY rowid")
            if row[0] not in _INTERNAL_TABLES]
        return names

    def export_rows(self):
        with self.connect() as connection:
            connection.execute('BEGIN')
            try:
                tables = {}
                for table in self._tables(connection):
                    rows = connection.execute(f'SELECT * FROM "{table}" ORDER BY rowid')
                    tables[table] = [dict(row) for row in rows]
            finally:
                connection.execute('ROLLBACK')
        return {'version': BACKUP_FORMAT_VERSION, 'schema_version': self.schema_version(),
                'tables': tables}

    def _check_payload(self, connection, payload):
        if (not isinstance(payload, dict) or set(payload) != {'version', 'schema_version', 'tables'}
                or payload['version'] != BACKUP_FORMAT_VERSION):
            raise ValueError('Unsupported planner database backup format')
        if payload['schema_version'] != SCHEMA_TARGET:
            raise ValueError(f'Planner database backup requires schema version {SCHEMA_TARGET}')
        tables = self._tables(connection)
        if not isinstance(payload['tables'], dict) or set(payload['tables']) != set(tables):
            raise ValueError('Planner database backup must contain exactly the current tables')
        for table in tables:
            columns = {row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')}
            rows = payload['tables'][table]
            if not isinstance(rows, list) or any(
                    not isinstance(row, dict) or set(row) != columns
                    or any(isinstance(value, (dict, list)) for value in row.values())
                    for row in rows):
                raise ValueError(f'Planner database backup rows do not match table {table}')
        return tables

    def validate_backup(self, payload):
        with self.connect() as connection:
            self._check_payload(connection, payload)

    def replace_rows(self, payload):
        """Replace every data row in one validated transaction; failures write nothing."""
        with self.write() as connection:
            tables = self._check_payload(connection, payload)
            connection.execute('PRAGMA defer_foreign_keys=ON')
            for table in reversed(tables):
                connection.execute(f'DELETE FROM "{table}"')
            try:
                for table in tables:
                    for row in payload['tables'][table]:
                        # Column names were checked against the table definition above.
                        columns = list(row)
                        connection.execute(
                            f'INSERT INTO "{table}" ({", ".join(chr(34) + c + chr(34) for c in columns)}) '
                            f'VALUES ({", ".join("?" for _ in columns)})',
                            [row[column] for column in columns])
            except sqlite3.IntegrityError as error:
                raise ValueError(f'Planner database backup violates constraints: {error}') from None
            if connection.execute('PRAGMA foreign_key_check').fetchone() is not None:
                raise ValueError('Planner database backup has dangling references')
