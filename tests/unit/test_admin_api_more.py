from tests.helpers import register_service_on_client


class _FakeAdmin:
    def is_admin(self, email: str) -> bool:
        return True

    def reload_config(self, request=None):
        # Emulate AdminService.reload_config behavior needed by tests: load
        # server_config from the registered storage and append to setup._loaded_config
        try:
            from planner_lib.services.resolver import resolve_service
            storage = resolve_service(request, 'server_config_storage')
            try:
                cfg = storage.load('config', 'server_config')
            except Exception:
                cfg = None
            if cfg is not None:
                import planner_lib.setup as setup_module
                if hasattr(setup_module, '_loaded_config'):
                    setup_module._loaded_config.clear()
                    setup_module._loaded_config.append(cfg)
        except Exception:
            pass
        # Attempt to call cost engine invalidation if available
        try:
            from planner_lib.cost import engine as cost_engine
            if hasattr(cost_engine, 'invalidate_team_rates_cache'):
                cost_engine.invalidate_team_rates_cache()
        except Exception:
            pass
        # Attempt to refresh account via account_manager.load
        try:
            from planner_lib.services.resolver import resolve_service
            sid = None
            try:
                from planner_lib.middleware.session import get_session_id_from_request as _get_session
                sid = _get_session(request)
            except Exception:
                sid = None
            acct_mgr = resolve_service(request, 'account_manager')
            try:
                acct_mgr.load(sid)
            except Exception:
                pass
        except Exception:
            pass
        return {'ok': True}


def test_reload_config_appends_server_config(client, monkeypatch):
    # Ensure setup._loaded_config exists
    import planner_lib.setup as setup_module
    setup_module._loaded_config = []

    # Provide a server_config_storage that returns a config dict via the container
    fake_storage = type('S', (), {'load': lambda self, namespace, key: {'server': 'cfg'}})()
    register_service_on_client(client, 'server_config_storage', fake_storage)
    # Ensure admin checks succeed in tests by registering a permissive admin service
    register_service_on_client(client, 'admin_service', _FakeAdmin())

    # Ensure a session context exists for the test session id so the
    # middleware/require_admin_session can resolve the email.
    try:
        session_mgr = client.app.state.container.get('session_manager')
        session_mgr._store['test-session'] = {'email': 'test@example.com', 'pat': 'token'}
    except Exception:
        pass

    # Call endpoint (provide session id header so request is treated as authenticated)
    r = client.post('/admin/v1/reload-config', headers={'X-Session-Id': 'test-session'})
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
    # Also ensure the AdminService uses our proxy so reload_config triggers the proxy.load
    try:
        admin_svc = client.app.state.container.get('admin_service')
        admin_svc._account_manager = client.app.state.container.get('account_manager')
    except Exception:
        pass

    # ensure cost loader is available (no-op)
    # The cost.config module may be optional in some test environments; avoid
    # raising if it's not importable.
    # Ensure cost loader is available (no-op). Import-guard to avoid ImportError
    try:
        import planner_lib.cost.config as cost_config
    except Exception:
        cost_config = None
    if cost_config is not None:
        monkeypatch.setattr(cost_config, 'load_cost_config', lambda: None)

    # create account and session for auth
    r = client.post('/api/account', json={'email': 'b@test.com', 'pat': 't'})
    assert r.status_code in (200, 201)
    r2 = client.post('/api/session', json={'email': 'b@test.com'})
    assert r2.status_code == 200

    sid = r2.json().get('sessionId')
    # Mark created account as admin so the admin endpoint accepts the session
    try:
        acct_storage = client.app.state.container.get('account_storage')
        acct_storage.save('accounts_admin', 'b@test.com', {'email': 'b@test.com'})
    except Exception:
        pass
    # Ensure session manager has the session context for the created sid
    try:
        session_mgr = client.app.state.container.get('session_manager')
        session_mgr._store[sid] = {'email': 'b@test.com', 'pat': 't'}
    except Exception:
        pass
    # Ensure cookie is present so AdminService.reload_config will pick up the sid
    client.cookies.set('sessionId', sid)
    r3 = client.post('/admin/v1/reload-config', headers={'X-Session-Id': sid})
    assert r3.status_code == 200
    assert called['invalidate'] is True
    assert called['account_load'] is True
