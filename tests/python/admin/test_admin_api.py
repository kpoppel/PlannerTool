import asyncio
from types import SimpleNamespace
import json
import pytest
from planner_lib.accounts.config import AccountPayload
from planner_lib.admin import api as admin_api
from fastapi import HTTPException


def make_request(container, headers=None, cookies=None):
    app = SimpleNamespace(state=SimpleNamespace(container=container))
    return SimpleNamespace(headers=headers or {}, cookies=cookies or {}, app=app, url=SimpleNamespace(path='/'))


class FakeStorage:
    def __init__(self):
        self.data = {'config': {}, 'accounts': {}, 'accounts_admin': {}}
        self._backend = None

    def load(self, ns, key):
        if ns == 'config' and key in self.data['config']:
            return self.data['config'][key]
        if ns == 'accounts' and key in self.data['accounts']:
            return self.data['accounts'][key]
        raise KeyError(key)

    def save(self, ns, key, value):
        if ns == 'config':
            self.data['config'][key] = value
        elif ns == 'accounts':
            self.data['accounts'][key] = value
        elif ns == 'accounts_admin':
            self.data['accounts_admin'][key] = value

    def delete(self, ns, key):
        if ns == 'accounts' and key in self.data['accounts']:
            del self.data['accounts'][key]
        if ns == 'accounts_admin' and key in self.data['accounts_admin']:
            del self.data['accounts_admin'][key]

    def list_keys(self, ns):
        if ns == 'accounts':
            return list(self.data['accounts'].keys())
        if ns == 'accounts_admin':
            return list(self.data['accounts_admin'].keys())
        return []

class FakeAccountManager:
    def __init__(self, storage):
        self._storage = storage

    def save(self, config: AccountPayload) -> dict: ...

    def load(self, key: str) -> dict: ...

    def has_permission(self, key: str, permission: str) -> bool: ...

    def get_all_with_permission(self, permission) -> list:
        # Stub delegate to FakeStorage for accounts_admin namespace
        return [k for k in self._storage.list_keys('accounts_admin')]

    def count_all_with_permission(self, permission) -> int:
        return len([k for k in self._storage.list_keys('accounts_admin')])

    def is_admin(self, email):
        return email and email.endswith('@admin')
 
    def get_all_users(self):
        try:
            return list(self._storage.list_keys('accounts'))
        except Exception:
            return []

    def list_accounts(self):
        return [self._storage.load('accounts', email) for email in self._storage.list_keys('accounts')]

    def get_account_id(self, email):
        return self._storage.load('accounts', email)['id']

    # def get_all_admins(self):
    #     try:
    #         return list(self._storage.list_keys('accounts_admin'))
    #     except Exception:
    #         return []

    # def admin_count(self):
    #     return len(self.get_all_admins())

    # def create_admin_account(self, email, pat):
    #     user = {'email': email, 'pat': pat}
    #     self._storage.save('accounts', email, user)
    #     self._storage.save('accounts_admin', email, user)

    def sync_accounts_full(self, users, admins):
        if isinstance(users, list):
            users = {e: {'email': e} for e in users}
        if isinstance(admins, list):
            admins = {e: {'email': e} for e in admins}
        current_users = set(self._storage.list_keys('accounts') or [])
        current_admins = set(self._storage.list_keys('accounts_admin') or [])
        for k, v in users.items():
            self._storage.save('accounts', k, v)
        for k in current_users - set(users):
            self._storage.delete('accounts', k)
        for k, v in admins.items():
            self._storage.save('accounts_admin', k, v)
        for k in current_admins - set(admins):
            self._storage.delete('accounts_admin', k)

class FakeAdminService:
    def __init__(self, storage):
        self._config_storage = storage

    def reload_config(self, request):
        return {'reloaded': True}


    def get_config(self, key, default=None):
        try:
            data = self._config_storage.load('config', key)
            if isinstance(data, (bytes, bytearray)):
                return data.decode('utf-8')
            return data
        except Exception:
            return default

    def save_config(self, key, content):
        try:
            existing = self._config_storage.load('config', key)
            from datetime import datetime, timezone
            ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
            self._config_storage.save('config', f'{key}_backup_{ts}', existing)
        except Exception:
            pass
        self._config_storage.save('config', key, content)

    def save_config_raw(self, key, content):
        self._config_storage.save('config', key, content)

    def get_project_map(self):
        return []
