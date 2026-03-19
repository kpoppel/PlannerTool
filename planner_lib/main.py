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
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from planner_lib.logging_config import configure_logging
from planner_lib.storage import create_storage, StorageBackend

from planner_lib.setup import has_feature_flag


@dataclass
class Config:
    data_dir: str = "data"
    storage_backend: str = "file"
    people_storage_backend: str = "single_file"
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
    
    # Create memory storage for cost engine cache (team rates)
    # Use pickle serializer for efficient in-memory caching
    storage_cost_cache = cast(StorageBackend, create_storage(
        backend="memory",
        serializer=config.pickle_serializer,
        accessor=None,
        data_dir=config.data_dir,
    ))
    # Bootstrap server
    from planner_lib.bootstrap import bootstrap_server
    server_cfg = bootstrap_server(storage_yaml, logger)

    # Compose services
    from planner_lib.accounts.config import AccountManager
    account_manager = AccountManager(account_storage=storage_pickle)

    from planner_lib.middleware.session import SessionManager
    session_manager = SessionManager(session_storage=None, account_manager=account_manager)

    from planner_lib.projects import ProjectService, TeamService, CapacityService
    project_service = ProjectService(storage_config=storage_yaml)
    team_service = TeamService(storage_config=storage_yaml)
    capacity_service = CapacityService(team_service=team_service)

    # Create PeopleService for managing people database
    from planner_lib.people import PeopleService
    people_service = PeopleService(storage=storage_yaml, data_dir=config.data_dir)

    from planner_lib.azure import AzureService
    org = server_cfg.get('azure_devops_organization')
    feature_flags = server_cfg.get('feature_flags', {})
    azure_client = AzureService(org, storage_pickle, feature_flags=feature_flags)

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
        people_service=people_service,
        project_service=project_service,
        team_service=team_service,
        cache_storage=storage_cost_cache,
    )

    # Admin service depends on account storage (pickle) and config storage (yaml)
    from planner_lib.admin.service import AdminService
    admin_service = AdminService(
        account_storage=storage_pickle,
        config_storage=storage_yaml,
        team_service=team_service,
        project_service=project_service,
        account_manager=account_manager,
        azure_client=azure_client,
    )

    # Create a minimal service container and register composed services.
    # We expose the container on `app.state.container` so new code can resolve
    # dependencies via the container while existing code can continue to read
    # legacy attributes on `app.state` until fully migrated.
    from planner_lib.services import ServiceContainer

    container = ServiceContainer()
    container.register_singleton("server_config_storage", storage_yaml)
    container.register_singleton("people_service", people_service)
    container.register_singleton("azure_client", azure_client)
    container.register_singleton("account_storage", storage_pickle)
    container.register_singleton("scenarios_storage", storage_pickle)
    container.register_singleton("views_storage", storage_pickle)
    container.register_singleton("cost_cache_storage", storage_cost_cache)
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

    # Serve built assets from `dist/` when present (production), otherwise
    # fall back to the development `www/` tree. Built `index.html` will
    # reference hashed assets under /static/ so we mount appropriately.
    from pathlib import Path
    dist_index = Path('dist/index.html')
    if dist_index.exists():
        @app.get('/', response_class=HTMLResponse)
        async def root():
            html = dist_index.read_text(encoding='utf-8')
            # If manifest resolver available, rewrite known asset paths to
            # their hashed equivalents so the browser loads correct files.
            resolver = getattr(app.state, 'resolve_asset_url', None)
            if resolver:
                # Replace common app entry points and assets. Keep this list
                # minimal and explicit to avoid accidental rewrites.
                    # Resolve common app assets. For timeline-line.svg prefer
                    # keeping the `/static/` path when the manifest doesn't map
                    # the file (it's copied into `dist/` but not necessarily in
                    # the manifest). This preserves the server's static mount.
                    app_js = resolver('js/app.js')
                    css_main = resolver('css/main.css')
                    # Try resolving timeline under several logical keys
                    tl_resolved = resolver('timeline-line.svg')
                    if tl_resolved and isinstance(tl_resolved, str) and tl_resolved.startswith('/static/'):
                        timeline_url = tl_resolved
                    else:
                        # Fall back to the canonical static path which maps to dist/timeline-line.svg
                        timeline_url = '/static/timeline-line.svg'

                    replacements = [
                        ('js/app.js', app_js),
                        ('css/main.css', css_main),
                        ('/static/timeline-line.svg', timeline_url),
                        ('timeline-line.svg', timeline_url),
                    ]

                    for orig, new in replacements:
                        if not new or new == orig:
                            continue
                        html = html.replace(f'src="{orig}"', f'src="{new}"')
                        html = html.replace(f'href="{orig}"', f'href="{new}"')
            return html

        # Serve built static files at /static
        app.mount('/static', StaticFiles(directory='dist'), name='static')

        # Keep legacy direct reference to the timeline image working by
        # redirecting requests for `/timeline-line.svg` to the mounted
        # `/static/` path where the file lives in production builds.
        @app.get('/timeline-line.svg')
        async def timeline_redirect():
            return RedirectResponse(url='/static/timeline-line.svg')
    else:
        # Serve main SPA entry at root (dev)
        @app.get('/', response_class=HTMLResponse)
        async def root():
            with open('www/index.html', 'r', encoding='utf-8') as f:
                return f.read()

        # Serve static UI from www/ under /static (dev)
        app.mount('/static', StaticFiles(directory='www'), name='static')

    # If a Vite manifest exists, load it so the server can resolve logical
    # module/source paths to the actual hashed asset filenames produced by
    # the build. Expose via `app.state.asset_manifest` and a helper
    # `app.state.resolve_asset_url(logical_path)`.
    try:
        import json
        # Support manifest placed at dist/manifest.json (common) or
        # dist/.vite/manifest.json (some build setups).
        manifest_path = Path('dist/manifest.json')
        if not manifest_path.exists():
            alt = Path('dist/.vite/manifest.json')
            if alt.exists():
                manifest_path = alt

        if manifest_path.exists():
            try:
                manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
                app.state.asset_manifest = manifest

                def resolve_asset_url(logical: str) -> str:
                    # Try direct lookup
                    if logical in manifest:
                        return '/static/' + manifest[logical]['file']
                    key = logical.lstrip('./')
                    if key in manifest:
                        return '/static/' + manifest[key]['file']

                    # Try matching against src or keys by suffix
                    for k, v in manifest.items():
                        src = v.get('src') or ''
                        if src == logical or src.endswith('/' + key) or k.endswith('/' + key) or k == key:
                            return '/static/' + v.get('file')

                    # Fallback to returning the logical path unchanged
                    return logical

                app.state.resolve_asset_url = resolve_asset_url
            except Exception:
                app.state.asset_manifest = None
                app.state.resolve_asset_url = lambda s: s
        else:
            app.state.asset_manifest = None
            app.state.resolve_asset_url = lambda s: s
    except Exception:
        app.state.asset_manifest = None
        app.state.resolve_asset_url = lambda s: s

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
    from planner_lib.views.api import router as views_router
    from planner_lib.cost.api import router as cost_router
    from planner_lib.server.api import router as server_router
    from planner_lib.admin.api import router as admin_router

    # Services are available via the container; do not expose them as
    # legacy `app.state` attributes to enforce container-based DI.

    app.include_router(session_router, prefix='/api')
    app.include_router(config_router, prefix='/api')
    app.include_router(projects_router, prefix='/api')
    app.include_router(scenario_router, prefix='/api')
    app.include_router(views_router, prefix='/api')
    app.include_router(cost_router, prefix='/api')
    app.include_router(server_router, prefix='/api')
    app.include_router(admin_router, prefix='')

    return app
