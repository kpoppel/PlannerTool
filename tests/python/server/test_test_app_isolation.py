def test_app_fixture_is_function_scoped(request, app):
    assert request._fixture_defs['app'].scope == 'function'


def test_plain_client_rejects_a_missing_session_cookie(client):
    response = client.get('/api/groups', headers={'Accept': 'application/json'})

    assert response.status_code == 401
    assert response.json()['error'] == 'missing_session_id'