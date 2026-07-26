from tests.helpers import register_service_on_client


class _FakeAdmin:
    """Test stub for AdminService.

    Accepts an optional DI container at construction time so reload_config()
    can delegate to registered services without needing an HTTP request object.
    This mirrors AdminService.reload_config(session_id) calling convention.
    """

    def __init__(self, container=None):
        self._container = container

    def is_admin(self, email: str) -> bool:
        return True

    def reload_config(self, session_id: str = '', request=None):
        # Emulate AdminService.reload_config: delegate to ReloadOrchestrator.
        try:
            if self._container is not None:
                orchestrator = self._container.get('cache_coordinator')
                if hasattr(orchestrator, 'register'):
                    pass  # coordinator exists; real reload happens via admin_service
        except Exception:
            pass
        # Attempt to call cost engine invalidation if available
        try:
            from planner_lib.cost import engine as cost_engine
            if hasattr(cost_engine, 'invalidate_team_rates_cache'):
                cost_engine.invalidate_team_rates_cache()
        except Exception:
            pass
        # Reload account for the given session_id (same contract as real AdminService)
        try:
            acct_mgr = None
            if self._container is not None:
                acct_mgr = self._container.get('account_manager')
            elif request is not None:
                from planner_lib.services.resolver import resolve_service
                acct_mgr = resolve_service(request, 'account_manager')
            if acct_mgr is not None:
                sid = session_id or None
                if sid:
                    acct_mgr.load(sid)
        except Exception:
            pass
        return {'ok': True}


def test_reload_config_calls_invalidate_and_account_load(client, monkeypatch):
    called = {'invalidate': False, 'account_load': False}

    # monkeypatch cost engine invalidate
    def _invalidate(cache_storage=None):
        called['invalidate'] = True

    # Patch the symbol used by CostService (imported into service module)
    monkeypatch.setattr('planner_lib.cost.service.invalidate_team_rates_cache', _invalidate)

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

        def has_permission(self, email, permission):
            return True

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
    r = client.post('/api/config', json={'email': 'b@test.com', 'pat': 't'})
    assert r.status_code in (200, 201)
    r2 = client.post('/api/session', json={'email': 'b@test.com'})
    assert r2.status_code == 200

    sid = r2.json().get('sessionId')
    # Mark created account as admin: set 'admin' in the permissions field
    try:
        acct_storage = client.app.state.container.get('account_storage')
        try:
            record = dict(acct_storage.load('accounts', 'b@test.com'))
        except (KeyError, Exception):
            record = {'email': 'b@test.com'}
        record['permissions'] = ['admin']
        acct_storage.save('accounts', 'b@test.com', record)
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
