from planner_lib.cost.service import CostService, build_cost_schema
from planner_lib.cost import engine
import json
from pathlib import Path
import pytest


def test_cost_monthly_hours_match_shared_capacity_loads(fake_services, cache_storage, monkeypatch):
    case = next(case for case in json.loads(
        (Path(__file__).parents[2] / 'fixtures/allocation_rule/cases.json').read_text()
    ) if 'monthlyLoad' in case)
    aggregates = {team: {'internal_hours_total': 160, 'internal_monthly_cost_total': 8000,
                         'sites': {}} for team in case['monthlyLoad']}
    monkeypatch.setattr(engine, '_team_members', lambda *args, **kwargs: aggregates)
    svc = CostService(fake_services['storage'], fake_services['project_repository'],
                      fake_services['team_repository'], fake_services['people_repository'],
                      cache_storage)
    result = svc.estimate_costs({'features': case['features']})['projects']['project-1']
    for team, expected in case['monthlyLoad'].items():
        monthly = {}
        for feature_id, cost in result.items():
            if feature_id == 'totals' or team not in cost['teams']:
                continue
            for month, hours in cost['teams'][team]['hours']['internal'].items():
                monthly[month] = monthly.get(month, 0) + hours
        assert set(monthly) == set(expected)
        for month, load in expected.items():
            assert monthly[month] == pytest.approx(load * 160 / (260 / 12), abs=0.02)


def test_cost_undated_grandchild_preserves_parent_and_reports_unknown_team(fake_services, cache_storage, monkeypatch):
    monkeypatch.setattr(fake_services['team_repository'], 'list_teams',
                        lambda: [{'id': 'team-alpha'}])
    svc = CostService(fake_services['storage'], fake_services['project_repository'],
                      fake_services['team_repository'], fake_services['people_repository'],
                      cache_storage)
    features = [
        {'id': 'root', 'project': 'project-1', 'start': '2025-01-01', 'end': '2025-01-31',
         'capacity': [{'team': 'team-alpha', 'capacity': 100}]},
        {'id': 'middle', 'parentId': 'root', 'capacity': []},
        {'id': 'leaf', 'parentId': 'middle', 'capacity': [
            {'team': 'team-alpha', 'capacity': 20}, {'team': 'unknown', 'capacity': 30}]},
    ]
    result = svc.estimate_costs({'features': features})
    parent_only = svc.estimate_costs({'features': [features[0]]})
    parent_hours = parent_only['projects']['project-1']['root']['internal_hours']
    assert parent_hours > 0
    assert result['projects']['project-1']['root']['internal_hours'] == parent_hours
    assert result['projects']['project-1']['leaf']['internal_hours'] == 0
    assert result['unknown_teams'] == [{'feature_id': 'leaf', 'team': 'unknown', 'capacity': 30}]


def test_cost_context_uses_configured_provenance_and_category_bounded_precedence(
    fake_services, cache_storage,
):
    svc = CostService(
        storage=fake_services['storage'],
        project_repository=fake_services['project_repository'],
        team_repository=fake_services['team_repository'],
        people_repository=fake_services['people_repository'],
        cache_storage=cache_storage,
    )
    base = {'start': '2025-01-01', 'end': '2025-01-31',
            'state': 'Active', 'type': 'Feature', 'relations': [],
            'capacity': [{'team': 'team-alpha', 'capacity': 100}]}
    parent = {**base, 'id': 'parent', 'project': 'project-1',
              'sourcePlanIds': ['project-1'], 'excludedChildIds': ['task']}
    linked = {**base, 'id': 'linked', 'project': 'context-internal',
              'parentId': 'parent', 'sourcePlanIds': ['project-1', 'project-2'],
              'relations': [{'type': 'Parent', 'id': 'parent'}],
              'capacity': [{'team': 'team-alpha', 'capacity': 30}]}
    task = {**base, 'id': 'task', 'project': 'project-2',
            'parentId': 'parent', 'sourcePlanIds': ['project-2'],
            'traversalBoundary': True,
            'relations': [{'type': 'Parent', 'id': 'parent'}]}

    linked_only = svc.estimate_costs({'features': [linked]})['projects']
    assert set(linked_only) == {'project-1', 'project-2'}
    assert linked_only['project-1']['linked'] == linked_only['project-2']['linked']

    parent_only = svc.estimate_costs({'features': [parent]})['projects']['project-1']
    bounded = svc.estimate_costs({'features': [parent, task]})['projects']
    assert 'task' not in bounded['project-1']
    assert bounded['project-1']['totals'] == parent_only['totals']

    combined = svc.estimate_costs({'features': [parent, linked]})['projects']
    assert 'context-internal' not in combined
    assert combined['project-1']['totals'] == linked_only['project-1']['totals']


