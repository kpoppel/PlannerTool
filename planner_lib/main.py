"""Application factory for the PlannerTool FastAPI app.

This module exposes `create_app(config: Config) -> FastAPI` which performs
all heavy setup (logging, config loading, storage/service composition,
middleware and router registration). Avoids performing side-effects at
import time so tests can construct isolated apps.

To create an app for production or local runs:

    from planner import create_app, Config
    app = create_app(Config())

Note: we intentionally do not create a global `app` at import time.
"""
from dataclasses import dataclass, field
from typing import Any, Dict, Tuple, cast

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from contextlib import asynccontextmanager

from planner_lib.logging_config import configure_logging
from planner_lib.storage import create_storage, StorageBackend


def _read_version() -> str:
    """Read VERSION file relative to repo root, returning 'unknown' if absent."""
    import os
    version_file = os.path.join(os.path.dirname(__file__), "../VERSION")
    if os.path.exists(version_file):
        with open(version_file, "r") as f:
            return f.read().strip()
    return "unknown"


@dataclass
class Config:
    data_dir: str = "data"
    config_storage_backend: str = "file"
    storage_backend: str = "diskcache" #"file"
    raw_serializer: str = "raw"
    yaml_serializer: str = "yaml"
    enable_brotli: bool = False
    # Directory to serve the SPA from. "www" for dev, "dist" for production builds.
    static_dir: str = "www"


# ---------------------------------------------------------------------------
# Private helpers — each responsible for one phase of app construction
# ---------------------------------------------------------------------------

def _build_storages(config: Config) -> Tuple[StorageBackend, StorageBackend]:
    """Construct and return (storage_diskcache, storage_yaml).

    All persistent runtime data lives in the diskcache backend; human-editable
    configuration lives in the YAML backend.
    """
    storage_diskcache = cast(StorageBackend, create_storage(
        backend=config.storage_backend,
        serializer=config.raw_serializer,
        data_dir=config.data_dir + "/cache",
    ))
    # Config still uses YAML for human editability
    storage_yaml = cast(StorageBackend, create_storage(
        backend=config.config_storage_backend,
        serializer=config.yaml_serializer,
        data_dir=config.data_dir,
    ))
    return storage_diskcache, storage_yaml


