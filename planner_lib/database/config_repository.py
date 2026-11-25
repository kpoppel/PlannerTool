"""Typed configuration projections for the existing application documents."""

from contextlib import ExitStack, contextmanager
import sqlite3
from threading import local

from planner_lib.migrations.contracts import SchemaError
from planner_lib.storage.base import StorageBackend

from .ado_config import (
    read_area_mappings, read_catalogue, read_display, read_projects,
    write_area_mappings, write_catalogue, write_display, write_projects,
)
from .iteration_config import read_iterations, write_iterations
from .transport_config import read_transport_options, write_transport_options


CORE_CONFIGURATION_SQLITE_VERSION = 3


def _shape(value, required, optional=()):
    if not isinstance(value, dict) or not set(required) <= value.keys() <= set(required) | set(optional):
        raise ValueError('Unsupported configuration document fields')


def _flags(value):
    if not isinstance(value, dict) or any(type(flag) is not bool for flag in value.values()):
        raise ValueError('Feature flags must be booleans')
    return value.items()


def _write_server(connection, value):
    _shape(value, ('schema_version', 'task_backend_id', 'feature_flags'),
           ('server_name', 'log_level', 'cache'))
    if value['schema_version'] != 2:
        raise ValueError('Unsupported server configuration version')
    cache = value.get('cache', {})
    _shape(cache, (), ('ttls',))
    ttls = cache.get('ttls', {})
    if not isinstance(ttls, dict) or any(type(minutes) is not int or minutes < 0 for minutes in ttls.values()):
        raise ValueError('Cache TTLs must be nonnegative whole minutes')
    connection.execute('INSERT OR REPLACE INTO server_settings VALUES (1, ?, ?, ?, ?)',
                       (value.get('server_name'), value.get('log_level', 'INFO'),
                        'log_level' in value, int('cache' in value) + int('ttls' in cache)))
    connection.execute('INSERT OR REPLACE INTO task_backend_selection VALUES (1, ?)',
                       (value['task_backend_id'],))
    connection.execute('DELETE FROM server_feature_flags')
    flags = write_transport_options(connection, 'server', value['feature_flags'])
    connection.executemany('INSERT INTO server_feature_flags VALUES (?, ?)', _flags(flags))
    connection.execute('DELETE FROM cache_policies')
    connection.executemany('INSERT INTO cache_policies VALUES (?, ?)',
                           ((name, minutes * 60) for name, minutes in ttls.items()))


def _read_server(connection):
    row = connection.execute('''SELECT server_name, log_level, log_level_present, cache_shape, backend_id
        FROM server_settings JOIN task_backend_selection USING (singleton_id)''').fetchone()
    if row is None:
        raise KeyError('server_config')
    result = {'schema_version': 2, 'task_backend_id': row['backend_id'], 'feature_flags': {
        name: bool(enabled) for name, enabled in connection.execute('SELECT * FROM server_feature_flags')}}
    result['feature_flags'].update(read_transport_options(connection, 'server'))
    if row['server_name'] is not None:
        result['server_name'] = row['server_name']
    if row['log_level_present']:
        result['log_level'] = row['log_level']
    if row['cache_shape']:
        result['cache'] = {}
    if row['cache_shape'] == 2:
        result['cache']['ttls'] = {name: seconds // 60 for name, seconds in connection.execute(
            'SELECT * FROM cache_policies')}
    return result


def _write_ado(connection, value):
    _shape(value, ('transport',), ('organization_url', 'feature_flags'))
    connection.execute("INSERT OR REPLACE INTO ado_settings VALUES ('ado', ?, ?, ?, ?)",
                       (value.get('organization_url', ''), value['transport'],
                        'organization_url' in value, 'feature_flags' in value))
    connection.execute("DELETE FROM backend_feature_flags WHERE backend_id = 'ado'")
    flags = write_transport_options(connection, 'ado', value.get('feature_flags', {}))
    connection.executemany("INSERT INTO backend_feature_flags VALUES ('ado', ?, ?)",
                           _flags(flags))


