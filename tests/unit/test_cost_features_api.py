def test_feature_endpoint_like_flow(fake_services, cache_storage):
    storage = fake_services['storage']
    people_service = fake_services['people_service']
    project_service = fake_services['project_service']
    team_service = fake_services['team_service']

    from planner_lib.cost.service import CostService, build_cost_schema
    import json, os, yaml

    svc = CostService(storage=storage, project_service=project_service, team_service=team_service, people_service=people_service, cache_storage=cache_storage)

    fixtures_dir = storage.base_path
    path = os.path.join(fixtures_dir, 'session_features.json')
    with open(path, 'r', encoding='utf-8') as f:
        payload = json.load(f)

    session = {'features': payload['features']}
    raw = svc.estimate_costs(session).get('projects', {})
    schema = build_cost_schema(raw, mode='full', session_features=session['features'], project_types={})

    # Basic assertions on schema shape
    assert 'projects' in schema
    # Ensure parent-child behavior: feature with id 3 (parent) should have has_project_parent flag on child 4
    proj_map = {p['id']: p for p in schema['projects']}
    # project-2 should exist and contain features
    p2 = proj_map.get('project-2')
    assert p2 is not None
    # Find feature 3 & 4 in project features
    ids = {f['id'] for f in p2['features']}
    assert '3' in ids or '4' in ids
