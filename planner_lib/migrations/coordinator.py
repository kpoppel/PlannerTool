"""Local-filesystem generations with durable publication and lifetime writer leases."""

import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import tempfile
import time
from uuid import uuid4
import yaml

from diskcache import Disk

from planner_lib.storage.diskcache_backend import DiskCacheStorage
from .contracts import SchemaError, TARGET_REVISION, schema_state, validate_registry, validate_schema_state
from .revisions import (
    REGISTRY, admit_legacy, initialize, validate_candidate, validate_records,
)

GENERATION_PATTERN = re.compile(r'^[0-9a-f]{32}$')
PHASES = {'preparing', 'migrating', 'validated', 'published', 'activated',
          'complete', 'failed', 'retry-authorized'}


def read_json(path):
    if path.is_symlink():
        raise SchemaError('Database control files must not be symlinks')
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except (ValueError, OSError):
        raise SchemaError('Invalid database control file: ' + path.name) from None


def flush_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_json(path, payload):
    temporary = path.with_name('.' + path.name + '.' + uuid4().hex)
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as output:
            json.dump(payload, output, sort_keys=True)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        flush_directory(path.parent)
    finally:
        if temporary.exists():
            temporary.unlink()


def build_identity():
    digest = hashlib.sha256()
    package = Path(__file__).parent
    inputs = sorted(package.glob('*.py')) + sorted(package.glob('*.json'))
    inputs += [package.parent / 'admin' / 'plugin_runtime_config.py',
               package.parent / 'admin' / 'config_manager.py',
               package.parent / 'accounts' / 'config.py',
               package.parent / 'storage' / 'diskcache_backend.py']
    for path in inputs:
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def check_tree(path):
    if path.is_symlink() or not path.is_dir():
        raise SchemaError('Authoritative database must be an independent directory')
    for item in path.rglob('*'):
        if item.is_symlink() or not (item.is_file() or item.is_dir()):
            raise SchemaError('Authoritative database contains unsupported filesystem entries')


class InspectionStorage:
    """Decode DiskCache records without constructing a Cache or creating files."""

    def __init__(self, directory):
        self.data_dir = Path(directory)
        check_tree(self.data_dir)
        database = self.data_dir / 'cache.db'
        if not database.is_file():
            raise SchemaError('Authoritative cache exists without a complete database')
        wal = self.data_dir / 'cache.db-wal'
        if wal.exists() and not (self.data_dir / 'cache.db-shm').exists():
            raise SchemaError('Database WAL requires offline checkpointing before inspection')
        suffix = '?mode=ro' if wal.exists() else '?mode=ro&immutable=1'
        self.connection = sqlite3.connect(database.as_uri() + suffix, uri=True)
        self.disk = Disk(str(self.data_dir))

    def load(self, namespace, key):
        composite = namespace + '::' + key.replace('/', '_').replace('\\', '_')
        row = self.connection.execute(
            'SELECT mode, filename, value FROM Cache WHERE key = ? AND raw = 1 '
            'AND (expire_time IS NULL OR expire_time > ?)', (composite, time.time())
        ).fetchone()
        if row is None:
            raise KeyError(key)
        mode, filename, value = row
        if filename is not None:
            relative = Path(filename)
            if relative.is_absolute() or '..' in relative.parts:
                raise SchemaError('Invalid DiskCache value-file path')
        return self.disk.fetch(mode, filename, value, False)

    def exists(self, namespace, key):
        try:
            self.load(namespace, key)
        except KeyError:
            return False
        return True

    def list_keys(self, namespace):
        prefix = namespace + '::'
        rows = self.connection.execute('SELECT key FROM Cache WHERE raw = 1 '
                                       'AND (expire_time IS NULL OR expire_time > ?)',
                                       (time.time(),))
        return [row[0][len(prefix):] for row in rows
                if isinstance(row[0], str) and row[0].startswith(prefix)]

    def get_expire_time(self, namespace, key):
        row = self.connection.execute('SELECT expire_time FROM Cache WHERE key = ? AND raw = 1',
                                      (namespace + '::' + key,)).fetchone()
        if row is None:
            raise KeyError(key)
        return row[0]

    def close(self):
        self.connection.close()


