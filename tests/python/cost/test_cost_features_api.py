def test_feature_endpoint_returns_cost_schema(
    authenticated_client, fake_services, cache_storage,
):
    storage = fake_services['storage']
    people_repository = fake_services['people_repository']
    project_repository = fake_services['project_repository']
    team_repository = fake_services['team_repository']

    from planner_lib.cost.service import CostService
    import json
    import os

    cost_service = CostService(
        storage=storage,
        project_repository=project_repository,
        team_repository=team_repository,
        people_repository=people_repository,
        cache_storage=cache_storage,
    )

    fixtures_dir = storage.base_path
    path = os.path.join(fixtures_dir, 'session_features.json')
    with open(path, 'r', encoding='utf-8') as f:
        payload = json.load(f)

    container = authenticated_client.app.state.container
    container.register_singleton('cost_service', cost_service)
    response = authenticated_client.post(
        '/api/cost/features', json={'features': payload['features']},
    )

    assert response.status_code == 200, response.text
    schema = response.json()
    assert 'projects' in schema
    proj_map = {p['id']: p for p in schema['projects']}
    p2 = proj_map.get('project-2')
    assert p2 is not None
    features = {feature['id']: feature for feature in p2['features']}
    assert features['3']['title'] == 'Parent'
    assert features['4']['title'] == 'Child of 3'
