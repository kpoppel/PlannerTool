import os
import yaml
import pytest

# Ensure a test secret key is always available so AccountManager can encrypt
# PATs without raising RuntimeError about a missing PLANNER_SECRET_KEY.
os.environ.setdefault('PLANNER_SECRET_KEY', 'test-only-secret-key-not-for-production')


class SimpleCache:
    def __init__(self):
        self._store = {}

    def exists(self, ns, key):
        return ns in self._store and key in self._store[ns]

    def load(self, ns, key):
        return self._store.get(ns, {}).get(key)

    def save(self, ns, key, val):
        self._store.setdefault(ns, {})[key] = val

    def delete(self, ns, key):
        if ns in self._store and key in self._store[ns]:
            del self._store[ns][key]


class FakeStorage:
    def __init__(self, base_path):
        self.base_path = base_path

    def load(self, ns, key):
        # Only support load('config', 'cost_config') for tests
        if ns == 'config' and key == 'cost_config':
            path = os.path.join(self.base_path, 'cost_config_test.yml')
            with open(path, 'r', encoding='utf-8') as f:
                data = yaml.safe_load(f) or {}
                # The real storage returns the inner cost mapping; support both
                # file formats that wrap under a top-level 'cost' key or
                # the raw cost dict.
                if isinstance(data, dict) and 'cost' in data and isinstance(data['cost'], dict):
                    return data['cost']
                return data
        return {}


class FakePeopleService:
    def __init__(self, people):
        self._people = people

    def get_people(self):
        return list(self._people)

    def list_people(self):
        return list(self._people)


class FakeProjectService:
    def __init__(self, projects):
        self._projects = projects

    def list_projects(self):
        return list(self._projects)


class FakeTeamService:
    def list_teams(self):
        return []


@pytest.fixture
def fixtures_dir(tmp_path, request):
    # Copy fixtures from tests/fixtures into a temporary path so tests
    # run isolated and do not depend on working directory.
    base = tmp_path / "fixtures"
    base.mkdir()
    src = os.path.join(os.path.dirname(__file__), 'fixtures')
    if os.path.isdir(src):
        import shutil
        for name in os.listdir(src):
            shutil.copy(os.path.join(src, name), str(base / name))
    return str(base)


@pytest.fixture
def cache_storage():
    return SimpleCache()


@pytest.fixture
def cost_config(fixtures_dir):
    import yaml
    path = os.path.join(fixtures_dir, 'cost_config_test.yml')
    with open(path, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f) or {}


@pytest.fixture
def people(fixtures_dir):
    import yaml
    path = os.path.join(fixtures_dir, 'people_test.yml')
    with open(path, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f) or []


@pytest.fixture
def projects():
    return [
        {'id': 'project-1', 'type': 'project'},
        {'id': 'project-2', 'type': 'project'},
    ]


@pytest.fixture
def fake_services(fixtures_dir, people, projects):
    storage = FakeStorage(fixtures_dir)
    people_svc = FakePeopleService(people)
    project_svc = FakeProjectService(projects)
    team_svc = FakeTeamService()
    return {
        'storage': storage,
        'people_service': people_svc,
        'project_service': project_svc,
        'team_service': team_svc,
        # Repository facades backed by the same service stubs
        'people_repository': people_svc,
        'team_repository': team_svc,
        'project_repository': project_svc,
    }
import pytest


@pytest.fixture
def authenticated_client(client):
    """TestClient enrolled through the real HTTP session flow."""
    response = client.post('/api/auth/enroll', json={
        'email': 'authenticated-test@example.com',
        'name': 'Authenticated Test Client',
    }, headers={'Accept': 'application/json'})
    assert response.status_code == 200
    return client
"""Pytest configuration helpers for test collection.

Ensure the project root is on sys.path so tests can import the package
without requiring PYTHONPATH to be set externally.
"""
import sys
from pathlib import Path


def pytest_configure(config):
    # Insert repo root (one level up from tests/) to sys.path
    repo_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(repo_root))


@pytest.fixture
def app(tmp_path):
    """Create an isolated FastAPI app and storage backend for each test."""
    from planner_lib.main import create_app, Config
    return create_app(Config(
        data_dir=str(tmp_path),
        storage_backend='memory',
        enable_brotli=False,
    ))


@pytest.fixture(scope="function")
def client(app):
    """FastAPI TestClient for the app fixture."""
    from fastapi.testclient import TestClient

    return TestClient(app)
