import os
os.environ['PLANNERTOOL_SKIP_SETUP'] = '1'

import pytest
from fastapi.testclient import TestClient

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