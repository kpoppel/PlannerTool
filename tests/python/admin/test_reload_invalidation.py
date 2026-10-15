import pytest
from unittest.mock import Mock


@pytest.mark.real_auth
def test_reload_config_invalidates_without_loading_credentials(client, monkeypatch):
    service = client.app.state.container.get('cost_service')
    reload_cost = Mock(wraps=service.reload)
    monkeypatch.setattr(service, 'reload', reload_cost)

    real_mgr = client.app.state.container.get('account_manager')
    from planner_lib.accounts.config import AccountCredentialsPayload
    real_mgr.create_account(AccountCredentialsPayload(email='b@test.com', pat='t'), ['admin'])
    session_mgr = client.app.state.container.get('session_manager')
    sid = session_mgr.create('b@test.com')
    load_account = Mock(wraps=real_mgr.load)
    monkeypatch.setattr(real_mgr, 'load', load_account)
    client.cookies.set('sessionId', sid)
    r3 = client.post('/admin/v1/reload-config')
    assert r3.status_code == 200
    reload_cost.assert_called_once_with()
    load_account.assert_not_called()
