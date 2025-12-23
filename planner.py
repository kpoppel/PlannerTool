from fastapi import FastAPI
import logging
import sys
from pathlib import Path
import yaml
import os

from planner_lib.plugins.middleware import BrotliCompressionMiddleware

# Load server config early so we can configure the root logger at the intended
# level before other modules are imported or initialized.
logging.basicConfig(level=logging.NOTSET, format='%(asctime)s INFO %(message)s')
DEFAULT_LOG_LEVEL = logging.WARNING
try:
    cfg_path = Path('data/config/server_config.yml')
    if cfg_path.exists():
        with cfg_path.open('r', encoding='utf-8') as _f:
            _cfg = yaml.safe_load(_f) or {}
            _lvl = _cfg.get('log_level')
            if isinstance(_lvl, str):
                _numeric = getattr(logging, _lvl.upper(), None)
                if isinstance(_numeric, int):
                    DEFAULT_LOG_LEVEL = _numeric
except Exception:
    # If yaml missing or invalid, fall back to DEFAULT_LOG_LEVEL
    logging.exception('Failed to load server configuration for logging setup')
    pass
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

# FastAPI imports
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi import HTTPException, Request, Response
from fastapi import Body
import uuid

# Application imports
from planner_lib.config.health import get_health
from planner_lib.config.config import config_manager, AccountPayload
from planner_lib.storage.file_backend import FileStorageBackend
from planner_lib.setup import YamlConfigStore
from planner_lib.setup import setup
from planner_lib.storage.scenario_store import (
    save_user_scenario,
    load_user_scenario,
    delete_user_scenario,
    list_user_scenarios,
)

# Parse CLI args for setup-related actions
##########################################
from planner_lib.setup import parse_args, get_parser, setup, has_feature_flag
import os

_setup_args = parse_args(sys.argv[1:])
if _setup_args.help:
    get_parser().print_help()
    sys.exit(0)

# At startup: ensure there's a server configuration file. If it doesn't exist,
# create a human-editable YAML template and exit so the operator can fill it in.
STORE_NS = "config"
STORE_KEY = "server_config.yml"
storage = FileStorageBackend()
storage.configure(mode="text")
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

# Add Brotli compression middleware if feature flag is enabled
if has_feature_flag('planner_use_brotli'):
    logger.info("Brotli compression middleware is enabled")
    from planner_lib.plugins.middleware import BrotliCompressionMiddleware
    #Register Brotli middleware (wrap app at ASGI layer)
    app.add_middleware(BrotliCompressionMiddleware)

# Separate storage backend for scenarios (binary pickled objects)
scenarios_storage = FileStorageBackend()
# Use pickle mode for binary objects
scenarios_storage.configure(mode="pickle")

# Serve static UI from www/ under /static
app.mount("/static", StaticFiles(directory="www"), name="static")

# Simple in-memory session store: sessionId -> context dict
SESSIONS: dict[str, dict] = {}
SESSION_COOKIE = "sessionId"

def get_session_id(request: Request) -> str:
    sid = request.headers.get("X-Session-Id") or request.cookies.get(SESSION_COOKIE)
    if not sid:
        raise HTTPException(status_code=401, detail="Missing session ID")
    if sid not in SESSIONS:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return sid

@app.post('/api/session')
async def api_session_post(payload: AccountPayload, response: Response):
    # Create a session bound to a user config
    email = payload.email
    if not email or '@' not in email:
        raise HTTPException(status_code=400, detail='invalid email')
    # Load (or create) user config from storage to couple into the session
    try:
        cfg = config_manager.load(email)
    except KeyError:
        # No config yet for this email; proceed with empty PAT
        logger.debug("No existing config for %s; creating session with empty PAT", email)
        cfg = { 'ok': True, 'email': email, 'pat': None }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # If a session already exists for this email, clear it
    try:
        for existing_sid, ctx in list(SESSIONS.items()):
            if ctx.get('email') == email:
                logger.debug("Removing existing session for email %s with session ID %s", email, existing_sid)
                del SESSIONS[existing_sid]
    except Exception:
        pass

    sid = uuid.uuid4().hex
    SESSIONS[sid] = {
        "namespace": STORE_NS,
        "key": STORE_KEY,
        "email": email,
        "pat": cfg.get('pat'),
    }
    response.set_cookie(key=SESSION_COOKIE, value=sid, httponly=True, samesite="lax")
    logger.debug("Creating session for email %s with session ID %s", payload.email, sid)
    return {"sessionId": sid}

