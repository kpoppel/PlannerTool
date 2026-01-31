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
from dataclasses import dataclass
from typing import Optional, cast

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from planner_lib.logging_config import configure_logging
from planner_lib.storage import create_storage, StorageBackend

from planner_lib.setup import has_feature_flag


@dataclass
class Config:
    data_dir: str = "data"
    storage_backend: str = "file"
    yaml_serializer: str = "yaml"
    pickle_serializer: str = "pickle"
    # If None, check feature-flag at runtime via has_feature_flag
    enable_brotli: Optional[bool] = None


def create_app(config: Config) -> FastAPI:
    """Create and return a configured FastAPI application.

    All previously-import-time side-effects are performed here so callers
    (tests, runners) can instantiate apps with custom `Config`.
    """
    logger = configure_logging()


    # Compose storages
    storage_yaml = cast(StorageBackend, create_storage(
        backend=config.storage_backend,
        serializer=config.yaml_serializer,
        accessor=None,
        data_dir=config.data_dir,
    ))
    storage_pickle = cast(StorageBackend, create_storage(
        backend=config.storage_backend,
        serializer=config.pickle_serializer,
        accessor=None,
        data_dir=config.data_dir,
    ))

    # Compose services
    from planner_lib.accounts.config import AccountManager
    account_manager = AccountManager(account_storage=storage_pickle)

    from planner_lib.middleware.session import SessionManager
    session_manager = SessionManager(session_storage=None, account_manager=account_manager)

    from planner_lib.projects import ProjectService, TeamService, CapacityService
    project_service = ProjectService(storage_config=storage_yaml)
    team_service = TeamService(storage_config=storage_yaml)
    capacity_service = CapacityService(team_service=team_service)

    from planner_lib.azure import AzureService
    server_cfg = storage_yaml.load('config', 'server_config')
    org = server_cfg.get('azure_devops_organization')
    azure_client = AzureService(org, storage_pickle)

    from planner_lib.projects.task_service import TaskService
    task_service = TaskService(
        storage_config=storage_yaml,
        project_service=project_service,
        team_service=team_service,
        capacity_service=capacity_service,
        azure_client=azure_client,
    )

    from planner_lib.cost.service import CostService
    cost_service = CostService(
        storage=storage_yaml,
        project_service=project_service,
    )

    # Admin service depends on account storage (pickle) and config storage (yaml)
    from planner_lib.admin.service import AdminService
    admin_service = AdminService(
        account_storage=storage_pickle,
        config_storage=storage_yaml,
        team_service=team_service,
        project_service=project_service,
        account_manager=account_manager,
    )

    # Create a minimal service container and register composed services.
    # We expose the container on `app.state.container` so new code can resolve
    # dependencies via the container while existing code can continue to read
    # legacy attributes on `app.state` until fully migrated.
    from planner_lib.services import ServiceContainer

    container = ServiceContainer()
    container.register_singleton("server_config_storage", storage_yaml)
    container.register_singleton("azure_client", azure_client)
    container.register_singleton("account_storage", storage_pickle)
    container.register_singleton("scenarios_storage", storage_pickle)
    container.register_singleton("project_service", project_service)
    container.register_singleton("team_service", team_service)
    container.register_singleton("capacity_service", capacity_service)
    container.register_singleton("task_service", task_service)
    container.register_singleton("cost_service", cost_service)
    container.register_singleton("account_manager", account_manager)
    container.register_singleton("session_manager", session_manager)
    container.register_singleton("admin_service", admin_service)

    # Build FastAPI app and expose services on app.state for request-time access
    app = FastAPI(title="AZ Planner Server")
    # Expose only the explicit service container on app.state. All runtime
    # code should resolve services from this container instead of relying on
    # legacy `app.state.<name>` attributes.
    app.state.container = container

    # Register middleware
    from planner_lib.middleware import SessionMiddleware, access_denied_response
    app.add_middleware(SessionMiddleware, session_manager=session_manager)

    # Add Brotli compression middleware if enabled via config or feature flag
    enable_brotli = config.enable_brotli if config.enable_brotli is not None else has_feature_flag('planner_use_brotli')
    if enable_brotli:
        logger.info("Brotli compression middleware is enabled")
        from planner_lib.middleware import BrotliCompression
        app.add_middleware(BrotliCompression)

    # Serve main SPA entry at root
    @app.get("/", response_class=HTMLResponse)
    async def root():
        with open("www/index.html", "r", encoding="utf-8") as f:
            return f.read()

    # Serve static UI from www/ under /static
    app.mount("/static", StaticFiles(directory="www"), name="static")

    # Exception handlers
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

    # Router registration: import routers here to avoid import-time side-effects
    from planner_lib.session.api import router as session_router
    from planner_lib.accounts.api import router as config_router
    from planner_lib.projects.api import router as projects_router
    from planner_lib.scenarios.api import router as scenario_router
    from planner_lib.cost.api import router as cost_router
    from planner_lib.server.api import router as server_router
    from planner_lib.admin.api import router as admin_router

    # Services are available via the container; do not expose them as
    # legacy `app.state` attributes to enforce container-based DI.

    app.include_router(session_router, prefix='/api')
    app.include_router(config_router, prefix='/api')
    app.include_router(projects_router, prefix='/api')
    app.include_router(scenario_router, prefix='/api')
    app.include_router(cost_router, prefix='/api')
    app.include_router(server_router, prefix='/api')
    app.include_router(admin_router, prefix='')

    return app
