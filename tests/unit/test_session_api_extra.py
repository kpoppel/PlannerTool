import pytest
from planner_lib.middleware.session import get_session_context_from_request


pytestmark = pytest.mark.real_auth


@pytest.mark.parametrize('path', ['/api/auth/me', '/api/view', '/api/scenario',
                                 '/admin/v1/users', '/admin/'])
def test_authenticated_request_resolves_credentials_and_refreshes_expiry_once(client, monkeypatch, path):
    from unittest.mock import Mock

    assert client.post('/api/auth/enroll', json={
        'email': 'resolution@example.com', 'name': 'Session Resolution',
    }).status_code == 200
    container = client.app.state.container
    storage = container.get('storage')
    accounts = container.get('account_manager')
    accounts.set_permissions(accounts.get_account_id('resolution@example.com'), ['admin'])
    save = Mock(wraps=storage.save)
    load_account = Mock(wraps=accounts.load)
    monkeypatch.setattr(storage, 'save', save)
    monkeypatch.setattr(accounts, 'load', load_account)

    response = client.get(path)

    assert response.status_code == 200
    load_account.assert_called_once_with('resolution@example.com')
    assert [call.args[0] for call in save.call_args_list].count('auth_sessions') == 1
    assert [call.args[0] for call in save.call_args_list].count('account_auth') == 1
    assert len(response.headers.get_list('set-cookie')) == 2


def test_session_post_rejects_email_only(client):
    response = client.post('/api/session', json={'email': 'admin@example.com'},
                           headers={'Accept': 'application/json'})
    assert response.status_code == 401
    assert 'sessionId' not in response.json()


def test_enrollment_status_is_read_only_and_distinguishes_unenrolled_accounts(client):
    from planner_lib.accounts.config import AccountCredentialsPayload

    accounts = client.app.state.container.get('account_manager')
    storage = client.app.state.container.get('storage')
    response = client.post('/api/auth/enrollment-status', json={'email': 'unknown@example.com'})
    assert response.status_code == 200
    assert response.json() == {'requiresKey': False}
    assert response.headers['cache-control'] == 'no-store'
    assert not storage.exists('accounts', 'unknown@example.com')
    accounts.create_account(AccountCredentialsPayload(email='precreated@example.com'))
    assert client.post('/api/auth/enrollment-status', json={
        'email': 'precreated@example.com',
    }).json() == {'requiresKey': False}
    enrollment = client.post('/api/auth/enroll', json={
        'email': 'enrolled@example.com', 'name': 'Existing User',
    })
    assert enrollment.status_code == 200
    account_id = accounts.get_account_id('enrolled@example.com')
    original = storage.load('account_auth', account_id)
    assert client.post('/api/auth/enrollment-status', json={
        'email': 'enrolled@example.com',
    }).json() == {'requiresKey': True}
    assert storage.load('account_auth', account_id) == original
    assert client.post('/api/auth/enrollment-status', json={'email': 'invalid'}).status_code == 400
    assert client.post('/api/auth/enrollment-status', json={
        'email': 'enrolled@example.com',
    }, headers={'Origin': 'http://attacker.example'}).status_code == 403


def test_enrollment_session_and_second_device(client):
    response = client.post('/api/auth/enroll', json={
        'email': 'new@example.com', 'name': 'New User',
    })
    assert response.status_code == 200
    assert response.json()['accountKey']
    assert 'sessionId' not in response.json()
    assert 'httponly' in response.headers['set-cookie'].lower()
    assert client.post('/api/session').json() == {'email': 'new@example.com'}
    assert client.post('/api/auth/enroll', json={
        'email': 'new@example.com', 'name': 'Someone Else',
    }).status_code == 409

    key = response.json()['accountKey']
    from fastapi.testclient import TestClient
    other = TestClient(client.app)
    assert other.post('/api/session', json={'email': 'new@example.com'}).status_code == 401
    assert other.post('/api/auth/enroll', json={
        'email': 'new@example.com', 'accountKey': key,
    }).status_code == 200
    assert other.post('/api/session').status_code == 200
    assert other.post('/api/auth/enroll', json={
        'email': 'new@example.com', 'accountKey': key,
    }).status_code == 401


