import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from planner_lib.migrations.contracts import SchemaError
from planner_lib.migrations.coordinator import Database, read_json
from planner_lib.migrations.revisions import BASELINE_IDS
from planner_lib.storage.diskcache_backend import DiskCacheStorage


def seed_legacy(root):
    root.mkdir(exist_ok=True)
    storage = DiskCacheStorage(root / 'cache')
    storage.save('config', 'server_config', {'schema_version': 2, 'feature_flags': {}})
    storage.save('config', 'projects', {'schema_version': 3, 'project_map': []})
    storage.save('config', 'people', {'schema_version': 1, 'database': {'people': []}})
    storage.save('opaque', 'large', b'a' * 100_000)
    storage.close()
    (root / 'migrations.json').write_text(json.dumps({'applied': list(BASELINE_IDS)}))


def test_external_inputs_only_initialize_without_migrations(tmp_path, monkeypatch):
    (tmp_path / 'config').mkdir()
    external = tmp_path / 'config' / 'teams.yml'
    external.write_text('external')
    database = Database(tmp_path)
    monkeypatch.setattr(database, '_upgrade', lambda *args: pytest.fail('fresh install ran upgrades'))
    handle = database.prepare()
    assert handle.storage.load('system', 'schema_state')['schema_revision'] == 33
    handle.close()
    assert external.read_text() == 'external'
    assert len(list((tmp_path / 'generations').iterdir())) == 1


def test_legacy_upgrade_preserves_large_values_and_removes_source(tmp_path):
    seed_legacy(tmp_path)
    handle = Database(tmp_path).prepare()
    assert handle.storage.load('opaque', 'large') == b'a' * 100_000
    handle.close()
    assert not (tmp_path / 'cache').exists()
    assert not (tmp_path / 'migrations.json').exists()
    assert len(list((tmp_path / 'generations').iterdir())) == 1
    assert read_json(tmp_path / 'upgrade-state.json')['phase'] == 'complete'


def test_failed_candidate_never_changes_source_or_retries_same_build(tmp_path, monkeypatch):
    seed_legacy(tmp_path)
    database = Database(tmp_path, build='first-build')

    def fail(storage, revision, journal):
        storage.save('opaque', 'large', b'b' * 100_000)
        raise ValueError('secret-do-not-log')

    monkeypatch.setattr(database, '_upgrade', fail)
    with pytest.raises(SchemaError):
        database.prepare()
    source = DiskCacheStorage(tmp_path / 'cache')
    assert source.load('opaque', 'large') == b'a' * 100_000
    source.close()
    assert not (tmp_path / 'active-generation.json').exists()
    assert 'secret-do-not-log' not in (tmp_path / 'upgrade-state.json').read_text()
    monkeypatch.setattr(database, '_upgrade', lambda *args: pytest.fail('same build retried'))
    with pytest.raises(SchemaError, match='retry'):
        database.prepare()
    handle = Database(tmp_path, build='changed-build').prepare()
    handle.close()


def test_current_restart_does_not_copy_or_rewrite_metadata(tmp_path, monkeypatch):
    database = Database(tmp_path)
    handle = database.prepare()
    generation = handle.storage.data_dir.parent.name
    handle.close()
    pointer = (tmp_path / 'active-generation.json').read_bytes()
    journal = (tmp_path / 'upgrade-state.json').read_bytes()
    monkeypatch.setattr(database, '_copy', lambda *args: pytest.fail('current restart copied'))
    handle = database.prepare()
    assert handle.storage.data_dir.parent.name == generation
    handle.close()
    assert (tmp_path / 'active-generation.json').read_bytes() == pointer
    assert (tmp_path / 'upgrade-state.json').read_bytes() == journal


def test_invalid_pointer_fails_without_opening_storage(tmp_path):
    (tmp_path / 'active-generation.json').write_text('{"generation":"../outside"}')
    with pytest.raises(SchemaError):
        Database(tmp_path).prepare()
    assert not (tmp_path / 'cache').exists()


def test_running_shared_writer_blocks_upgrade_and_prune(tmp_path):
    handle = Database(tmp_path).prepare()
    try:
        with pytest.raises(SchemaError, match='Stop'):
            Database(tmp_path, lock_timeout=0.02).prune()
    finally:
        handle.close()


def test_status_of_missing_installation_creates_nothing(tmp_path):
    root = tmp_path / 'missing'
    status = Database(root).status()
    assert status['active_revision'] is None
    assert not root.exists()


