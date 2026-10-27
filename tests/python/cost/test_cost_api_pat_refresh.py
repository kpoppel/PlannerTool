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


def test_cost_metadata_uses_only_anonymous_workforce(client) -> None:
    """The public metadata endpoint never resolves people or legacy name-keyed rates."""
    container = client.app.state.container
    email = 'workforce-metadata@example.com'
    container.get('account_manager').update_credentials(AccountCredentialsPayload(email=email))
    client.cookies.set(session_module.SESSION_COOKIE, container.get('session_manager').create(email))
    metadata = {'catalogue': [], 'teams': {}, 'groups': {}, 'suppliers': []}
    service = SimpleNamespace(team_bases=Mock(return_value=metadata))
    container.register_singleton('cost_service', service)
    response = client.get('/api/cost/teams', headers={'Accept': 'application/json'})
    assert response.status_code == 200
    assert response.json() == metadata
    service.team_bases.assert_called_once_with()


@pytest.mark.parametrize('method', ['get', 'post'])
def test_repository_cost_requests_preserve_allocation_graph_and_diagnostics(client, method):
    container = client.app.state.container
    email = 'allocation@example.com'
    container.get('account_manager').update_credentials(AccountCredentialsPayload(email=email))
    sid = container.get('session_manager').create(email)
    client.cookies.set(session_module.SESSION_COOKIE, sid)
    features = [{'id': 'child', 'project': 'project-1', 'parentId': 'parent',
                 'sourcePlanIds': ['project-1'], 'traversalBoundary': True,
                 'excludedChildIds': ['excluded'], 'capacity': [{'team': 'missing', 'capacity': 20}]}]
    unknown = [{'feature_id': 'child', 'team': 'missing', 'capacity': 20}]
    estimate = Mock(return_value={'projects': {}, 'project_types': {}, 'unknown_teams': unknown})
    container.register_singleton('cost_service', SimpleNamespace(estimate_costs=estimate))
    container.register_singleton('task_repository', SimpleNamespace(read=Mock(return_value=features)))
    if method == 'get':
        response = client.get('/api/cost', headers={'Accept': 'application/json'})
    else:
        response = client.post('/api/cost/features', json={}, headers={'Accept': 'application/json'})
    assert response.status_code == 200
    assert estimate.call_args.args[0]['features'] == features
    assert 'pat' not in estimate.call_args.args[0]
    assert 'token' not in estimate.call_args.args[0]
    assert response.json()['unknown_teams'] == unknown


@pytest.mark.parametrize('pat', [None, 'updated-token'])
@pytest.mark.parametrize('method', ['post', 'get'])
@pytest.mark.parametrize('remote', [False, True])
def test_cost_uses_live_account_pat_without_session_refresh(client, caplog, monkeypatch, pat, method, remote):
    import logging

    email = "user@example.com"
    container = client.app.state.container
    container.register_singleton('backend', SimpleNamespace(is_remote=remote))
    account_mgr = container.get("account_manager")
    session_mgr = container.get("session_manager")
    account_mgr.update_credentials(AccountCredentialsPayload(email=email))
    sid = session_mgr.create(email)
    account_mgr.update_credentials(AccountCredentialsPayload(email=email, pat=pat))
    assert 'pat' not in session_mgr.get(sid)

    def reject_session_refresh(*args):
        raise AssertionError('PAT is already resolved from the account')

    monkeypatch.setattr(session_mgr, 'set_val', reject_session_refresh, raising=False)
    client.cookies.set(session_module.SESSION_COOKIE, sid)

    container.register_singleton("cost_service", _FakeCostService())
    read_tasks = Mock(return_value=[])
    container.register_singleton('task_repository', SimpleNamespace(read=read_tasks))
    load_account = Mock(wraps=account_mgr.load)
    monkeypatch.setattr(account_mgr, 'load', load_account)

    with caplog.at_level(logging.ERROR, logger="planner_lib.cost.api"):
        if method == 'post':
            response = client.post('/api/cost/features', json={'features': []},
                                   headers={'Accept': 'application/json'})
        else:
            response = client.get('/api/cost', headers={
                'Accept': 'application/json', 'X-Session-Id': 'unsupported-session',
            })
            read_tasks.assert_called_once()

    assert response.status_code == 200, response.text
    if method == 'post' or not remote:
        load_account.assert_not_called()
    else:
        load_account.assert_called_once_with(email)
    if method == 'get':
        credential = read_tasks.call_args.kwargs['credential']
        if pat is None or not remote:
            assert credential is None
        else:
            assert credential['token'] == pat
    error_logs = [r for r in caplog.records if "Failed to load user config" in r.message]
    assert not error_logs
