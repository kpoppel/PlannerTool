import pytest
from planner_lib.cost import service as cost_service
from planner_lib.cost import engine as cost_engine


def test_estimate_costs_empty():
    # Provide a minimal config so the service doesn't attempt to read files
    cfg = {
        'cost': {'working_hours': {}, 'internal_cost': {'default_hourly_rate': 0}, 'external_cost': {}},
        'database': {'people': []}
    }
    # monkeypatch load_cost_config and clear cached team rates
    cost_engine.invalidate_team_rates_cache()
    import types
    cost_service.load_cost_config = lambda: cfg
    res = cost_service.estimate_costs(session={})
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

    # Monkeypatch service.load_cost_config so estimate_costs uses our config
    monkeypatch.setattr(cost_service, 'load_cost_config', lambda: cfg)
    cost_engine.invalidate_team_rates_cache()

    res = cost_service.estimate_costs(session)
    assert isinstance(res, dict)
    assert 'p1' in res
    assert 'f1' in res['p1']
    f = res['p1']['f1']
    # Engine returns internal/external cost and hours
    assert 'internal_cost' in f
    assert 'internal_hours' in f
    # With our config: 2 working days -> 16 hours, hourly rate 50 -> cost 800
    assert pytest.approx(f['internal_cost'], rel=1e-6) == 800.0


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
    assert pytest.approx(out['internal_cost'], rel=1e-6) == 480.0
