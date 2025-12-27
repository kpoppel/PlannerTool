import datetime

from planner_lib.cost import engine


def make_mock_config():
    return {
        "cost": {
            "working_hours": {
                "LY": {"internal": 3, "external": 11},
                "ERL": {"internal": 7, "external": 13},
            },
            "internal_cost": {"default_hourly_rate": 17},
            "external_cost": {"default_hourly_rate": 19,
                              "external": { "External One": 23, "External Mix One": 31 }},
        },
        "database": {
            "people": [
                {"name": "Internal One", "external": False, "team_name": "Team One", "site": "LY"},
                {"name": "External One", "external": True, "team_name": "Team Two", "site": "ERL"},
                {"name": "Internal Mix One", "external": False, "team_name": "Team Mix", "site": "LY"},
                {"name": "Internal Mix Two", "external": False, "team_name": "Team Mix", "site": "ERL"},
                {"name": "External Mix One", "external": True, "team_name": "Team Mix", "site": "LY"},
                {"name": "External Mix Two", "external": True, "team_name": "Team Mix", "site": "ERL"},
            ],
            "teams": []
        }
    }


def teardown_function(function):
    engine.invalidate_team_rates_cache()


def test_team_aggregates_counts_and_rates():
    cfg = make_mock_config()
    aggregates = engine._team_members(cfg)
    assert "team-one" in aggregates
    assert "team-two" in aggregates
    assert "team-mix" in aggregates

    t1 = aggregates["team-one"]
    assert t1["internal_count"] == 1
    assert t1["external_count"] == 0
    assert t1["internal_hourly_rate_total"] == 17.0
    assert t1["external_hourly_rate_total"] == 0.0
    assert t1["internal_hours_total"] == 3.0
    assert t1["external_hours_total"] == 0.0

    t2 = aggregates["team-two"]
    assert t2["internal_count"] == 0
    assert t2["external_count"] == 1
    assert t2["internal_hourly_rate_total"] == 0.0
    assert t2["external_hourly_rate_total"] == 23.0
    assert t2["internal_hours_total"] == 0.0
    assert t2["external_hours_total"] == 13.0

    tm = aggregates["team-mix"]
    assert tm["internal_count"] == 2
    assert tm["external_count"] == 2
    assert tm["internal_hourly_rate_total"] == 2*17.0
    assert tm["external_hourly_rate_total"] == 31.0+19.0
    assert tm["internal_hours_total"] == 10.0
    assert tm["external_hours_total"] == 24.0


def test_calculate_monotonic_increase_over_durations():
    cfg = make_mock_config()
    capacities = [
        {"team": "team-one", "capacity": 100},
        {"team": "team-two", "capacity": 100},
        {"team": "team-mix", "capacity": 100},
    ]

    start = datetime.date(2025, 1, 1)
    days_list = [1, 10, 100]
    results = []

    for days in days_list:
        end = start + datetime.timedelta(days=days - 1)
        start_iso = start.isoformat()
        end_iso = end.isoformat()
        res = engine.calculate(cfg, start_iso, end_iso, capacities)
        # sanity
        assert res["internal_hours"] >= 0
        assert res["external_hours"] >= 0
        assert res["internal_cost"] >= 0
        assert res["external_cost"] >= 0
        results.append(res)

    # monotonic (non-decreasing) as duration increases
    for i in range(len(results) - 1):
        assert results[i]["internal_hours"] <= results[i + 1]["internal_hours"]
        assert results[i]["external_hours"] <= results[i + 1]["external_hours"]
        assert results[i]["internal_cost"] <= results[i + 1]["internal_cost"]
        assert results[i]["external_cost"] <= results[i + 1]["external_cost"]

def test_calculate_exact_values():
    cfg = make_mock_config()
    capacities = [
        {"team": "team-one", "capacity": 100},
        {"team": "team-two", "capacity": 100},
        {"team": "team-mix", "capacity": 100},
    ]

    start = datetime.date(2025, 1, 1)
    days_list = [1, 10, 100]
    results = []

    for days in days_list:
        end = start + datetime.timedelta(days=days - 1)
        start_iso = start.isoformat()
        end_iso = end.isoformat()
        res = engine.calculate(cfg, start_iso, end_iso, capacities)
        # sanity
        assert res["internal_hours"] >= 0
        assert res["external_hours"] >= 0
        assert res["internal_cost"] >= 0
        assert res["external_cost"] >= 0
        results.append(res)

    # exact numeric checks (regression): expected values computed from engine logic
    # For 1 day
    r1 = results[0]
    assert abs(r1["internal_hours"] - 0.65) < 1e-6
    assert abs(r1["external_hours"] - 1.85) < 1e-6
    assert abs(r1["internal_cost"] - 24.65) < 1e-6
    assert abs(r1["external_cost"] - 107.45) < 1e-6

    # For 10 days
    r10 = results[1]
    assert abs(r10["internal_hours"] - 5.2) < 1e-6
    assert abs(r10["external_hours"] - 14.8) < 1e-6
    assert abs(r10["internal_cost"] - 197.2) < 1e-6
    assert abs(r10["external_cost"] - 859.6) < 1e-6

    # For 100 days
    r100 = results[2]
    assert abs(r100["internal_hours"] - 46.8) < 1e-6
    assert abs(r100["external_hours"] - 133.2) < 1e-6
    assert abs(r100["internal_cost"] - 1774.8) < 1e-6
    assert abs(r100["external_cost"] - 7736.4) < 1e-6


