from contextlib import closing

import pytest

from planner_lib.domain.iteration_sets import validate_iteration_sets
from planner_lib.migrations.contracts import SchemaError
from planner_lib.migrations.coordinator import Database, read_json


def test_ado_config_backend_round_trips_normalized_documents(tmp_path):
    from planner_lib.backend.config import ConfigBackend

    plan_id = 'e3384ffc-49cf-4991-a950-25f1624d4fd0'
    area = 'Project\\Team'
    documents = {
        'projects': {'schema_version': 4, 'container_types': ['team'], 'allocation_defaults': {'team': []},
                     'project_map': [{'id': plan_id, 'type': 'team', 'name': 'Team', 'area_path': area,
                                      'task_types': ['Feature'], 'closed_history_days': 30,
                                      'iteration_uuid': None, 'allocatable_ids': []}]},
        'ado_processes': {'schema_version': 1, 'processes': [{
            'id': 'process', 'name': 'Agile', 'projects': ['Project'], 'loaded_at': '2026-01-01',
            'types': [{'reference_name': 'Custom.Feature', 'name': 'Feature', 'backlog_level': 'portfolio',
                       'backlog': None, 'imported': True, 'missing': False,
                       'states': [{'name': 'Active', 'category': 'InProgress', 'order': 14}]}],
        }]},
        'global_settings': {'schema_version': 2, 'process_order': ['process'],
                            'type_tiers': {'process': [['Feature']]}},
        'area_plan_map': {'last_update': '2026-01-01', plan_id: {'areas': {
            area: {'plans': {'delivery': {'name': 'Release', 'enabled': False}}},
        }}},
    }
    handle = Database(tmp_path).prepare()
    try:
        backend = ConfigBackend(storage=handle.storage)
        with handle.storage.transaction():
            for key, document in documents.items():
                backend.save_config_raw(key, document)
        assert backend.fetch_area_plan_map() == documents['area_plan_map']
        for key, document in documents.items():
            assert handle.storage.load('config', key) == document
            assert not handle.storage.retained.exists('config', key)
    finally:
        handle.close()


def test_fresh_generation_owns_server_config_in_sqlite(tmp_path):
    handle = Database(tmp_path).prepare()
    try:
        assert not handle.storage.retained.exists('config', 'server_config')
        assert handle.storage.load('config', 'server_config')['task_backend_id'] == 'ado'
        with handle.planner_database.connect() as connection:
            assert connection.execute('SELECT count(*) FROM server_settings').fetchone()[0] == 1
            assert connection.execute('SELECT count(*) FROM task_backend_selection').fetchone()[0] == 1
    finally:
        handle.close()


def test_revision_47_activation_preserves_local_rows_and_never_uses_legacy_keys(
    tmp_path, monkeypatch, pre_normalization_storage,
):
    from planner_lib.database import PlannerDatabase, planner_database
    from planner_lib.storage.diskcache_backend import DiskCacheStorage

    with closing(Database(tmp_path).prepare()) as handle:
        raw = pre_normalization_storage(handle, 47)
        settings = {'schema_version': 2, 'server_name': 'Old', 'task_backend_id': 'local',
                    'feature_flags': {'enable_cache': False}, 'cache': {'ttls': {'default': 0}}}
        raw.save('config', 'server_config', settings)
        path = handle.planner_database.path
    path.unlink()
    with monkeypatch.context() as legacy:
        legacy.setattr(planner_database, 'MIGRATIONS', planner_database.MIGRATIONS[:2])
        legacy.setattr(planner_database, 'SCHEMA_TARGET', 2)
        previous = PlannerDatabase.create(path, root=tmp_path)
        with previous.write() as connection:
            connection.execute("INSERT INTO processes VALUES ('retained', 'local', 'Retained')")
            connection.execute("INSERT INTO iteration_sets VALUES ('old-set', 'local', 'Old Set')")
            connection.execute("INSERT INTO iterations VALUES ('old-preset', 'old-set', 'old-path', '2026-01-01', '2026-01-02')")

    def interrupt(boundary):
        if boundary == 'candidate-flushed':
            raise RuntimeError('interrupted')

    with pytest.raises(SchemaError):
        Database(tmp_path, build='interrupted', fault=interrupt).prepare()
    assert read_json(tmp_path / 'active-generation.json')['generation'] == path.parent.name
    with closing(DiskCacheStorage(path.parent / 'cache')) as raw:
        assert raw.load('config', 'server_config') == settings

    with closing(Database(tmp_path, build='retry').prepare()) as handle:
        assert handle.storage.load('config', 'server_config') == settings
        assert not handle.storage.retained.exists('config', 'server_config')
        with handle.planner_database.connect() as connection:
            assert connection.execute('SELECT process_id FROM processes').fetchone()[0] == 'retained'
            assert connection.execute('SELECT iteration_id FROM task_iteration_refs').fetchone()[0] == 'old-preset'
        handle.storage.retained.save('config', 'server_config', {'server_name': 'Wrong authority'})
        assert handle.storage.load('config', 'server_config') == settings
        with handle.planner_database.write() as connection:
            connection.execute('DELETE FROM server_settings')
        with pytest.raises(KeyError):
            handle.storage.load('config', 'server_config')


