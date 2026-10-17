"""Tests for the Azure browse API endpoints in planner_lib/azure/api.py.

These endpoints allow any authenticated user with a PAT to browse Azure DevOps
projects and area paths without requiring admin privileges.

The browse-live endpoints (/projects, /wikis, /wiki-pages) build a fresh live
AzureClient via _live_client_or_raise().  Tests patch that helper to inject
a FakeAzureClient without making real ADO connections.
"""
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from tests.helpers import register_services_on_client


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------

class FakeSessionMgr:
    def get(self, sid):
        return {'email': 'user@example.com', 'account_id': 'test-account'}

    def create(self, data):
        return 'test-session'


class FakeAzureClient:
    """Stand-in for the AzureClient returned by azure_svc.connect(pat)."""

    def __init__(self, projects=None, area_paths=None):
        self._projects = projects or ['ProjectA', 'ProjectB']
        self._area_paths = area_paths or ['ProjectA', 'ProjectA\\Team1', 'ProjectA\\Team2']

    def get_projects(self):
        return self._projects

    def get_area_paths(self, project, root_path='/'):
        return self._area_paths

class FakeAzureService:
    """Stand-in for the azure_client service registered in the DI container."""

    def __init__(self, inner_client):
        self._inner = inner_client

    @contextmanager
    def connect(self, pat):
        yield self._inner


def _register_azure_services(authenticated_client, pat='test-pat', inner_client=None):
    """Register explicit session and Azure service stubs on the test client."""
    fake_client = inner_client or FakeAzureClient()
    register_services_on_client(authenticated_client, {
        'session_manager': FakeSessionMgr(),
        'account_manager': SimpleNamespace(load=lambda email: {'pat': pat}, pat_error=lambda email: None),
        'azure_client': FakeAzureService(fake_client),
    })
    return fake_client


@contextmanager
def _patch_live_client(fake_client):
    """Patch _live_client_or_raise to yield fake_client instead of a real ADO connection."""
    @contextmanager
    def _fake_live(org_url, pat):
        yield fake_client

    with patch('planner_lib.azure.api._live_client_or_raise', side_effect=_fake_live):
        yield


# ---------------------------------------------------------------------------
# Tests — GET /api/azure/projects
# ---------------------------------------------------------------------------

@pytest.mark.parametrize('endpoint', [
    'work-item-metadata', 'area-path-metadata', 'prefetch-projects-metadata',
])
def test_legacy_metadata_routes_are_not_registered(endpoint):
    from planner_lib.azure.api import browse_router

    assert f'/{endpoint}' not in {route.path for route in browse_router.routes}


def test_browse_projects_returns_project_list(authenticated_client):
    fake_client = _register_azure_services(authenticated_client)
    with _patch_live_client(fake_client):
        resp = authenticated_client.get('/api/azure/projects?org_url=test-org')
    assert resp.status_code == 200
    data = resp.json()
    assert 'projects' in data
    assert 'ProjectA' in data['projects']
    assert 'ProjectB' in data['projects']


def test_browse_projects_missing_pat_returns_401(authenticated_client):
    _register_azure_services(authenticated_client, pat=None)
    resp = authenticated_client.get('/api/azure/projects?org_url=test-org', headers={'Accept': 'application/json'})
    assert resp.status_code == 401
    # access_denied_response puts the error dict directly at the root (not under 'detail')
    assert resp.json()['error'] == 'missing_pat'


# ---------------------------------------------------------------------------
# Tests — GET /api/azure/area-paths
# ---------------------------------------------------------------------------

def test_browse_area_paths_returns_paths(authenticated_client):
    _register_azure_services(authenticated_client)
    resp = authenticated_client.get('/api/azure/area-paths?project=ProjectA')
    assert resp.status_code == 200
    data = resp.json()
    assert 'area_paths' in data
    assert 'ProjectA\\Team1' in data['area_paths']


def test_browse_area_paths_missing_project_param_returns_422(authenticated_client):
    _register_azure_services(authenticated_client)
    # No ?project= query param — FastAPI should return 422 Unprocessable Entity
    resp = authenticated_client.get('/api/azure/area-paths')
    assert resp.status_code == 422


def test_browse_area_paths_missing_pat_returns_401(authenticated_client):
    _register_azure_services(authenticated_client, pat=None)
    resp = authenticated_client.get('/api/azure/area-paths?project=ProjectA', headers={'Accept': 'application/json'})
    assert resp.status_code == 401


def test_cache_refresh_uses_active_projects_and_rejects_archived_areas(authenticated_client):
    from tests.helpers import register_services_on_client
    from planner_lib.azure.api import router as cache_router

    authenticated_client.app.include_router(cache_router, prefix='/api/cache')

    active_project = {
        'id': '11111111-1111-4111-8111-111111111111',
        'name': 'Active', 'type': 'project', 'area_path': 'ProjectA\\Active',
        'task_types': ['Feature'], 'closed_history_days': 0,
    }
    archived_project = {
        'id': '22222222-2222-4222-8222-222222222222',
        'name': 'Archived', 'type': 'project', 'area_path': 'ProjectA\\Archived',
        'task_types': ['Feature'], 'closed_history_days': 0, 'archived': True,
    }

    class FakeProjectRepository:
        def get_project_map(self):
            return [active_project]

    class FakeAdminService:
        def get_config(self, key, default=None):
            return {
                'project_map': [active_project, archived_project],
            } if key == 'projects' else default

    class FakeRefreshBackend:
        def __init__(self):
            self.fetch_calls = []

        def invalidate_cache(self):
            return {'ok': True}

        def fetch_tasks(self, area_path, **kwargs):
            self.fetch_calls.append(area_path)
            return []

    backend = FakeRefreshBackend()
    register_services_on_client(authenticated_client, {
        'backend': backend,
        'project_repository': FakeProjectRepository(),
        'admin_service': FakeAdminService(),
    })
    _register_azure_services(authenticated_client)

    response = authenticated_client.get('/api/cache/refresh')
    assert response.status_code == 200, response.text
    assert backend.fetch_calls == ['ProjectA\\Active']
    assert response.json()['refreshed'] == ['ProjectA\\Active']

    response = authenticated_client.get('/api/cache/refresh', params={
        'areas': 'ProjectA\\Archived',
    })
    assert response.status_code == 200
    assert backend.fetch_calls == ['ProjectA\\Active']
    assert response.json()['refreshed'] == []
    assert response.json()['errors'] == [{
        'area': 'ProjectA\\Archived',
        'error': 'Archived project areas cannot be refreshed',
    }]
