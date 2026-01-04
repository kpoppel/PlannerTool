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

# Load and validate cost configuration at startup so any inconsistencies
# are visible in the server logs immediately.
try:
    from planner_lib.cost.config import load_cost_config
    try:
        load_cost_config()
    except Exception as e:
        logger.exception('Initial cost configuration validation failed: %s', e)
        # Also write to stderr to ensure the message is visible when the
        # server is started under external servers (uvicorn) that may
        # capture or reconfigure Python logging.
        try:
            import sys
            sys.stderr.write('Initial cost configuration validation failed: ' + str(e) + '\n')
        except Exception:
            pass
except Exception:
    # If cost config module not available, continue silently
    pass

# FastAPI imports
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi import HTTPException, Request, Response
from fastapi import Body
import uuid
from datetime import datetime
from typing import Dict, Any

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
    # Require a valid session
    sid = get_session_id(request)
    logger.debug("Fetching projects for session for %s", sid)
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
    # Require a valid session
    sid = get_session_id(request)
    logger.debug("Fetching scenario(s) for session %s", sid)
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
    # Require a valid session
    sid = get_session_id(request)
    logger.debug("Saving/deleting scenario for session %s", sid)
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
            # Server-side validation: Prevent saving readonly scenarios
            if isinstance(data, dict) and data.get('readonly'):
                raise HTTPException(status_code=400, detail='Cannot save readonly scenario')
            
            scenario_id = None
            if isinstance(data, dict):
                scenario_id = data.get('id')
            meta = save_user_scenario(scenarios_storage, user_id, scenario_id, data)
            return meta
        elif op == 'delete':
            if not isinstance(data, dict) or not data.get('id'):
                raise HTTPException(status_code=400, detail='Missing scenario id for delete')
            
            # Server-side validation: Prevent deleting readonly scenarios
            # Load the scenario first to check if it's readonly
            try:
                scenario = load_user_scenario(scenarios_storage, user_id, data['id'])
                if isinstance(scenario, dict) and scenario.get('readonly'):
                    raise HTTPException(status_code=400, detail='Cannot delete readonly scenario')
            except KeyError:
                raise HTTPException(status_code=404, detail='Scenario not found')
            
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
async def api_cost_post(request: Request, payload: dict = Body(default={})):
    # Require a valid session
    sid = get_session_id(request)
    logger.debug("Calculating cost for session %s", sid)
    try:
        from planner_lib.cost import estimate_costs, build_cost_schema
        from planner_lib.projects import list_tasks
        from planner_lib.storage.scenario_store import load_user_scenario

        # Build session context and determine features to estimate
        ctx = SESSIONS.get(sid) or {}
        email = ctx.get('email')
        pat = ctx.get('pat')

        # If client provided explicit features in payload, prefer them
        features = (payload or {}).get('features')
        scenario_id = (payload or {}).get('scenarioId') or (payload or {}).get('scenario_id') or (payload or {}).get('scenario')

        # If features not provided, fetch baseline tasks for the user (requires PAT)
        if features is None:
            try:
                # ensure PAT is loaded into ctx if missing
                if email and not pat:
                    loaded = config_manager.load(email)
                    pat = loaded.get('pat')
                    ctx['pat'] = pat
                    SESSIONS[sid] = ctx
            except Exception:
                pass
            tasks = list_tasks(pat=pat)
            # normalize baseline tasks to expected cost input
            features = []
            for t in (tasks or []):
                features.append({
                    'id': t.get('id'),
                    'project': t.get('project'),
                    'start': t.get('start'),
                    'end': t.get('end'),
                    'capacity': t.get('capacity') or 1.0,
                    'title': t.get('title'),
                    'type': t.get('type'),
                    'state': t.get('state'),
                })

        # If a scenario id was provided, load the scenario and apply its overrides
        applied_overrides = None
        if scenario_id:
            try:
                if not email:
                    raise HTTPException(status_code=401, detail='Missing user context for scenario')
                scen = load_user_scenario(scenarios_storage, email, scenario_id)
                # scen is expected to be a dict with 'overrides' mapping featureId->{start,end}
                overrides = scen.get('overrides') if isinstance(scen, dict) else None
                if overrides:
                    applied_overrides = {}
                    new_features = []
                    for f in features:
                        fid = str(f.get('id'))
                        f_copy = dict(f)
                        if fid in overrides:
                            ov = overrides[fid]
                            if isinstance(ov, dict):
                                if 'start' in ov:
                                    f_copy['start'] = ov.get('start')
                                if 'end' in ov:
                                    f_copy['end'] = ov.get('end')
                            applied_overrides[fid] = ov
                        new_features.append(f_copy)
                    features = new_features
            except KeyError:
                raise HTTPException(status_code=404, detail='Scenario not found')
            except HTTPException:
                raise
            except Exception as e:
                logger.exception('Failed to load scenario %s: %s', scenario_id, e)

        # Prepare context for estimate_costs
        ctx = dict(ctx)
        ctx['features'] = features

        raw = estimate_costs(ctx) or {}
        # Attach meta information about applied scenario overrides
        if scenario_id:
            raw = dict(raw)
            raw_meta = raw.get('meta') if isinstance(raw.get('meta'), dict) else {}
            raw_meta.update({'scenario_id': scenario_id, 'applied_overrides': applied_overrides})
            raw['meta'] = raw_meta

        return build_cost_schema(raw, mode='full', session_features=ctx.get('features'))
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to calculate cost: %s', e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get('/api/cost')
async def api_cost_get(request: Request):
    # Return calculated cost for the session; if no valid session provided,
    # return a canned schema response from the cost module so clients can
    # discover the expected shape without authentication.
    sid = request.headers.get("X-Session-Id") or request.cookies.get(SESSION_COOKIE)
    if not sid or sid not in SESSIONS:
        # No valid session: let the cost module return the canned schema
        from planner_lib.cost import build_cost_schema
        # Return an empty/raw schema so callers can see expected keys
        return build_cost_schema({}, mode='schema', session_features=None)

    # Valid session — resolve PAT and build session context
    sid = get_session_id(request)
    logger.debug("Fetching calculated cost for session %s", sid)
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
        from planner_lib.cost import build_cost_schema, estimate_costs

        tasks = list_tasks(pat=pat)
        features = []
        for t in tasks or []:
            features.append({
                'id': t.get('id'),
                'project': t.get('project'),
                'start': t.get('start'),
                'end': t.get('end'),
                'capacity': t.get('capacity'),
                'title': t.get('title'),
                'type': t.get('type'),
                'state': t.get('state'),
            })

        ctx = dict(ctx)
        ctx['features'] = features
        raw = estimate_costs(ctx)
        return build_cost_schema(raw, mode='full', session_features=features)
    
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