def test_admin_can_precreate_an_account_with_permissions_before_browser_enrollment(client):
    from fastapi.testclient import TestClient

    assert client.post('/api/auth/enroll', json={
        'email': 'creator@example.com', 'name': 'Administrator',
    }).status_code == 200
    accounts = client.app.state.container.get('account_manager')
    accounts.set_permissions(accounts.get_account_id('creator@example.com'), ['admin'])
    assert client.post('/admin/v1/users', json={
        'email': 'precreated@example.com', 'permissions': ['admin'],
    }).status_code == 200
    account_id = accounts.get_account_id('precreated@example.com')
    storage = client.app.state.container.get('storage')
    assert storage.load('account_auth', account_id) == {'enrolled': False}

    with TestClient(client.app) as user:
        assert user.post('/api/session').status_code == 401
        enrollment = user.post('/api/auth/enroll', json={
            'email': 'precreated@example.com', 'name': 'New Administrator',
        })
        assert enrollment.status_code == 200
        assert enrollment.json()['accountKey']
        assert enrollment.json()['initialSetup'] is False
        assert accounts.get_account_id('precreated@example.com') == account_id
        assert accounts.get_account_by_id(account_id)['permissions'] == ['admin']
        assert user.get('/admin/v1/users').status_code == 200


def test_cross_origin_writes_rejected(client):
    response = client.post('/api/auth/enroll', json={
        'email': 'new@example.com', 'name': 'New User',
    }, headers={'Origin': 'http://attacker.example'})
    assert response.status_code == 403


def test_migrated_admin_can_enroll_through_same_origin_proxy(client):
    from planner_lib.accounts.config import AccountCredentialsPayload

    accounts = client.app.state.container.get('account_manager')
    storage = client.app.state.container.get('storage')
    accounts.create_account(AccountCredentialsPayload(email='upgrade@example.com'))
    account_id = accounts.get_account_id('upgrade@example.com')
    accounts.set_permissions(account_id, ['admin'])
    storage.save('account_auth', account_id, {'enrolled': False})
    client.cookies.set('sessionId', 'legacy-email-only-session')
    headers = {'Host': 'localhost:5173', 'Origin': 'http://localhost:5173',
               'Sec-Fetch-Site': 'same-origin'}

    assert client.post('/api/session', headers=headers).status_code == 401
    enrollment = client.post('/api/auth/enroll', json={
        'email': 'upgrade@example.com', 'name': 'Existing Administrator',
    }, headers=headers)
    assert enrollment.status_code == 200
    assert enrollment.json()['initialSetup'] is False
    assert accounts.get_account_id('upgrade@example.com') == account_id
    assert 'admin' in accounts.get_account_by_id(account_id)['permissions']
    assert storage.load('account_auth', account_id)['enrolled'] is True
    assert client.post('/api/session', headers=headers).status_code == 200


@pytest.mark.parametrize('minimum_size', [1, 10000])
def test_brotli_preserves_auth_cookies_and_admin_access(client, minimum_size):
    from fastapi.testclient import TestClient
    from planner_lib.middleware.brotli import BrotliCompression

    accounts = client.app.state.container.get('account_manager')
    storage = client.app.state.container.get('storage')
    storage.save('config', 'projects', {'project_map': [], 'container_types': ['project']})
    with TestClient(BrotliCompression(client.app, minimum_size=minimum_size),
                    headers={'Accept-Encoding': 'br', 'Accept': 'application/json'}) as browser:
        enrollment = browser.post('/api/auth/enroll', json={
            'email': 'cookie-admin@example.com', 'name': 'Cookie Administrator',
        })
        assert enrollment.status_code == 200
        assert len(enrollment.headers.get_list('set-cookie')) == 2
        assert {'plannerDevice', 'sessionId'}.issubset(set(browser.cookies.keys()))
        if minimum_size == 1:
            assert enrollment.headers['content-encoding'] == 'br'
        else:
            assert 'content-encoding' not in enrollment.headers
        account_id = accounts.get_account_id('cookie-admin@example.com')
        accounts.set_permissions(account_id, ['admin'])

        assert browser.get('/api/auth/me').status_code == 200
        assert browser.get('/api/projects').status_code == 200
        assert browser.get('/api/scenario').status_code == 200
        assert browser.get('/admin/v1/users').status_code == 200
        assert browser.get('/admin/').status_code == 200
        assert browser.post('/api/session').status_code == 200
        assert browser.get('/api/projects').status_code == 200
        assert browser.get('/admin/v1/users').status_code == 200


