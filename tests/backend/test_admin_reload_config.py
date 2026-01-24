import os
os.environ['PLANNERTOOL_SKIP_SETUP'] = '1'

from fastapi.testclient import TestClient
from pathlib import Path
import tempfile
import yaml

from planner_lib.main import create_app, Config
import planner_lib.cost.config as cost_config


# Use a temporary config directory for tests so we don't write into production `data`.
tmp = tempfile.mkdtemp(prefix="plannertool-test-config-")
tmp_cfg_dir = Path(tmp) / "config"
tmp_cfg_dir.mkdir(parents=True, exist_ok=True)
db_file = tmp_cfg_dir / "database.yaml"
db_file.write_text(yaml.safe_dump({"database": {}}), encoding='utf-8')

# Point the cost config loader at the temporary config dir before creating the app
cost_config.CONFIG_PATH = tmp_cfg_dir


def test_reload_config_endpoint_sets_ok(client):
    # Create an account and a session via the API so the session manager
    # contains a valid session for this test
    acct = {"email": "test@example.com", "pat": "token"}
    r_acct = client.post('/api/account', json=acct)
    assert r_acct.status_code in (200, 201)
    r_sess = client.post('/api/session', json={"email": acct["email"]})
    assert r_sess.status_code == 200
    sid = r_sess.json().get('sessionId')
    headers = {'X-Session-Id': sid}

    # The admin route is available at /admin/v1/reload-config
    resp = client.post('/admin/v1/reload-config', headers=headers)
    assert resp.status_code == 200
    assert resp.json().get('ok') is True