def _build_services(
    config: Config,
    storage_diskcache: StorageBackend,
    storage_yaml: StorageBackend,
    server_cfg: Dict[str, Any],
    feature_flags: Dict[str, Any],
    logger,
) -> "ServiceContainer":  # type: ignore[name-defined]
    """Compose all application services and return a populated ServiceContainer.

    Services are registered as lazy factories so the build order is purely
    declarative — each factory resolves its own dependencies from the
    container at first use.
    """
    from planner_lib.services import ServiceContainer
    from planner_lib.services.cache_coordinator import CacheCoordinator
    from planner_lib.server.health import HealthConfig
    from planner_lib.accounts.config import AccountManager
    from planner_lib.middleware.session import SessionManager
    from planner_lib.projects import (
        AzureProjectMetadataService,
        CapacityService,
    )
    from planner_lib.azure import AzureService
    from planner_lib.cost.service import CostService
    from planner_lib.admin.service import AdminService

    container = ServiceContainer()

    # --- Storage (eager, no inter-service deps) ---
    container.register_singleton("server_config_storage", storage_yaml)
    container.register_singleton("account_storage", storage_diskcache)
    container.register_singleton("scenarios_storage", storage_diskcache)
    container.register_singleton("views_storage", storage_diskcache)

    # --- Optional memory cache ---
    # (removed — diskcache handles memory via OS page cache automatically)

    # --- Accounts / session ---
    container.register_factory("account_manager",
        lambda: AccountManager(account_storage=storage_diskcache))
    container.register_factory("session_manager",
        lambda: SessionManager(
            account_manager=container.get("account_manager"),
            account_storage=storage_diskcache,
        ))

    # --- Project domain ---
    container.register_factory("azure_project_metadata_service",
        lambda: AzureProjectMetadataService(cache=storage_diskcache))

    container.register_factory("capacity_service",
        lambda: CapacityService(team_repository=container.get("team_repository")))

    # --- ConfigBackend (diskcache-backed, peer of UserDataBackend) ---
    def _make_config_backend():
        from planner_lib.backend.config import ConfigBackend
        # ConfigBackend reads/writes directly to diskcache — no CachingBackend wrapper.
        # yaml_storage is passed solely for fetch_people (people.yml not yet migrated).
        return ConfigBackend(
            storage=storage_diskcache,
            yaml_storage=storage_yaml,
            data_dir=config.data_dir,
        )

    container.register_factory("config_backend", _make_config_backend)

    # --- Azure ---
    def _make_azure_client():
        ado_cfg = container.get("config_backend").fetch_ado_config()
        return AzureService(
            ado_cfg.get('organization_url', ''),
            storage_diskcache,
            feature_flags={**feature_flags, **ado_cfg.get('feature_flags', {})},
        )

    container.register_factory("azure_client", _make_azure_client)

    # --- New layered backend (BackendPort) ---
    def _make_backend():
        from planner_lib.backend.registry import build_active_backend
        ado_cfg = container.get("config_backend").fetch_ado_config()
        ado_flags = ado_cfg.get('feature_flags', {})
        inner = build_active_backend(
            {**feature_flags, **ado_flags},
            org_url=ado_cfg.get('organization_url', ''),
            storage=storage_diskcache,
            config_backend=container.get("config_backend"),
            team_repository=container.get("team_repository"),
            capacity_service=container.get("capacity_service"),
        )

        if feature_flags.get('enable_cache', False):
            from planner_lib.backend.caching import CachingBackend, CacheTTLConfig
            ttl_config = CacheTTLConfig.from_config(
                server_cfg.get('cache', {}).get('ttls', {})
            )
            return CachingBackend(inner=inner, storage=storage_diskcache, ttl_config=ttl_config)

        return inner

    container.register_factory("backend", _make_backend)

    def _make_user_data_backend():
        from planner_lib.backend.user_data import UserDataBackend
        # UserDataBackend is NEVER wrapped in CachingBackend — writes must be
        # visible immediately; the diskcache storage is already persistent.
        return UserDataBackend(storage=storage_diskcache)

    container.register_factory("user_data_backend", _make_user_data_backend)

    # project_repository and team_repository are backed by config_backend so
    # they benefit from the TTL cache like every other repository.
    container.register_factory("project_repository",
        lambda: __import__(
            'planner_lib.repository', fromlist=['ProjectRepository']
        ).ProjectRepository(
            backend=container.get("config_backend"),
            metadata_service=container.get("azure_project_metadata_service"),
        ))
    container.register_factory("team_repository",
        lambda: __import__(
            'planner_lib.repository', fromlist=['TeamRepository']
        ).TeamRepository(local_backend=container.get("config_backend")))

    container.register_factory("credential_provider",
        lambda: __import__(
            'planner_lib.backend.credential', fromlist=['AccountManagerCredentialProvider']
        ).AccountManagerCredentialProvider(container.get("account_manager")))

    container.register_factory("task_repository",
        lambda: __import__(
            'planner_lib.repository', fromlist=['TaskRepository']
        ).TaskRepository(
            backend=container.get("backend"),
            project_repository=container.get("project_repository"),
            credential_provider=container.get("credential_provider"),
        ))

    container.register_factory("history_repository",
        lambda: __import__(
            'planner_lib.repository', fromlist=['HistoryRepository']
        ).HistoryRepository(
            backend=container.get("backend"),
            credential_provider=container.get("credential_provider"),
        ))

    container.register_factory("plan_repository",
        lambda: __import__(
            'planner_lib.repository', fromlist=['PlanRepository']
        ).PlanRepository(
            backend=container.get("backend"),
            project_repository=container.get("project_repository"),
            credential_provider=container.get("credential_provider"),
            plan_config=container.get("config_backend"),
        ))

    container.register_factory("iteration_repository",
        lambda: __import__(
            'planner_lib.repository', fromlist=['IterationRepository']
        ).IterationRepository(
            backend=container.get("backend"),
            project_repository=container.get("project_repository"),
            credential_provider=container.get("credential_provider"),
            iteration_config=container.get("config_backend"),
        ))

    container.register_factory("people_repository",
        lambda: __import__(
            'planner_lib.repository', fromlist=['PeopleRepository']
        ).PeopleRepository(backend=container.get("config_backend")))

    container.register_factory("scenario_repository",
        lambda: __import__(
            'planner_lib.repository', fromlist=['ScenarioRepository']
        ).ScenarioRepository(backend=container.get("user_data_backend")))

    container.register_factory("view_repository",
        lambda: __import__(
            'planner_lib.repository', fromlist=['ViewRepository']
        ).ViewRepository(backend=container.get("user_data_backend")))

    # --- Cost ---
    container.register_factory("cost_service",
        lambda: CostService(
            storage=storage_diskcache,
            people_repository=container.get("people_repository"),
            project_repository=container.get("project_repository"),
            team_repository=container.get("team_repository"),
            cache_storage=storage_diskcache,
        ))

    # --- Admin ---
    container.register_factory("admin_service",
        lambda: AdminService(
            account_storage=storage_diskcache,
            config_storage=storage_diskcache,
            server_config_storage=storage_yaml,
            project_repository=container.get("project_repository"),
            account_manager=container.get("account_manager"),
            azure_client=container.get("azure_client"),
            views_storage=storage_diskcache,
            scenarios_storage=storage_diskcache,
            reloadable_services=[
                container.get("cost_service"),
            ],
        ))

    # --- Cache coordinator ---
    def _make_cache_coordinator():
        cc = CacheCoordinator()
        cc.register(container.get("azure_client"), "azure_client")
        cc.register(container.get("cost_service"), "cost_service")
        cc.register(container.get("backend"), "backend")
        return cc
    container.register_factory("cache_coordinator", _make_cache_coordinator)

    # --- Health ---
    container.register_singleton("health_config", HealthConfig(
        server_name=server_cfg.get('server_name'),
        version=_read_version(),
    ))

    return container