class Lease:
    def __init__(self, root, exclusive, timeout, *, decide=None, create=True):
        self.main = None
        self.gate = None
        if create:
            root.mkdir(parents=True, exist_ok=True)
        flags = os.O_RDWR | os.O_CREAT if create else os.O_RDONLY
        try:
            self.gate = os.open(root / 'database-entry.lock',
                                flags | os.O_NOFOLLOW, 0o600)
            self.main = os.open(root / 'database.lock',
                                flags | os.O_NOFOLLOW, 0o600)
            deadline = time.monotonic() + timeout
            self._lock(self.gate, fcntl.LOCK_EX, deadline)
            if decide is not None:
                exclusive = decide()
            self.exclusive = exclusive
            self._lock(self.main, fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH, deadline)
            if not exclusive:
                fcntl.flock(self.gate, fcntl.LOCK_UN)
        except BaseException:
            self.close()
            raise

    def _lock(self, descriptor, mode, deadline):
        while True:
            try:
                fcntl.flock(descriptor, mode | fcntl.LOCK_NB)
                return
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise SchemaError('Database is busy. Stop running writers and retry offline.') from None
                time.sleep(min(0.02, max(0, deadline - time.monotonic())))

    def shared(self):
        fcntl.flock(self.main, fcntl.LOCK_SH)
        self.exclusive = False
        fcntl.flock(self.gate, fcntl.LOCK_UN)

    def close(self):
        for name in ('main', 'gate'):
            descriptor = getattr(self, name)
            if descriptor is not None:
                os.close(descriptor)
                setattr(self, name, None)


class DatabaseHandle:
    def __init__(self, storage, lease):
        self.storage = storage
        self.lease = lease
        self.closed = False

    def close(self):
        if not self.closed:
            try:
                self.storage.close()
            finally:
                self.lease.close()
                self.closed = True


