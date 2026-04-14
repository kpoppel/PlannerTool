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

    container = ServiceContainer()

    # --- Storage (eager, no inter-service deps) ---
    container.register_singleton("server_config_storage", storage_yaml)
    container.register_singleton("account_storage", storage_diskcache)
    container.register_singleton("scenarios_storage", storage_diskcache)
    container.register_singleton("views_storage", storage_diskcache)
    container.register_singleton("cost_cache_storage", storage_diskcache)

    # --- Optional memory cache ---
    memory_cache = None
    if feature_flags.get('enable_memory_cache', False):
        from planner_lib.storage.memory_cache_manager import MemoryCacheManager
        memory_cache_config = server_cfg.get('memory_cache', {})
        max_size_mb = memory_cache_config.get('max_size_mb', 50)
        staleness_seconds = memory_cache_config.get('staleness_seconds', 1800)
        memory_cache = MemoryCacheManager(
            disk_cache=storage_diskcache,
            size_limit_mb=max_size_mb,
            staleness_seconds=staleness_seconds,
        )
        logger.info("Memory cache initialized: %sMB limit, %ss staleness", max_size_mb, staleness_seconds)
    else:
        logger.info("Memory cache disabled")
    container.register_singleton("memory_cache", memory_cache)

    # --- Accounts / session ---
    container.register_factory("account_manager", lambda: (
        __import__('planner_lib.accounts.config', fromlist=['AccountManager'])
        .AccountManager(account_storage=storage_diskcache)
    ))
    container.register_factory("session_manager", lambda: (
        __import__('planner_lib.middleware.session', fromlist=['SessionManager'])
        .SessionManager(
            account_manager=container.get("account_manager"),
            account_storage=storage_diskcache,
        )
    ))

    # --- Project domain ---
    container.register_factory("azure_project_metadata_service", lambda: (
        __import__('planner_lib.projects', fromlist=['AzureProjectMetadataService'])
        .AzureProjectMetadataService(cache=storage_diskcache)
    ))
    container.register_factory("project_service", lambda: (
        __import__('planner_lib.projects', fromlist=['ProjectService'])
        .ProjectService(
            storage_config=storage_yaml,
            metadata_service=container.get("azure_project_metadata_service"),
        )
    ))
    container.register_factory("team_service", lambda: (
        __import__('planner_lib.projects', fromlist=['TeamService'])
        .TeamService(storage_config=storage_yaml)
    ))
    container.register_factory("capacity_service", lambda: (
        __import__('planner_lib.projects', fromlist=['CapacityService'])
        .CapacityService(team_service=container.get("team_service"))
    ))

    # --- People ---
    container.register_factory("people_service", lambda: (
        __import__('planner_lib.people', fromlist=['PeopleService'])
        .PeopleService(storage=storage_yaml, data_dir=config.data_dir)
    ))

    # --- Azure ---
    container.register_factory("azure_client", lambda: (
        __import__('planner_lib.azure', fromlist=['AzureService'])
        .AzureService(
            server_cfg.get('azure_devops_organization'),
            storage_diskcache,
            feature_flags=feature_flags,
            memory_cache=memory_cache,
        )
    ))

    # --- Tasks ---
    container.register_factory("task_service", lambda: (
        __import__('planner_lib.projects.task_service', fromlist=['TaskService'])
        .TaskService(
            storage_config=storage_yaml,
            project_service=container.get("project_service"),
            team_service=container.get("team_service"),
            capacity_service=container.get("capacity_service"),
            azure_client=container.get("azure_client"),
            metadata_service=container.get("azure_project_metadata_service"),
        )
    ))
    container.register_factory("task_update_service", lambda: (
        __import__('planner_lib.projects.task_update_service', fromlist=['TaskUpdateService'])
        .TaskUpdateService(
            storage_config=storage_yaml,
            team_service=container.get("team_service"),
            capacity_service=container.get("capacity_service"),
            azure_client=container.get("azure_client"),
        )
    ))
    container.register_factory("history_service", lambda: (
        __import__('planner_lib.projects.history_service', fromlist=['HistoryService'])
        .HistoryService(
            storage_config=storage_yaml,
            azure_client=container.get("azure_client"),
        )
    ))

    # --- Cost ---
    container.register_factory("cost_service", lambda: (
        __import__('planner_lib.cost.service', fromlist=['CostService'])
        .CostService(
            storage=storage_yaml,
            people_service=container.get("people_service"),
            project_service=container.get("project_service"),
            team_service=container.get("team_service"),
            cache_storage=storage_diskcache,
        )
    ))

    # --- Admin ---
    container.register_factory("admin_service", lambda: (
        __import__('planner_lib.admin.service', fromlist=['AdminService'])
        .AdminService(
            account_storage=storage_diskcache,
            config_storage=storage_yaml,
            project_service=container.get("project_service"),
            account_manager=container.get("account_manager"),
            azure_client=container.get("azure_client"),
            views_storage=storage_diskcache,
            scenarios_storage=storage_diskcache,
            reloadable_services=[
                container.get("people_service"),
                container.get("team_service"),
                container.get("project_service"),
                container.get("capacity_service"),
                container.get("cost_service"),
            ],
        )
    ))

    # --- Cache coordinator ---
    def _make_cache_coordinator():
        cc = CacheCoordinator()
        cc.register(container.get("azure_client"), "azure_client")
        cc.register(container.get("cost_service"), "cost_service")
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

    memory_cache = container.get("memory_cache")
    storage_diskcache = container.get("account_storage")  # same instance as cache backend
    session_manager = container.get("session_manager")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if feature_flags.get('enable_memory_cache', False):
            try:
                from planner_lib.azure.warmup import CacheWarmupService
                warmup_service = CacheWarmupService(memory_cache, storage_diskcache)
                await warmup_service.warmup_async()
            except Exception:
                logger.exception('Failed to initialize cache warmup service')
        try:
            yield
        finally:
            if memory_cache is not None:
                try:
                    memory_cache.close()
                    logger.info("Memory cache closed")
                except Exception as e:
                    logger.error(f"Error closing memory cache: {e}")

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

    if feature_flags.get('enable_memory_cache', False):
        from planner_lib.azure.api import router as azure_cache_router
        app.include_router(azure_cache_router, prefix='/api/cache')
        logger.info("Azure cache API endpoints registered at /api/cache/")

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

    return _build_app(config, container, feature_flags, logger)
