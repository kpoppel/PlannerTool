import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from planner_lib.admin import api as admin_api


class _FakeAdminService:
    def __init__(self, cfg=None):
        self._cfg = cfg or {}

    def get_config(self, key, default=None):
        return self._cfg.get(key, default)

    def save_config(self, key, content):
        self._cfg[key] = content


def _container(admin_svc):
    return SimpleNamespace(get=lambda name: {'admin_service': admin_svc}.get(name))


class _Req:
    def __init__(self, container, payload=None):
        self._payload = payload
        self.headers = {}
        self.cookies = {}
        self.app = SimpleNamespace(state=SimpleNamespace(container=container))

    async def json(self):
        return self._payload


def test_admin_get_iterations_defaults_to_iteration_sets():
    admin_svc = _FakeAdminService(cfg={})
    req = _Req(_container(admin_svc))

    result = asyncio.run(admin_api.admin_get_iterations.__wrapped__(req))

    assert result == {'content': {'iteration_sets': []}}


def test_admin_get_iterations_ignores_legacy_shape():
    admin_svc = _FakeAdminService(
        cfg={
            'iterations': {
                'azure_project': 'MyProject',
                'default_roots': ['Platform'],
                'project_overrides': {},
            }
        }
    )
    req = _Req(_container(admin_svc))

    result = asyncio.run(admin_api.admin_get_iterations.__wrapped__(req))

    assert result == {'content': {'iteration_sets': []}}


def test_admin_save_iterations_validates_required_fields():
    admin_svc = _FakeAdminService(cfg={})

    bad_missing_source = {
        'content': {
            'iteration_sets': [
                {'id': 'set-1', 'name': 'Set 1', 'values': []},
            ]
        }
    }
    req = _Req(_container(admin_svc), payload=bad_missing_source)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(admin_api.admin_save_iterations.__wrapped__(req))
    assert exc.value.status_code == 400


def test_admin_save_iterations_persists_normalized_payload():
    admin_svc = _FakeAdminService(cfg={})
    payload = {
        'content': {
            'iteration_sets': [
                {
                    'id': 'set-1',
                    'name': 'Set 1',
                    'source_project': 'MyProject',
                    'root_path': 'Platform',
                    'values': [],
                }
            ]
        }
    }
    req = _Req(_container(admin_svc), payload=payload)

    result = asyncio.run(admin_api.admin_save_iterations.__wrapped__(req))

    assert result == {'ok': True}
    saved = admin_svc.get_config('iterations')
    assert saved['iteration_sets'][0]['id'] == 'set-1'
    assert saved['iteration_sets'][0]['source_project'] == 'MyProject'


def test_admin_delete_iteration_set_blocks_when_referenced_in_project_map():
    admin_svc = _FakeAdminService(
        cfg={
            'iterations': {
                'iteration_sets': [
                    {'id': 'set-1', 'name': 'Set 1', 'source_project': 'MyProject', 'values': [], 'cached_at': None},
                    {'id': 'set-2', 'name': 'Set 2', 'source_project': 'MyProject', 'values': [], 'cached_at': None},
                ]
            },
            'projects': {
                'project_map': [
                    {'name': 'Proj A', 'iteration_uuid': 'set-1'},
                    {'name': 'Proj B', 'iteration_uuid': None},
                ]
            },
        }
    )
    req = _Req(_container(admin_svc))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(admin_api.admin_delete_iteration_set.__wrapped__(req, 'set-1'))

    assert exc.value.status_code == 409
    assert exc.value.detail['error'] == 'referenced_by_projects'


def test_admin_unassociate_all_iterations_clears_project_map_links():
    admin_svc = _FakeAdminService(
        cfg={
            'projects': {
                'project_map': [
                    {'name': 'Proj A', 'iteration_uuid': 'set-1'},
                    {'name': 'Proj B', 'iteration_uuid': 'set-1'},
                    {'name': 'Proj C', 'iteration_uuid': 'set-2'},
                ]
            }
        }
    )
    req = _Req(_container(admin_svc), payload={})

    result = asyncio.run(admin_api.admin_unassociate_all_iterations.__wrapped__(req, 'set-1'))

    assert result == {'ok': True, 'unassociated': 2}
    pmap = admin_svc.get_config('projects')['project_map']
    assert pmap[0]['iteration_uuid'] is None
    assert pmap[1]['iteration_uuid'] is None
    assert pmap[2]['iteration_uuid'] == 'set-2'
