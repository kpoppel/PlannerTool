"""Admin setup and session-lifecycle route handlers.

Covers: setup-status, initial-setup, admin UI root/login, admin check, and config reload.
Admin HTML is served from {static_dir}/admin/ — the same Vite build output tree as the main app.
"""
import asyncio

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pathlib import Path
import logging

from planner_lib.middleware import require_admin_session
from planner_lib.services.resolver import resolve_service
from planner_lib.middleware.session import SESSION_COOKIE
from planner_lib.middleware.session import get_session_id_from_request as _get_session_id_or_raise
from planner_lib.accounts.config import _is_valid_pat, AccountPayload
from planner_lib.accounts.constants import AccountPermissions

router = APIRouter()
logger = logging.getLogger(__name__)


def _inject_base(html: str, request: Request, suffix: str = '/') -> str:
    root_path = (request.scope.get('root_path') or '').rstrip('/')
    html = html.replace('<head>', f'<head>\n    <base href="{root_path}/static{suffix}">', 1)
    if root_path:
        # Rewrite the static importmap placeholder to resolve /static/ under the sub-path
        html = html.replace(
            '{"imports":{"/static/":"/static/"}}',
            '{' + f'"imports":{{"/static/":"{root_path}/static/"}}' + '}',
        )
    return html


@router.get('/admin/v1/setup-status')
async def admin_setup_status(request: Request):
    """Check if the admin system needs initial setup (no admins exist)."""
    try:
        account_manager = resolve_service(request, 'account_manager')
        response = JSONResponse({'needs_setup': account_manager.count_all_with_permission(AccountPermissions.ADMIN) == 0})
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        return response
    except Exception as e:
        logger.exception('Failed to check setup status: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/setup')
async def admin_setup(request: Request):
    """Create the initial admin account if none exists."""
    logger.warning('Received request to set up initial admin account')
    try:
        payload = await request.json()
        email = payload.get('email')
        pat = payload.get('pat')
        if not email or not pat:
            raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Email and PAT are required'})

        # Validate PAT format before creating the admin account to avoid
        # persisting obviously malformed tokens that could cause server
        # runtime errors when later used.
        if not _is_valid_pat(pat):
            raise HTTPException(status_code=400, detail={'error': 'invalid_pat', 'message': 'PAT format invalid'})

        account_manager = resolve_service(request, 'account_manager')
        if account_manager.count_all_with_permission(AccountPermissions.ADMIN) > 0:
            raise HTTPException(status_code=403, detail={'error': 'already_setup', 'message': 'Admin accounts already exist'})
        account_data = AccountPayload(email=email, pat=pat, permissions=[AccountPermissions.ADMIN])
        account_manager.save(account_data)

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


@router.post('/admin/v1/reload-config')
@require_admin_session
async def api_admin_reload_config(request: Request):
    """Reload configuration from storage and notify all dependent services."""
    sid = _get_session_id_or_raise(request)
    logger.debug('Reloading server and cost configuration for session %s', sid)
    try:
        admin_svc = resolve_service(request, 'admin_service')
        return await asyncio.to_thread(admin_svc.reload_config, session_id=sid)
    except Exception as e:
        logger.exception('Failed to reload configuration: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.get('/admin/', response_class=HTMLResponse)
@router.get('/admin', response_class=HTMLResponse)
async def admin_root(request: Request):
    """Serve the admin UI entry-point or login page depending on session state."""
    if not request.url.path.endswith('/'):
        return RedirectResponse(url=str(request.url.replace(path=request.url.path + '/')))

    base_path = Path(request.app.state.static_dir) / 'admin'
    index_path = base_path / 'index.html'
    login_path = base_path / 'login.html'

    def serve_file(target: Path, fallback: Path | None = None) -> HTMLResponse:
        try:
            with open(target, 'r', encoding='utf-8') as f:
                return HTMLResponse(_inject_base(f.read(), request, '/admin/'))
        except FileNotFoundError:
            if fallback:
                try:
                    with open(fallback, 'r', encoding='utf-8') as f:
                        return HTMLResponse(_inject_base(f.read(), request, '/admin/'))
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

        account_manager = resolve_service(request, 'account_manager')
        ctx = session_mgr.get(sid) or {}
        email = ctx.get('email')
        if email and account_manager.has_permission(email, AccountPermissions.ADMIN):
            return serve_file(index_path)

        # Valid session but not an admin — redirect to login with an error flag.
        login_url = (request.scope.get('root_path') or '') + '/admin/login?error=not_admin'
        redirect = RedirectResponse(url=login_url, status_code=302)
        redirect.delete_cookie(SESSION_COOKIE, path='/')
        return redirect
    except HTTPException:
        raise
    except Exception:
        login_url = (request.scope.get('root_path') or '') + '/admin/login?error=not_admin'
        redirect = RedirectResponse(url=login_url, status_code=302)
        redirect.delete_cookie(SESSION_COOKIE, path='/')
        return redirect


@router.get('/admin/login', response_class=HTMLResponse)
async def admin_login(request: Request):
    """Serve the admin login page directly (e.g. after a redirect from admin_root)."""
    login_path = Path(request.app.state.static_dir + '/admin') / 'login.html'
    try:
        with open(login_path, 'r', encoding='utf-8') as f:
            return HTMLResponse(_inject_base(f.read(), request, '/admin/'))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail='Login page not found')


@router.get('/admin/check')
@require_admin_session
async def admin_check(request: Request):
    """Return 200 when the current session has admin access.

    Intended for client-side bootstrapping after session acquisition.
    """
    return {'ok': True}
