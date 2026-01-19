from fastapi import FastAPI
import logging
import sys
from pathlib import Path
import yaml
import os

# Load server config early so we can configure the root logger at the intended
# level before other modules are imported or initialized. Happy-path: assume
# config file and values are present and valid.
logging.basicConfig(level=logging.NOTSET, format='%(asctime)s INFO %(message)s')
DEFAULT_LOG_LEVEL = logging.WARNING
cfg_path = Path('data/config/server_config.yml')
if cfg_path.exists():
    with cfg_path.open('r', encoding='utf-8') as _f:
        _cfg = yaml.safe_load(_f) or {}
        _lvl = _cfg.get('log_level')
        DEFAULT_LOG_LEVEL = getattr(logging, _lvl.upper()) # pyright: ignore[reportOptionalMemberAccess]
logging.log(100, f'[planner]: Log level set to: {logging.getLevelName(DEFAULT_LOG_LEVEL)}')

# configure basic logging for the backend using the early-configured level
for handler in logging.root.handlers[:]:
    logging.root.removeHandler(handler)
logging.basicConfig(level=DEFAULT_LOG_LEVEL, format='%(asctime)s %(levelname)s [%(name)s]: %(message)s')
logger = logging.getLogger(__name__)
# Keep known noisy libraries quiet by default
logging.getLogger('azure.devops.client').setLevel(logging.WARNING)
logging.getLogger('azure').setLevel(logging.WARNING)
logging.getLogger('msrest').setLevel(logging.WARNING)
logging.getLogger('requests').setLevel(logging.WARNING)
logging.getLogger('urllib3').setLevel(logging.WARNING)
logger.info("Starting AZ Planner Server")

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
from planner_lib.storage.file_backend import FileStorageBackend
from planner_lib.storage import create_storage
from planner_lib.setup import YamlConfigStore
from planner_lib.setup import setup

# Parse CLI args for setup-related actions
##########################################
from planner_lib.setup import parse_args, get_parser, setup, has_feature_flag

_setup_args = parse_args(sys.argv[1:])
if _setup_args.help:
    get_parser().print_help()
    sys.exit(0)

# At startup: ensure there's a server configuration file. If it doesn't exist,
# create a human-editable YAML template and exit so the operator can fill it in.
STORE_NS = "config"
STORE_KEY = "server_config.yml"
# Use the storage factory so serializers handle formats (YAML/text).
storage = create_storage(backend="file", serializer="yaml", accessor=None, data_dir="data")
store = YamlConfigStore(storage, namespace=STORE_NS)
# Allow tests and CI to skip interactive setup by setting PLANNERTOOL_SKIP_SETUP=1
if os.environ.get('PLANNERTOOL_SKIP_SETUP'):
    rc = 0
else:
    rc = setup(sys.argv[1:], storage, STORE_NS, STORE_KEY)
    if rc != 0:
        sys.exit(rc)

## Setup is complete, setup middlewares, routing, and start the FastAPI app
###########################################################################
app = FastAPI(title="AZ Planner Server")

# Register session middleware
app.add_middleware(SessionMiddleware)

# Add Brotli compression middleware if feature flag is enabled
if has_feature_flag('planner_use_brotli'):
    logger.info("Brotli compression middleware is enabled")
    from planner_lib.middleware import BrotliCompression
    #Register Brotli middleware (wrap app at ASGI layer)
    app.add_middleware(BrotliCompression)

# Separate storage backend for scenarios (binary pickled objects)
# Use the storage factory; choose 'pickle' serializer and 'dict' accessor
# so scenarios are stored as binary pickles but accessible via value helpers.
scenarios_storage = create_storage(backend="file", serializer="pickle", accessor="dict", data_dir="data")

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
from planner_lib.config.api import router as config_router
from planner_lib.projects.api import router as projects_router
from planner_lib.scenarios.api import router as scenario_router
from planner_lib.cost.api import router as cost_router
from planner_lib.server.api import router as server_router
from planner_lib.admin.admin import router as admin_router

# Expose shared objects to routers via app.state
app.state.scenarios_storage = scenarios_storage
app.state.config_manager = config_manager

app.include_router(session_router, prefix='/api')
app.include_router(config_router, prefix='/api')
app.include_router(projects_router, prefix='/api')
app.include_router(scenario_router, prefix='/api')
app.include_router(cost_router, prefix='/api')
app.include_router(server_router, prefix='/api')
app.include_router(admin_router, prefix='')