def test_logical_restore_publishes_only_a_validated_candidate(tmp_path):
    from planner_lib.admin.config_manager import ConfigManager

    database = Database(tmp_path)
    handle = database.prepare()
    pointer = tmp_path / 'active-generation.json'
    before = read_json(pointer)
    manager = ConfigManager(handle.storage, planner_database=handle.planner_database)
    payload = manager.get_backup()
    payload.pop('accounts')
    payload.pop('authentication')
    payload['planner_database']['tables']['server_settings'][0]['server_name'] = 'Restored'
    assert 'server_config' not in payload['config']
    broken = {**payload, 'config': {**payload['config'], 'teams': {'schema_version': 3}}}
    try:
        with pytest.raises(SchemaError):
            manager.restore_backup(broken, database_handle=handle)
        assert read_json(pointer) == before
        assert 'server_name' not in handle.storage.load('config', 'server_config')
        manager.restore_backup(payload, database_handle=handle)
        assert read_json(pointer) != before
        assert handle.restart_required
    finally:
        handle.close()
    with closing(Database(tmp_path).prepare()) as restored:
        assert restored.storage.load('config', 'server_config')['server_name'] == 'Restored'


def test_admin_restore_parks_old_worker_until_restart(tmp_path):
    from fastapi.testclient import TestClient

    from planner_lib.main import Config, create_app

    config = Config(data_dir=str(tmp_path), storage_backend='diskcache')
    with TestClient(create_app(config)) as client:
        old_cache = client.app.state.container.get('remote_cache_storage')
        old_cache.save('backend_domain', 'restore-probe', ['stale'])
        enrollment = client.post('/api/auth/enroll', json={
            'email': 'restore-test@example.com', 'name': 'Restore Test',
        }, headers={'Accept': 'application/json'})
        assert enrollment.status_code == 200
        backup = client.get('/admin/v1/backup')
        assert backup.status_code == 200, backup.text
        payload = {'schema_revision': backup.json()['schema_revision'],
                   'planner_database': backup.json()['planner_database']}
        payload['planner_database']['tables']['server_settings'][0]['server_name'] = 'Restored via API'
        result = client.post('/admin/v1/restore', json=payload)
        assert result.status_code == 200, result.text
        assert result.json()['restart_required'] is True
        assert client.get('/admin/v1/backup').json() == {'error': 'restart_required'}
    with TestClient(create_app(config)) as restarted:
        storage = restarted.app.state.container.get('storage')
        assert storage.load('config', 'server_config')['server_name'] == 'Restored via API'
        assert not restarted.app.state.container.get('remote_cache_storage').exists('backend_domain', 'restore-probe')


def test_logical_restore_refuses_to_switch_with_another_live_worker(tmp_path):
    database = Database(tmp_path, lock_timeout=0.02)
    with closing(database.prepare()) as handle, closing(database.prepare()):
        pointer = read_json(tmp_path / 'active-generation.json')
        with pytest.raises(SchemaError, match='Stop running writers'):
            database.restore_logical(handle, lambda *_: pytest.fail('must not stage with a live worker'))
        assert read_json(tmp_path / 'active-generation.json') == pointer
        assert not handle.restart_required


def test_iteration_sets_keep_wire_order_and_generator_recipe(tmp_path):
    handle = Database(tmp_path).prepare()
    config = validate_iteration_sets({'iteration_sets': [
        {'id': 'manual', 'name': 'Cadence', 'source_type': 'manual', 'values': [
            {'path': 'second', 'name': 'Same name', 'startDate': '2026-01-03', 'finishDate': '2026-01-04'},
            {'path': 'first', 'name': 'Same name', 'startDate': '2026-01-01', 'finishDate': '2026-01-02'},
        ]},
        {'id': 'generated', 'name': 'Cadence', 'source_type': 'generated', 'values': [],
         'generator': {'start': '2026-02-01', 'length': 2, 'unit': 'weeks', 'firstNumber': 2,
                       'prefix': 'Sprint', 'mode': 'count', 'count': 2}},
    ]})
    try:
        handle.storage.save('config', 'iterations', config)
        assert handle.storage.load('config', 'iterations') == config
        assert not handle.storage.retained.exists('config', 'iterations')
    finally:
        handle.close()