def test_admin_reset_revokes_devices_and_issues_one_time_account_key(client):
    response = client.post('/api/auth/enroll', json={
        'email': 'admin@example.com', 'name': 'Administrator',
    })
    assert response.status_code == 200
    accounts = client.app.state.container.get('account_manager')
    account_id = accounts.get_account_id('admin@example.com')
    reset = client.post('/api/auth/admin-reset/' + account_id)
    assert reset.status_code == 200
    key = reset.json()['accountKey']
    assert client.post('/api/session').status_code == 401
    recovered = client.post('/api/auth/enroll', json={'email': 'admin@example.com', 'accountKey': key})
    assert recovered.status_code == 200
    assert client.post('/api/session').status_code == 200
    assert client.post('/api/auth/enroll', json={'email': 'admin@example.com', 'accountKey': key}).status_code == 401


def test_logout_revokes_only_current_browser_and_clears_cookies(client):
    from fastapi.testclient import TestClient
    enrollment = client.post('/api/auth/enroll', json={
        'email': 'logout@example.com', 'name': 'Logout Test',
    })
    assert enrollment.status_code == 200
    previous_device = client.cookies['plannerDevice']
    assert client.get('/static/js/vendor/lit.js').status_code == 200
    assert {cookie.path for cookie in client.cookies.jar
            if cookie.name in ('sessionId', 'plannerDevice')} == {'/'}
    key = enrollment.json()['accountKey']
    for cookie in list(client.cookies.jar):
        if cookie.name in ('sessionId', 'plannerDevice'):
            for path in ('/static/', '/admin/static/'):
                client.cookies.set(cookie.name, cookie.value, domain=cookie.domain, path=path)
    with TestClient(client.app) as other:
        assert other.post('/api/auth/enroll', json={
            'email': 'logout@example.com', 'accountKey': key,
        }).status_code == 200
        assert client.post('/api/auth/logout').status_code == 200
        assert 'sessionId' not in client.cookies
        assert 'plannerDevice' not in client.cookies
        assert client.post('/api/session').status_code == 401
        assert other.post('/api/session').status_code == 200
        accounts = client.app.state.container.get('account_manager')
        assert accounts.get_account_id('logout@example.com')
        auth = client.app.state.container.get('auth_manager')
        with pytest.raises(PermissionError):
            auth.authenticate_device(previous_device)


def test_self_service_delete_without_device_and_removed_routes(client):
    from fastapi.testclient import TestClient
    response = client.post('/api/auth/enroll', json={'email': 'delete@example.com', 'name': 'Owner'})
    accounts = client.app.state.container.get('account_manager')
    accounts.set_permissions(accounts.get_account_id('delete@example.com'), [])
    with TestClient(client.app) as other:
        assert other.post('/api/auth/delete-account', json={
            'email': 'delete@example.com', 'accountKey': 'wrong', 'confirm': True,
        }).status_code == 401
        assert other.post('/api/auth/delete-account', json={
            'email': 'delete@example.com', 'accountKey': response.json()['accountKey'], 'confirm': False,
        }).status_code == 400
        deletion = other.post('/api/auth/delete-account', json={
            'email': 'delete@example.com', 'accountKey': response.json()['accountKey'], 'confirm': True,
        })
        assert deletion.status_code == 200
        assert deletion.headers['cache-control'] == 'no-store'
    assert client.post('/api/session').status_code == 401
    for route in ('/api/auth/pair', '/api/auth/pair/redeem', '/api/auth/recover'):
        assert route not in client.app.openapi()['paths']


