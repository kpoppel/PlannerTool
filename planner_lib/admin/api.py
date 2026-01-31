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
import json
from typing import List

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


@router.get('/admin/v1/projects')
@require_admin_session
async def admin_get_projects(request: Request):
    """Return the contents of `data/config/projects.yml` as JSON.

    This endpoint returns the stored value (deserialized by the
    configured storage serializer) as the `content` field in the
    JSON response. If the stored value is raw bytes it will be
    returned as a UTF-8 decoded string.
    """
    try:
        admin_svc = resolve_service(request, 'admin_service')
        storage = admin_svc._config_storage
        try:
            data = storage.load('config', 'projects')
            # If backend returned raw bytes, decode to text; otherwise return the object
            if isinstance(data, (bytes, bytearray)):
                return {'content': data.decode('utf-8')}
            return {'content': data}
        except KeyError:
            return {'content': ''}
    except Exception as e:
        logger.exception('Failed to load projects: %s', e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/admin/v1/projects')
@require_admin_session
async def admin_save_projects(request: Request):
    """Save edited projects content; create a timestamped backup before overwrite."""
    try:
        payload = await request.json()
        content = payload.get('content', '')
        if not content:
            raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Empty content'})

        # Require valid JSON from the frontend; parse it and save the parsed
        # Python object using the configured storage serializer (YAML).
        try:
            parsed = json.loads(content)
        except Exception as e:
            raise HTTPException(status_code=400, detail={'error': 'invalid_json', 'message': 'Content must be valid JSON', 'detail': str(e)})

        admin_svc = resolve_service(request, 'admin_service')
        storage = admin_svc._config_storage

        # backup and save
        _backup_existing(storage, 'projects', 'projects')
        storage.save('config', 'projects', parsed)
        return { 'ok': True }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to save projects: %s', e)
        raise HTTPException(status_code=500, detail=str(e))


    


def _backup_existing(storage, key, backup_prefix=None):
    """Create a timestamped backup of `key` in the `config` namespace.

    Uses `storage.save` for structured values and writes raw bytes via the
    storage backend when the loaded value is already bytes. This keeps the
    implementation simple while preserving exact backups when required.
    """
    try:
        existing = storage.load('config', key)
    except KeyError:
        return
    from datetime import datetime, timezone
    ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup_key = f"{(backup_prefix or key)}_backup_{ts}"
    # Prefer the storage layer to persist the existing value. If that
    # fails (e.g. serializer cannot handle raw bytes), fall back to the
    # backend save to ensure the backup is preserved.
    try:
        storage.save('config', backup_key, existing)
    except Exception as e:
        logger.debug('storage.save backup failed for %s: %s; falling back to backend save', backup_key, e)
        # Try to use backend directly as a fallback to guarantee a backup
        backend = getattr(storage, '_backend', None)
        if backend is not None:
            try:
                backend.save('config', backup_key, existing)
            except Exception as e2:
                logger.exception('Backend save also failed for backup %s: %s', backup_key, e2)
        else:
            # As a last resort, save the string representation via storage.save
            try:
                storage.save('config', backup_key, str(existing))
            except Exception:
                logger.exception('Failed to write backup %s', backup_key)


@router.get('/admin/v1/teams')
@require_admin_session
async def admin_get_teams(request: Request):
    """Return the raw contents of `data/config/teams.yml` as text, pretty-printed when possible."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        storage = admin_svc._config_storage
        try:
            data = storage.load('config', 'teams')
            if isinstance(data, (bytes, bytearray)):
                return {'content': data.decode('utf-8')}
            return {'content': data}
        except KeyError:
            return {'content': ''}
    except Exception as e:
        logger.exception('Failed to load teams: %s', e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/admin/v1/teams')
@require_admin_session
async def admin_save_teams(request: Request):
    """Save edited teams content; create a timestamped backup before overwrite."""
    try:
        payload = await request.json()
        content = payload.get('content', '')
        if not content:
            raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Empty content'})

        try:
            parsed = json.loads(content)
        except Exception as e:
            raise HTTPException(status_code=400, detail={'error': 'invalid_json', 'message': 'Content must be valid JSON', 'detail': str(e)})

        admin_svc = resolve_service(request, 'admin_service')
        storage = admin_svc._config_storage

        _backup_existing(storage, 'teams', 'teams')
        storage.save('config', 'teams', parsed)
        return {'ok': True}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to save teams: %s', e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/admin/v1/system')
@require_admin_session
async def admin_get_system(request: Request):
    """Return the raw contents of `data/config/system.yml` as text, pretty-printed when possible."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        storage = admin_svc._config_storage
        try:
            # The admin 'System' editor should edit the server configuration
            # stored under the logical key 'server_config' in the config storage.
            data = storage.load('config', 'server_config')
            if isinstance(data, (bytes, bytearray)):
                return {'content': data.decode('utf-8')}
            return {'content': data}
        except KeyError:
            return {'content': ''}
    except Exception as e:
        logger.exception('Failed to load system: %s', e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/admin/v1/users')
@require_admin_session
async def admin_get_users(request: Request):
    """Return JSON object containing both `users` and `admins` lists.

    The response shape is: { users: [...], admins: [...] }
    """
    try:
        admin_svc = resolve_service(request, 'admin_service')
        storage = admin_svc._account_storage

        # Determine current session email so frontend can avoid offering
        # destructive actions to the current admin. Use session manager.
        current_email = None
        try:
            sid = _get_session_id_or_raise(request)
            session_mgr = resolve_service(request, 'session_manager')
            ctx = session_mgr.get(sid) or {}
            current_email = ctx.get('email')
        except Exception:
            current_email = None

        # List users and admins (logical keys)
        try:
            users = list(storage.list_keys('accounts'))
        except Exception:
            users = []
        try:
            admins = list(storage.list_keys('accounts_admin'))
        except Exception:
            admins = []

        resp = {'users': users, 'admins': admins}
        if current_email:
            resp['current'] = current_email
        return resp
    except Exception as e:
        logger.exception('Failed to list users/admins: %s', e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/admin/v1/users')
@require_admin_session
async def admin_save_users(request: Request):
    """Accept and apply a modification blob of the form: { users: [...], admins: [...] }.

    Behavior:
    - Ensure storage contains exactly the supplied `users` keys under `accounts`.
      Create missing user entries with minimal payload and delete removed ones.
    - Ensure `accounts_admin` contains exactly the supplied `admins` keys. When
      adding an admin, copy the existing user payload if present; otherwise create
      a minimal admin entry. When removing an admin, delete the admin key.
    """
    try:
        payload = await request.json()
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Expected JSON object'})

        users = payload.get('users', []) or []
        admins = payload.get('admins', []) or []
        if not isinstance(users, list) or not isinstance(admins, list):
            raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': '`users` and `admins` must be lists'})

        admin_svc = resolve_service(request, 'admin_service')
        storage = admin_svc._account_storage

        # Current sets
        try:
            current_users = set(storage.list_keys('accounts'))
        except Exception:
            current_users = set()
        try:
            current_admins = set(storage.list_keys('accounts_admin'))
        except Exception:
            current_admins = set()

        incoming_users = set(users)
        incoming_admins = set(admins)

        # Determine current session email to prevent self-removal
        current_email = None
        try:
            sid = _get_session_id_or_raise(request)
            session_mgr = resolve_service(request, 'session_manager')
            ctx = session_mgr.get(sid) or {}
            current_email = ctx.get('email')
        except Exception:
            current_email = None

        # Prevent the current admin from removing themselves (either as user or admin)
        if current_email:
            # If the current email is currently an admin but is not present in the
            # incoming admins set, reject the request to avoid locking out.
            if current_email in current_admins and current_email not in incoming_admins:
                raise HTTPException(status_code=400, detail={'error': 'forbidden', 'message': 'Cannot remove current admin from admin list'})
            # If the current email exists as a user but is being removed from users,
            # reject as that would also remove admin marker and lock them out.
            if current_email in current_users and current_email not in incoming_users:
                raise HTTPException(status_code=400, detail={'error': 'forbidden', 'message': 'Cannot remove current admin user account'})

        # --- Users: add missing, remove extra ---
        to_add_users = incoming_users - current_users
        to_remove_users = current_users - incoming_users

        for u in to_add_users:
            # Try to preserve any existing user data if a non-accounts backend
            # contained data under another namespace; otherwise create minimal.
            try:
                storage.save('accounts', u, {'email': u})
                logger.info('Created user account %s', u)
            except Exception:
                logger.exception('Failed to create user account %s', u)

        for u in to_remove_users:
            try:
                storage.delete('accounts', u)
                logger.info('Deleted user account %s', u)
            except KeyError:
                # already gone
                pass
            except Exception:
                logger.exception('Failed to delete user account %s', u)

        # --- Admins: add missing (copy from accounts if present), remove extra ---
        to_add_admins = incoming_admins - current_admins
        to_remove_admins = current_admins - incoming_admins

        for a in to_add_admins:
            try:
                # prefer to copy existing user payload to admin namespace
                try:
                    payload_obj = storage.load('accounts', a)
                except KeyError:
                    payload_obj = {'email': a}
                storage.save('accounts_admin', a, payload_obj)
                logger.info('Added admin account %s', a)
            except Exception:
                logger.exception('Failed to add admin account %s', a)

        for a in to_remove_admins:
            try:
                storage.delete('accounts_admin', a)
                logger.info('Removed admin account %s', a)
            except KeyError:
                pass
            except Exception:
                logger.exception('Failed to remove admin account %s', a)

        # If a user was removed, also remove admin marker if present
        for u in to_remove_users:
            try:
                storage.delete('accounts_admin', u)
            except Exception:
                pass

        return {'ok': True}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to save users/admins: %s', e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/admin/v1/system')
@require_admin_session
async def admin_save_system(request: Request):
    """Save edited system content; create a timestamped backup before overwrite."""
    try:
        payload = await request.json()
        content = payload.get('content', '')
        if not content:
            raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Empty content'})

        try:
            parsed = json.loads(content)
        except Exception as e:
            raise HTTPException(status_code=400, detail={'error': 'invalid_json', 'message': 'Content must be valid JSON', 'detail': str(e)})

        admin_svc = resolve_service(request, 'admin_service')
        storage = admin_svc._config_storage

        _backup_existing(storage, 'server_config', 'server_config')
        # Save parsed object under logical key 'server_config'
        storage.save('config', 'server_config', parsed)
        return {'ok': True}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to save system: %s', e)
        raise HTTPException(status_code=500, detail=str(e))
