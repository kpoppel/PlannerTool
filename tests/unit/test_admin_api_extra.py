import pytest


def test_reload_config_raises_500(client, monkeypatch):
    # Force cost_config.load_cost_config to raise so endpoint returns 500
    def _load():
        raise RuntimeError('fail')

    try:
        monkeypatch.setattr('planner_lib.cost.config.load_cost_config', _load)
    except ImportError:
        # In some test environments the optional cost config module may not
        # be present; skip the test in that case rather than failing.
        import pytest

        pytest.skip('planner_lib.cost.config not available')

    # create account and session for auth
    r = client.post('/api/account', json={'email': 'a@test.com', 'pat': 't'})
    assert r.status_code in (200, 201)
    r2 = client.post('/api/session', json={'email': 'a@test.com'})
    assert r2.status_code == 200
    sid = r2.json().get('sessionId')

    from fastapi.testclient import TestClient

    tc = TestClient(client.app, raise_server_exceptions=False)
    resp = tc.post('/admin/v1/reload-config', headers={'X-Session-Id': sid})
    assert resp.status_code == 500
