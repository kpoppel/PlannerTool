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