class SessMgr:
    def __init__(self, ctx=None):
        self._ctx = ctx or {}

    def exists(self, sid):
        return True

    def get(self, sid):
        return self._ctx


def test_admin_get_projects_and_bytes():
    storage = FakeStorage()
    storage.data['config']['projects'] = {'hello': 'world'}
    admin_svc = FakeAdminService(storage)
    container = SimpleNamespace(get=lambda name: {'admin_service': admin_svc}.get(name))
    req = make_request(container)

    res = asyncio.run(admin_api.admin_get_projects.__wrapped__(req))
    assert res['content'] == {'hello': 'world'}

    # bytes content
    storage.data['config']['projects'] = b'bytes'
    res = asyncio.run(admin_api.admin_get_projects.__wrapped__(req))
    assert res['content'] == 'bytes'

    # missing -> empty
    del storage.data['config']['projects']
    res = asyncio.run(admin_api.admin_get_projects.__wrapped__(req))
    assert res['content'] == ''


def test_admin_save_projects_success_and_invalid_payload():
    storage = FakeStorage()
    admin_svc = FakeAdminService(storage)
    container = SimpleNamespace(get=lambda name: {'admin_service': admin_svc}.get(name))

    class Req:
        def __init__(self, payload):
            self._payload = payload
            self.headers = {}
            self.cookies = {}
            self.app = SimpleNamespace(state=SimpleNamespace(container=container))

        async def json(self):
            return self._payload

    # valid content
    content_obj = {'container_types': ['project', 'team'], 'project_map': []}
    payload = {'content': content_obj}
    req = Req(payload)
    res = asyncio.run(admin_api.admin_save_projects.__wrapped__(req))
    assert res['ok']
    assert storage.data['config']['projects'] == content_obj

    req_invalid_hierarchy = Req({'content': {
        'container_types': ['B', 'A', 'B'],
        'project_map': [{'name': 'Plan C', 'type': 'C'}],
    }})
    with pytest.raises(HTTPException) as hierarchy_error:
        asyncio.run(admin_api.admin_save_projects.__wrapped__(req_invalid_hierarchy))
    assert hierarchy_error.value.status_code == 400

    # invalid (empty) content
    req2 = Req({'content': ''})
    with pytest.raises(HTTPException) as ei:
        asyncio.run(admin_api.admin_save_projects.__wrapped__(req2))
    assert ei.value.status_code == 400

    # invalid content type
    req3 = Req({'content': '{"a":1}'})
    with pytest.raises(HTTPException) as ei2:
        asyncio.run(admin_api.admin_save_projects.__wrapped__(req3))
    assert ei2.value.status_code == 400


def test_admin_get_users():
    storage = FakeStorage()
    storage.save('accounts', 'u1', {'id': 'user-id', 'email': 'u1', 'permissions': []})
    storage.save('accounts', 'admin1', {'id': 'admin-id', 'email': 'admin1', 'permissions': ['admin']})
    acct_mgr = FakeAccountManager(storage)
    admin_svc = FakeAdminService(storage)
    session_mgr = SessMgr({'account_id': 'admin-id', 'email': 'admin1'})
    container = SimpleNamespace(get=lambda name: {'account_manager': acct_mgr, 'admin_service': admin_svc, 'session_manager': session_mgr}.get(name))
    req = make_request(container, cookies={'sessionId': 's1'})

    # get users
    res = asyncio.run(admin_api.admin_get_users.__wrapped__(req))
    assert res['accounts'] == [
        {'id': 'user-id', 'email': 'u1', 'permissions': []},
        {'id': 'admin-id', 'email': 'admin1', 'permissions': ['admin']},
    ]
    assert res['currentId'] == 'admin-id'


