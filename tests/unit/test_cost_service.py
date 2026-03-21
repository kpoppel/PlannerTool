from planner_lib.cost.service import CostService, build_cost_schema


def test_cost_service_estimate(fake_services, cache_storage):
    storage = fake_services['storage']
    people_service = fake_services['people_service']
    project_service = fake_services['project_service']
    team_service = fake_services['team_service']

    svc = CostService(storage=storage, project_service=project_service, team_service=team_service, people_service=people_service, cache_storage=cache_storage)

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