@app.get("/", response_class=HTMLResponse)
async def root():
    # Redirect-style: serve index quickly
    with open("www/index.html", "r", encoding="utf-8") as f:
        return f.read()

@app.get("/dev", response_class=HTMLResponse)
async def dev_page():
    return FileResponse("www/dev.html")

@app.get("/api/health")
async def api_health():
    return get_health()

@app.post('/api/config')
async def save_config(payload: AccountPayload):
    logger.debug("Saving config for email %s", payload.email)
    try:
        status = config_manager.save(payload)
        if not status:
            raise HTTPException(status_code=400, detail='invalid email')
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return status

@app.get('/api/projects')
async def api_projects(request: Request):
    logger.debug("Fetching projects for session for %s", request.cookies.get(SESSION_COOKIE))
    # Require a valid session
    _ = get_session_id(request)
    try:
        from planner_lib.projects import list_projects
        return list_projects()
    except Exception:
        return []

@app.get('/api/tasks')
async def api_tasks(request: Request):
    # Require a valid session
    sid = get_session_id(request)
    logger.debug("Fetching tasks for session for %s", sid)
    # Ensure session has user PAT loaded; if missing, load from config
    ctx = SESSIONS.get(sid) or {}
    email = ctx.get('email')
    pat = ctx.get('pat')
    if email and not pat:
        try:
            loaded = config_manager.load(email)
            pat = loaded.get('pat')
            ctx['pat'] = pat
            SESSIONS[sid] = ctx
        except Exception as e:
            logger.exception('Failed to load user config for %s: %s', email, e)
    try:
        from planner_lib.projects import list_tasks
        # Optional per-project filtering via query parameter
        project_id = request.query_params.get('project')
        if project_id:
            return list_tasks(pat=pat, project_id=project_id)
        return list_tasks(pat=pat)
    except Exception:
        return []

@app.post('/api/tasks')
async def api_tasks_update(request: Request, payload: list[dict] = Body(default=[])):
    # Require a valid session
    sid = get_session_id(request)
    logger.debug("Updating tasks for session %s: %d items", sid, len(payload or []))
    # Ensure session has user PAT
    ctx = SESSIONS.get(sid) or {}
    email = ctx.get('email')
    pat = ctx.get('pat')
    if email and not pat:
        try:
            loaded = config_manager.load(email)
            pat = loaded.get('pat')
            ctx['pat'] = pat
            SESSIONS[sid] = ctx
        except Exception as e:
            logger.exception('Failed to load user config for %s: %s', email, e)
    try:
        from planner_lib.projects import update_tasks
        result = update_tasks(payload or [], pat=pat)
        if not result.get('ok', True) and result.get('errors'):
            # Return 207 Multi-Status-like behavior via 200 but include errors
            logger.warning("Task update completed with errors: %s", result['errors'])
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get('/api/teams')
async def api_teams(request: Request):
    # Require a valid session
    sid = get_session_id(request)
    logger.debug("Fetching teams for session for %s", sid)
    try:
        from planner_lib.projects import list_teams
        return list_teams()
    except Exception:
        return []

