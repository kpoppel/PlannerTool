"""Local administration endpoints: permissions, conflicts and validation errors."""


def test_local_catalogue_and_plans_endpoints(authenticated_client):
    client = authenticated_client
    assert client.get('/admin/v1/local/catalogue').json()['content']['revision'] == 0
    starter = client.post('/admin/v1/local/catalogue/starter', json={'content': {'revision': 0}})
    assert starter.status_code == 200
    catalogue = starter.json()['content']
    assert catalogue['revision'] == 1

    stale = client.put('/admin/v1/local/catalogue', json={'content': {**catalogue, 'revision': 0}})
    assert stale.status_code == 409
    assert stale.json()['error'] == 'stale_revision'
    invalid = client.put('/admin/v1/local/catalogue', json={'content': {**catalogue, 'states': 'x'}})
    assert invalid.status_code == 400
    assert invalid.json()['error'] == 'invalid_definition'

    plan = {'id': '11111111-1111-4111-8111-111111111111', 'name': 'Local plan', 'type': 'project',
            'archived': False, 'task_types': [catalogue['processes'][0]['types'][0]['id']],
            'closed_history_days': 0, 'iteration_uuid': None, 'markers': []}
    saved = client.put('/admin/v1/local/plans', json={'content': {'revision': 0, 'plans': [plan]}})
    assert saved.status_code == 200, saved.text
    assert client.get('/admin/v1/local/plans').json()['content']['plans'] == [plan]


def test_local_administration_requires_project_permission(client):
    for method, path in (('get', '/admin/v1/local/catalogue'), ('put', '/admin/v1/local/catalogue'),
                         ('post', '/admin/v1/local/catalogue/starter'), ('get', '/admin/v1/local/plans'),
                         ('put', '/admin/v1/local/plans')):
        kwargs = {} if method == 'get' else {'json': {'content': {}}}
        assert getattr(client, method)(path, **kwargs).status_code in (401, 403)


def test_admin_restart_requires_admin_and_runs_after_acceptance(client, app):
    requested = []
    app.state.request_restart = lambda: requested.append(True)
    assert client.post('/admin/v1/restart').status_code in (401, 403)
    assert requested == []
    enrollment = client.post('/api/auth/enroll', json={
        'email': 'restart-test@example.com', 'name': 'Restart Test',
    }, headers={'Accept': 'application/json'})
    assert enrollment.status_code == 200
    system = client.get('/admin/v1/system').json()['content']
    saved = client.post('/admin/v1/system', json={'content': {**system, 'task_backend_id': 'local'}})
    assert saved.json() == {'ok': True, 'restart_required': True}
    assert client.get('/api/task-backend').json()['id'] == 'ado'
    metadata = client.get('/admin/v1/task-backends').json()
    assert metadata['active'] == 'ado'
    assert metadata['configured'] == 'local'
    assert metadata['restart_available'] is True
    assert client.post('/admin/v1/restart').status_code == 202
    assert requested == [True]


def test_local_task_api_read_after_create_with_cache_enabled(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from planner_lib.backend.azure import AzureDevOpsBackend
    from planner_lib.domain.iteration_sets import validate_iteration_sets
    from planner_lib import main
    from planner_lib.migrations.coordinator import Database

    def reject_ado(*args, **kwargs):
        raise AssertionError('Local startup must not construct the ADO task backend')

    monkeypatch.setattr(AzureDevOpsBackend, 'build_from_flags', reject_ado)
    handle = Database(tmp_path).prepare()
    try:
        config = handle.storage.load('config', 'server_config')
        config['task_backend_id'] = 'local'
        config['feature_flags']['enable_cache'] = True
        handle.storage.save('config', 'server_config', config)
        handle.storage.save('config', 'iterations', validate_iteration_sets({'iteration_sets': [{
            'id': 'manual-set', 'name': 'Manual', 'source_type': 'manual', 'values': [{
                'path': 'sprint-1', 'name': 'Sprint 1',
                'startDate': '2026-12-01', 'finishDate': '2026-12-05',
            }],
        }]}))
    finally:
        handle.close()
    app = main.create_app(main.Config(data_dir=str(tmp_path), storage_backend='diskcache'))
    with TestClient(app) as client:
        assert client.post('/api/tasks/create', json={}).status_code == 401
        response = client.post('/api/auth/enroll', json={
            'email': 'local-task-test@example.com', 'name': 'Local Task Test',
        }, headers={'Accept': 'application/json'})
        assert response.status_code == 200, response.text
        catalogue = client.post('/admin/v1/local/catalogue/starter', json={'content': {'revision': 0}})
        assert catalogue.status_code == 200, catalogue.text
        type_id = catalogue.json()['content']['processes'][0]['types'][0]['id']
        plan_id = '11111111-1111-4111-8111-111111111111'
        plan = {'id': plan_id, 'name': 'Local plan', 'type': 'project', 'archived': False,
                'task_types': [type_id], 'closed_history_days': 0, 'iteration_uuid': 'manual-set', 'markers': []}
        plans = client.put('/admin/v1/local/plans', json={'content': {'revision': 0, 'plans': [plan]}})
        assert plans.status_code == 200, plans.text
        assert client.get('/api/tasks').json() == []
        presets = client.get('/api/iterations').json()['iterationSetsById']['manual-set']['presets']
        created = client.post('/api/tasks/create', json={
            'project': plan_id, 'typeId': type_id, 'title': 'First local task', 'iterationPresetId': presets[0]['id'],
        })
        assert created.status_code == 201, created.text
        task = created.json()
        assert client.get('/api/tasks').json() == [task]
        history = client.get('/api/history/tasks', params={'plan': plan_id})
        assert history.status_code == 200, history.text
        assert history.json()['tasks'][0]['task_id'] == task['id']
        assert {entry['field']: entry['value'] for entry in history.json()['tasks'][0]['history']} == {
            'start': '2026-12-01', 'end': '2026-12-05', 'iteration': 'sprint-1',
        }
