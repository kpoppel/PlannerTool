from fastapi import FastAPI
import sys

# Factor logging configuration out to a composeable module. Call the
# configuration early so the rest of the application starts with the
# intended logging level and handlers.
from planner_lib.logging_config import configure_logging
logger = configure_logging()

# Load and validate cost configuration at startup (happy-path: module exists
# and config is valid).
from planner_lib.cost.config import load_cost_config
load_cost_config()

# FastAPI imports
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi import HTTPException, Request
from starlette.exceptions import HTTPException as StarletteHTTPException


# Middleware imports
from planner_lib.middleware import SessionMiddleware, access_denied_response

# Application imports
from planner_lib.storage import create_storage, StorageBackend
#from planner_lib.setup import setup

# Parse CLI args for setup-related actions
##########################################
#from planner_lib.setup import parse_args, get_parser, has_feature_flag
from planner_lib.setup import has_feature_flag

# _setup_args = parse_args(sys.argv[1:])
# if _setup_args.help:
#     get_parser().print_help()
#     sys.exit(0)

# Create storages needed by the application and packages
from typing import cast
storage_yaml = cast(StorageBackend, create_storage(backend="file", serializer="yaml", accessor=None, data_dir="data"))
storage_pickle = cast(StorageBackend, create_storage(backend="file", serializer="pickle", accessor=None, data_dir="data"))

# Instance packages
from planner_lib.accounts.config import AccountManager
account_manager = AccountManager(account_storage=storage_pickle)

from planner_lib.middleware.session import SessionManager
session_manager = SessionManager(session_storage=None, account_manager=account_manager)

from planner_lib.projects import ProjectService, TeamService, CapacityService
project_service = ProjectService(storage_config=storage_yaml)
team_service = TeamService(storage_config=storage_yaml)
capacity_service = CapacityService(team_service=team_service)
from planner_lib.projects.task_service import TaskService
task_service = TaskService(storage_config=storage_yaml, project_service=project_service, team_service=team_service, capacity_service=capacity_service)

# Allow tests and CI to skip interactive setup by setting PLANNERTOOL_SKIP_SETUP=1
# if os.environ.get('PLANNERTOOL_SKIP_SETUP'):
#     rc = 0
# else:
#     rc = setup(sys.argv[1:], storage, STORE_NS, STORE_KEY)
#     if rc != 0:
#         sys.exit(rc)

## Setup is complete, setup middlewares, routing, and start the FastAPI app
###########################################################################
app = FastAPI(title="AZ Planner Server")

# expose projects service on app.state for request-time access
app.state.project_service = project_service
app.state.team_service = team_service
app.state.capacity_service = capacity_service
app.state.task_service = task_service

# Register session middleware
app.add_middleware(SessionMiddleware, session_manager=session_manager)

# Add Brotli compression middleware if feature flag is enabled
if has_feature_flag('planner_use_brotli'):
    logger.info("Brotli compression middleware is enabled")
    from planner_lib.middleware import BrotliCompression
    #Register Brotli middleware (wrap app at ASGI layer)
    app.add_middleware(BrotliCompression)

# Serve main SPA entry at root
@app.get("/", response_class=HTMLResponse)
async def root():
    with open("www/index.html", "r", encoding="utf-8") as f:
        return f.read()

# Serve static UI from www/ under /static
app.mount("/static", StaticFiles(directory="www"), name="static")


# Catch 401 HTTPException globally to return a suitable message
@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    if exc.status_code == 401:
        return access_denied_response(request, exc.detail)
    raise exc

# Catch 404 errors globally to return a suitable message
@app.exception_handler(StarletteHTTPException)
async def starlette_http_exception_handler(request: Request, exc: StarletteHTTPException):
    # Only handle 404 here; delegate others back to FastAPI default handling
    if exc.status_code == 404:
        error_code = {'error': 'not_found', 'message': 'The requested resource was not found.'}
        return access_denied_response(request, error_code)
    raise exc

# Router registration: move inline route handlers into package routers and include them here.
from planner_lib.session.api import router as session_router
from planner_lib.accounts.api import router as config_router
from planner_lib.projects.api import router as projects_router
from planner_lib.scenarios.api import router as scenario_router
from planner_lib.cost.api import router as cost_router
from planner_lib.server.api import router as server_router
from planner_lib.admin.admin import router as admin_router

# Expose shared objects to routers via app.state
app.state.scenarios_storage = storage_pickle
app.state.account_manager = account_manager
app.state.server_config_storage = storage_yaml
app.state.session_manager = session_manager

app.include_router(session_router, prefix='/api')
app.include_router(config_router, prefix='/api')
app.include_router(projects_router, prefix='/api')
app.include_router(scenario_router, prefix='/api')
app.include_router(cost_router, prefix='/api')
app.include_router(server_router, prefix='/api')
app.include_router(admin_router, prefix='')