def test_calculate_exact_values_permutations():
    cfg = make_mock_config()
    engine.invalidate_team_rates_cache()
    start = datetime.date(2025, 1, 1)
    days_list = [1, 10, 100]
    capacity_sets = {
        'all_100': [
            {"team": "team-one", "capacity": 100},
            {"team": "team-two", "capacity": 100},
            {"team": "team-mix", "capacity": 100},
        ],
        'one_100': [
            {"team": "team-one", "capacity": 100},
        ],
        'one50_two50': [
            {"team": "team-one", "capacity": 50},
            {"team": "team-two", "capacity": 50},
        ],
        'mix_100': [
            {"team": "team-mix", "capacity": 100},
        ],
        'mixed_25_25_50': [
            {"team": "team-one", "capacity": 25},
            {"team": "team-two", "capacity": 25},
            {"team": "team-mix", "capacity": 50},
        ],
    }

    expected = {
        'all_100': {
            1: {'internal_hours': 0.65, 'external_hours': 1.85, 'internal_cost': 24.65, 'external_cost': 107.45},
            10: {'internal_hours': 5.2, 'external_hours': 14.8, 'internal_cost': 197.2, 'external_cost': 859.6},
            100: {'internal_hours': 46.8, 'external_hours': 133.2, 'internal_cost': 1774.8, 'external_cost': 7736.4},
        },
        'one_100': {
            1: {'internal_hours': 0.15, 'external_hours': 0.0, 'internal_cost': 2.55, 'external_cost': 0.0},
            10: {'internal_hours': 1.2, 'external_hours': 0.0, 'internal_cost': 20.4, 'external_cost': 0.0},
            100: {'internal_hours': 10.8, 'external_hours': 0.0, 'internal_cost': 183.6, 'external_cost': 0.0},
        },
        'one50_two50': {
            1: {'internal_hours': 0.07, 'external_hours': 0.33, 'internal_cost': 1.19, 'external_cost': 7.59},
            10: {'internal_hours': 0.6, 'external_hours': 2.6, 'internal_cost': 10.2, 'external_cost': 59.8},
            100: {'internal_hours': 5.4, 'external_hours': 23.4, 'internal_cost': 91.8, 'external_cost': 538.2},
        },
        'mix_100': {
            1: {'internal_hours': 0.5, 'external_hours': 1.2, 'internal_cost': 17.0, 'external_cost': 60.0},
            10: {'internal_hours': 4.0, 'external_hours': 9.6, 'internal_cost': 136.0, 'external_cost': 480.0},
            100: {'internal_hours': 36.0, 'external_hours': 86.4, 'internal_cost': 1224.0, 'external_cost': 4320.0},
        },
        'mixed_25_25_50': {
            1: {'internal_hours': 0.29, 'external_hours': 0.76, 'internal_cost': 10.54, 'external_cost': 41.68},
            10: {'internal_hours': 2.3, 'external_hours': 6.1, 'internal_cost': 83.3, 'external_cost': 334.9},
            100: {'internal_hours': 20.7, 'external_hours': 54.9, 'internal_cost': 749.7, 'external_cost': 3014.1},
        }
    }

    for name, caps in capacity_sets.items():
        for days in days_list:
            end = start + datetime.timedelta(days=days - 1)
            res = engine.calculate(cfg, start.isoformat(), end.isoformat(), caps)
            exp = expected[name][days]
            assert abs(res['internal_hours'] - exp['internal_hours']) < 1e-6, f"{name} {days} internal_hours"
            assert abs(res['external_hours'] - exp['external_hours']) < 1e-6, f"{name} {days} external_hours"
            assert abs(res['internal_cost'] - exp['internal_cost']) < 1e-6, f"{name} {days} internal_cost"
            assert abs(res['external_cost'] - exp['external_cost']) < 1e-6, f"{name} {days} external_cost"
