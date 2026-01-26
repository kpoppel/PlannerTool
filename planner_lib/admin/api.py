from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.responses import FileResponse
from pathlib import Path
import mimetypes
from planner_lib.middleware import require_admin_session
from planner_lib.services.resolver import resolve_service
from planner_lib.middleware.session import SESSION_COOKIE
from planner_lib.middleware.session import get_session_id_from_request as _get_session_id_or_raise
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

@router.get('/admin/static/{path:path}')
async def admin_static(request: Request, path: str):
    """Serve static files from `www-admin` for authenticated admin users.

    Prevent path traversal by resolving the target path and ensuring it's
    contained within the `www-admin` directory.
    """
    base = Path('www-admin').resolve()
    # Default to index.html when path is empty or points to a directory
    if not path or path.endswith('/'):
        target = base / 'index.html'
    else:
        target = (base / path).resolve()

    try:
        # Ensure the resolved target is inside the base directory
        target.relative_to(base)
    except Exception:
        raise HTTPException(status_code=404, detail='Not found')

    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail='Not found')

    # Guess content type
    content_type, _ = mimetypes.guess_type(str(target))
    return FileResponse(path=str(target), media_type=content_type or 'application/octet-stream')

@router.post('/admin/v1/reload-config')
@require_admin_session
async def api_admin_reload_config(request: Request):
    sid = request.cookies.get('session') or ''
    logger.debug("Reloading server and cost configuration for session %s", sid)
    try:
        admin_svc = resolve_service(request, 'admin_service')
        return admin_svc.reload_config(request)
    except Exception as e:
        logger.exception('Failed to reload configuration: %s', e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/admin', response_class=HTMLResponse)
async def admin_root(request: Request):
    """Serve the admin UI entrypoint (placeholder) from `www-admin/index.html`."""
    # Behavior:
    # - If there is no session id provided, serve the admin index so the
    #   frontend can bootstrap and create a session client-side.
    # - If a session id is present and valid, only serve the index when the
    #   session's account is an admin. Otherwise return 401 so the global
    #   401 handler renders the access-denied page.
    base_path = Path('www-admin')
    index_path = base_path / 'index.html'

    # Resolve session id from headers/cookies without raising on missing
    sid = request.headers.get('X-Session-Id') or request.cookies.get(SESSION_COOKIE)
    if not sid:
        # No session — serve the login page so the client can create a session
        login_path = base_path / 'login.html'
        try:
            with open(login_path, 'r', encoding='utf-8') as f:
                return HTMLResponse(f.read())
        except FileNotFoundError:
            # Fallback to index if login page missing
            try:
                with open(index_path, 'r', encoding='utf-8') as f:
                    return HTMLResponse(f.read())
            except FileNotFoundError:
                raise HTTPException(status_code=404, detail='Admin UI not found')

    # Session id present — validate existence and admin status
    try:
        session_mgr = resolve_service(request, 'session_manager')
        if not session_mgr.exists(sid):
            # Treat invalid/expired session like missing session: allow bootstrap
            try:
                with open(index_path, 'r', encoding='utf-8') as f:
                    return HTMLResponse(f.read())
            except FileNotFoundError:
                raise HTTPException(status_code=404, detail='Admin UI not found')

        # Session exists — check admin status via AdminService
        try:
            admin_svc = resolve_service(request, 'admin_service')
            # attempt to fetch email from session manager
            ctx = session_mgr.get(sid) or {}
            email = ctx.get('email')
            if email and admin_svc.is_admin(email):
                try:
                    with open(index_path, 'r', encoding='utf-8') as f:
                        return HTMLResponse(f.read())
                except FileNotFoundError:
                    raise HTTPException(status_code=404, detail='Admin UI not found')
            # Session present but not admin — return 401 so access_denied_response is used
            raise HTTPException(status_code=401, detail={'error': 'access_denied', 'message': 'Admin access required.'})
        except HTTPException:
            raise
        except Exception:
            # If admin service not available, fall back to denying access
            raise HTTPException(status_code=401, detail={'error': 'access_denied', 'message': 'Admin access required.'})
    except Exception:
        # On unexpected errors, propagate as 500
        raise


@router.get('/admin/check')
@require_admin_session
async def admin_check(request: Request):
    """Simple endpoint returning 200 when the current session is an admin.

    This is intended for client-side bootstrapping: the admin loader can
    call this endpoint after acquiring a session to determine whether the
    session qualifies for admin access. When not authorized, the
    `require_admin_session` decorator raises HTTP 401 and the global
    handler yields the standard access-denied response.
    """
    return { 'ok': True }
