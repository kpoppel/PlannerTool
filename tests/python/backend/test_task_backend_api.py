"""Active task-backend identity and capability endpoints."""


def test_session_reads_active_backend_identity_and_capabilities(authenticated_client):
    response = authenticated_client.get('/api/task-backend')
    assert response.status_code == 200
    body = response.json()
    assert body['id'] == 'ado'
    assert 'task_read' in body['capabilities']
    assert 'task_create' not in body['capabilities']


def test_task_backend_requires_session(client):
    assert client.get('/api/task-backend').status_code == 401


def test_admin_lists_registered_backends_with_active_selection(authenticated_client):
    response = authenticated_client.get('/admin/v1/task-backends')
    assert response.status_code == 200
    body = response.json()
    assert body['active'] == 'ado'
    assert [(backend['id'], backend['available']) for backend in body['backends']] == [
        ('ado', True), ('local', True)]
    # Enrollment-only deployments cannot reach live Azure DevOps.
    assert body['backends'][0]['transports'] == ['mock_generator', 'mock_fixture', 'static']


def test_entra_deployment_offers_live_ado_transport(authenticated_client, monkeypatch):
    monkeypatch.setenv('PLANNER_AUTH_PROVIDER', 'entra')
    body = authenticated_client.get('/admin/v1/task-backends').json()
    assert body['backends'][0]['transports'] == ['live', 'mock_generator', 'mock_fixture', 'static']


def test_switch_without_managed_launcher_saves_a_pending_manual_restart(authenticated_client):
    system = authenticated_client.get('/admin/v1/system').json()['content']
    response = authenticated_client.post('/admin/v1/system', json={
        'content': {**system, 'task_backend_id': 'local'}})
    assert response.status_code == 200, response.text
    assert response.json() == {'ok': True, 'restart_required': True}
    assert authenticated_client.get('/admin/v1/system').json()['content']['task_backend_id'] == 'local'
    metadata = authenticated_client.get('/admin/v1/task-backends').json()
    assert (metadata['active'], metadata['configured'], metadata['restart_available']) == ('ado', 'local', False)
    assert authenticated_client.get('/api/task-backend').json()['id'] == 'ado'


def test_persisted_live_ado_without_entra_still_starts(tmp_path, monkeypatch):
    """Regression: a stored live selection once made the server refuse to start, locking admins out."""
    from fastapi.testclient import TestClient

    from planner_lib import main
    from planner_lib.migrations.coordinator import Database

    monkeypatch.delenv('PLANNER_ADO_AUTHENTICATION', raising=False)
    monkeypatch.setenv('PLANNER_AUTH_PROVIDER', 'enrollment')
    handle = Database(tmp_path).prepare()
    try:
        ado = handle.storage.load('config', 'ado_config')
        handle.storage.save('config', 'ado_config', {**ado, 'organization_url': 'example', 'transport': 'live'})
    finally:
        handle.close()
    app = main.create_app(main.Config(data_dir=str(tmp_path), storage_backend='diskcache'))
    with TestClient(app) as client:
        assert client.post('/api/auth/enroll', json={
            'email': 'live-start@example.com', 'name': 'Live Start',
        }, headers={'Accept': 'application/json'}).status_code == 200
        assert client.get('/api/task-backend').json()['id'] == 'ado'
        # The admin can still move away from the unavailable transport.
        saved = client.post('/admin/v1/ado', json={'content': {**ado, 'transport': 'mock_generator'}})
        assert saved.status_code == 200, saved.text
