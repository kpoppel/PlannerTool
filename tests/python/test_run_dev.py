import os
import shutil
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def launcher(tmp_path):
    scripts = tmp_path / 'scripts'
    scripts.mkdir()
    script = scripts / 'run_dev.sh'
    shutil.copyfile(ROOT / 'scripts/run_dev.sh', script)
    (tmp_path / '.encryption_key').write_text('synthetic-installation-key')
    (tmp_path / '.encryption_key').chmod(0o600)
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith(('PLANNER_', 'ENTRA_', 'VIRTUAL_ENV'))}
    return script, environment


def test_development_help_explains_credentials_and_validation(launcher):
    script, environment = launcher
    result = subprocess.run(['bash', str(script), '--help'], env=environment,
                            capture_output=True, text=True, timeout=10)
    assert result.returncode == 0
    assert '--check' in result.stdout
    assert 'ENTRA_CLIENT_CERTIFICATE_FILE' in result.stdout
    assert 'ENTRA_CLIENT_CERTIFICATE_KEY_FILE' in result.stdout
    assert 'ENTRA_CLIENT_SECRET_FILE' in result.stdout
    assert 'docs/DEPLOYMENT.md' in result.stdout


def test_development_check_requires_project_virtual_environment(launcher):
    script, environment = launcher
    result = subprocess.run(['bash', str(script), '--check'], env=environment,
                            capture_output=True, text=True, timeout=10)
    assert result.returncode != 0
    assert '.venv' in result.stderr


@pytest.mark.parametrize('preflight_status', [0, 1])
def test_development_check_validates_broker_without_starting_services(launcher, preflight_status):
    script, environment = launcher
    root = script.parent.parent
    python = root / '.venv/bin/python'
    python.parent.mkdir(parents=True)
    python.write_text('#!/bin/bash\n'
                      'if [[ "$1" == "entra-id/app.py" && "$2" == "--check" ]]; then\n'
                      '  printf "broker preflight checked\\n"\n'
                      f'  exit {preflight_status}\n'
                      'fi\n'
                      '[[ "$1" == "-c" ]]\n')
    python.chmod(0o700)
    vite = root / 'node_modules/.bin/vite'
    vite.parent.mkdir(parents=True)
    vite.write_text('#!/bin/bash\nprintf "must not start Vite\\n" >&2\nexit 99\n')
    vite.chmod(0o700)
    auth_env = root / 'auth.env'
    auth_env.write_text('PLANNER_AUTH_INSTANCE=dev\n'
                        'PLANNER_AUTH_PUBLIC_URL=https://localhost:5174/auth/\n')
    auth_env.chmod(0o600)
    result = subprocess.run(['bash', str(script), '--auth-env', str(auth_env), '--check'],
                            env=environment, capture_output=True, text=True, timeout=10)
    assert result.returncode == preflight_status
    assert 'broker preflight checked' in result.stdout
    assert 'must not start' not in result.stderr
    assert not (root / 'logfile.log').exists()


def test_container_missing_installation_key_guides_without_touching_data(tmp_path):
    environment = {**os.environ, 'PLANNER_SECRET_KEY': '', 'DATA_DIR': str(tmp_path / 'data')}
    result = subprocess.run(['sh', str(ROOT / 'docker/entrypoint.sh'), 'false'],
                            env=environment, capture_output=True, text=True, timeout=10)
    assert result.returncode != 0
    assert 'docs/DEPLOYMENT.md' in result.stdout + result.stderr
    assert 'original' in result.stdout + result.stderr
    assert not (tmp_path / 'data').exists()