def test_ancestor_only_context_does_not_create_partial_plan_cost_totals(fake_services, cache_storage):
    svc = CostService(
        storage=fake_services['storage'],
        project_repository=fake_services['project_repository'],
        team_repository=fake_services['team_repository'],
        people_repository=fake_services['people_repository'],
        cache_storage=cache_storage,
    )
    seed = {'id': 'seed', 'project': 'project-1', 'sourcePlanIds': ['project-1'],
            'parentId': 'ancestor', 'relations': [{'type': 'Parent', 'id': 'ancestor'}],
            'start': '2025-01-01', 'end': '2025-01-31',
            'capacity': [{'team': 'team-alpha', 'capacity': 30}]}
    ancestor = {**seed, 'id': 'ancestor', 'project': 'project-2', 'sourcePlanIds': [],
                'ancestorOnly': True, 'childrenComplete': False, 'parentId': None,
                'relations': [], 'capacity': [{'team': 'team-alpha', 'capacity': 100}]}

    expected = svc.estimate_costs({'features': [seed]})['projects']
    actual = svc.estimate_costs({'features': [seed, ancestor]})['projects']
    assert set(actual) == {'project-1'}
    assert actual['project-1']['totals'] == expected['project-1']['totals']
    assert actual['project-1']['seed']['has_project_parent']
    assert 'ancestor' not in actual['project-1']


def test_cost_schema_sorts_by_configured_container_order():
    schema = build_cost_schema(
        {'a-leaf': {}, 'z-root': {}, 'm-middle': {}},
        project_types={'a-leaf': 'project', 'z-root': 'team', 'm-middle': 'program'},
        project_container_order={'a-leaf': 2, 'z-root': 0, 'm-middle': 1},
    )
    assert [plan['id'] for plan in schema['projects']] == ['z-root', 'm-middle', 'a-leaf']
    assert [plan['container_order'] for plan in schema['projects']] == [0, 1, 2]


def test_project_site_totals_include_only_effective_internal_work(fake_services, cache_storage):
    svc = CostService(fake_services['storage'], fake_services['project_repository'],
                      fake_services['team_repository'], fake_services['people_repository'],
                      cache_storage)
    feature = {'id': 'one', 'project': 'project-1', 'start': '2026-03-01', 'end': '2026-03-31',
               'capacity': [{'team': 'team-alpha', 'capacity': 100}]}
    result = svc.estimate_costs({'features': [feature]})['projects']['project-1']
    assert result['totals']['sites']['siteA']['hours']['2026-03'] == 162.46
    assert result['totals']['sites']['siteA']['cost']['2026-03'] == 8123.0


def test_cost_service_estimate(fake_services, cache_storage):
    storage = fake_services['storage']
    people_repository = fake_services['people_repository']
    project_repository = fake_services['project_repository']
    team_repository = fake_services['team_repository']

    svc = CostService(storage=storage, project_repository=project_repository, team_repository=team_repository, people_repository=people_repository, cache_storage=cache_storage)

    # Load session features from fixture
    import json, os
    fixtures_dir = storage.base_path
    path = os.path.join(fixtures_dir, 'session_features.json')
    with open(path, 'r', encoding='utf-8') as f:
        payload = json.load(f)

    session = {'features': payload['features']}
    result = svc.estimate_costs(session)
    assert isinstance(result, dict)
    # projects mapping should include project-1 and project-2
    projects = result.get('projects', {})
    assert 'project-1' in projects
    assert 'project-2' in projects

    # Verify per-feature numeric results are exact for feature id 1 (team-alpha full)
    proj1 = projects.get('project-1') or {}
    f1 = proj1.get(1) or proj1.get('1')
    assert f1 is not None
    # internal & external totals should match engine expectations from fixtures
    assert f1['internal_hours'] == 162.46
    assert f1['external_hours'] == 20.31
    assert f1['internal_cost'] == 8123.0
    assert f1['external_cost'] == 3046.5

    # Build schema and ensure output shape
    schema = build_cost_schema(projects, mode='full', session_features=session['features'], project_types=result.get('project_types'))
    assert 'projects' in schema
    assert isinstance(schema['projects'], list)
