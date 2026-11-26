import pytest
from unittest.mock import Mock


@pytest.mark.real_auth
def test_reload_config_invalidates_cost_service(client, monkeypatch):
    service = client.app.state.container.get('cost_service')
    reload_cost = Mock(wraps=service.reload)
    monkeypatch.setattr(service, 'reload', reload_cost)

    real_mgr = client.app.state.container.get('account_manager')
    from planner_lib.accounts.config import AccountIdentityPayload
    real_mgr.create_account(AccountIdentityPayload(email='b@test.com'), ['admin'])
    session_mgr = client.app.state.container.get('session_manager')
    sid = session_mgr.create('b@test.com')
    client.cookies.set('sessionId', sid)
    r3 = client.post('/admin/v1/reload-config')
    assert r3.status_code == 200
    reload_cost.assert_called_once_with()
