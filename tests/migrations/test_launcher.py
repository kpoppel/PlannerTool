import json
import os
from pathlib import Path
import subprocess
import sys
import pytest


def test_offline_status_creates_no_database(tmp_path):
    root = tmp_path / 'missing'
    process = subprocess.run([
        sys.executable, 'planner.py', 'database', 'status', '--data-dir', str(root),
    ], cwd=Path(__file__).resolve().parents[2], env={**os.environ, 'DATA_DIR': str(root)},
        capture_output=True, timeout=20)
    assert process.returncode == 0, process.stderr.decode()
    assert json.loads(process.stdout)['active_revision'] is None
    assert not root.exists()


def test_restore_without_confirmation_exits_nonzero_without_creating_database(tmp_path):
    root = tmp_path / 'missing'
    process = subprocess.run([
        sys.executable, 'planner.py', 'database', 'restore', '--data-dir', str(root),
        '--backup', str(tmp_path / 'backup'),
    ], cwd=Path(__file__).resolve().parents[2], env={**os.environ, 'DATA_DIR': str(root)},
        capture_output=True, timeout=20)
    assert process.returncode != 0
    assert b'confirm' in process.stderr
    assert not root.exists()


def test_runtime_image_packages_server_resources_not_historical_runner():
    root = Path(__file__).resolve().parents[2]
    dockerfile = (root / 'docker' / 'Dockerfile').read_text()
    entrypoint = (root / 'docker' / 'entrypoint.sh').read_text()
    assert 'COPY planner_lib ./planner_lib' in dockerfile
    assert 'COPY scripts/migrate.py' not in dockerfile
    assert 'COPY scripts/migrations' not in dockerfile
    assert 'migrate.py --apply' not in entrypoint
    assert 'start anyway' not in entrypoint


def test_historical_migration_scripts_are_removed() -> None:
    """All launchers must rely on server-owned database preparation."""
    root = Path(__file__).resolve().parents[2]
    assert not (root / 'scripts' / 'migrate.py').exists()
    assert not (root / 'scripts' / 'migrations').exists()
    assert 'migrate.py' not in (root / 'scripts' / 'systemd_runner.sh').read_text()


def test_build_context_excludes_operator_data_and_secrets():
    root = Path(__file__).resolve().parents[2]
    ignore = (root / '.dockerignore').read_text()
    assert ignore.splitlines()[0] == '**'
    for forbidden in ('!data', '!backup', '!backups', '!.encryption_key', '!deployment'):
        assert forbidden not in ignore.splitlines()


@pytest.mark.skipif('PLANNER_MIGRATION_IMAGE' not in os.environ, reason='requires a built runtime image')
@pytest.mark.parametrize('legacy', [False, True, 'yaml'])
def test_runtime_image_http_startup_on_disposable_volume(tmp_path, legacy):
    from tests.migrations.test_coordinator import seed_legacy

    root = tmp_path / 'installation'
    root.mkdir()
    if legacy:
        seed_legacy(root)
    (root / 'config').mkdir()
    if legacy == 'yaml':
        from planner_lib.storage.diskcache_backend import DiskCacheStorage
        storage = DiskCacheStorage(root / 'cache')
        storage.delete('config', 'server_config')
        people = storage.load('config', 'people')
        del people['schema_version']
        storage.save('config', 'people', people)
        storage.close()
        owned = root / 'config' / 'server_config.yml'
        owned.write_text('schema_version: 2\nlog_level: INFO\nfeature_flags: {}\n')
        owned.chmod(0o600)
    external = tmp_path / 'external.yaml'
    external.write_text('external-input')
    program = '''
import json, threading, urllib.request
from pathlib import Path
import uvicorn
from planner_lib.migrations.coordinator import Database
ready = threading.Event()
class Server(uvicorn.Server):
    async def startup(self, sockets=None):
        await super().startup(sockets)
        ready.set()
server = Server(uvicorn.Config('planner:make_app', factory=True, host='127.0.0.1',
                              port=0, log_level='error'))
thread = threading.Thread(target=server.run, daemon=True)
thread.start()
assert ready.wait(15), 'HTTP listener did not start'
try:
    port = server.servers[0].sockets[0].getsockname()[1]
    response = urllib.request.urlopen('http://127.0.0.1:' + str(port) + '/', timeout=5)
    assert response.status == 200
    assert b'<base href="/static/">' in response.read()
    assert Database('/app/data').status()['active_revision'] == 33
    assert not Path('/app/scripts/migrate.py').exists()
    assert not Path('/app/cache').exists()
    assert Path('/app/data/config/database.yaml').read_text() == 'external-input'
finally:
    server.should_exit = True
    thread.join(10)
assert not thread.is_alive(), 'Shutdown did not finish'
Database('/app/data', lock_timeout=0).prune()
assert len(list(Path('/app/data/generations').iterdir())) == 1
print('Runtime HTTP startup and shutdown passed')
'''
    process = subprocess.run([
        'docker', 'run', '--rm', '-e', 'PLANNER_SECRET_KEY=isolated-image-test-only',
        '-v', str(root) + ':/app/data',
        '-v', str(external) + ':/app/data/config/database.yaml:ro',
        os.environ['PLANNER_MIGRATION_IMAGE'], 'python', '-c', program,
    ], capture_output=True, text=True, timeout=45)
    assert process.returncode == 0, process.stdout + process.stderr
    assert external.read_text() == 'external-input'
    assert not (root / 'config' / 'server_config.yml').exists()


