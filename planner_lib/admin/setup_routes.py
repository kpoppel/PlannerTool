"""Admin setup and session-lifecycle route handlers.

Covers: setup-status, initial-setup, admin static files, admin UI root,
admin check, and config reload.
"""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse, RedirectResponse
from pathlib import Path
import mimetypes
import logging

from planner_lib.middleware import require_admin_session
from planner_lib.services.resolver import resolve_service
from planner_lib.middleware.session import SESSION_COOKIE
from planner_lib.middleware.session import get_session_id_from_request as _get_session_id_or_raise

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get('/admin/v1/setup-status')
async def admin_setup_status(request: Request):
    """Check if the admin system needs initial setup (no admins exist)."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        response = JSONResponse({'needs_setup': admin_svc.admin_count() == 0})
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        return response
    except Exception as e:
        logger.exception('Failed to check setup status: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/setup')
async def admin_setup(request: Request):
    """Create the initial admin account if none exists."""
    try:
        payload = await request.json()
        email = payload.get('email')
        pat = payload.get('pat')
        if not email or not pat:
            raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Email and PAT are required'})

        admin_svc = resolve_service(request, 'admin_service')

        if admin_svc.admin_count() > 0:
            raise HTTPException(status_code=403, detail={'error': 'already_setup', 'message': 'Admin accounts already exist'})

        admin_svc.create_admin_account(email, pat)

        session_mgr = resolve_service(request, 'session_manager')
        sid = session_mgr.create(email)
        session_mgr.set_val(sid, 'pat', pat)

        response = JSONResponse({'ok': True, 'message': f'Admin account created for {email}'})
        response.headers['x-set-session-id'] = sid
        return response
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to setup initial admin: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.get('/admin/static/{path:path}')
async def admin_static(request: Request, path: str):
    """Serve static files from ``www-admin`` for authenticated admin users.

    Symlink traversal is blocked before path resolution.
    """
    base = Path('www-admin').resolve()
    if not path or path.endswith('/'):
        target = base / 'index.html'
    else:
        unresolved = base / path
        if unresolved.is_symlink():
            raise HTTPException(status_code=404, detail='Not found')
        target = unresolved.resolve()

    try:
        target.relative_to(base)
    except Exception:
        raise HTTPException(status_code=404, detail='Not found')

    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail='Not found')

    content_type, _ = mimetypes.guess_type(str(target))
    return FileResponse(path=str(target), media_type=content_type or 'application/octet-stream')


@router.post('/admin/v1/reload-config')
@require_admin_session
async def api_admin_reload_config(request: Request):
    """Reload configuration from storage and notify all dependent services."""
    sid = _get_session_id_or_raise(request)
    logger.debug('Reloading server and cost configuration for session %s', sid)
    try:
        admin_svc = resolve_service(request, 'admin_service')
        return admin_svc.reload_config(session_id=sid)
    except Exception as e:
        logger.exception('Failed to reload configuration: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.get('/admin/', response_class=HTMLResponse)
@router.get('/admin', response_class=HTMLResponse)
async def admin_root(request: Request):
    """Serve the admin UI entry-point or login page depending on session state."""
    if not request.url.path.endswith('/'):
        return RedirectResponse(url=str(request.url.replace(path=request.url.path + '/')))

    base_path = Path('www-admin')
    index_path = base_path / 'index.html'
    login_path = base_path / 'login.html'

    def serve_file(target: Path, fallback: Path = None):
        try:
            with open(target, 'r', encoding='utf-8') as f:
                return HTMLResponse(f.read())
        except FileNotFoundError:
            if fallback:
                try:
                    with open(fallback, 'r', encoding='utf-8') as f:
                        return HTMLResponse(f.read())
                except FileNotFoundError:
                    pass
            raise HTTPException(status_code=404, detail='Admin UI not found')

    sid = request.headers.get('X-Session-Id') or request.cookies.get(SESSION_COOKIE)
    if not sid:
        return serve_file(login_path, fallback=index_path)

    try:
        session_mgr = resolve_service(request, 'session_manager')
        if not session_mgr.exists(sid):
            return serve_file(login_path, fallback=index_path)

        admin_svc = resolve_service(request, 'admin_service')
        ctx = session_mgr.get(sid) or {}
        email = ctx.get('email')
        if email and admin_svc.is_admin(email):
            return serve_file(index_path)

        raise HTTPException(status_code=401, detail={'error': 'access_denied', 'message': 'Admin access required.'})
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail={'error': 'access_denied', 'message': 'Admin access required.'})


@router.get('/admin/check')
@require_admin_session
async def admin_check(request: Request):
    """Return 200 when the current session has admin access.

    Intended for client-side bootstrapping after session acquisition.
    """
    return {'ok': True}