def _build_app(
    config: Config,
    container: "ServiceContainer",  # type: ignore[name-defined]
    feature_flags: Dict[str, Any],
    logger,
) -> FastAPI:
    """Construct the FastAPI application: lifespan, middleware, routes."""
    from planner_lib.middleware import SessionMiddleware, access_denied_response

    memory_cache = None  # removed: MemoryCacheManager was eliminated; diskcache handles memory via OS page cache
    storage_diskcache = container.get("account_storage")  # same instance as cache backend
    session_manager = container.get("session_manager")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # diskcache handles memory (OS page cache via SQLite mmap) automatically;
        # no warmup or memory cache manager is needed.
        try:
            yield
        finally:
            pass

    app = FastAPI(title="AZ Planner Server", lifespan=lifespan)
    app.state.container = container

    app.add_middleware(SessionMiddleware, session_manager=session_manager)

    if config.enable_brotli:
        logger.info("Brotli compression middleware is enabled")
        from planner_lib.middleware import BrotliCompression
        app.add_middleware(BrotliCompression)

    static_dir = config.static_dir

    @app.get("/", response_class=HTMLResponse)
    async def root(request: Request):
        if not request.url.path.endswith('/'):
            return RedirectResponse(url=str(request.url.replace(path=request.url.path + '/')))
        with open(f"{static_dir}/index.html", "r", encoding="utf-8") as f:
            return f.read()

    app.mount("/static", StaticFiles(directory=static_dir), name="static")

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request, exc):
        if exc.status_code == 401:
            return access_denied_response(request, exc.detail)
        raise exc

    @app.exception_handler(StarletteHTTPException)
    async def starlette_http_exception_handler(request: Request, exc: StarletteHTTPException):
        if exc.status_code == 404:
            error_code = {'error': 'not_found', 'message': 'The requested resource was not found.'}
            return access_denied_response(request, error_code)
        raise exc

    from planner_lib.session.api import router as session_router
    from planner_lib.accounts.api import router as config_router
    from planner_lib.projects.api import router as projects_router
    from planner_lib.scenarios.api import router as scenario_router
    from planner_lib.views.api import router as views_router
    from planner_lib.cost.api import router as cost_router
    from planner_lib.server.api import router as server_router
    from planner_lib.admin.api import router as admin_router

    app.include_router(session_router, prefix='/api')
    app.include_router(config_router, prefix='/api')
    app.include_router(projects_router, prefix='/api')
    app.include_router(scenario_router, prefix='/api')
    app.include_router(views_router, prefix='/api')
    app.include_router(cost_router, prefix='/api')
    app.include_router(server_router, prefix='/api')
    app.include_router(admin_router, prefix='')

    from planner_lib.azure.api import browse_router as azure_browse_router
    app.include_router(azure_browse_router, prefix='/api/azure')

    if feature_flags.get('enable_cache', False):
        from planner_lib.azure.api import router as azure_cache_router
        app.include_router(azure_cache_router, prefix='/api/cache')
        logger.info("Cache API endpoints registered at /api/cache/")

    return app


def create_app(config: Config) -> FastAPI:
    """Create and return a configured FastAPI application.

    Delegates to three focused helpers:
      _build_storages  — construct storage backends
      _build_services  — compose all services into a ServiceContainer
      _build_app       — create the FastAPI app, attach middleware and routes
    """
    logger = configure_logging()

    storage_diskcache, storage_yaml = _build_storages(config)

    from planner_lib.bootstrap import bootstrap_server
    server_cfg = bootstrap_server(storage_yaml, logger)
    feature_flags = server_cfg.get('feature_flags', {})

    container = _build_services(config, storage_diskcache, storage_yaml, server_cfg, feature_flags, logger)

    active_flags = [k for k, v in feature_flags.items() if v is True]
    logger.info(
        "Startup: data_dir='%s', storage=%s/%s, static_dir='%s'",
        config.data_dir, config.config_storage_backend, config.storage_backend, config.static_dir,
    )
    logger.info(
        "Startup: active feature_flags = %s",
        active_flags if active_flags else '(none)',
    )

    # Log the cache composition up-front — the backend is a lazy factory so
    # its own __init__ log only appears on the first request.  main.py owns the
    # flag-based decision, so it is the right place for this summary.
    from planner_lib.backend.registry import get_active_class
    _active_backend_cls = get_active_class(feature_flags)
    _cache_on = feature_flags.get('enable_cache', False)
    if _cache_on:
        logger.info(
            "Startup: cache=ON (disk), inner backend=%s",
            _active_backend_cls.__name__,
        )
    else:
        logger.info(
            "Startup: cache=OFF, backend=%s (requests go directly to backend)",
            _active_backend_cls.__name__,
        )

    return _build_app(config, container, feature_flags, logger)
