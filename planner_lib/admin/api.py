from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.responses import FileResponse
from pathlib import Path
import mimetypes
from planner_lib.middleware import require_admin_session
from planner_lib.services.resolver import resolve_service
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

@router.get('/admin/static/{path:path}')
@require_admin_session
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
@require_admin_session
async def admin_root(request: Request):
    """Serve the admin UI entrypoint (placeholder) from `www-admin/index.html`."""
    try:
        with open('www-admin/index.html', 'r', encoding='utf-8') as f:
            return HTMLResponse(f.read())
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail='Admin UI not found')
