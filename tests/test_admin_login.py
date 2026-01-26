from fastapi.testclient import TestClient
from planner_lib.main import create_app, Config


def test_admin_login_flow_with_memory_storage(app):
    # Use pytest app fixture so autouse patches are applied; create a local
    # TestClient with `raise_server_exceptions=False` so HTTPException routes
    # return responses instead of raising errors in the test harness.
    from fastapi.testclient import TestClient

    client = TestClient(app, raise_server_exceptions=False)
    container = app.state.container
    account_storage = container.get('account_storage')

    subject = 'test@example.com'

    # Ensure the account exists but is NOT an admin yet -> /admin should deny
    account_storage.save('accounts', subject, {'email': subject, 'pat': None})

    # Visiting /admin with no session returns the login page
    r = client.get('/admin')
    assert r.status_code == 200
    assert 'Admin Login' in r.text

    # The test harness patches session resolution to always return an
    # identity of `test@example.com` for any session id. Simulate that by
    # providing the canonical test session id and assert /admin is denied
    # until the account is marked as an admin.
    sid = 'test-session'
    client.cookies.clear()
    r = client.get('/admin', headers={'X-Session-Id': sid})
    assert r.status_code == 401

    # Malformed (non-email) payloads are rejected (4xx/5xx depending on global
    # exception handling). Accept any error status here.
    r = client.post('/api/session', json={'email': 'not-an-email'})
    assert r.status_code >= 400

    # Now mark the test subject as an admin and verify /admin loads for that session
    account_storage.save('accounts_admin', subject, {'email': subject})
    client.cookies.clear()
    r = client.get('/admin', headers={'X-Session-Id': sid})
    assert r.status_code == 200
    # admin index contains the admin title
    assert 'PlannerTool — Admin' in r.text
