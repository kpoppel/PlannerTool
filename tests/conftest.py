"""Shared isolated application and authentication fixtures."""
import os
import sys
from pathlib import Path

import pytest

# Ensure a test secret key is always available so AccountManager can encrypt
# PATs without raising RuntimeError about a missing PLANNER_SECRET_KEY.
os.environ.setdefault('PLANNER_SECRET_KEY', 'test-only-secret-key-not-for-production')


@pytest.fixture
def authenticated_client(client):
    """TestClient enrolled through the real HTTP session flow."""
    response = client.post('/api/auth/enroll', json={
        'email': 'authenticated-test@example.com',
        'name': 'Authenticated Test Client',
    }, headers={'Accept': 'application/json'})
    assert response.status_code == 200
    return client
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