def _read_ado(connection):
    row = connection.execute("SELECT * FROM ado_settings WHERE backend_id = 'ado'").fetchone()
    if row is None:
        raise KeyError('ado_config')
    result = {'transport': row['transport']}
    if row['url_present']:
        result['organization_url'] = row['organization_url']
    if row['flags_present']:
        result['feature_flags'] = {name: bool(enabled) for name, enabled in connection.execute(
            "SELECT flag_name, enabled FROM backend_feature_flags WHERE backend_id = 'ado'")}
        result['feature_flags'].update(read_transport_options(connection, 'ado'))
    return result


PROJECTIONS = {
    'server_config': (_read_server, _write_server),
    'ado_config': (_read_ado, _write_ado),
    'iterations': (read_iterations, write_iterations),
    'projects': (read_projects, write_projects),
    'ado_processes': (read_catalogue, write_catalogue),
    'global_settings': (read_display, write_display),
    'area_plan_map': (read_area_mappings, write_area_mappings),
}


def migrate_config(storage, database):
    with database.write() as connection:
        for key, (read, write) in PROJECTIONS.items():
            if not storage.exists('config', key):
                continue
            if storage.get_expire_time('config', key) is not None:
                raise SchemaError(f'Cannot migrate expiring configuration: {key}')
            original = storage.load('config', key)
            write(connection, original)
            if read(connection) != original:
                raise SchemaError(f'Configuration projection changed {key}')
    for key in PROJECTIONS:
        if storage.exists('config', key):
            storage.delete('config', key)


class ConfigStorage(StorageBackend):
    """Route core configuration to SQLite without a legacy read path."""

    def __init__(self, retained, database):
        self.retained = retained
        self.database = database
        self._transaction = local()
        self._closed = False

    @property
    def data_dir(self):
        return self.retained.data_dir

    def _require_open(self):
        if self._closed:
            raise RuntimeError('Configuration storage is closed')

    @contextmanager
    def transaction(self):
        self._require_open()
        if getattr(self._transaction, 'stack', None) is not None:
            yield
            return
        try:
            with self.retained.transaction(), ExitStack() as stack:
                self._transaction.stack = stack
                try:
                    yield
                finally:
                    self._transaction.stack = None
                    self._transaction.connection = None
        except sqlite3.IntegrityError as error:
            raise ValueError(f'Configuration violates database constraints: {error}') from error

    @contextmanager
    def _read(self):
        self._require_open()
        connection = getattr(self._transaction, 'connection', None)
        if connection is not None:
            yield connection
        else:
            with self.database.connect() as connection:
                connection.execute('BEGIN')
                yield connection

    def load(self, namespace, key):
        if namespace == 'config' and key in PROJECTIONS:
            with self._read() as connection:
                return PROJECTIONS[key][0](connection)
        return self.retained.load(namespace, key)

    def save(self, namespace, key, value, ttl_seconds=None):
        if namespace != 'config' or key not in PROJECTIONS:
            self.retained.save(namespace, key, value, ttl_seconds=ttl_seconds)
            return
        if ttl_seconds is not None:
            raise ValueError('Core configuration cannot expire')
        with self.transaction():
            connection = getattr(self._transaction, 'connection', None)
            if connection is None:
                connection = self._transaction.stack.enter_context(self.database.write())
                self._transaction.connection = connection
            read, write = PROJECTIONS[key]
            write(connection, value)
            if read(connection) != value:
                raise ValueError(f'Configuration does not round-trip: {key}')

    def exists(self, namespace, key):
        if namespace == 'config' and key in PROJECTIONS:
            try:
                self.load(namespace, key)
            except KeyError:
                return False
            return True
        return self.retained.exists(namespace, key)

    def list_keys(self, namespace):
        keys = self.retained.list_keys(namespace)
        if namespace != 'config':
            return keys
        return [*(key for key in keys if key not in PROJECTIONS),
                *(key for key in PROJECTIONS if self.exists(namespace, key))]

    def delete(self, namespace, key):
        if namespace == 'config' and key in PROJECTIONS:
            raise ValueError('Core configuration cannot be deleted')
        self.retained.delete(namespace, key)

    def configure(self, **options):
        self.retained.configure(**options)

    def get_expire_time(self, namespace, key):
        if namespace == 'config' and key in PROJECTIONS:
            return None
        return self.retained.get_expire_time(namespace, key)

    def expire(self):
        return self.retained.expire()

    def close(self):
        self._closed = True
        self.retained.close()