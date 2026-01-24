from tests.helpers import register_service_on_client


def test_reload_config_appends_server_config(client, monkeypatch):
    # Ensure setup._loaded_config exists
    import planner_lib.setup as setup_module
    setup_module._loaded_config = []

    # Provide a server_config_storage that returns a config dict via the container
    fake_storage = type('S', (), {'load': lambda self, k: {'server': 'cfg'}})()
    register_service_on_client(client, 'server_config_storage', fake_storage)

    # Call endpoint
    r = client.post('/admin/v1/reload-config')
    assert r.status_code == 200
    assert setup_module._loaded_config and setup_module._loaded_config[-1] == {'server': 'cfg'}
    # Reset to avoid leaking a raw dict into subsequent test runs
    setup_module._loaded_config = []


def test_reload_config_calls_invalidate_and_account_load(client, monkeypatch):
    called = {'invalidate': False, 'account_load': False}

    # monkeypatch cost engine invalidate
    def _invalidate():
        called['invalidate'] = True

    monkeypatch.setattr('planner_lib.cost.engine.invalidate_team_rates_cache', _invalidate)

    # Create a proxy account manager that delegates `save` to the real
    # manager but intercepts `load` so we can record calls. Register it in
    # the container so resolver picks it up.
    real_mgr = client.app.state.container.get('account_manager')

    class ProxyAcctMgr:
        def save(self, payload):
            return real_mgr.save(payload)

        def load(self, sid):
            called['account_load'] = True
            return real_mgr.load(sid)

    register_service_on_client(client, 'account_manager', ProxyAcctMgr())

    # ensure cost loader is available (no-op)
    monkeypatch.setattr('planner_lib.cost.config.load_cost_config', lambda: None)

    # create account and session for auth
    r = client.post('/api/account', json={'email': 'b@test.com', 'pat': 't'})
    assert r.status_code in (200, 201)
    r2 = client.post('/api/session', json={'email': 'b@test.com'})
    assert r2.status_code == 200

    sid = r2.json().get('sessionId')
    r3 = client.post('/admin/v1/reload-config', headers={'X-Session-Id': sid})
    assert r3.status_code == 200
    assert called['invalidate'] is True
    assert called['account_load'] is True
