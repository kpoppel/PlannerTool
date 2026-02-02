import asyncio
from types import SimpleNamespace
import pytest
from planner_lib.cost.api import api_cost_post, api_cost_get, api_cost_teams
from planner_lib.cost.service import build_cost_schema
from fastapi import HTTPException


def make_request_with_container(container, sid='s1'):
    app = SimpleNamespace(state=SimpleNamespace(container=container))
    headers = {'X-Session-Id': sid}
    cookies = {}
    return SimpleNamespace(headers=headers, cookies=cookies, app=app, url=SimpleNamespace(path='/'))


class SimpleSessionMgr:
    def __init__(self, ctx=None):
        self._ctx = ctx or {}
    def exists(self, sid):
        return True
    def get(self, sid):
        return dict(self._ctx)
    def set(self, sid, ctx):
        self._ctx = ctx


def test_api_cost_post_with_features():
    # prepare services
    cost_raw = {'project-1': {'1': {'internal_cost': 100}}}
    cost_svc = SimpleNamespace(estimate_costs=lambda ctx: cost_raw)
    container = SimpleNamespace(get=lambda name: {'session_manager': SimpleSessionMgr(), 'cost_service': cost_svc}.get(name))
    req = make_request_with_container(container)

    payload = {'features': [{'id': '1', 'project': 'project-1', 'start': '2020-01-01', 'end': '2020-02-01'}]}
    # call wrapped function to bypass decorator (require_session already validated)
    res = asyncio.run(api_cost_post.__wrapped__(req, payload=payload))
    assert isinstance(res, dict)
    assert 'projects' in res
    assert any(p['id'] == 'project-1' for p in res['projects'])


def test_api_cost_post_without_features_uses_task_service():
    # task service returns tasks which are converted
    tasks = [
        {'id': '10', 'project': 'project-A', 'start': None, 'end': None, 'capacity': [1,2], 'title':'T','type':'Feature','state':'Active'}
    ]
    task_svc = SimpleNamespace(list_tasks=lambda pat=None: tasks)
    cost_svc = SimpleNamespace(estimate_costs=lambda ctx: {'project-A': {'10': {'internal_cost': 5}}})
    container = SimpleNamespace(get=lambda name: {'session_manager': SimpleSessionMgr(), 'task_service': task_svc, 'cost_service': cost_svc}.get(name))
    req = make_request_with_container(container)
    res = asyncio.run(api_cost_post.__wrapped__(req, payload={}))
    assert isinstance(res, dict)
    assert any(p['id'] == 'project-A' for p in res['projects'])


def test_api_cost_post_scenario_overrides(monkeypatch):
    # test that scenario overrides are applied
    features = [{'id': '7', 'project': 'project-X', 'start': '2020-01-01', 'end': '2020-01-10', 'capacity': []}]
    task_svc = SimpleNamespace(list_tasks=lambda pat=None: [])
    cost_svc = SimpleNamespace(estimate_costs=lambda ctx: {'project-X': {'7': {'internal_cost': 1}}})
    container = SimpleNamespace(get=lambda name: {'session_manager': SimpleSessionMgr({'email': ''}), 'task_service': task_svc, 'cost_service': cost_svc}.get(name))
    req = make_request_with_container(container)

    # monkeypatch load_user_scenario to return overrides for id '7'
    def fake_load_user_scenario(storage, user_id, scenario_id):
        return {'overrides': {'7': {'start': '2020-02-01', 'capacity': [3]}}}
    monkeypatch.setattr('planner_lib.scenarios.scenario_store.load_user_scenario', fake_load_user_scenario)

    res = asyncio.run(api_cost_post.__wrapped__(req, payload={'features': features, 'scenarioId': 's1'}))
    # ensure meta contains applied_overrides
    assert res.get('meta') and res['meta'].get('scenario_id') == 's1'


def test_api_cost_post_scenario_not_found(monkeypatch):
    cost_svc = SimpleNamespace(estimate_costs=lambda ctx: {})
    container = SimpleNamespace(get=lambda name: {'session_manager': SimpleSessionMgr({'email': ''}), 'cost_service': cost_svc}.get(name))
    req = make_request_with_container(container)

    def raise_key_error(storage, user_id, scenario_id):
        raise KeyError('not found')
    monkeypatch.setattr('planner_lib.scenarios.scenario_store.load_user_scenario', raise_key_error)

    with pytest.raises(HTTPException) as ei:
        asyncio.run(api_cost_post.__wrapped__(req, payload={'features': [], 'scenarioId': 'missing'}))
    assert ei.value.status_code == 404


def test_api_cost_get_no_session_returns_schema():
    # no session -> build schema mode
    # create container with session_manager that reports false for exists
    class SessMgr(SimpleSessionMgr):
        def exists(self, sid):
            return False
    container = SimpleNamespace(get=lambda name: {'session_manager': SessMgr()}.get(name))
    app = SimpleNamespace(state=SimpleNamespace(container=container))
    req = SimpleNamespace(headers={}, cookies={}, app=app, url=SimpleNamespace(path='/'))

    res = asyncio.run(api_cost_get.__wrapped__(req))
    assert isinstance(res, dict)
    assert res['meta']['response_mode'] == 'schema'


def test_api_cost_teams_aggregates():
    # build storage that returns config and database
    storage = SimpleNamespace()
    def load(ns, key):
        if ns == 'config' and key == 'cost_config':
            return {'working_hours': {'HQ': {'internal': 10}}, 'internal_cost': {'default_hourly_rate': 20}, 'external_cost': {'external': {'Eve': 50}, 'default_hourly_rate': 30}}
        if ns == 'config' and key == 'database':
            return {'database': {'people': [{'name': 'Alice', 'team_name': 'Dev', 'site': 'HQ', 'external': False}, {'name': 'Eve', 'team': 'Dev', 'site': 'HQ', 'external': True}]}}
        raise KeyError
    storage.load = load
    container = SimpleNamespace(get=lambda name: {'server_config_storage': storage}.get(name))
    req = make_request_with_container(container)
    res = asyncio.run(api_cost_teams.__wrapped__(req))
    assert 'teams' in res
    teams = res['teams']
    assert any(t['id'].startswith('team-') for t in teams)