@pytest.mark.parametrize('boundary', [
    'journal-preparing', 'copy-file', 'copy-complete', 'journal-migrating',
    'migration-26', 'migration-27', 'migration-28', 'migration-29',
    'migration-30', 'migration-31', 'migration-32', 'migration-33',
    'journal-validated', 'candidate-flushed', 'pointer-published',
    'journal-published', 'journal-activated', 'source-removed', 'journal-complete',
])
def test_process_crashes_reconcile_without_partial_activation(tmp_path, boundary):
    seed_legacy(tmp_path)
    program = '''
import os, sys
from planner_lib.migrations.coordinator import Database
def fault(name):
    if name == sys.argv[2]:
        os._exit(77)
Database(sys.argv[1], fault=fault).prepare()
'''
    process = subprocess.run([sys.executable, '-c', program, str(tmp_path), boundary],
                             cwd=Path(__file__).resolve().parents[2],
                             env=dict(os.environ), capture_output=True, timeout=20)
    assert process.returncode == 77, process.stderr.decode()
    if not (tmp_path / 'active-generation.json').exists():
        source = DiskCacheStorage(tmp_path / 'cache')
        assert source.load('opaque', 'large') == b'a' * 100_000
        source.close()
    handle = Database(tmp_path).prepare()
    assert handle.storage.load('opaque', 'large') == b'a' * 100_000
    assert handle.storage.load('system', 'schema_state')['schema_revision'] == 33
    handle.close()
    assert not (tmp_path / 'cache').exists()
    assert len(list((tmp_path / 'generations').iterdir())) == 1


def test_explicit_retry_authorizes_same_build(tmp_path, monkeypatch):
    seed_legacy(tmp_path)
    database = Database(tmp_path, build='fixed')
    with monkeypatch.context() as scoped:
        scoped.setattr(database, '_upgrade', lambda *args: (_ for _ in ()).throw(ValueError()))
        with pytest.raises(SchemaError):
            database.prepare()
    database.retry()
    handle = database.prepare()
    handle.close()


def test_restore_requires_confirmation_and_preserves_external_inputs(tmp_path):
    root = tmp_path / 'installation'
    backup = tmp_path / 'independent-backup'
    seed_legacy(backup)
    handle = Database(root).prepare()
    handle.close()
    external = root / 'config'
    external.mkdir()
    (external / 'input.yml').write_text('external')
    database = Database(root)
    with pytest.raises(SchemaError, match='confirm'):
        database.restore(backup, confirmed=False)
    database.restore(backup, confirmed=True)
    assert database.status()['active_revision'] == 24
    assert (backup / 'cache' / 'cache.db').exists()
    assert (external / 'input.yml').read_text() == 'external'
    assert len(list((root / 'generations').iterdir())) == 1


def test_prepublication_flush_failure_never_selects_candidate(tmp_path, monkeypatch):
    seed_legacy(tmp_path)
    database = Database(tmp_path)
    monkeypatch.setattr(database, '_flush', lambda *args: (_ for _ in ()).throw(OSError()))
    with pytest.raises(SchemaError):
        database.prepare()
    assert not (tmp_path / 'active-generation.json').exists()
    assert (tmp_path / 'cache' / 'cache.db').exists()


def test_cleanup_failure_resumes_without_rerunning_migrations(tmp_path, monkeypatch):
    seed_legacy(tmp_path)
    database = Database(tmp_path)
    with monkeypatch.context() as scoped:
        scoped.setattr(database, '_remove', lambda *args: (_ for _ in ()).throw(OSError()))
        with pytest.raises(OSError):
            database.prepare()
    assert read_json(tmp_path / 'upgrade-state.json')['phase'] == 'activated'
    monkeypatch.setattr(database, '_upgrade', lambda *args: pytest.fail('committed migrations reran'))
    handle = database.prepare()
    handle.close()
    assert not (tmp_path / 'cache').exists()


def test_prune_never_deletes_unowned_generation_directory(tmp_path):
    handle = Database(tmp_path).prepare()
    handle.close()
    backup = tmp_path / 'generations' / ('a' * 32)
    backup.mkdir()
    (backup / 'operator-backup').write_text('preserve')
    with pytest.raises(SchemaError, match='ownership'):
        Database(tmp_path).prune()
    assert (backup / 'operator-backup').read_text() == 'preserve'


def test_expiring_schema_metadata_is_rejected(tmp_path):
    handle = Database(tmp_path).prepare()
    state = handle.storage.load('system', 'schema_state')
    handle.storage.save('system', 'schema_state', state, ttl_seconds=3600)
    handle.close()
    with pytest.raises(SchemaError, match='expire'):
        Database(tmp_path).prepare()