@app.get('/api/cost/teams')
async def api_cost_teams(request: Request):
    """Return discovered teams and member details derived from cost/database config.

    Response shape:
    { teams: [ { id, name, members: [ { name, external, site, hourly_rate, hours_per_month } ], totals: { ... } } ] }
    """
    try:
        from planner_lib.cost.config import load_cost_config
        from planner_lib.util import slugify

        cfg = load_cost_config() or {}
        cost_cfg = cfg.get('cost', {}) or {}
        db_cfg = cfg.get('database', {}) or {}
        people = db_cfg.get('people', []) or []

        site_hours_map = cost_cfg.get('working_hours', {}) or {}
        external_cfg = cost_cfg.get('external_cost', {}) or {}
        ext_rates = external_cfg.get('external', {}) or {}
        default_ext_rate = float(external_cfg.get('default_hourly_rate', 0) or 0)
        internal_default_rate = float(cost_cfg.get('internal_cost', {}).get('default_hourly_rate', 0) or 0)

        teams_map = {}
        for p in people:
            raw_team = p.get('team_name') or p.get('team') or ''
            team_key = slugify(raw_team)
            if not team_key:
                # skip people without a team
                continue
            entry = teams_map.setdefault(team_key, {
                'id': 'team-' + team_key,
                'name': raw_team or team_key,
                'members': [],
                'totals': {
                    'internal_count': 0,
                    'external_count': 0,
                    'internal_hours_total': 0,
                    'external_hours_total': 0,
                    'internal_hourly_rate_total': 0.0,
                    'external_hourly_rate_total': 0.0,
                }
            })

            name = p.get('name') or ''
            site = p.get('site') or ''
            is_external = bool(p.get('external'))
            if is_external:
                hourly_rate = float(ext_rates.get(name, default_ext_rate) or 0)
                hours = int(site_hours_map.get(site, {}).get('external', 0) or 0)
                entry['totals']['external_count'] += 1
                entry['totals']['external_hourly_rate_total'] += hourly_rate
                entry['totals']['external_hours_total'] += hours
            else:
                hourly_rate = float(internal_default_rate or 0)
                hours = int(site_hours_map.get(site, {}).get('internal', 0) or 0)
                entry['totals']['internal_count'] += 1
                entry['totals']['internal_hourly_rate_total'] += hourly_rate
                entry['totals']['internal_hours_total'] += hours

            entry['members'].append({
                'name': name,
                'external': is_external,
                'site': site,
                'hourly_rate': hourly_rate,
                'hours_per_month': hours,
            })

        teams = list(teams_map.values())
        return { 'teams': teams }
    except Exception as e:
        logger.exception('Failed to build teams data: %s', e)
        raise HTTPException(status_code=500, detail=str(e))
