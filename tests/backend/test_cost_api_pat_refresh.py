"""Cost requests use current account credentials, not copied session PATs."""
import os
os.environ.setdefault('PLANNERTOOL_SKIP_SETUP', '1')

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from planner_lib.main import create_app, Config
from planner_lib.accounts.config import AccountCredentialsPayload
from planner_lib.middleware import session as session_module


pytestmark = pytest.mark.real_auth


def _make_app(tmp_path: Path) -> TestClient:
    cfg_dir = tmp_path / "config"
    cfg_dir.mkdir(parents=True, exist_ok=True)

    # Write default server_config to diskcache so the server finds it on startup
    from diskcache import Cache
    cache = Cache(directory=str(tmp_path))
    cache.set("config::server_config", {"azure_devops_organization": "", "feature_flags": {}})
    cache.close()

    app = create_app(Config(data_dir=str(tmp_path)))
    return TestClient(app, raise_server_exceptions=True)


@pytest.fixture()
def client(tmp_path):
    return _make_app(tmp_path)


class _FakeCostService:
    """Minimal cost service stub: returns a valid empty cost result."""

    def estimate_costs(self, ctx):
        return {"projects": {}, "project_types": {}}


@pytest.mark.parametrize('pat', [None, 'updated-token'])
@pytest.mark.parametrize('method', ['post', 'get'])
def test_cost_uses_live_account_pat_without_session_refresh(client, caplog, monkeypatch, pat, method):
    import logging

    email = "user@example.com"
    container = client.app.state.container
    account_mgr = container.get("account_manager")
    session_mgr = container.get("session_manager")
    account_mgr.update_credentials(AccountCredentialsPayload(email=email))
    sid = session_mgr.create(email)
    account_mgr.update_credentials(AccountCredentialsPayload(email=email, pat=pat))
    assert session_mgr.get(sid)['pat'] == pat

    def reject_session_refresh(*args):
        raise AssertionError('PAT is already resolved from the account')

    monkeypatch.setattr(session_mgr, 'set_val', reject_session_refresh, raising=False)
    client.cookies.set(session_module.SESSION_COOKIE, sid)

    container.register_singleton("cost_service", _FakeCostService())
    read_tasks = Mock(return_value=[])
    container.register_singleton('task_repository', SimpleNamespace(read=read_tasks))

    with caplog.at_level(logging.ERROR, logger="planner_lib.cost.api"):
        if method == 'post':
            response = client.post('/api/cost', json={'features': []},
                                   headers={'Accept': 'application/json'})
        else:
            response = client.get('/api/cost', headers={
                'Accept': 'application/json', 'X-Session-Id': 'unsupported-session',
            })
            read_tasks.assert_called_once()

    assert response.status_code == 200, response.text
    error_logs = [r for r in caplog.records if "Failed to load user config" in r.message]
    assert not error_logs
