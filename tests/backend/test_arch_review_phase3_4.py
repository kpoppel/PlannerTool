"""Tests for Phase 3 (CacheCoordinator) and Phase 4 (hygiene) architectural improvements.

Covers:
- CacheCoordinator fans out to all registered Invalidatable services
- CacheCoordinator is registered in the DI container
- Azure router prefixes are declared in main.py (not in azure/api.py)
- health.py no longer reads storage at request time (uses injected HealthConfig)
- AzureService satisfies the Invalidatable protocol
"""
import pytest
from unittest.mock import MagicMock, call


# ---------------------------------------------------------------------------
# CacheCoordinator unit tests
# ---------------------------------------------------------------------------


def test_coordinator_fans_out_to_all_invalidatables():
    from planner_lib.services.cache_coordinator import CacheCoordinator

    class FakeCache:
        invalidated = False
        def invalidate_cache(self):
            self.invalidated = True

    c1, c2 = FakeCache(), FakeCache()
    coord = CacheCoordinator()
    coord.register(c1, "cache_one")
    coord.register(c2, "cache_two")

    result = coord.invalidate_all()

    assert c1.invalidated
    assert c2.invalidated
    assert result["ok"] is True
    assert set(result["invalidated"]) == {"cache_one", "cache_two"}
    assert result["errors"] == []


def test_coordinator_skips_non_invalidatables():
    from planner_lib.services.cache_coordinator import CacheCoordinator

    class NotACache:
        pass

    coord = CacheCoordinator()
    coord.register(NotACache(), "not_a_cache")
    # Should not raise and the service should not appear in the list
    result = coord.invalidate_all()
    assert result["invalidated"] == []


def test_coordinator_reports_errors_but_continues():
    from planner_lib.services.cache_coordinator import CacheCoordinator

    class BrokenCache:
        def invalidate_cache(self):
            raise RuntimeError("disk full")

    class GoodCache:
        invalidated = False
        def invalidate_cache(self):
            self.invalidated = True

    broken = BrokenCache()
    good = GoodCache()
    coord = CacheCoordinator()
    coord.register(broken, "broken")
    coord.register(good, "good")

    result = coord.invalidate_all()

    # Good cache still runs even though broken raised
    assert good.invalidated
    assert result["ok"] is False
    assert len(result["errors"]) == 1
    assert "broken" in result["errors"][0]
    assert "good" in result["invalidated"]


def test_cache_coordinator_registered_in_app(app):
    coordinator = app.state.container.get("cache_coordinator")
    assert coordinator is not None


def test_cache_coordinator_has_azure_and_cost(app):
    from planner_lib.services.cache_coordinator import CacheCoordinator
    coordinator = app.state.container.get("cache_coordinator")
    assert isinstance(coordinator, CacheCoordinator)
    # Should have at least one registered service (azure_client, cost_service)
    assert len(coordinator._services) >= 1


# ---------------------------------------------------------------------------
# AzureService satisfies Invalidatable protocol
# ---------------------------------------------------------------------------


def test_azure_service_satisfies_invalidatable():
    from planner_lib.services.interfaces import Invalidatable
    from planner_lib.azure import AzureService

    svc = AzureService(organization_url="https://dev.azure.com/test", storage=MagicMock())
    assert isinstance(svc, Invalidatable), (
        "AzureService must implement Invalidatable so it can be registered "
        "in CacheCoordinator"
    )


# ---------------------------------------------------------------------------
# health.py — HealthConfig injection (no storage reads at request time)
# ---------------------------------------------------------------------------


def test_get_health_uses_injected_config():
    from planner_lib.server.health import get_health, HealthConfig

    cfg = HealthConfig(server_name="test-server", version="9.9.9")
    result = get_health(cfg)

    assert result["server_name"] == "test-server"
    assert result["version"] == "9.9.9"
    assert result["status"] == "ok"
    assert "uptime_seconds" in result
    assert "start_time" in result


def test_get_health_fallback_when_no_config():
    from planner_lib.server.health import get_health

    result = get_health(None)
    # server_name may be None; version comes from VERSION file
    assert result["status"] == "ok"
    assert result["server_name"] is None


def test_health_config_registered_in_app(app):
    health_cfg = app.state.container.get("health_config")
    assert health_cfg is not None


def test_health_endpoint_returns_200(client):
    resp = client.get('/api/health')
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "version" in data


# ---------------------------------------------------------------------------
# Router prefix convention — azure/api.py must NOT define prefixes internally
# ---------------------------------------------------------------------------


def test_azure_api_routers_have_no_internal_prefix():
    """azure/api.py routers must declare no prefix so main.py owns all prefixes."""
    import importlib
    azure_api = importlib.import_module("planner_lib.azure.api")

    router_prefix = getattr(azure_api.router, "prefix", "")
    browse_prefix = getattr(azure_api.browse_router, "prefix", "")

    assert router_prefix == "", (
        f"azure/api.py router must have no prefix (got '{router_prefix}'). "
        "Prefixes must be declared in main.py via include_router(prefix=...)"
    )
    assert browse_prefix == "", (
        f"azure/api.py browse_router must have no prefix (got '{browse_prefix}'). "
        "Prefixes must be declared in main.py via include_router(prefix=...)"
    )


# ---------------------------------------------------------------------------
# TaskRepository split (replaces old TaskService/TaskUpdateService)
# ---------------------------------------------------------------------------


def test_task_repository_registered_in_app(app):
    """TaskRepository must be available from the DI container."""
    repo = app.state.container.get("task_repository")
    assert repo is not None


def test_task_repository_has_read_and_write_methods():
    from planner_lib.repository.task_repository import TaskRepository
    assert callable(getattr(TaskRepository, "read", None))
    assert callable(getattr(TaskRepository, "write", None))