def test_context_is_request_local_and_reads_new_pat_on_next_request(client, monkeypatch):
    from unittest.mock import Mock
    from fastapi.testclient import TestClient
    from starlette.requests import Request
    from planner_lib.accounts.config import AccountCredentialsPayload

    assert client.post('/api/auth/enroll', json={
        'email': 'first@example.com', 'name': 'First',
    }).status_code == 200
    with TestClient(client.app) as other:
        assert other.post('/api/auth/enroll', json={
            'email': 'second@example.com', 'name': 'Second',
        }).status_code == 200
        container = client.app.state.container
        accounts = container.get('account_manager')
        accounts.update_credentials(AccountCredentialsPayload(email='first@example.com', pat='first-pat'))
        accounts.update_credentials(AccountCredentialsPayload(email='second@example.com', pat='second-pat'))
        sessions = container.get('session_manager')
        resolve_context = Mock(wraps=sessions.get)
        monkeypatch.setattr(sessions, 'get', resolve_context)

        def make_request(browser):
            return Request({'type': 'http', 'app': client.app,
                            'headers': [(b'cookie', f'sessionId={browser.cookies["sessionId"]}'.encode())]})

        first_request = make_request(client)
        first = get_session_context_from_request(first_request)
        second = get_session_context_from_request(make_request(other))
        assert get_session_context_from_request(first_request) is first
        assert (first['email'], first['pat']) == ('first@example.com', 'first-pat')
        assert (second['email'], second['pat']) == ('second@example.com', 'second-pat')
        assert first['account_id'] != second['account_id']
        assert resolve_context.call_count == 2

        accounts.update_credentials(AccountCredentialsPayload(email='first@example.com', pat='updated-pat'))
        assert get_session_context_from_request(make_request(client))['pat'] == 'updated-pat'
        assert resolve_context.call_count == 3


@pytest.mark.parametrize('mutation', ['revoke', 'reset', 'delete'])
def test_response_does_not_renew_cookies_after_handler_revocation(client, mutation):
    import asyncio
    from fastapi import HTTPException
    from starlette.requests import Request
    from starlette.responses import Response
    from planner_lib.middleware.session import SessionMiddleware

    assert client.post('/api/auth/enroll', json={
        'email': 'revoked@example.com', 'name': 'Revoked',
    }).status_code == 200
    container = client.app.state.container
    sessions = container.get('session_manager')
    auth = container.get('auth_manager')
    accounts = container.get('account_manager')
    accounts.set_permissions(accounts.get_account_id('revoked@example.com'), [])
    cookie = f'sessionId={client.cookies["sessionId"]}; plannerDevice={client.cookies["plannerDevice"]}'
    scope = {'type': 'http', 'app': client.app, 'method': 'GET', 'path': '/api/auth/me',
             'scheme': 'http', 'server': ('testserver', 80), 'headers': [(b'cookie', cookie.encode())]}

    async def handler(request):
        context = get_session_context_from_request(request)
        if mutation == 'revoke':
            auth.revoke(context['email'], context['device_id'])
        elif mutation == 'reset':
            auth.reset(context['email'])
        else:
            accounts.delete_account(context['account_id'])
        return Response(status_code=200)

    response = asyncio.run(SessionMiddleware(client.app, sessions).dispatch(Request(scope), handler))
    assert response.status_code == 200
    assert response.headers.getlist('set-cookie') == []
    with pytest.raises(HTTPException) as error:
        get_session_context_from_request(Request(scope))
    assert error.value.status_code == 401