def test_status_reports_newer_schema_without_service_compatibility(tmp_path):
    handle = Database(tmp_path).prepare()
    state = handle.storage.load('system', 'schema_state')
    handle.storage.save('system', 'schema_state', {**state, 'schema_revision': 34})
    handle.close()
    assert Database(tmp_path).status()['active_revision'] == 34
    assert Database(tmp_path).status()['compatibility_error']
    with pytest.raises(SchemaError):
        Database(tmp_path).prepare()


def test_status_of_legacy_database_does_not_create_lock_files(tmp_path):
    seed_legacy(tmp_path)
    before = {str(path.relative_to(tmp_path)): path.read_bytes()
              for path in tmp_path.rglob('*') if path.is_file()}
    assert Database(tmp_path).status()['active_revision'] == 24
    after = {str(path.relative_to(tmp_path)): path.read_bytes()
             for path in tmp_path.rglob('*') if path.is_file()}
    assert before == after


def test_concurrent_current_workers_share_generation_and_killed_owner_releases_lock(tmp_path):
    program = '''
import sys
from planner_lib.migrations.coordinator import Database
handle = Database(sys.argv[1]).prepare()
print(handle.storage.data_dir.parent.name, flush=True)
sys.stdin.readline()
handle.close()
'''
    workers = []
    try:
        for _ in range(2):
            process = subprocess.Popen([sys.executable, '-c', program, str(tmp_path)],
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, text=True, env=dict(os.environ))
            workers.append(process)
        generations = [worker.stdout.readline().strip() for worker in workers]
        assert generations[0] and generations[0] == generations[1]
        workers[0].terminate()
        workers[0].wait(timeout=10)
        with pytest.raises(SchemaError):
            Database(tmp_path, lock_timeout=0).prune()
        workers[1].terminate()
        workers[1].wait(timeout=10)
        Database(tmp_path, lock_timeout=0).prune()
    finally:
        for worker in workers:
            if worker.poll() is None:
                worker.kill()
            worker.communicate(timeout=10)


def test_upgrade_preserves_credentials_ownership_and_saved_data(tmp_path):
    from planner_lib.accounts.config import _encrypt_pat, _decrypt_pat
    from uuid import UUID

    seed_legacy(tmp_path)
    source = DiskCacheStorage(tmp_path / 'cache')
    encrypted = _encrypt_pat('isolated-azure-token')
    account = {'email': 'owner@example.test', 'pat': encrypted, 'permissions': ['admin']}
    source.save('accounts', 'owner@example.test', account)
    source.save('views', 'owner@example.test_item', {'viewOptions': {'expandParentChild': True}})
    source.save('views', 'view_register', {'owner@example.test_item': {
        'user': 'owner@example.test', 'id': 'item', 'name': 'Preserved',
    }})
    source.save('scenarios', 'deleted@example.test_item', {'name': 'Orphaned'})
    source.save('auth_sessions', 'legacy', {'email': 'owner@example.test'})
    source.save('config', 'plugin_runtime_config', {'schema_version': 1, 'plugins': [{
        'id': 'sample-menu-plugin', 'enabled': True, 'activated': True,
        'order': 7, 'custom_config': {'preserved': True},
    }]})
    source.close()
    handle = Database(tmp_path).prepare()
    try:
        migrated = handle.storage.load('accounts', 'owner@example.test')
        account_id = migrated['account_id']
        assert str(UUID(account_id)) == account_id
        assert migrated == {**account, 'account_id': account_id}
        assert _decrypt_pat(migrated['pat']) == 'isolated-azure-token'
        assert handle.storage.load('account_auth', account_id) == {'enrolled': False}
        assert handle.storage.load('views', account_id + '_item')['viewOptions']['context'] == {
            'parent': True, 'child': True, 'dependency': False, 'otherAllocations': False,
        }
        assert handle.storage.load('views', 'view_register')[account_id + '_item']['name'] == 'Preserved'
        orphan_key = next(key for key in handle.storage.list_keys('scenarios') if key != 'scenario_register')
        assert str(UUID(orphan_key.partition('_')[0])) != account_id
        assert handle.storage.load('scenarios', orphan_key)['name'] == 'Orphaned'
        assert not handle.storage.exists('auth_sessions', 'legacy')
        plugin = handle.storage.load('config', 'plugin_runtime_config')['plugins'][0]
        assert plugin['activateOnStartup'] is False
        assert plugin['menuPosition'] == 'before-tools'
        assert plugin['custom_config'] == {'preserved': True}
        assert 'order' not in plugin
        assert handle.storage.load('system', 'schema_state')['initialized_at_revision'] is None
    finally:
        handle.close()


