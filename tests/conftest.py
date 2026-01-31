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

        def create_any(self, email: str, request=None):
            return "test-session"

        def get_any(self, sid):
            # Prefer real stored session when available; otherwise return a
            # permissive default so tests that don't create a session still
            # behave as if an authenticated test user is present.
            try:
                stored = getattr(self, '_store', None)
                if stored is not None:
                    v = stored.get(sid)
                    if v is not None:
                        return v
            except Exception:
                pass
            return {"email": "test@example.com", "pat": "token"}

        monkeypatch.setattr(SessionManager, "exists", exists_any, raising=True)
        monkeypatch.setattr(SessionManager, "create", create_any, raising=True)
        monkeypatch.setattr(SessionManager, "get", get_any, raising=True)
    except Exception:
        # Fallback: try to patch instance methods
        def exists_any(sid):
            return True

        def get_any(sid):
            try:
                stored = getattr(mgr, '_store', None)
                if stored is not None:
                    v = stored.get(sid)
                    if v is not None:
                        return v
            except Exception:
                pass
            return {"email": "test@example.com", "pat": "token"}

        def create_any(self_or_email, email_or_request=None, request=None):
            # Support both (email) signature and (email, request=...) usage.
            # Normalize to return a constant test session id.
            return "test-session"

        monkeypatch.setattr(mgr, "exists", exists_any, raising=False)
        monkeypatch.setattr(mgr, "create", create_any, raising=False)
    # Also monkeypatch the request-level helper to always return a test session id
    try:
        import planner_lib.middleware.session as session_mod

        def _fake_get_session_id(request):
            return "test-session"

        monkeypatch.setattr(session_mod, "get_session_id_from_request", _fake_get_session_id, raising=True)
    except Exception:
        pass

    # Some modules imported `get_session_id_from_request` at import time
    # (bound to a local name). Ensure those references are patched too so
    # decorators and other imported call sites use the permissive test
    # helper rather than the original implementation.
    try:
        import planner_lib.middleware.admin as admin_mod

        monkeypatch.setattr(admin_mod, "get_session_id_from_request", _fake_get_session_id, raising=False)
    except Exception:
        pass
    try:
        import planner_lib.admin.api as admin_api_mod

        monkeypatch.setattr(admin_api_mod, "_get_session_id_or_raise", _fake_get_session_id, raising=False)
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


@pytest.fixture(scope="session")
def app():
    """Create a fresh FastAPI app instance using the in-memory storage backend."""
    from planner_lib.main import create_app, Config
    # Disable brotli by default in test apps to avoid environment-dependent
    # middleware differences during unit tests.
    # Ensure the in-memory storage used by create_app contains a server_config
    # so composition of services that read 'config/server_config' succeeds.
    # Patch MemoryStorage so all in-process memory backends share one instance.
    from planner_lib import storage as storage_mod
    try:
        from planner_lib.storage import memory_backend as mem_mod
        OrigMemory = mem_mod.MemoryStorage
        shared = OrigMemory()
        # Ensure server_config exists (empty dict) so create_app can read it
        try:
            shared.save('config', 'server_config', {})
        except Exception:
            pass

        # Replace the class so subsequent MemoryStorage() returns the same instance
        mem_mod.MemoryStorage = lambda: shared
    except Exception:
        OrigMemory = None

    try:
        app = create_app(Config(storage_backend='memory', enable_brotli=False))
        # Snapshot initial container singletons to allow per-test restoration
        try:
            container = getattr(app.state, 'container', None)
            if container is not None:
                app.state._initial_container_singletons = dict(getattr(container, '_singletons', {}))
            else:
                app.state._initial_container_singletons = {}
        except Exception:
            app.state._initial_container_singletons = {}
        return app
    finally:
        # Restore original MemoryStorage class if we replaced it
        try:
            if OrigMemory is not None:
                mem_mod.MemoryStorage = OrigMemory
        except Exception:
            pass


@pytest.fixture(autouse=True)
def isolate_storage(app):
    """Autouse fixture to reset in-memory storages between tests when the
    app is session-scoped. This preserves test isolation while keeping the
    app instance shared across the session.
    """
    # If app wasn't created or doesn't expose a container, nothing to do
    container = getattr(app.state, 'container', None)
    if container is None:
        yield
        return

    # Known storage names registered in create_app
    storage_names = ['server_config_storage', 'account_storage', 'scenarios_storage']
    for name in storage_names:
        try:
            s = container.get(name)
        except Exception:
            continue
        try:
            be = getattr(s, '_backend', s)
            # If underlying backend is the in-memory implementation, clear its store
            if hasattr(be, '_store') and isinstance(getattr(be, '_store'), dict):
                be._store.clear()
        except Exception:
            # Fallback: attempt to remove known namespaces if supported
            try:
                for k in list(s.list_keys('') or []):
                    try:
                        s.delete('', k)
                    except Exception:
                        pass
            except Exception:
                pass

    yield
    # After each test, restore container singletons to initial snapshot to avoid
    # cross-test pollution when the app is session-scoped.
    try:
        container = getattr(app.state, 'container', None)
        init = getattr(app.state, '_initial_container_singletons', None)
        if container is not None and init is not None:
            container._singletons = dict(init)
    except Exception:
        pass


@pytest.fixture(scope="function")
def client(app):
    """FastAPI TestClient for the app fixture."""
    from fastapi.testclient import TestClient

    return TestClient(app)
