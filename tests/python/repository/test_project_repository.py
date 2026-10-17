"""Tests for ProjectRepository and AzureDevOpsBackend project enrichment."""
import pytest

from planner_lib.repository.project_repository import ProjectRepository
from planner_lib.backend.config import ConfigBackend
from planner_lib.backend.azure import AzureDevOpsBackend
from planner_lib.azure.catalogue import work_item_display
from tests.python.azure.test_process_catalogue import catalogue_storage


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class FakeDiskCache:
    def __init__(self):
        self._store = {}
        defaults = catalogue_storage(['MyADO'])
        for key in ('ado_processes', 'global_settings'):
            self.save('config', key, defaults.load('config', key))

    def _key(self, ns, key):
        return f"{ns}::{key}"

    def save(self, ns, key, value, ttl_seconds=None):
        if ns == 'config' and key == 'projects':
            value = {**value, 'project_map': [
                {'task_types': ['Feature'], 'closed_history_days': 0, **plan}
                for plan in value['project_map']]}
        self._store[self._key(ns, key)] = value

    def load(self, ns, key):
        k = self._key(ns, key)
        if k not in self._store:
            raise KeyError(key)
        return self._store[k]

    def exists(self, ns, key):
        return self._key(ns, key) in self._store


class FakeBackend:
    def __init__(self, projects):
        self._projects = projects

    def fetch_projects(self):
        return list(self._projects)

    def fetch_project_map(self):
        return list(self._projects)


def _make_project(name='TeamA', area_path='MyADO\\TeamA'):
    storage = catalogue_storage(['MyADO'])
    return {
        'id': '11111111-1111-4111-8111-111111111111',
        'name': name,
        'type': 'project',
        'area_path': area_path,
        'task_types': ['Feature'],
        'closed_history_days': 0,
        'work_item_display': work_item_display(storage.load('config', 'ado_processes'),
                               storage.load('config', 'global_settings')),
    }


# ---------------------------------------------------------------------------
# ProjectRepository — simple delegation
# ---------------------------------------------------------------------------

def test_project_repository_delegates_to_backend():
    repo = ProjectRepository(backend=FakeBackend([_make_project()]))
    projects = repo.list_projects()
    assert len(projects) == 1
    assert projects[0]['name'] == 'TeamA'


def test_configured_container_order_is_exposed_on_projects():
    cache = FakeDiskCache()
    cache.save('config', 'projects', {
        'container_types': ['B', 'A', 'C'],
        'project_map': [
            {'id': '11111111-1111-4111-8111-111111111111', 'name': 'Alpha', 'type': 'A'},
            {'id': '22222222-2222-4222-8222-222222222222', 'name': 'Bravo', 'type': 'B'},
            {'id': '33333333-3333-4333-8333-333333333333', 'name': 'Charlie', 'type': 'C'},
        ],
    })
    backend = ConfigBackend(cache)
    projects = backend.fetch_projects()
    assert [project['container_order'] for project in projects] == [1, 0, 2]


def test_configured_projects_keep_unique_ids_when_names_are_equal():
    cache = FakeDiskCache()
    cache.save('config', 'projects', {
        'container_types': ['project'],
        'project_map': [
            {'id': '11111111-1111-4111-8111-111111111111', 'name': 'Shared', 'type': 'project'},
            {'id': '22222222-2222-4222-8222-222222222222', 'name': 'Shared', 'type': 'project'},
        ],
    })

    backend = ConfigBackend(cache)

    assert [project['id'] for project in backend.fetch_projects()] == [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
    ]
    assert [project['id'] for project in backend.fetch_project_map()] == [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
    ]


# ---------------------------------------------------------------------------
# AzureDevOpsBackend.fetch_projects — catalogue-backed display
# ---------------------------------------------------------------------------

@pytest.mark.parametrize('area_path', ['MyADO\\TeamA', None])
@pytest.mark.parametrize('empty_display', [False, True])
def test_azure_backend_preserves_configured_project_display(area_path, empty_display):
    project = _make_project(area_path=area_path)
    if empty_display:
        project['work_item_display'] = []
    backend = AzureDevOpsBackend(
        organization_url='https://dev.azure.com/MyOrg',
        storage=None,
        team_repository=None,
        capacity_service=None,
        local_backend=FakeBackend([project]),
    )
    projects = backend.fetch_projects()
    assert projects == [project]
