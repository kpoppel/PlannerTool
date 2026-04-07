"""Tests for the Azure browse API endpoints in planner_lib/azure/api.py.

These endpoints allow any authenticated user with a PAT to browse Azure DevOps
projects, area paths, and work item metadata without requiring admin privileges.
"""
from contextlib import contextmanager
from types import SimpleNamespace

import pytest

from tests.helpers import register_services_on_client


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------

class FakeSessionMgr:
    def __init__(self, pat=None):
        self._pat = pat

    def exists(self, sid):
        return True

    def get(self, sid):
        return {'email': 'user@example.com', 'pat': self._pat}

    def get_val(self, sid, key):
        if key == 'pat':
            return self._pat
        return None

    def create(self, data):
        return 'test-session'


class FakeAzureClient:
    """Stand-in for the AzureClient returned by azure_svc.connect(pat)."""

    def __init__(self, projects=None, area_paths=None, metadata=None, area_path_metadata=None):
        self._projects = projects or ['ProjectA', 'ProjectB']
        self._area_paths = area_paths or ['ProjectA', 'ProjectA\\Team1', 'ProjectA\\Team2']
        self._metadata = metadata or {
            'types': ['Bug', 'Epic', 'Feature', 'Task', 'User Story'],
            'states': ['Active', 'Closed', 'New', 'Resolved'],
            'states_by_type': {'Bug': ['Active', 'Closed', 'New', 'Resolved']},
            'state_categories': {'Active': 'InProgress', 'Closed': 'Completed', 'New': 'Proposed'},
        }
        # area-path-scoped metadata (only types/states found in that specific area)
        self._area_path_metadata = area_path_metadata or {
            'types': ['Feature', 'Bug'],
            'states': ['Active', 'New'],
            'states_by_type': {'Feature': ['Active', 'New'], 'Bug': ['Active']},
            'state_categories': {'Active': 'InProgress', 'New': 'Proposed'},
        }
        self.call_count = 0

    def get_projects(self):
        return self._projects

    def get_area_paths(self, project, root_path='/'):
        return self._area_paths

    def get_work_item_metadata(self, project):
        return self._metadata

    def get_area_path_used_metadata(self, project, area_path):
        self.call_count += 1
        return self._area_path_metadata


class FakeAzureService:
    """Stand-in for the azure_client service registered in the DI container."""

    def __init__(self, inner_client):
        self._inner = inner_client

    @contextmanager
    def connect(self, pat):
        yield self._inner


def _register_azure_services(client, pat='test-pat', inner_client=None):
    """Register a fake session manager and azure client service on test client."""
    fake_client = inner_client or FakeAzureClient()
    register_services_on_client(client, {
        'session_manager': FakeSessionMgr(pat=pat),
        'azure_client': FakeAzureService(fake_client),
    })


# ---------------------------------------------------------------------------
# Tests — GET /api/azure/projects
# ---------------------------------------------------------------------------

def test_browse_projects_returns_project_list(client):
    _register_azure_services(client)
    resp = client.get('/api/azure/projects')
    assert resp.status_code == 200
    data = resp.json()
    assert 'projects' in data
    assert 'ProjectA' in data['projects']
    assert 'ProjectB' in data['projects']


def test_browse_projects_missing_pat_returns_401(client):
    _register_azure_services(client, pat=None)
    resp = client.get('/api/azure/projects', headers={'Accept': 'application/json'})
    assert resp.status_code == 401
    # access_denied_response puts the error dict directly at the root (not under 'detail')
    assert resp.json()['error'] == 'missing_pat'


# ---------------------------------------------------------------------------
# Tests — GET /api/azure/area-paths
# ---------------------------------------------------------------------------

def test_browse_area_paths_returns_paths(client):
    _register_azure_services(client)
    resp = client.get('/api/azure/area-paths?project=ProjectA')
    assert resp.status_code == 200
    data = resp.json()
    assert 'area_paths' in data
    assert 'ProjectA\\Team1' in data['area_paths']


def test_browse_area_paths_missing_project_param_returns_422(client):
    _register_azure_services(client)
    # No ?project= query param — FastAPI should return 422 Unprocessable Entity
    resp = client.get('/api/azure/area-paths')
    assert resp.status_code == 422


def test_browse_area_paths_missing_pat_returns_401(client):
    _register_azure_services(client, pat=None)
    resp = client.get('/api/azure/area-paths?project=ProjectA', headers={'Accept': 'application/json'})
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Tests — GET /api/azure/work-item-metadata
# ---------------------------------------------------------------------------

def test_work_item_metadata_returns_types_and_states(client):
    _register_azure_services(client)
    resp = client.get('/api/azure/work-item-metadata?project=ProjectA')
    assert resp.status_code == 200
    data = resp.json()
    assert 'types' in data
    assert 'states' in data
    assert 'states_by_type' in data
    assert 'Feature' in data['types']
    assert 'Bug' in data['types']
    # Types must be exact Azure casing, not lowercased
    assert 'feature' not in data['types']
    assert 'epic' not in data['types']


def test_work_item_metadata_missing_project_param_returns_422(client):
    _register_azure_services(client)
    resp = client.get('/api/azure/work-item-metadata')
    assert resp.status_code == 422


def test_work_item_metadata_missing_pat_returns_401(client):
    _register_azure_services(client, pat=None)
    resp = client.get('/api/azure/work-item-metadata?project=ProjectA', headers={'Accept': 'application/json'})
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Tests — GET /api/azure/area-path-metadata
# ---------------------------------------------------------------------------

