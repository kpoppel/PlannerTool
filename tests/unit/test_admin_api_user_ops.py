import asyncio
from types import SimpleNamespace
import pytest
from planner_lib.admin import api as admin_api


class RecordingStorage:
    """In-memory storage that records all mutations.

    Accounts are stored in a single 'accounts' namespace; admin status is
    tracked via the 'permissions' field in each record rather than a separate
    'accounts_admin' namespace.
    """
    def __init__(self):
        self.data = {'accounts': {}}
        self.saved = []
        self.deleted = []

    def load(self, ns, key):
        if ns == 'accounts' and key in self.data['accounts']:
            return self.data['accounts'][key]
        raise KeyError(key)

    def save(self, ns, key, value):
        self.saved.append((ns, key, value))
        if ns == 'accounts':
            self.data['accounts'][key] = value

    def delete(self, ns, key):
        self.deleted.append((ns, key))
        if ns == 'accounts' and key in self.data['accounts']:
            del self.data['accounts'][key]
        else:
            raise KeyError(key)

    def list_keys(self, ns):
        if ns == 'accounts':
            return list(self.data['accounts'].keys())
        return []

    def exists(self, ns, key):
        return (ns == 'accounts') and (key in self.data['accounts'])


class SessMgr:
    def __init__(self, ctx=None):
        self._ctx = ctx or {}
    def exists(self, sid):
        return True
    def get(self, sid):
        return self._ctx


def make_request(container, payload, session_email=None):
    class Req:
        def __init__(self, payload, container, session_email):
            self._payload = payload
            self.headers = {'X-Session-Id': 's1'} if session_email else {}
            self.cookies = {}
            self.app = SimpleNamespace(state=SimpleNamespace(container=container))
        async def json(self):
            return self._payload
    return Req(payload, container, session_email)


class ExplicitAccountManager:
    def __init__(self):
        self.accounts = {
            'current@example.com': {
                'id': '11111111-1111-4111-8111-111111111111',
                'email': 'current@example.com',
                'permissions': ['admin'],
            },
        }

    def create_account(self, credentials, permissions=None):
        self.accounts[credentials.email] = {
            'id': '33333333-3333-4333-8333-333333333333',
            'email': credentials.email,
            'pat': credentials.pat,
            'permissions': list(permissions or []),
        }
        return {'ok': True, 'id': self.accounts[credentials.email]['id'], 'email': credentials.email}

    def get_account_by_id(self, account_id):
        return next(account for account in self.accounts.values() if account['id'] == account_id)

    def get_account_id(self, email):
        return self.accounts[email]['id']

    def list_accounts(self):
        return list(self.accounts.values())

    def set_permissions(self, account_id, permissions):
        self.get_account_by_id(account_id)['permissions'] = list(permissions)

    def delete_account(self, account_id):
        account = self.get_account_by_id(account_id)
        del self.accounts[account['email']]

    def get_all_with_permission(self, permission):
        return [
            email for email, account in self.accounts.items()
            if permission in account['permissions']
        ]

    def count_all_with_permission(self, permission):
        return len(self.get_all_with_permission(permission))


def _explicit_request(account_manager, payload=None):
    session_manager = SessMgr({'email': 'current@example.com'})
    container = SimpleNamespace(get=lambda name: {
        'account_manager': account_manager,
        'session_manager': session_manager,
    }.get(name))
    return make_request(container, payload or {}, session_email='current@example.com')


def test_create_user_uses_explicit_account_creation():
    from planner_lib.admin.users_routes import admin_create_user
    account_manager = ExplicitAccountManager()
    request = _explicit_request(account_manager, {
        'email': 'new-admin@example.com',
        'permissions': ['admin'],
    })

    result = asyncio.run(admin_create_user.__wrapped__(request))

    assert result == {'ok': True}
    assert account_manager.accounts['new-admin@example.com']['permissions'] == ['admin']


def test_create_user_rejects_invalid_email():
    from fastapi import HTTPException
    from planner_lib.admin.users_routes import admin_create_user
    request = _explicit_request(ExplicitAccountManager(), {
        'email': 'not-an-email',
        'permissions': [],
    })

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(admin_create_user.__wrapped__(request))

    assert exc_info.value.status_code == 400


def test_setup_updates_existing_account_permissions_by_id():
    from planner_lib.admin.setup_routes import admin_setup

    class ExistingAccountManager:
        def __init__(self):
            self.updated_account_id = None

        def count_all_with_permission(self, permission):
            return 0

        def create_account(self, credentials, permissions):
            raise ValueError('Account already exists')

        def update_credentials(self, credentials):
            return {'ok': True}

        def get_account_id(self, email):
            return '11111111-1111-4111-8111-111111111111'

        def set_permissions(self, account_id, permissions):
            self.updated_account_id = account_id

    class SetupSessionManager:
        def create(self, email):
            return 'setup-session'

        def set_val(self, session_id, key, value):
            pass

    account_manager = ExistingAccountManager()
    container = SimpleNamespace(get=lambda name: {
        'account_manager': account_manager,
        'session_manager': SetupSessionManager(),
    }.get(name))
    request = make_request(
        container,
        {'email': 'current@example.com', 'pat': 'valid-pat'},
    )

    result = asyncio.run(admin_setup(request))

    assert result.status_code == 200
    assert account_manager.updated_account_id == '11111111-1111-4111-8111-111111111111'


def test_get_users_returns_account_ids_and_current_id():
    from planner_lib.admin.users_routes import admin_get_users
    account_manager = ExplicitAccountManager()
    request = _explicit_request(account_manager)

    result = asyncio.run(admin_get_users.__wrapped__(request))

    assert result == {
        'accounts': [{
            'id': '11111111-1111-4111-8111-111111111111',
            'email': 'current@example.com',
            'permissions': ['admin'],
        }],
        'currentId': '11111111-1111-4111-8111-111111111111',
    }


def test_set_user_permissions_blocks_current_admin_demotion():
    from fastapi import HTTPException
    from planner_lib.admin.users_routes import admin_set_user_permissions
    account_manager = ExplicitAccountManager()
    request = _explicit_request(account_manager, {'permissions': []})

    with pytest.raises(HTTPException, match='Cannot remove current admin'):
        asyncio.run(admin_set_user_permissions.__wrapped__(
            '11111111-1111-4111-8111-111111111111', request
        ))


def test_delete_user_uses_explicit_account_deletion():
    from planner_lib.admin.users_routes import admin_delete_user
    account_manager = ExplicitAccountManager()
    account_manager.accounts['remove@example.com'] = {
        'id': '22222222-2222-4222-8222-222222222222',
        'email': 'remove@example.com',
        'permissions': [],
    }
    request = _explicit_request(account_manager)

    result = asyncio.run(admin_delete_user.__wrapped__(
        '22222222-2222-4222-8222-222222222222', request
    ))

    assert result == {'ok': True}
    assert 'remove@example.com' not in account_manager.accounts
