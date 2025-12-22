import os
os.environ['PLANNERTOOL_SKIP_SETUP'] = '1'

import importlib
import pytest
from fastapi.testclient import TestClient
from pathlib import Path
import tempfile
import yaml

# Ensure planner module is imported with the skip-setup flag set before import
# Use a temporary config directory for tests so we don't write into production `data/`.
tmp = tempfile.mkdtemp(prefix="plannertool-test-config-")
tmp_cfg_dir = Path(tmp) / "config"
tmp_cfg_dir.mkdir(parents=True, exist_ok=True)
db_file = tmp_cfg_dir / "database.yaml"
db_file.write_text(yaml.safe_dump({"database": {}}), encoding='utf-8')

# Point the cost config loader at the temporary config dir before importing planner
import planner_lib.cost.config as cost_config
cost_config.CONFIG_PATH = tmp_cfg_dir

import planner
importlib.reload(planner)
from planner import app, SESSIONS


def test_reload_config_endpoint_sets_ok():
    client = TestClient(app)
    # create a dummy session
    sid = 'test-session'
    SESSIONS[sid] = {'email': 'test@example.com'}
    headers = {'X-Session-Id': sid}
    resp = client.post('/api/admin/reload-config', headers=headers)
    assert resp.status_code == 200
    assert resp.json().get('ok') is True