def test_area_path_metadata_returns_scoped_types_and_states(client):
    """area-path-metadata returns only what is actually used in that area path."""
    _register_azure_services(client)
    resp = client.get('/api/azure/area-path-metadata?project=ProjectA&area_path=ProjectA%5CTeam1')
    assert resp.status_code == 200
    data = resp.json()
    assert 'types' in data
    assert 'states' in data
    assert 'states_by_type' in data
    # Should only have types actually present in the area (Feature, Bug) — not all project types
    assert set(data['types']) == {'Bug', 'Feature'}
    assert 'Task' not in data['types']
    assert 'Epic' not in data['types']


def test_area_path_metadata_missing_project_returns_422(client):
    _register_azure_services(client)
    resp = client.get('/api/azure/area-path-metadata?area_path=ProjectA%5CTeam1')
    assert resp.status_code == 422


def test_area_path_metadata_missing_area_path_returns_422(client):
    _register_azure_services(client)
    resp = client.get('/api/azure/area-path-metadata?project=ProjectA')
    assert resp.status_code == 422


def test_area_path_metadata_missing_pat_returns_401(client):
    _register_azure_services(client, pat=None)
    resp = client.get(
        '/api/azure/area-path-metadata?project=ProjectA&area_path=ProjectA%5CTeam1',
        headers={'Accept': 'application/json'},
    )
    assert resp.status_code == 401


def test_area_path_metadata_returns_state_categories(client):
    """area-path-metadata now includes state_categories field."""
    inner = FakeAzureClient(area_path_metadata={
        'types': ['Feature'],
        'states': ['Active', 'New'],
        'states_by_type': {'Feature': ['Active', 'New']},
        'state_categories': {'Active': 'InProgress', 'New': 'Proposed'},
    })
    _register_azure_services(client, inner_client=inner)
    resp = client.get('/api/azure/area-path-metadata?project=ProjectA&area_path=ProjectA%5CTeam1')
    assert resp.status_code == 200
    data = resp.json()
    assert 'state_categories' in data
    assert data['state_categories']['Active'] == 'InProgress'
    assert data['state_categories']['New'] == 'Proposed'


# ---------------------------------------------------------------------------
# Tests — GET /api/azure/prefetch-projects-metadata
# ---------------------------------------------------------------------------

def test_prefetch_projects_metadata_returns_results(client):
    """prefetch endpoint returns metadata keyed by area path."""
    _register_azure_services(client)
    import urllib.parse
    area_path = urllib.parse.quote('ProjectA\\Team1', safe='')
    resp = client.get(f'/api/azure/prefetch-projects-metadata?area_paths={area_path}')
    assert resp.status_code == 200
    data = resp.json()
    assert 'results' in data
    assert 'ProjectA\\Team1' in data['results']
    result = data['results']['ProjectA\\Team1']
    assert result['azure_project'] == 'ProjectA'
    assert 'types' in result
    assert 'states' in result
    assert 'state_categories' in result


def test_prefetch_projects_metadata_multiple_paths(client):
    """prefetch endpoint handles multiple comma-separated area paths."""
    _register_azure_services(client)
    import urllib.parse
    p1 = urllib.parse.quote('ProjectA\\Team1', safe='')
    p2 = urllib.parse.quote('ProjectA\\Team2', safe='')
    resp = client.get(f'/api/azure/prefetch-projects-metadata?area_paths={p1}%2C{p2}')
    assert resp.status_code == 200
    data = resp.json()
    assert 'ProjectA\\Team1' in data['results']
    assert 'ProjectA\\Team2' in data['results']
    # Both should derive to the same azure_project
    assert data['results']['ProjectA\\Team1']['azure_project'] == 'ProjectA'
    assert data['results']['ProjectA\\Team2']['azure_project'] == 'ProjectA'


def test_prefetch_projects_metadata_missing_pat_returns_401(client):
    _register_azure_services(client, pat=None)
    import urllib.parse
    area_path = urllib.parse.quote('ProjectA\\Team1', safe='')
    resp = client.get(
        f'/api/azure/prefetch-projects-metadata?area_paths={area_path}',
        headers={'Accept': 'application/json'},
    )
    assert resp.status_code == 401


def test_prefetch_projects_metadata_missing_area_paths_returns_422(client):
    """Missing required area_paths param → 422 from FastAPI."""
    _register_azure_services(client)
    resp = client.get('/api/azure/prefetch-projects-metadata')
    assert resp.status_code == 422


def test_prefetch_projects_metadata_uses_disk_cache(client):
    """On second call for same area path the Azure client is not called again."""
    # Create a metadata service with an in-memory cache
    class InMemoryCache:
        def __init__(self):
            self._store = {}
        def load(self, ns, key):
            k = f"{ns}::{key}"
            if k not in self._store:
                raise KeyError(key)
            return self._store[k]
        def save(self, ns, key, val):
            self._store[f"{ns}::{key}"] = val

    from planner_lib.projects.metadata_service import AzureProjectMetadataService
    from tests.helpers import register_services_on_client

    svc_cache = InMemoryCache()
    meta_svc = AzureProjectMetadataService(cache=svc_cache)

    inner = FakeAzureClient()
    register_services_on_client(client, {
        'session_manager': FakeSessionMgr(pat='test-pat'),
        'azure_client': FakeAzureService(inner),
        'azure_project_metadata_service': meta_svc,
    })

    import urllib.parse
    area_path = urllib.parse.quote('ProjectA\\Team1', safe='')

    # First call — cache miss
    resp1 = client.get(f'/api/azure/prefetch-projects-metadata?area_paths={area_path}')
    assert resp1.status_code == 200
    call_count_after_first = inner.call_count

    # Second call — should hit the in-memory/disk cache, not call Azure again
    resp2 = client.get(f'/api/azure/prefetch-projects-metadata?area_paths={area_path}')
    assert resp2.status_code == 200
    assert inner.call_count == call_count_after_first  # no extra Azure call
