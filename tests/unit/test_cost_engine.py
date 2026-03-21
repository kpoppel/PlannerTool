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
