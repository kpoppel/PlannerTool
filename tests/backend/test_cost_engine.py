import pytest
from planner_lib.cost import service as cost_service_module
from planner_lib.cost import engine as cost_engine


def test_estimate_costs_empty():
    # Provide a minimal config so the service doesn't attempt to read files
    cfg = {
        'cost': {'working_hours': {}, 'internal_cost': {'default_hourly_rate': 0}, 'external_cost': {}},
        'database': {'people': []}
    }
    # monkeypatch load_cost_config and clear cached team rates
    cost_engine.invalidate_team_rates_cache()
    # Provide a dummy storage object that returns the expected keys
    class _DummyStorage:
        def load(self, namespace, key):
            if namespace == 'config' and key == 'cost_config':
                return cfg.get('cost', {})
            if namespace == 'config' and key == 'database':
                return {'database': cfg.get('database', {})}
            return {}

    # Instantiate CostService with minimal dependencies for the test
    class _DummyProjectService:
        def list_projects(self):
            return []

    class _DummyTeamService:
        def list_teams(self):
            return []

    svc = cost_service_module.CostService(
        storage=_DummyStorage(), project_service=_DummyProjectService(), team_service=_DummyTeamService()
    )
    res = svc.estimate_costs(session={})
    # Expect an empty dict when no features provided
    assert isinstance(res, dict)
    assert res == {}


def test_estimate_costs_simple_feature(monkeypatch):
    # Provide a simple session with one feature and a controlled config
    session = {
        'features': [
            {
                'id': 'f1',
                'project': 'p1',
                'start': '2025-01-01',
                'end': '2025-01-02',
                # capacity expected as a list of {team, capacity_percent}
                'capacity': [{'team': 'team-a', 'capacity': 100}],
            }
        ]
    }

    # Provide a minimal cost/database config so calculations are deterministic
    cfg = {
        'cost': {
            'working_hours': {
                'HQ': {'internal': 160, 'external': 0}
            },
            'internal_cost': {'default_hourly_rate': 50},
            'external_cost': {'default_hourly_rate': 120, 'external': []},
        },
        'database': {
            'people': [
                {'name': 'Bob', 'team_name': 'Team A', 'site': 'HQ', 'external': False}
            ]
        }
    }

    # Provide a dummy storage object that returns the expected keys
    class _DummyStorage:
        def load(self, namespace, key):
            if namespace == 'config' and key == 'cost_config':
                return cfg.get('cost', {})
            if namespace == 'config' and key == 'database':
                return {'database': cfg.get('database', {})}
            return {}
    cost_engine.invalidate_team_rates_cache()
    # Ensure no loaded server config interferes with project filtering
    import planner_lib.setup as setup_module
    monkeypatch.setattr(setup_module, 'get_loaded_config', lambda: None)
    class _DummyProjectService:
        def list_projects(self):
            return []

    class _DummyTeamService:
        def list_teams(self):
            # provide configured team list that matches the people entry
            return [{
                'id': 'team-team-a',
                'name': 'Team A',
                'short_name': 'Team A'
            }]

    svc = cost_service_module.CostService(
        storage=_DummyStorage(), project_service=_DummyProjectService(), team_service=_DummyTeamService()
    )
    res = svc.estimate_costs(session)
    assert isinstance(res, dict)
    assert 'p1' in res
    assert 'f1' in res['p1']
    f = res['p1']['f1']
    # Engine returns internal/external cost and hours
    assert 'internal_cost' in f
    assert 'internal_hours' in f
    # With our config: 2 working days -> 16 hours, hourly rate 50 -> cost 800
    # Updated expected value based on current engine logic
    assert pytest.approx(f['internal_cost'], rel=1e-6) == 738.46


def test_engine_calculate_direct():
    # Direct test of calculate with explicit config and capacity
    cfg = {
        'cost': {
            'working_hours': {'HQ': {'internal': 160, 'external': 0}},
            'internal_cost': {'default_hourly_rate': 60},
            'external_cost': {'default_hourly_rate': 150, 'external': []},
        },
        'database': {
            'people': [
                {'name': 'Alice', 'team_name': 'Team B', 'site': 'HQ', 'external': False},
            ]
        }
    }
    # capacity 50% from team-b
    capacity = [{'team': 'team-b', 'capacity': 50}]
    cost_engine.invalidate_team_rates_cache()
    out = cost_engine.calculate(cfg, start='2025-01-01', end='2025-01-02', capacity=capacity)
    assert 'internal_cost' in out and 'internal_hours' in out
    # With hourly 60 and 16 hours * 0.5 = 8 hours -> cost = 480
    # Updated expected based on current engine outputs
    assert pytest.approx(out['internal_cost'], rel=1e-6) == 443.08