class Database:
    def __init__(self, root, *, build=None, lock_timeout=5, fault=None):
        self.root = Path(root).absolute()
        self.build = build_identity() if build is None else build
        self.lock_timeout = lock_timeout
        self.fault = fault

    def _boundary(self, name):
        if self.fault is not None:
            self.fault(name)

    def _generation(self, generation):
        if not isinstance(generation, str) or not GENERATION_PATTERN.fullmatch(generation):
            raise SchemaError('Invalid generation identifier')
        path = self.root / 'generations' / generation
        if (self.root / 'generations').is_symlink() or path.is_symlink():
            raise SchemaError('Generation paths must not be symlinks')
        return path

    def _pointer(self):
        pointer = read_json(self.root / 'active-generation.json')
        if pointer is None:
            return None
        if not isinstance(pointer, dict) or set(pointer) != {'generation'}:
            raise SchemaError('Invalid active generation pointer')
        self._generation(pointer['generation'])
        return pointer['generation']

    def _journal(self):
        journal = read_json(self.root / 'upgrade-state.json')
        if journal is None:
            return None
        if (not isinstance(journal, dict) or journal.get('phase') not in PHASES
                or not isinstance(journal.get('build'), str)
                or journal.get('target_revision') != TARGET_REVISION
                or type(journal.get('legacy_server_config')) is not bool):
            raise SchemaError('Invalid database operation journal')
        self._generation(journal.get('candidate'))
        if journal.get('source') not in (None, 'legacy'):
            self._generation(journal['source'])
        return journal

    def _record(self, journal, phase):
        journal['phase'] = phase
        write_json(self.root / 'upgrade-state.json', journal)
        self._boundary('journal-' + phase)

    def _source(self, pointer):
        if pointer is not None:
            generation = self._generation(pointer)
            self._owned(generation)
            return generation / 'cache'
        cache = self.root / 'cache'
        if cache.is_symlink():
            raise SchemaError('Legacy authoritative cache must not be a symlink')
        if cache.exists():
            if not (cache / 'cache.db').is_file():
                raise SchemaError('Existing cache without schema evidence is not a fresh installation')
            return cache
        for name in ('accounts', 'scenarios', 'views'):
            path = self.root / name
            if path.exists() and (not path.is_dir() or any(path.iterdir())):
                raise SchemaError('Unsupported pre-v4.2.1 authoritative layout')
        if (self.root / 'migrations.json').exists():
            raise SchemaError('Legacy ledger exists without its authoritative database')
        if (self.root / 'config' / 'server_config.yml').exists():
            raise SchemaError('Legacy authoritative server config without a database is not fresh')
        return None

    def _legacy_config(self, source):
        if source != self.root / 'cache':
            return None
        storage = InspectionStorage(source)
        try:
            if storage.exists('config', 'server_config'):
                return None
        finally:
            storage.close()
        path = self.root / 'config' / 'server_config.yml'
        if not path.exists():
            return None
        if (path.is_symlink() or path.parent.is_symlink()
                or os.statvfs(path).f_flag & os.ST_RDONLY):
            raise SchemaError('Legacy authoritative server config must not be an external read-only mount or symlink')
        try:
            payload = yaml.safe_load(path.read_text())
        except (OSError, yaml.YAMLError):
            raise SchemaError('Invalid legacy authoritative server config') from None
        if not isinstance(payload, dict):
            raise SchemaError('Legacy authoritative server config must be an object')
        return payload

    def _revision(self, source):
        server_config = self._legacy_config(source)
        storage = InspectionStorage(source)
        try:
            if storage.exists('system', 'schema_state'):
                if storage.get_expire_time('system', 'schema_state') is not None:
                    raise SchemaError('Schema metadata must never expire')
                revision = validate_schema_state(storage.load('system', 'schema_state'))
                validate_records(storage, revision, server_config=server_config)
                return revision
            if source.parent.parent.name == 'generations':
                raise SchemaError('Selected generation has no schema metadata')
            return admit_legacy(storage, read_json(self.root / 'migrations.json'),
                                server_config=server_config)
        finally:
            storage.close()

    def _copy(self, source, destination, *, checkpoint=True):
        check_tree(source)
        if checkpoint:
            storage = DiskCacheStorage(source)
            try:
                if storage._cache.check():
                    raise SchemaError('Source DiskCache integrity check failed')
                storage._cache._sql('PRAGMA wal_checkpoint(TRUNCATE)').fetchall()
            finally:
                storage._cache.close()
        def copy_file(original, copied):
            result = shutil.copy2(original, copied)
            self._boundary('copy-file')
            return result

        shutil.copytree(source, destination, copy_function=copy_file)
        for path in (destination, *destination.rglob('*')):
            os.chmod(path, path.stat().st_mode & (0o700 if path.is_dir() else 0o600))
        self._boundary('copy-complete')

    def _flush(self, candidate):
        for path in candidate.rglob('*'):
            if path.is_file():
                os.chmod(path, path.stat().st_mode & 0o600)
                descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
                try:
                    os.fsync(descriptor)
                finally:
                    os.close(descriptor)
        directories = [path for path in candidate.rglob('*') if path.is_dir()]
        for path in sorted(directories, key=lambda item: len(item.parts), reverse=True):
            os.chmod(path, path.stat().st_mode & 0o700)
            flush_directory(path)
        flush_directory(candidate)
        flush_directory(candidate.parent)
        flush_directory(self.root)
        self._boundary('candidate-flushed')

    def _upgrade(self, storage, revision, journal):
        if not storage.exists('system', 'schema_state'):
            storage.save('system', 'schema_state', schema_state(revision))
        for migration in REGISTRY:
            if migration.revision <= revision:
                continue
            if migration.predecessor != revision:
                raise SchemaError('Missing supported migration transition')
            journal['failed_migration'] = migration.migration_id
            self._record(journal, 'migrating')
            with storage._cache.transact():
                migration.upgrade(storage)
                state = storage.load('system', 'schema_state')
                storage.save('system', 'schema_state', {
                    **state, 'schema_revision': migration.revision,
                    'last_applied_migration': migration.migration_id,
                })
            revision = migration.revision
            self._boundary('migration-' + str(revision))

    def _owned(self, path):
        marker = read_json(path / 'generation.json')
        if marker != {'generation': path.name, 'owner': 'planner-server'}:
            raise SchemaError('Generation ownership is unverifiable; refusing destructive operations')

    def _remove(self, path, *, recorded=False):
        if path.is_symlink():
            raise SchemaError('Refusing to remove a symlink from the database inventory')
        if path.exists():
            if path.parent == self.root / 'generations' and not recorded:
                self._owned(path)
            shutil.rmtree(path)
            flush_directory(path.parent)
            self._boundary('source-removed')

    def _cleanup(self, journal):
        active = self._pointer()
        if active != journal['candidate']:
            raise SchemaError('Cleanup journal does not identify the active database')
        if journal['source'] == 'legacy':
            self._remove(self.root / 'cache')
            if journal['legacy_server_config']:
                path = self.root / 'config' / 'server_config.yml'
                if path.exists():
                    if (path.is_symlink() or path.parent.is_symlink()
                            or os.statvfs(path).f_flag & os.ST_RDONLY):
                        raise SchemaError('Refusing to remove external legacy server config')
                    path.unlink()
                    flush_directory(path.parent)
            ledger = self.root / 'migrations.json'
            if ledger.is_symlink():
                raise SchemaError('Refusing to delete external migration ledger')
            if ledger.exists():
                ledger.unlink()
                flush_directory(self.root)
        generations = self.root / 'generations'
        for path in generations.iterdir():
            if path.name != active:
                self._generation(path.name)
                self._remove(path)
        journal['failed_migration'] = None
        journal['error'] = None
        self._record(journal, 'complete')

    def _reconcile(self, pointer, journal):
        if journal is None or journal['phase'] == 'complete':
            return
        if pointer == journal['candidate']:
            storage = InspectionStorage(self._generation(pointer) / 'cache')
            try:
                revision = validate_schema_state(storage.load('system', 'schema_state'))
                validate_records(storage, revision)
            finally:
                storage.close()
            flush_directory(self.root)
            self._record(journal, 'activated')
            self._cleanup(journal)
            return
        expected_source = 'legacy' if pointer is None and (self.root / 'cache').exists() else pointer
        if journal['source'] != expected_source or journal['phase'] in ('published', 'activated'):
            raise SchemaError('Pointer and operation journal disagree; inspect offline')
        if journal['phase'] == 'failed' and journal['build'] == self.build:
            raise SchemaError('This build previously failed. Use database retry or deploy a changed build.')
        self._remove(self._generation(journal['candidate']), recorded=True)

    def _publish(self, journal):
        write_json(self.root / 'active-generation.json', {'generation': journal['candidate']})
        self._boundary('pointer-published')
        self._record(journal, 'published')
        storage = InspectionStorage(self._generation(journal['candidate']) / 'cache')
        try:
            revision = validate_schema_state(storage.load('system', 'schema_state'))
            validate_records(storage, revision)
        finally:
            storage.close()
        self._record(journal, 'activated')
        self._cleanup(journal)

    def _stage(self, source, revision, pointer, *, restoring=False, server_config=None):
        generation = uuid4().hex
        source_id = 'legacy' if pointer is None and (self.root / 'cache').exists() else pointer
        journal = {'source': source_id, 'candidate': generation, 'target_revision': TARGET_REVISION,
                   'build': self.build, 'phase': 'preparing', 'failed_migration': None, 'error': None,
                   'legacy_server_config': source_id == 'legacy' and (
                       self._legacy_config(self.root / 'cache') is not None
                       if restoring else server_config is not None),
                   'operation': 'restore' if restoring else 'upgrade'}
        self._record(journal, 'preparing')
        candidate = self._generation(generation)
        candidate.parent.mkdir(mode=0o700, exist_ok=True)
        candidate.mkdir(mode=0o700)
        write_json(candidate / 'generation.json', {'generation': generation, 'owner': 'planner-server'})
        storage = None
        try:
            if source is not None:
                self._copy(source, candidate / 'cache', checkpoint=not restoring)
            storage = DiskCacheStorage(candidate / 'cache')
            if server_config is not None:
                storage.save('config', 'server_config', server_config)
            if restoring:
                if not storage.exists('system', 'schema_state'):
                    storage.save('system', 'schema_state', schema_state(revision))
                validate_schema_state(storage.load('system', 'schema_state'))
                validate_records(storage, revision)
                if storage._cache.check():
                    raise SchemaError('Restored database integrity check failed')
            elif source is None:
                initialize(storage)
            else:
                self._upgrade(storage, revision, journal)
            if not restoring:
                journal['failed_migration'] = 'candidate-validation'
                validate_candidate(storage)
            journal['failed_migration'] = None
            storage._cache._sql('PRAGMA wal_checkpoint(TRUNCATE)').fetchall()
            storage._cache.close()
            storage = None
            self._record(journal, 'validated')
            self._flush(candidate)
        except Exception as error:
            journal['error'] = {'type': type(error).__name__,
                                'message': 'Candidate preparation failed; source remains selected.'}
            try:
                if storage is not None:
                    storage.close()
                self._record(journal, 'failed')
            except Exception:
                raise SchemaError('Failure could not be recorded durably; source remains selected. '
                                  'Repair storage and inspect offline status before retrying.') from None
            raise SchemaError('Database preparation failed; source unchanged. Inspect status and use database retry.') from None
        self._publish(journal)
        return generation

    def prepare(self):
        validate_registry(REGISTRY)
        lease = Lease(self.root, False, self.lock_timeout)
        try:
            pointer, journal = self._pointer(), self._journal()
            if pointer is not None and (journal is None or journal['phase'] == 'complete'):
                source = self._source(pointer)
                if self._revision(source) == TARGET_REVISION:
                    return DatabaseHandle(DiskCacheStorage(source), lease)
            lease.close()
            lease = Lease(self.root, True, self.lock_timeout, decide=self._needs_exclusive)
            if not lease.exclusive:
                return DatabaseHandle(DiskCacheStorage(self._source(self._pointer())), lease)
            pointer, journal = self._pointer(), self._journal()
            self._reconcile(pointer, journal)
            pointer = self._pointer()
            source = self._source(pointer)
            revision = self._revision(source) if source is not None else None
            if pointer is None or revision != TARGET_REVISION:
                pointer = self._stage(source, revision, pointer,
                                      server_config=self._legacy_config(source) if source is not None else None)
            lease.shared()
            return DatabaseHandle(DiskCacheStorage(self._generation(pointer) / 'cache'), lease)
        except BaseException:
            lease.close()
            raise

    def _needs_exclusive(self):
        pointer, journal = self._pointer(), self._journal()
        return not (pointer is not None and (journal is None or journal['phase'] == 'complete')
                    and self._revision(self._source(pointer)) == TARGET_REVISION)

    def status(self):
        if not self.root.exists():
            return {'active_generation': None, 'active_revision': None, 'phase': None,
                    'temporary_source': None, 'pending_cleanup': False, 'failure': None}
        lease = None
        if (self.root / 'database.lock').exists():
            lease = Lease(self.root, False, self.lock_timeout, create=False)
        try:
            return self._status()
        finally:
            if lease is not None:
                lease.close()

    def _status(self):
        pointer, journal = self._pointer(), self._journal()
        source = self._source(pointer)
        revision = None
        compatibility_error = None
        if source is not None:
            server_config = self._legacy_config(source)
            storage = InspectionStorage(source)
            try:
                if storage.exists('system', 'schema_state'):
                    state = storage.load('system', 'schema_state')
                    revision = state.get('schema_revision') if isinstance(state, dict) else None
                    try:
                        validate_schema_state(state)
                    except SchemaError as error:
                        compatibility_error = str(error)
                else:
                    try:
                        revision = admit_legacy(storage, read_json(self.root / 'migrations.json'),
                                                server_config=server_config)
                    except SchemaError as error:
                        compatibility_error = str(error)
            finally:
                storage.close()
        return {'active_generation': pointer, 'active_revision': revision,
                'compatibility_error': compatibility_error,
            'failed_migration': journal['failed_migration'] if journal else None,
            'failed_build': journal['build'] if journal and journal['error'] else None,
                'phase': journal['phase'] if journal else None,
                'temporary_source': journal['source'] if journal and journal['phase'] != 'complete' else None,
                'pending_cleanup': bool(journal and pointer == journal['candidate']
                                        and journal['phase'] != 'complete'),
                'failure': journal['error'] if journal else None}

    def retry(self):
        lease = Lease(self.root, True, self.lock_timeout)
        try:
            journal = self._journal()
            if journal is None or journal['phase'] != 'failed':
                raise SchemaError('There is no failed database operation to authorize')
            journal['build'] = self.build
            self._record(journal, 'retry-authorized')
        finally:
            lease.close()

    def prune(self):
        lease = Lease(self.root, True, self.lock_timeout)
        try:
            pointer, journal = self._pointer(), self._journal()
            if journal and pointer == journal['candidate'] and journal['phase'] != 'complete':
                self._reconcile(pointer, journal)
                return
            protected = {pointer}
            if journal and journal['phase'] != 'complete':
                protected.add(journal['source'])
            generations = self.root / 'generations'
            if generations.exists():
                for path in generations.iterdir():
                    self._generation(path.name)
                    if path.name not in protected:
                        self._remove(path)
        finally:
            lease.close()

    def restore(self, backup, *, confirmed):
        if not confirmed:
            raise SchemaError('Restore requires explicit confirmation of lost writes and restored credentials')
        backup_root = Path(backup).absolute()
        if (backup_root == self.root or self.root in backup_root.parents
                or backup_root in self.root.parents):
            raise SchemaError('Restore requires an independent full backup outside the installation')
        backup_database = Database(backup_root, build=self.build)
        backup_pointer = backup_database._pointer()
        source = backup_database._source(backup_pointer)
        if source is None:
            raise SchemaError('Backup contains no authoritative database')
        revision = backup_database._revision(source)
        server_config = backup_database._legacy_config(source)
        inspection = InspectionStorage(source)
        try:
            validate_records(inspection, revision, server_config=server_config)
        finally:
            inspection.close()
        lease = Lease(self.root, True, self.lock_timeout)
        try:
            pointer, journal = self._pointer(), self._journal()
            if journal and pointer == journal['candidate'] and journal['phase'] != 'complete':
                self._reconcile(pointer, journal)
                pointer = self._pointer()
            self._stage(source, revision, pointer, restoring=True, server_config=server_config)
        finally:
            lease.close()

    def export_legacy(self, destination):
        destination = Path(destination).resolve()
        installation = self.root.resolve()
        if (destination.exists() or destination == installation
                or installation in destination.parents or destination in installation.parents):
            raise SchemaError('Legacy export requires a new independent path outside the installation')
        lease = Lease(self.root, True, self.lock_timeout)
        try:
            pointer, journal = self._pointer(), self._journal()
            if journal and pointer == journal['candidate'] and journal['phase'] != 'complete':
                raise SchemaError('Finish committed cleanup with database prune before exporting')
            source = self._source(pointer)
            if source is None:
                raise SchemaError('There is no authoritative database to export')
            revision = self._revision(source)
            server_config = self._legacy_config(source)
            with tempfile.TemporaryDirectory(prefix='.planner-export-', dir=destination.parent) as temporary:
                staged = Path(temporary)
                self._copy(source, staged / 'cache')
                if revision == 24:
                    storage = DiskCacheStorage(staged / 'cache')
                    try:
                        if storage.exists('config', 'server_config'):
                            server_config = storage.load('config', 'server_config')
                            storage.delete('config', 'server_config')
                    finally:
                        storage._cache.close()
                    (staged / 'config').mkdir(mode=0o700)
                    with (staged / 'config' / 'server_config.yml').open('x') as output:
                        yaml.safe_dump(server_config, output)
                storage = InspectionStorage(staged / 'cache')
                try:
                    validate_records(storage, revision, server_config=server_config)
                    if not storage.exists('system', 'schema_state'):
                        write_json(staged / 'migrations.json', read_json(self.root / 'migrations.json'))
                finally:
                    storage.close()
                self._flush(staged)
                if destination.exists() or destination.is_symlink():
                    raise SchemaError('Legacy export destination already exists')
                os.rename(staged, destination)
                flush_directory(destination.parent)
            return destination
        finally:
            lease.close()