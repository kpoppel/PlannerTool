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
    assert [backend['id'] for backend in body['backends']] == ['ado']
    assert body['backends'][0]['transports'] == ['live', 'mock_generator', 'mock_fixture', 'static']
