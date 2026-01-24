import pytest


@pytest.fixture(scope="function", autouse=True)
def ensure_test_sessions(monkeypatch, app):
    """Autouse fixture to make session checks permissive during tests.

    Use the function-scoped `app` fixture (in-memory backend) instead of
    importing `planner.app` directly. This avoids import-time coupling and
    ensures we patch the session manager used by the test app.
    """
    planner_app = app

    # Resolve the session manager from the app's service container.
    container = getattr(planner_app.state, 'container', None)
    if container is None:
        yield
        return
    try:
        mgr = container.get('session_manager')
    except Exception:
        yield
        return

    # Patch the SessionManager class methods so bound-method behavior is correct
    try:
        from planner_lib.middleware.session import SessionManager

        def exists_any(self, sid):
            return True

        def get_any(self, sid):
            return {"email": "test@example.com", "pat": "token"}

        def create_any(self, email: str):
            return "test-session"

        monkeypatch.setattr(SessionManager, "exists", exists_any, raising=True)
        monkeypatch.setattr(SessionManager, "get", get_any, raising=True)
        monkeypatch.setattr(SessionManager, "create", create_any, raising=True)
    except Exception:
        # Fallback: try to patch instance methods
        def exists_any(sid):
            return True

        def get_any(sid):
            return {"email": "test@example.com", "pat": "token"}

        def create_any(email: str):
            return "test-session"

        monkeypatch.setattr(mgr, "exists", exists_any, raising=False)
        monkeypatch.setattr(mgr, "get", get_any, raising=False)
        monkeypatch.setattr(mgr, "create", create_any, raising=False)
    # Also monkeypatch the request-level helper to always return a test session id
    try:
        import planner_lib.middleware.session as session_mod

        def _fake_get_session_id(request):
            return "test-session"

        monkeypatch.setattr(session_mod, "get_session_id_from_request", _fake_get_session_id, raising=True)
    except Exception:
        pass

    # Ensure `planner.app` module attribute is available for tests that import it
    try:
        import planner

        monkeypatch.setattr(planner, "app", planner_app, raising=False)
    except Exception:
        pass

    yield
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


@pytest.fixture(scope="function")
def app():
    """Create a fresh FastAPI app instance using the in-memory storage backend."""
    from planner_lib.main import create_app, Config

    return create_app(Config(storage_backend='memory'))


@pytest.fixture(scope="function")
def client(app):
    """FastAPI TestClient for the app fixture."""
    from fastapi.testclient import TestClient

    return TestClient(app)