def test_legacy_export_is_independent_and_does_not_change_selection(tmp_path):
    installation = tmp_path / 'installation'
    backup = tmp_path / 'backup'
    export = tmp_path / 'legacy-export'
    seed_legacy(backup)
    database = Database(installation)
    database.restore(backup, confirmed=True)
    pointer = (installation / 'active-generation.json').read_bytes()
    database.export_legacy(export)
    assert (export / 'cache' / 'cache.db').exists()
    assert not (export / 'active-generation.json').exists()
    assert Database(export).status()['active_revision'] == 24
    assert (installation / 'active-generation.json').read_bytes() == pointer
    active = database._source(database._pointer()) / 'cache.db'
    assert active.stat().st_ino != (export / 'cache' / 'cache.db').stat().st_ino
    with pytest.raises(SchemaError):
        database.export_legacy(installation / 'copy')
    with pytest.raises(SchemaError):
        database.export_legacy(export)


def test_v421_adopts_authoritative_server_yaml_and_unversioned_people(tmp_path):
    import yaml

    seed_legacy(tmp_path)
    storage = DiskCacheStorage(tmp_path / 'cache')
    storage.delete('config', 'server_config')
    people = {'database': {'people': []}}
    storage.save('config', 'people', people)
    storage.close()
    (tmp_path / 'config').mkdir()
    server_path = tmp_path / 'config' / 'server_config.yml'
    server = {'schema_version': 2, 'server_name': 'Preserved', 'feature_flags': {}}
    server_path.write_text(yaml.safe_dump(server))
    external = tmp_path / 'config' / 'database.yaml'
    external.write_text('external')
    database = Database(tmp_path)
    assert database.status()['active_revision'] == 24
    handle = database.prepare()
    try:
        assert handle.storage.load('config', 'server_config') == server
        assert handle.storage.load('config', 'people') == people
    finally:
        handle.close()
    assert not server_path.exists()
    assert external.read_text() == 'external'


def test_restore_and_export_v421_yaml_layout(tmp_path):
    import yaml

    backup = tmp_path / 'backup'
    seed_legacy(backup)
    storage = DiskCacheStorage(backup / 'cache')
    storage.delete('config', 'server_config')
    storage.close()
    (backup / 'config').mkdir()
    server = {'schema_version': 2, 'feature_flags': {}, 'server_name': 'Original'}
    (backup / 'config' / 'server_config.yml').write_text(yaml.safe_dump(server))
    installation = tmp_path / 'installation'
    database = Database(installation)
    database.restore(backup, confirmed=True)
    assert database.status()['active_revision'] == 24
    output = tmp_path / 'legacy-output'
    database.export_legacy(output)
    assert yaml.safe_load((output / 'config' / 'server_config.yml').read_text()) == server
    assert (backup / 'config' / 'server_config.yml').exists()
    assert Database(output).status()['active_revision'] == 24


def test_failure_journal_write_fails_closed_without_secret_traceback(tmp_path, monkeypatch):
    import errno
    import traceback
    from planner_lib.migrations import coordinator

    seed_legacy(tmp_path)
    database = Database(tmp_path)
    original = coordinator.write_json

    def fail_record(path, payload):
        if payload.get('phase') == 'failed':
            raise OSError(errno.ENOSPC, 'private-journal-details')
        return original(path, payload)

    monkeypatch.setattr(coordinator, 'write_json', fail_record)
    monkeypatch.setattr(database, '_upgrade', lambda *args: (_ for _ in ()).throw(
        ValueError('private-migration-details')))
    with pytest.raises(SchemaError, match='durably') as captured:
        database.prepare()
    assert 'private-' not in ''.join(traceback.format_exception(captured.value))
    assert not (tmp_path / 'active-generation.json').exists()
    assert (tmp_path / 'cache' / 'cache.db').exists()


def test_restore_over_legacy_yaml_cleans_owned_source_only(tmp_path):
    root = tmp_path / 'installation'
    seed_legacy(root)
    storage = DiskCacheStorage(root / 'cache')
    storage.delete('config', 'server_config')
    storage.close()
    (root / 'config').mkdir()
    owned = root / 'config' / 'server_config.yml'
    owned.write_text('schema_version: 2\nfeature_flags: {}\n')
    external = root / 'config' / 'database.yaml'
    external.write_text('external-input')
    backup = tmp_path / 'backup'
    handle = Database(backup).prepare()
    handle.close()
    Database(root).restore(backup, confirmed=True)
    assert not owned.exists()
    assert external.read_text() == 'external-input'
    assert Database(root).status()['active_revision'] == 33