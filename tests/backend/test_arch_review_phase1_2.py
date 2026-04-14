"""Tests for Phase 1 + Phase 2 architectural improvements.

Covers:
- Reloadable / Invalidatable protocol declarations
- AdminService.reload_config() no longer requires a Request argument
- SessionManager.create() no longer requires a Request argument (uses account_storage)
- HistoryService is registered in the DI container
- HTTP 500 responses no longer expose internal exception messages (OWASP A05)
"""
import os
import uuid
import pytest
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# Protocol declarations
# ---------------------------------------------------------------------------


def test_reloadable_protocol_is_runtime_checkable():
    from planner_lib.services.interfaces import Reloadable

    class HasReload:
        def reload(self):
            pass

    class NoReload:
        pass

    assert isinstance(HasReload(), Reloadable)
    assert not isinstance(NoReload(), Reloadable)


def test_invalidatable_protocol_is_runtime_checkable():
    from planner_lib.services.interfaces import Invalidatable

    class HasInvalidate:
        def invalidate_cache(self):
            pass

    class NoInvalidate:
        pass

    assert isinstance(HasInvalidate(), Invalidatable)
    assert not isinstance(NoInvalidate(), Invalidatable)


# ---------------------------------------------------------------------------
# AdminService.reload_config — no Request dependency
# ---------------------------------------------------------------------------


def _make_admin_service(config_data=None):
    """Return an AdminService backed by simple in-memory mocks."""
    from planner_lib.admin.service import AdminService

    account_storage = MagicMock()
    account_storage.exists.return_value = False
    config_storage = MagicMock()
    config_storage.load.side_effect = KeyError("not found")
    config_storage.load.return_value = config_data or {}
    # Make load raise KeyError for all calls (no server_config present)
    config_storage.load.side_effect = KeyError("not found")

    azure_client = MagicMock()
    azure_client.organization_url = None
    azure_client.feature_flags = None

    return AdminService(
        account_storage=account_storage,
        config_storage=config_storage,
        project_service=None,
        account_manager=MagicMock(),
        azure_client=azure_client,
    )


def test_admin_reload_config_accepts_no_arguments():
    """reload_config() must accept zero arguments and return {'ok': True}."""
    svc = _make_admin_service()
    result = svc.reload_config()
    assert result == {'ok': True}


def test_admin_reload_config_calls_reload_on_reloadable_services():
    """reload_config() calls reload() on injected services that implement Reloadable."""
    from planner_lib.admin.service import AdminService

    class FakeReloadable:
        reloaded = False
        def reload(self):
            self.reloaded = True

    people = FakeReloadable()
    config_storage = MagicMock()
    config_storage.load.side_effect = KeyError("not found")
    azure_client = MagicMock()
    azure_client.organization_url = None
    azure_client.feature_flags = None

    svc = AdminService(
        account_storage=MagicMock(),
        config_storage=config_storage,
        project_service=None,
        account_manager=MagicMock(),
        azure_client=azure_client,
        reloadable_services=[people],
    )
    svc.reload_config()
    assert people.reloaded, "reload() should have been called on the people service"


def test_admin_reload_config_calls_invalidate_on_invalidatable_cost():
    """reload_config() calls invalidate_cache() on the cost service."""
    from planner_lib.admin.service import AdminService

    class FakeInvalidatable:
        invalidated = False
        def invalidate_cache(self):
            self.invalidated = True

    cost = FakeInvalidatable()
    config_storage = MagicMock()
    config_storage.load.side_effect = KeyError("not found")
    azure_client = MagicMock()
    azure_client.organization_url = None
    azure_client.feature_flags = None

    svc = AdminService(
        account_storage=MagicMock(),
        config_storage=config_storage,
        project_service=None,
        account_manager=MagicMock(),
        azure_client=azure_client,
        reloadable_services=[cost],
    )
    svc.reload_config()
    assert cost.invalidated, "invalidate_cache() should have been called on cost service"


# ---------------------------------------------------------------------------
# SessionManager — admin fallback via account_storage, no Request
# ---------------------------------------------------------------------------
#
# NOTE: The conftest `ensure_test_sessions` autouse fixture monkeypatches
# SessionManager.create at the class level to facilitate integration tests.
# For unit-testing the REAL implementation we load a fresh copy of the
# module via importlib so the class is not subject to that patch.

