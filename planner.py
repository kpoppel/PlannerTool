from fastapi import FastAPI
import logging
import sys
from pathlib import Path

# configure basic logging for the backend
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s %(levelname)s %(name)s: %(message)s')
logging.getLogger('azure.devops.client').setLevel(logging.WARNING)
logging.getLogger('azure').setLevel(logging.WARNING)
logging.getLogger('msrest').setLevel(logging.WARNING)
logging.getLogger('requests').setLevel(logging.WARNING)
logging.getLogger('urllib3').setLevel(logging.WARNING)
logger = logging.getLogger('planner')
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi import HTTPException, Request, Response
from fastapi import Body
import uuid

from planner_lib.config.health import get_health
from planner_lib.config.config import config_manager, AccountPayload
from planner_lib.storage.file_backend import FileStorageBackend
from planner_lib.setup import YamlConfigStore
from planner_lib.setup import setup

# Parse CLI args for setup-related actions
##########################################
from planner_lib.setup import parse_args, get_parser, setup
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
rc = setup(sys.argv[1:], storage, STORE_NS, STORE_KEY)
if rc != 0:
    sys.exit(rc)

## Setup is complete, setup routing, and start the FastAPI app
##############################################################
app = FastAPI(title="AZ Planner Dev Server")

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
