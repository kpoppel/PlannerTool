import asyncio
from types import SimpleNamespace
import json
import pytest
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
            import asyncio
            from types import SimpleNamespace
            import json
            import pytest
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


            class FakeAdminService:
                def __init__(self, storage):
                    self._config_storage = storage
                    self._account_storage = storage

                def reload_config(self, request):
                    return {'reloaded': True}


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


            def test_admin_save_projects_success_and_invalid_json():
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
                content_obj = {'a': 1}
                payload = {'content': json.dumps(content_obj)}
                req = Req(payload)
                res = asyncio.run(admin_api.admin_save_projects.__wrapped__(req))
                assert res['ok']
                assert storage.data['config']['projects'] == content_obj

                # invalid (empty) content
                req2 = Req({'content': ''})
                with pytest.raises(HTTPException) as ei:
                    asyncio.run(admin_api.admin_save_projects.__wrapped__(req2))
                assert ei.value.status_code == 400

                # invalid json
                req3 = Req({'content': '{not json'})
                with pytest.raises(HTTPException) as ei2:
                    asyncio.run(admin_api.admin_save_projects.__wrapped__(req3))
                assert ei2.value.status_code == 400


            def test_admin_get_users_and_save_users():
                storage = FakeStorage()
                storage.save('accounts', 'u1', {'email': 'u1'})
                storage.save('accounts_admin', 'admin1', {'email': 'admin1'})
                admin_svc = FakeAdminService(storage)
                # create session manager that returns current admin email
                session_mgr = SessMgr({'email': 'admin1'})
                container = SimpleNamespace(get=lambda name: {'admin_service': admin_svc, 'session_manager': session_mgr}.get(name))
                req = make_request(container, headers={'X-Session-Id': 's1'})

                # get users
                res = asyncio.run(admin_api.admin_get_users.__wrapped__(req))
                assert 'users' in res and 'admins' in res
                assert res['current'] == 'admin1'

                # save users: remove user u1 and add u2; also remove admin1 would be forbidden
                class Req2:
                    def __init__(self, payload):
                        self._payload = payload
                        self.headers = {'X-Session-Id': 's1'}
                        self.cookies = {}
                        self.app = SimpleNamespace(state=SimpleNamespace(container=container))
                    async def json(self):
                        return self._payload

                # attempt to remove current admin from admins -> should raise
                payload = {'users': ['u1'], 'admins': []}
                req2 = Req2(payload)
                with pytest.raises(HTTPException) as ei:
                    asyncio.run(admin_api.admin_save_users.__wrapped__(req2))
                assert ei.value.status_code == 400

                # valid change: add u2 and admin2
                payload2 = {'users': ['u1', 'u2'], 'admins': ['admin1', 'admin2']}
                req3 = Req2(payload2)
                res2 = asyncio.run(admin_api.admin_save_users.__wrapped__(req3))
                assert res2['ok']
                assert 'u2' in storage.data['accounts']
                assert 'admin2' in storage.data['accounts_admin']