import importlib.util


def _make_storage_with_admin(email):
    """Fake storage that has `email` in `accounts_admin` namespace but not in `accounts`."""
    store = {}

    class FakeStorage:
        def exists(self, ns, key):
            return store.get(ns, {}).get(key) is not None

        def load(self, ns, key):
            val = store.get(ns, {}).get(key)
            if val is None:
                raise KeyError(key)
            return val

        def save(self, ns, key, val):
            store.setdefault(ns, {})[key] = val

    s = FakeStorage()
    s.save('accounts_admin', email, {'email': email})
    return s


def _load_fresh_session_manager():
    """Return a SessionManager class loaded from a fresh module import.

    This bypasses any monkeypatching applied to the regular
    `planner_lib.middleware.session.SessionManager` class by test fixtures.
    """
    import planner_lib.middleware.session as orig_mod
    spec = importlib.util.spec_from_file_location(
        'session_fresh', orig_mod.__file__
    )
    fresh_mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fresh_mod)
    return fresh_mod.SessionManager


def test_session_manager_create_does_not_accept_request_kwarg():
    """Ensure create() no longer accepts a request= keyword argument."""
    FreshSM = _load_fresh_session_manager()
    import inspect
    sig = inspect.signature(FreshSM.create)
    assert 'request' not in sig.parameters, (
        "SessionManager.create() must not accept a 'request' parameter"
    )


def test_session_manager_admin_fallback_uses_account_storage():
    """Admin-only emails create sessions when account_storage has accounts_admin marker."""
    FreshSM = _load_fresh_session_manager()

    email = "adminonly@example.com"
    account_storage = _make_storage_with_admin(email)

    account_manager = MagicMock()
    account_manager.load.side_effect = KeyError("not found")

    mgr = FreshSM(
        account_manager=account_manager,
        account_storage=account_storage,
    )
    sid = mgr.create(email)
    assert sid, "Should have returned a session id"
    ctx = mgr.get(sid)
    assert ctx['email'] == email
    assert ctx['pat'] is None


def test_session_manager_raises_for_unknown_email_without_admin_marker():
    """create() raises KeyError when email has no account and no admin marker."""
    FreshSM = _load_fresh_session_manager()

    class EmptyStorage:
        def exists(self, ns, key):
            return False

    account_manager = MagicMock()
    account_manager.load.side_effect = KeyError("not found")

    mgr = FreshSM(
        account_manager=account_manager,
        account_storage=EmptyStorage(),
    )
    with pytest.raises(KeyError):
        mgr.create("nobody@example.com")


# ---------------------------------------------------------------------------
# HistoryService in DI container
# ---------------------------------------------------------------------------


def test_history_service_key_in_service_keys():
    from planner_lib.services.container import ServiceKeys
    assert hasattr(ServiceKeys, 'HISTORY_SERVICE')
    assert ServiceKeys.HISTORY_SERVICE == 'history_service'


def test_history_service_registered_in_app(app):
    """The session-scoped app must have history_service in the container."""
    container = app.state.container
    history_svc = container.get('history_service')
    assert history_svc is not None


# ---------------------------------------------------------------------------
# HTTP 500 responses must not expose exception messages
# ---------------------------------------------------------------------------


def test_api_handlers_do_not_expose_exception_in_500_detail():
    """Verify that HTTP 500 responses use a static detail string, not str(e).

    This guards against OWASP A05 (Security Misconfiguration / Information
    Exposure) where internal Python exception messages — which may contain
    file paths, class names, or config values — are sent back to clients.
    """
    import inspect
    import importlib

    leak_pattern = 'detail=str(e)'

    api_modules = [
        'planner_lib.session.api',
        'planner_lib.accounts.api',
        'planner_lib.projects.api',
        'planner_lib.scenarios.api',
        'planner_lib.views.api',
        'planner_lib.cost.api',
    ]

    violations = []
    for mod_name in api_modules:
        mod = importlib.import_module(mod_name)
        source = inspect.getsource(mod)
        if leak_pattern in source:
            violations.append(mod_name)

    assert not violations, (
        f"Found 'detail=str(e)' in these API modules (OWASP A05 risk): "
        f"{violations}"
    )
