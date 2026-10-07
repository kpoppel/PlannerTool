from planner_lib.cost.service import CostService, build_cost_schema


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


def test_cost_schema_sorts_by_configured_container_order():
    schema = build_cost_schema(
        {'a-leaf': {}, 'z-root': {}, 'm-middle': {}},
        project_types={'a-leaf': 'project', 'z-root': 'team', 'm-middle': 'program'},
        project_container_order={'a-leaf': 2, 'z-root': 0, 'm-middle': 1},
    )
    assert [plan['id'] for plan in schema['projects']] == ['z-root', 'm-middle', 'a-leaf']
    assert [plan['container_order'] for plan in schema['projects']] == [0, 1, 2]


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
