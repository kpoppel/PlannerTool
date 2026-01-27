import os
os.environ['PLANNERTOOL_SKIP_SETUP'] = '1'

from fastapi.testclient import TestClient
from pathlib import Path
import tempfile
import yaml

from planner_lib.main import create_app, Config


# Use a temporary config directory for tests so we don't write into production `data`.
tmp = tempfile.mkdtemp(prefix="plannertool-test-config-")
tmp_cfg_dir = Path(tmp) / "config"
tmp_cfg_dir.mkdir(parents=True, exist_ok=True)
db_file = tmp_cfg_dir / "database.yaml"
db_file.write_text(yaml.safe_dump({"database": {}}), encoding='utf-8')

# Point the cost config loader at the temporary config dir before creating the app
try:
    import planner_lib.cost.config as cost_config
    cost_config.CONFIG_PATH = tmp_cfg_dir
except Exception:
    # The cost.config module may be optional in some environments; tests
    # should still collect and run. If the module is unavailable, set
    # cost_config to None and continue.
    cost_config = None


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
    # Mark created account as admin so the admin endpoint accepts the session
    try:
        acct_storage = client.app.state.container.get('account_storage')
        acct_storage.save('accounts_admin', acct['email'], {'email': acct['email']})
    except Exception:
        pass
    # Ensure session manager has the session context for the created sid
    try:
        session_mgr = client.app.state.container.get('session_manager')
        session_mgr._store[sid] = {'email': acct['email'], 'pat': 'token'}
    except Exception:
        pass

    # The admin route is available at /admin/v1/reload-config
    resp = client.post('/admin/v1/reload-config', headers=headers)
    assert resp.status_code == 200
    assert resp.json().get('ok') is True