@app.get('/api/scenario')
async def api_scenario_get(request: Request):
    sid = get_session_id(request)
    ctx = SESSIONS.get(sid) or {}
    user_id = ctx.get('email')
    if not user_id:
        raise HTTPException(status_code=401, detail='Missing user context')
    scenario_id = request.query_params.get('id')
    try:
        if scenario_id:
            data = load_user_scenario(scenarios_storage, user_id, scenario_id)
            return data
        else:
            return list_user_scenarios(scenarios_storage, user_id)
    except KeyError:
        raise HTTPException(status_code=404, detail='Scenario not found')
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post('/api/scenario')
async def api_scenario_post(request: Request, payload: dict = Body(default={})): 
    sid = get_session_id(request)
    ctx = SESSIONS.get(sid) or {}
    user_id = ctx.get('email')
    if not user_id:
        raise HTTPException(status_code=401, detail='Missing user context')
    op = (payload or {}).get('op')
    data = (payload or {}).get('data')
    if not op:
        raise HTTPException(status_code=400, detail='Missing op')
    try:
        if op == 'save':
            scenario_id = None
            if isinstance(data, dict):
                scenario_id = data.get('id')
            meta = save_user_scenario(scenarios_storage, user_id, scenario_id, data)
            return meta
        elif op == 'delete':
            if not isinstance(data, dict) or not data.get('id'):
                raise HTTPException(status_code=400, detail='Missing scenario id for delete')
            ok = delete_user_scenario(scenarios_storage, user_id, data['id'])
            if not ok:
                raise HTTPException(status_code=404, detail='Scenario not found')
            return { 'ok': True, 'id': data['id'] }
        else:
            raise HTTPException(status_code=400, detail='Unsupported op')
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post('/api/cost')
# TODO: This looks like total imagination from the LLM. The frontend can ask for recalculation of a single task's cost.
async def api_cost_post(request: Request, payload: dict = Body(default={})):
    # Require a valid session
    sid = get_session_id(request)
    logger.debug("Calculating cost for session %s", sid)
    # try:
    #     from planner_lib.cost import estimate_costs
    #     # Payload can include optional 'scenario' and 'revisions'
    #     scenario = (payload or {}).get('scenario')
    #     revisions = (payload or {}).get('revisions')

    #     # Bind any available features/tasks from session context for local compute
    #     ctx = SESSIONS.get(sid) or {}
    #     # Optionally client may include 'features' in payload to avoid extra calls
    #     features = (payload or {}).get('features')
    #     if features is not None:
    #         ctx = dict(ctx)
    #         ctx['features'] = features

    #     result = estimate_costs(ctx, scenario=scenario, revisions=revisions)
    #     return result
    # except HTTPException:
    #     raise
    # except Exception as e:
    #     logger.exception('Failed to calculate cost: %s', e)
    #     raise HTTPException(status_code=500, detail=str(e))


@app.get('/api/cost')
async def api_cost_get(request: Request):
    # Return calculated cost for all loaded tasks/projects for this session
    sid = get_session_id(request)
    logger.debug("Fetching calculated cost for session %s", sid)
    # Ensure session has user PAT
    ctx = SESSIONS.get(sid) or {}
    email = ctx.get('email')
    pat = ctx.get('pat')
    if email and not pat:
        try:
            loaded = config_manager.load(email)
            pat = loaded.get('pat')
            ctx['pat'] = pat
            SESSIONS[sid] = ctx
        except Exception as e:
            logger.exception('Failed to load user config for %s: %s', email, e)
    try:
        from planner_lib.projects import list_tasks
        from planner_lib.cost import estimate_costs

        tasks = list_tasks(pat=pat)
        # Normalize task data for engine (send only expected fields)
        features = []
        for t in tasks or []:
            features.append({
                'id': t.get('id'),
                'project': t.get('project'),
                'start': t.get('start'),
                'end': t.get('end'),
                'capacity': t.get('capacity'),
            })

        ctx = dict(ctx)
        ctx['features'] = features
        res = estimate_costs(ctx)
        return res
    except Exception as e:
        logger.exception('Failed to fetch cost data: %s', e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post('/api/admin/reload-config')
async def api_admin_reload_config(request: Request):
    # Require a valid session (admin-like action requires auth)
    sid = get_session_id(request)
    logger.debug("Reloading server and cost configuration for session %s", sid)
    try:
        # Reload server configuration (re-run setup load into module state)
        from planner_lib.setup import YamlConfigStore, setup as _setup
        from planner_lib.config.config import config_manager
        from planner_lib.cost import config as cost_config
        from planner_lib.cost import engine as cost_engine

        # Re-load the server-side stored configuration into setup module state
        # Use the same storage and keys as application startup
        store = YamlConfigStore(storage, namespace=STORE_NS)
        try:
            cfg = store.load(STORE_KEY)
            # update the loaded config in setup module
            from planner_lib import setup as setup_module
            # directly set the private loaded config for simplicity
            if hasattr(setup_module, '_loaded_config'):
                setup_module._loaded_config.clear()
                setup_module._loaded_config.append(cfg)
        except Exception:
            # ignore missing server config during reload
            logger.debug('No server config present to reload')

        # Reload cost configuration files and invalidate cost caches
        _ = cost_config.load_cost_config()
        try:
            cost_engine.invalidate_team_rates_cache()
        except Exception:
            logger.debug('Cost engine cache invalidation not available')

        # Also reload any other dynamic config managers if present
        try:
            config_manager.load(request.cookies.get(SESSION_COOKIE) or '')
        except Exception:
            pass

        return { 'ok': True }
    except Exception as e:
        logger.exception('Failed to reload configuration: %s', e)
        raise HTTPException(status_code=500, detail=str(e))
