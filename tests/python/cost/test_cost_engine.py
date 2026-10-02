import math
import pytest
from planner_lib.cost import engine


def test_hours_between_single_day():
    # For a single working day, expect a fraction of the default hours
    default = 160
    hrs = engine._hours_between('2026-03-02', '2026-03-02', default)
    # avg working days per month ~= 21.6667 so one day ~ default/21.6667
    assert hrs == pytest.approx(default / (5 * 52.0 / 12.0))


def test_allocate_months_full_month():
    # Full March 2026 -> expect one month key and hours close to default
    default = 160
    res = engine._allocate_months('2026-03-01', '2026-03-31', default)
    assert isinstance(res, dict)
    assert '2026-03' in res
    assert res['2026-03'] == pytest.approx(round(res['2026-03'], 2))


def test_team_members_and_monthly_costs(cache_storage, fixtures_dir):
    # Build a config with people from fixtures and assert team aggregates
    import yaml, os
    cfg_path = os.path.join(fixtures_dir, 'cost_config_test.yml')
    people_path = os.path.join(fixtures_dir, 'people_test.yml')
    with open(cfg_path, 'r', encoding='utf-8') as f:
        cfg = yaml.safe_load(f)
    with open(people_path, 'r', encoding='utf-8') as f:
        people = yaml.safe_load(f)
    cfg['database'] = {'people': people}

    teams = engine._team_members(cfg, cache_storage=cache_storage)
    # Expect team-alpha and team-beta
    assert 'team-alpha' in teams
    assert 'team-beta' in teams
    a = teams['team-alpha']
    # internal member Alice: internal default rate 50, internal_hours siteA=160
    assert a['internal_monthly_cost_total'] == pytest.approx(50 * 160)
    # external member 'Ext Contractor' uses rate 150 and external_hours siteA=20
    assert a['external_monthly_cost_total'] == pytest.approx(150 * 20)


def test_calculate_detailed_single_team_allocation(cache_storage, fixtures_dir):
    import yaml, os
    cfg_path = os.path.join(fixtures_dir, 'cost_config_test.yml')
    people_path = os.path.join(fixtures_dir, 'people_test.yml')
    with open(cfg_path, 'r', encoding='utf-8') as f:
        cfg = yaml.safe_load(f)
    with open(people_path, 'r', encoding='utf-8') as f:
        people = yaml.safe_load(f)
    cfg['database'] = {'people': people}

    # Ensure team aggregates are cached before calculate_detailed
    engine.invalidate_team_rates_cache(cache_storage)
    _ = engine._team_members(cfg, cache_storage=cache_storage)

    out = engine.calculate_detailed(cfg, '2026-03-01', '2026-03-31', [{'team': 'team-alpha', 'capacity': 100}], cache_storage)
    # Exact expected values computed for March 2026 with provided fixtures
    # March 2026 working days -> 22 -> base_hours_internal = 162.46, base_hours_external = 20.31
    assert out['internal_hours'] == 162.46
    assert out['external_hours'] == 20.31
    # Costs computed as team_monthly_cost_total * fraction (rounded)
    # internal: 8000 * (162.46/160) = 8123.0
    # external: uses rounded month bucket 20.31 -> fraction = 20.31/20 = 1.0155 -> 3000*1.0155 = 3046.5
    assert out['internal_cost'] == 8123.0
    assert out['external_cost'] == 3046.5
    assert 'team-alpha' in out['teams']


def test_multi_member_team_cost_does_not_scale_quadratically(cache_storage):
    """When a team has N internal members the monthly cost must equal N*rate*hours_per_person,
    NOT (N*rate)*(N*hours_per_person) which would be N^2 times too large.

    Regression test for the Signal Processing case:
      8 members, rate=64, site hours=116 → monthly cost = 8*64*116 = 59392
      Feature 771 h at 30% cap → cost ≈ 771*64 = 49344 (not 394729)
    """
    N = 8
    rate = 64
    h = 116  # monthly site hours per internal person
    config = {
        'cost': {
            'internal_cost': {'default_hourly_rate': rate},
            'external_cost': {'default_hourly_rate': 0, 'external': {}},
            'working_hours': {'HQ': {'internal': h, 'external': 0}},
        },
        'database': {
            'people': [
                {'name': f'Person{i}', 'team_name': 'Signal Processing', 'site': 'HQ', 'external': False}
                for i in range(N)
            ]
        },
    }
    teams = engine._team_members(config, cache_storage=cache_storage)
    team = teams['team-signal-processing']

    assert team['internal_count'] == N
    assert team['internal_hours_total'] == N * h  # 928
    # Monthly cost must be N * rate * h, not (N*rate) * (N*h)
    assert team['internal_monthly_cost_total'] == pytest.approx(N * rate * h)  # 59392, not 475136


def test_calculate_cost_per_hour_equals_average_member_rate(cache_storage):
    """For a uniform team, cost / allocated_hours must equal the per-member hourly rate.

    This ensures the feature cost in the UI matches user expectation:
      feature_cost = allocated_hours * per_member_rate
    """
    N = 8
    rate = 64
    h = 116
    config = {
        'cost': {
            'internal_cost': {'default_hourly_rate': rate},
            'external_cost': {'default_hourly_rate': 0, 'external': {}},
            'working_hours': {'HQ': {'internal': h, 'external': 0}},
        },
        'database': {
            'people': [
                {'name': f'Person{i}', 'team_name': 'Signal Processing', 'site': 'HQ', 'external': False}
                for i in range(N)
            ]
        },
    }
    # Span 2026-02-01 to 2026-04-24 (the real-world failing case)
    result = engine.calculate(
        config,
        '2026-02-01', '2026-04-24',
        [{'team': 'team-signal-processing', 'capacity': 30}],
        cache_storage,
    )
    alloc_hours = result['internal_hours']
    alloc_cost = result['internal_cost']
    assert alloc_hours > 0
    # cost / hours must equal per-member rate (64), not N*rate (512)
    assert alloc_cost / alloc_hours == pytest.approx(rate, rel=1e-3)