def test_admin_restore_backup_reloads_config_after_restore():
    storage = FakeStorage()
    called = {}

    class RestoreAdminService:
        def __init__(self, backing_storage):
            self._config_storage = backing_storage

        def restore_backup(self, data, current_user_email=None):
            called['restore_args'] = (data, current_user_email)
            self._config_storage.save(
                'config',
                'ado_config',
                {
                    'organization_url': 'https://example.visualstudio.com',
                    'feature_flags': {'use_azure_mock_generator': True},
                },
            )
            return {'ok': True, 'message': 'Restore completed successfully.'}

        def reload_config(self):
            called['reloaded'] = True
            return {'ok': True}

    class SessionMgrWithValues:
        def exists(self, sid):
            return True

        def get(self, sid):
            return {'email': 'admin1@admin', 'pat': 'pat-token'}

        def get_val(self, sid, key):
            values = {'email': 'admin1@admin', 'pat': 'pat-token'}
            return values.get(key)

    admin_svc = RestoreAdminService(storage)
    session_mgr = SessionMgrWithValues()
    container = SimpleNamespace(
        get=lambda name: {
            'admin_service': admin_svc,
            'session_manager': session_mgr,
        }.get(name)
    )

    class Req:
        def __init__(self, payload):
            self._payload = payload
            self.headers = {}
            self.cookies = {'sessionId': 'restore-session'}
            self.app = SimpleNamespace(state=SimpleNamespace(container=container))

        async def json(self):
            return self._payload

    req = Req({'config': {'ado_config': {'organization_url': 'old', 'feature_flags': {}}}})
    res = asyncio.run(admin_api.admin_restore_backup.__wrapped__(req))

    assert res.status_code == 200
    assert called['restore_args'][1] == 'admin1@admin'
    assert called['reloaded'] is True
    assert storage.data['config']['ado_config']['feature_flags']['use_azure_mock_generator'] is True


@pytest.mark.parametrize('azure_fails', [False, True])
def test_iteration_browse_connects_fetches_and_closes_on_same_worker(azure_fails):
    import threading
    from contextlib import contextmanager
    from planner_lib.admin.config_routes import admin_browse_iterations

    request_thread = threading.get_ident()
    lifecycle_threads = []
    state = threading.local()
    expected = [{'path': 'Demo\\Iteration\\Team', 'name': 'Iteration 1'}]

    class AzureService:
        @contextmanager
        def connect(self, pat):
            assert pat == 'test-pat'
            lifecycle_threads.append(threading.get_ident())
            state.connected = True
            try:
                yield self
            finally:
                lifecycle_threads.append(threading.get_ident())
                state.connected = False

        def get_iterations(self, project, root_path, depth):
            lifecycle_threads.append(threading.get_ident())
            assert getattr(state, 'connected', False), 'Azure connection belongs to another thread'
            assert (project, root_path, depth) == ('Demo', 'Demo\\Iteration\\Team', 4)
            if azure_fails:
                raise RuntimeError('Azure iteration fetch failed')
            return expected

    class Session:
        def exists(self, sid):
            return sid == 'iteration-session'

        def get(self, sid):
            assert sid == 'iteration-session'
            return {'email': 'test@example.com'}

        def get_val(self, sid, key):
            assert (sid, key) == ('iteration-session', 'pat')
            return 'test-pat'

    services = {
        'session_manager': Session(), 'azure_client': AzureService(),
        'account_manager': SimpleNamespace(load=lambda email: {'pat': 'test-pat'}),
    }
    request = make_request(SimpleNamespace(get=lambda name: services[name]),
                           cookies={'sessionId': 'iteration-session'})

    async def payload():
        return {'project': 'Demo', 'root_path': 'Demo\\Iteration\\Team', 'depth': 4}

    request.json = payload
    if azure_fails:
        with pytest.raises(HTTPException) as failure:
            asyncio.run(admin_browse_iterations.__wrapped__(request))
        assert failure.value.status_code == 500
    else:
        assert asyncio.run(admin_browse_iterations.__wrapped__(request)) == {'iterations': expected}
    assert len(lifecycle_threads) == 3
    assert len(set(lifecycle_threads)) == 1
    assert lifecycle_threads[0] != request_thread