@pytest.mark.skipif('PLANNER_MIGRATION_IMAGE' not in os.environ, reason='requires a built runtime image')
def test_runtime_image_rejects_unsupported_schema_before_http(tmp_path):
    from planner_lib.storage.diskcache_backend import DiskCacheStorage

    storage = DiskCacheStorage(tmp_path / 'cache')
    storage.save('system', 'schema_state', {
        'schema_revision': 34, 'last_applied_migration': None, 'initialized_at_revision': 34,
    })
    storage.close()
    process = subprocess.run([
        'docker', 'run', '--rm', '-e', 'PLANNER_SECRET_KEY=isolated-image-test-only',
        '-v', str(tmp_path) + ':/app/data', os.environ['PLANNER_MIGRATION_IMAGE'],
        'python', '-c', 'from planner import make_app; make_app()',
    ], capture_output=True, text=True, timeout=30)
    assert process.returncode != 0
    assert 'Unsupported schema revision' in process.stderr
    assert not (tmp_path / 'active-generation.json').exists()


@pytest.mark.skipif('PLANNER_MIGRATION_IMAGE' not in os.environ, reason='requires a built runtime image')
@pytest.mark.parametrize('reload', [False, True])
def test_runtime_image_direct_launch_and_reload_release_ownership(tmp_path, reload):
    program = r'''
import os, signal, socket, subprocess, sys, threading, time, urllib.request
from pathlib import Path
from planner_lib.migrations.coordinator import Database
reload = sys.argv[1] == 'True'
watch = Path('/tmp/reload-watch')
watch.mkdir()
trigger = watch / 'trigger.py'
trigger.write_text('VALUE = 1\n')
with socket.socket() as listener:
    listener.bind(('127.0.0.1', 0))
    port = listener.getsockname()[1]
command = [sys.executable, 'planner.py']
if reload:
    command = [sys.executable, '-m', 'uvicorn', 'planner:make_app', '--factory',
               '--host', '127.0.0.1', '--port', str(port), '--reload',
               '--reload-dir', str(watch)]
log = Path('/tmp/launcher.log')
def wait_for(check):
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        assert process.poll() is None, log.read_text()
        if check():
            return
        threading.Event().wait(0.05)
    raise AssertionError(log.read_text())
def http_ready():
    try:
        return urllib.request.urlopen('http://127.0.0.1:' + str(port) + '/', timeout=1).status == 200
    except OSError:
        return False
with log.open('w') as output:
    process = subprocess.Popen(command, stdout=output, stderr=output,
                               env={**os.environ, 'HOST': '127.0.0.1', 'PORT': str(port)})
    try:
        wait_for(http_ready)
        pointer = Path('/app/data/active-generation.json').read_bytes()
        if reload:
            wait_for(lambda: 'Started server process' in log.read_text())
            threading.Event().wait(0.5)
            trigger.write_text('VALUE = 2\n')
            os.utime(trigger, (time.time() + 3, time.time() + 3))
            wait_for(lambda: log.read_text().count('Started server process') >= 2)
            wait_for(http_ready)
            assert Path('/app/data/active-generation.json').read_bytes() == pointer
    finally:
        process.terminate()
        process.wait(timeout=15)
assert process.returncode in (0, -signal.SIGTERM), log.read_text()
Database('/app/data', lock_timeout=0).prune()
assert Database('/app/data').status()['active_revision'] == 33
'''
    process = subprocess.run([
        'docker', 'run', '--rm', '-e', 'PLANNER_SECRET_KEY=isolated-image-test-only',
        '-v', str(tmp_path) + ':/app/data', os.environ['PLANNER_MIGRATION_IMAGE'],
        'python', '-c', program, str(reload),
    ], capture_output=True, text=True, timeout=60)
    assert process.returncode == 0, process.stdout + process.stderr