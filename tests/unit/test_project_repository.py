"""Tests for ProjectRepository and AzureDevOpsBackend project enrichment."""
import pytest

from planner_lib.repository.project_repository import ProjectRepository
from planner_lib.backend.azure import AzureDevOpsBackend
from planner_lib.projects.metadata_service import AzureProjectMetadataService


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class FakeDiskCache:
    def __init__(self):
        self._store = {}

    def _key(self, ns, key):
        return f"{ns}::{key}"

    def save(self, ns, key, value, ttl_seconds=None):
        self._store[self._key(ns, key)] = value

    def load(self, ns, key):
        k = self._key(ns, key)
        if k not in self._store:
            raise KeyError(key)
        return self._store[k]

    def exists(self, ns, key):
        return self._key(ns, key) in self._store


def _state_categories():
    return {'New': 'Proposed', 'Active': 'InProgress', 'Closed': 'Completed'}


def _make_metadata():
    return {
        'types': ['Feature'],
        'states': ['New', 'Active', 'Closed'],
        'states_by_type': {},
        'state_categories': _state_categories(),
    }


class FakeBackend:
    def __init__(self, projects):
        self._projects = projects

    def fetch_projects(self):
        return list(self._projects)

    def fetch_project_map(self):
        return list(self._projects)


def _make_project(name='TeamA', area_path='MyADO\\TeamA', states=None):
    return {
        'id': f'project-{name.lower()}',
        'name': name,
        'type': 'project',
        'area_path': area_path,
        'display_states': states or ['New', 'Active', 'Closed'],
        'state_categories': {},
        'task_types': [],
        'task_type_hierarchy': [],
        'state_display_sequence': [],
    }


# ---------------------------------------------------------------------------
# ProjectRepository — simple delegation
# ---------------------------------------------------------------------------

def test_project_repository_delegates_to_backend():
    repo = ProjectRepository(backend=FakeBackend([_make_project()]))
    projects = repo.list_projects()
    assert len(projects) == 1
    assert projects[0]['name'] == 'TeamA'


# ---------------------------------------------------------------------------
# AzureDevOpsBackend.fetch_projects — no metadata service
# ---------------------------------------------------------------------------

def test_azure_backend_fetch_projects_no_metadata_service_returns_projects_as_is():
    backend = AzureDevOpsBackend(
        organization_url='https://dev.azure.com/MyOrg',
        storage=None,
        team_repository=None,
        capacity_service=None,
        local_backend=FakeBackend([_make_project()]),
        metadata_service=None,
    )
    projects = backend.fetch_projects()
    assert projects[0]['state_categories'] == {}


# ---------------------------------------------------------------------------
# AzureDevOpsBackend.fetch_projects — cold cache
# ---------------------------------------------------------------------------

def test_azure_backend_fetch_projects_cold_cache_returns_empty_state_categories():
    """Cache not yet warmed → state_categories stays empty until a task fetch
    warms it as a side-effect inside AzureDevOpsBackend.fetch_tasks."""
    cache = FakeDiskCache()
    metadata_svc = AzureProjectMetadataService(cache=cache)
    backend = AzureDevOpsBackend(
        organization_url='https://dev.azure.com/MyOrg',
        storage=None,
        team_repository=None,
        capacity_service=None,
        local_backend=FakeBackend([_make_project()]),
        metadata_service=metadata_svc,
    )
    projects = backend.fetch_projects()
    assert projects[0]['state_categories'] == {}


# ---------------------------------------------------------------------------
# AzureDevOpsBackend.fetch_projects — warm cache
# ---------------------------------------------------------------------------

def test_azure_backend_fetch_projects_warm_cache_enriches_state_categories():
    """After a task fetch has warmed the cache, state_categories are returned."""
    cache = FakeDiskCache()
    metadata_svc = AzureProjectMetadataService(cache=cache)
    # Simulate the side-effect that AzureDevOpsBackend.fetch_tasks produces
    metadata_svc.store('MyADO', _make_metadata())

    backend = AzureDevOpsBackend(
        organization_url='https://dev.azure.com/MyOrg',
        storage=None,
        team_repository=None,
        capacity_service=None,
        local_backend=FakeBackend([_make_project()]),
        metadata_service=metadata_svc,
    )
    projects = backend.fetch_projects()
    assert projects[0]['state_categories'] == {
        'New': 'Proposed', 'Active': 'InProgress', 'Closed': 'Completed'
    }


def test_azure_backend_fetch_projects_warm_cache_filters_to_display_states():
    """Only states in display_states are included in state_categories."""
    cache = FakeDiskCache()
    metadata_svc = AzureProjectMetadataService(cache=cache)
    full_meta = {**_make_metadata(), 'state_categories': {
        'New': 'Proposed', 'Active': 'InProgress', 'Closed': 'Completed',
        'Resolved': 'Resolved', 'Removed': 'Removed',
    }}
    metadata_svc.store('MyADO', full_meta)

    backend = AzureDevOpsBackend(
        organization_url='https://dev.azure.com/MyOrg',
        storage=None,
        team_repository=None,
        capacity_service=None,
        local_backend=FakeBackend([_make_project(states=['New', 'Active', 'Closed'])]),
        metadata_service=metadata_svc,
    )
    projects = backend.fetch_projects()
    assert set(projects[0]['state_categories'].keys()) == {'New', 'Active', 'Closed'}


def test_azure_backend_fetch_projects_skips_project_without_area_path():
    """Projects with no area_path are returned unchanged."""
    p = _make_project()
    p['area_path'] = None
    cache = FakeDiskCache()
    metadata_svc = AzureProjectMetadataService(cache=cache)
    metadata_svc.store('MyADO', _make_metadata())
    
    backend = AzureDevOpsBackend(
        organization_url='https://dev.azure.com/MyOrg',
        storage=None,
        team_repository=None,
        capacity_service=None,
        local_backend=FakeBackend([p]),
        metadata_service=metadata_svc,
    )
    projects = backend.fetch_projects()
    assert projects[0]['state_categories'] == {}


def test_azure_backend_fetch_projects_skips_project_without_display_states():
    """Projects with no display_states are returned unchanged."""
    p = _make_project()
    p['display_states'] = []
    cache = FakeDiskCache()
    metadata_svc = AzureProjectMetadataService(cache=cache)
    metadata_svc.store('MyADO', _make_metadata())
    
    backend = AzureDevOpsBackend(
        organization_url='https://dev.azure.com/MyOrg',
        storage=None,
        team_repository=None,
        capacity_service=None,
        local_backend=FakeBackend([p]),
        metadata_service=metadata_svc,
    )
    projects = backend.fetch_projects()
    assert projects[0]['state_categories'] == {}

