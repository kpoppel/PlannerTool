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
from planner_lib.util import slugify

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



@router.get('/admin/v1/iterations')
@require_admin_session
async def admin_get_iterations(request: Request):
    """Return the contents of `data/config/iterations.yml` as JSON."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        storage = admin_svc._config_storage
        try:
            data = storage.load('config', 'iterations')
            if isinstance(data, (bytes, bytearray)):
                return {'content': data.decode('utf-8')}
            return {'content': data}
        except KeyError:
            return {'content': {'default_roots': [], 'project_overrides': {}}}
    except Exception as e:
        logger.exception('Failed to load iterations config: %s', e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/admin/v1/iterations')
@require_admin_session
async def admin_save_iterations(request: Request):
    """Save edited iterations config; create a timestamped backup before overwrite."""
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

        _backup_existing(storage, 'iterations', 'iterations')
        storage.save('config', 'iterations', parsed)
        return { 'ok': True }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to save iterations config: %s', e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/admin/v1/iterations/browse')
@require_admin_session
async def admin_browse_iterations(request: Request):
    """Browse iterations for a given project and optional root path.
    
    Payload: { "project": "ProjectName", "root_path": "optional path", "depth": 10 }
    PAT is retrieved from the current session.
    
    Returns: { "iterations": [ { "path": ..., "name": ..., "startDate": ..., "finishDate": ... } ] }
    """
    try:
        payload = await request.json()
        project = payload.get('project')
        if not project:
            raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Missing project'})
        
        root_path = payload.get('root_path')
        depth = payload.get('depth', 10)
        
        # Get PAT from session
        sid = _get_session_id_or_raise(request)
        session_mgr = resolve_service(request, 'session_manager')
        pat = session_mgr.get_val(sid, 'pat')
        if not pat:
            raise HTTPException(status_code=401, detail={'error': 'missing_pat', 'message': 'Personal Access Token required'})
        
        # Connect to Azure and fetch iterations
        azure_svc = resolve_service(request, 'azure_client')
        with azure_svc.connect(pat) as client:
            iterations = client.get_iterations(project, root_path=root_path, depth=depth)
        
        return {'iterations': iterations}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to browse iterations: %s', e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/admin/v1/area-mappings')
@require_admin_session
async def admin_get_area_mappings(request: Request):
    """Return the stored area->plan mapping from config storage."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        storage = admin_svc._config_storage
        try:
            data = storage.load('config', 'area_plan_map')
            if isinstance(data, (bytes, bytearray)):
                return {'content': data.decode('utf-8')}
            return {'content': data}
        except KeyError:
            return {'content': {}}
    except Exception as e:
        logger.exception('Failed to load area mappings: %s', e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/admin/v1/area-mappings')
@require_admin_session
async def admin_save_area_mappings(request: Request):
    """Save edited area->plan mappings; create a timestamped backup before overwrite."""
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

        _backup_existing(storage, 'area_plan_map', 'area_plan_map')
        storage.save('config', 'area_plan_map', parsed)
        return { 'ok': True }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to save area mappings: %s', e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/admin/v1/area-mapping/refresh')
@require_admin_session
async def admin_refresh_area_mapping(request: Request):
    """Resolve area->plan mapping for a single `area_path` using Azure and persist it.

    Payload: { "area_path": "Project\\Some\\Path" }
    PAT is retrieved from the current session.
    """
    try:
        payload = await request.json()
        area_path = payload.get('area_path')
        if not area_path or not isinstance(area_path, str):
            raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Missing or invalid area_path'})

        # Get PAT from session
        sid = _get_session_id_or_raise(request)
        session_mgr = resolve_service(request, 'session_manager')
        pat = session_mgr.get_val(sid, 'pat')

        # Use the composed AzureService to connect and resolve area->team->plan mapping
        azure_svc = resolve_service(request, 'azure_client')
        try:
            with azure_svc.connect(pat) as client:
                # Get Azure project from area_path
                project_name = area_path.split('\\')[0] if '\\' in area_path else area_path.split('/')[0]
                
                # Step 1: Find teams that own this area path
                owner_team_ids = client.get_team_from_area_path(project_name, area_path)  # type: ignore
                logger.info(f'Found {len(owner_team_ids)} teams owning area {area_path}: {owner_team_ids}')
                
                if not owner_team_ids:
                    logger.warning(f'No teams found for area path: {area_path}')
                
                # Step 2: Get all plans for the project (includes team membership)
                all_plans = client.get_all_plans(project_name)  # type: ignore
                logger.info(f'Found {len(all_plans)} total plans in project {project_name}')
                
                # Step 3: Filter plans that contain any of the owner teams
                plan_dict = {}
                for plan in all_plans:
                    plan_id = plan.get('id')
                    plan_name = plan.get('name')
                    plan_teams = plan.get('teams', [])
                    
                    if not plan_id:
                        continue
                    
                    # Check if any team in this plan matches our owner teams
                    for team in plan_teams:
                        team_id = team.get('id') if isinstance(team, dict) else str(team)
                        if team_id in owner_team_ids:
                            plan_dict[str(plan_id)] = plan_name or str(plan_id)
                            logger.info(f'Plan {plan_name} ({plan_id}) matched via team {team_id}')
                            break
                
                logger.info(f'Found {len(plan_dict)} plans associated with area {area_path}')
                
        except Exception as e:
            logger.exception('Azure mapping resolution failed for %s: %s', area_path, e)
            raise HTTPException(status_code=500, detail=str(e))

        # Determine project id for this area_path using configured projects
        admin_svc = resolve_service(request, 'admin_service')
        project_map = admin_svc._project_service.get_project_map()

        project_id = None
        # Prefer exact configured match or prefix match
        for p in project_map:
            try:
                cfg_area = p.get('area_path')
                if not cfg_area:
                    continue
                if area_path == cfg_area or area_path.startswith(cfg_area + '\\') or cfg_area.startswith(area_path + '\\'):
                    project_id = p.get('id')
                    break
            except Exception:
                continue

        # Fallback: derive project name from the area_path root and map to project id
        if project_id is None:
            root = area_path.split('\\')[0] if '\\' in area_path else area_path.split('/')[0]
            for p in project_map:
                try:
                    if slugify(p.get('name', ''), prefix='project-') == slugify(root, prefix='project-'):
                        project_id = p.get('id')
                        break
                except Exception:
                    continue

        if not project_id:
            raise HTTPException(status_code=400, detail={'error': 'unknown_project', 'message': 'Could not determine project for area_path'})

        # Persist mapping under project id
        storage = admin_svc._config_storage
        if storage.exists('config', 'area_plan_map'):
            existing = storage.load('config', 'area_plan_map') or {}
        else:
            existing = {}

        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        
        # Update or create project entry
        proj_obj = existing.get(project_id) or {'areas': {}}
        proj_obj.setdefault('areas', {})
        
        # Preserve existing enabled states or default to True
        old_plans = proj_obj['areas'].get(area_path, {}).get('plans', {})
        new_plans = {}
        for pid, pname in plan_dict.items():
            # If plan already exists, preserve its enabled state
            if isinstance(old_plans, dict) and pid in old_plans:
                new_plans[pid] = {
                    'name': pname,
                    'enabled': old_plans[pid].get('enabled', True)
                }
            else:
                # New plan, default to enabled
                new_plans[pid] = {
                    'name': pname,
                    'enabled': True
                }
        
        proj_obj['areas'][area_path] = {'plans': new_plans}
        existing[project_id] = proj_obj
        
        # Store global last_update at root level
        existing['last_update'] = now
        
        try:
            storage.save('config', 'area_plan_map', existing)
        except Exception as e:
            logger.exception('Failed to persist area->plan mapping for %s (project %s): %s', area_path, project_id, e)
            raise HTTPException(status_code=500, detail=str(e))

        return {'ok': True, 'project_id': project_id, 'area_path': area_path, 'plans': new_plans, 'last_update': now}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to refresh area mapping: %s', e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/admin/v1/area-mapping/refresh-all')
@require_admin_session
async def admin_refresh_all_area_mappings(request: Request):
    """Refresh mappings for all configured projects/area_paths from server config.

    PAT is retrieved from the current session.
    """
    try:
        # Get PAT from session
        sid = _get_session_id_or_raise(request)
        session_mgr = resolve_service(request, 'session_manager')
        pat = session_mgr.get_val(sid, 'pat')
        
        if not pat:
            raise HTTPException(status_code=400, detail={'error': 'missing_pat', 'message': 'A PAT is required to query Azure for mappings'})

        admin_svc = resolve_service(request, 'admin_service')
        project_map = admin_svc._project_service.get_project_map() or []
        storage = admin_svc._config_storage
        if storage.exists('config', 'area_plan_map'):
            existing = storage.load('config', 'area_plan_map') or {}
        else:
            existing = {}

        azure_svc = resolve_service(request, 'azure_client')
        with azure_svc.connect(pat) as client:
            # Build project -> plans cache
            project_plans = {}
            for entry in project_map:
                area = entry.get('area_path')
                if not area:
                    continue
                proj_name = area.split('\\')[0] if '\\' in area else area.split('/')[0]
                if proj_name not in project_plans:
                    try:
                        plans = client.get_all_plans(proj_name)  # type: ignore
                        project_plans[proj_name] = plans
                        logger.info(f'Fetched {len(plans)} plans for {proj_name}, first plan has teams: {plans[0].get("teams") if plans else "N/A"}')
                    except Exception as e:
                        logger.warning(f'Failed to fetch plans for {proj_name}: {e}')
                        project_plans[proj_name] = []
            
            # Match areas to plans via team ownership
            results = {}
            for entry in project_map:
                area = entry.get('area_path')
                proj_id = entry.get('id')
                if not area or not proj_id:
                    continue
                
                proj_name = area.split('\\')[0] if '\\' in area else area.split('/')[0]
                all_plans = project_plans.get(proj_name, [])
                
                try:
                    owner_team_ids = client.get_team_from_area_path(proj_name, area)  # type: ignore
                except Exception as e:
                    results[area] = {'ok': False, 'error': str(e)}
                    continue
                
                # Match plans by team membership
                matched = {}
                for plan in all_plans:
                    if any(t.get('id') in owner_team_ids for t in plan.get('teams', [])):
                        matched[str(plan['id'])] = plan['name']
                
                logger.info(f'Area {area}: found {len(owner_team_ids)} teams, matched {len(matched)} plans')
                
                # Preserve enabled states
                old_plans = existing.get(proj_id, {}).get('areas', {}).get(area, {}).get('plans', {})
                new_plans = {
                    pid: {
                        'name': pname,
                        'enabled': old_plans.get(pid, {}).get('enabled', True) if isinstance(old_plans, dict) else True
                    }
                    for pid, pname in matched.items()
                }
                
                results[area] = {'ok': True, 'plans': new_plans, 'project_id': proj_id}
                if proj_id not in existing:
                    existing[proj_id] = {'areas': {}}
                if 'areas' not in existing[proj_id]:
                    existing[proj_id]['areas'] = {}
                existing[proj_id]['areas'][area] = {'plans': new_plans}

        # Save mappings with timestamp
        from datetime import datetime, timezone
        existing['last_update'] = datetime.now(timezone.utc).isoformat()
        storage.save('config', 'area_plan_map', existing)

        return {'ok': True, 'results': results}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f'Failed to refresh all area mappings: {e}')
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/admin/v1/area-mapping/toggle-plan')
@require_admin_session
async def admin_toggle_plan_enabled(request: Request):
    """Toggle the enabled state of a specific plan in an area mapping.
    
    Payload: {
        "project_id": "project-name",
        "area_path": "Project\\Area\\Path",
        "plan_id": "uuid",
        "enabled": true/false
    }
    """
    try:
        payload = await request.json()
        project_id = payload.get('project_id')
        area_path = payload.get('area_path')
        plan_id = payload.get('plan_id')
        enabled = payload.get('enabled')
        
        if not all([project_id, area_path, plan_id]) or enabled is None:
            raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Missing required fields'})
        
        admin_svc = resolve_service(request, 'admin_service')
        storage = admin_svc._config_storage
        
        if storage.exists('config', 'area_plan_map'):
            existing = storage.load('config', 'area_plan_map') or {}
        else:
            existing = {}
        
        # Navigate to the specific plan
        proj_obj = existing.get(project_id)
        if not proj_obj or 'areas' not in proj_obj:
            raise HTTPException(status_code=404, detail={'error': 'not_found', 'message': 'Project not found'})
        
        area_obj = proj_obj['areas'].get(area_path)
        if not area_obj or 'plans' not in area_obj:
            raise HTTPException(status_code=404, detail={'error': 'not_found', 'message': 'Area not found'})
        
        plans = area_obj['plans']
        if not isinstance(plans, dict) or plan_id not in plans:
            raise HTTPException(status_code=404, detail={'error': 'not_found', 'message': 'Plan not found'})
        
        # Update enabled state
        plans[plan_id]['enabled'] = bool(enabled)
        
        try:
            storage.save('config', 'area_plan_map', existing)
        except Exception as e:
            logger.exception('Failed to save area_plan_map after toggle: %s', e)
            raise HTTPException(status_code=500, detail=str(e))
        
        return {'ok': True, 'plan_id': plan_id, 'enabled': enabled}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to toggle plan enabled state: %s', e)
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


@router.get('/admin/v1/schema/{config_type}')
@require_admin_session
async def admin_get_schema(request: Request, config_type: str):
    """Return JSON schema for a given configuration type.
    
    Supported types: system, projects, teams, area_mappings
    Returns a JSON Schema that describes the structure, types, and constraints.
    """
    schemas = {
        'system': {
            'type': 'object',
            'title': 'Server Configuration',
            'description': 'Core server settings and feature flags',
            'properties': {
                'server_name': {
                    'type': 'string',
                    'title': 'Server Name',
                    'description': 'Unique identifier for this server instance',
                    'minLength': 1
                },
                'azure_devops_organization': {
                    'type': 'string',
                    'title': 'Azure DevOps Organization',
                    'description': 'Organization name in Azure DevOps',
                    'minLength': 1
                },
                'database_path': {
                    'type': 'string',
                    'title': 'Database Path',
                    'description': 'Filesystem path to database storage',
                    'minLength': 1
                },
                'log_level': {
                    'type': 'string',
                    'title': 'Log Level',
                    'description': 'Logging verbosity level',
                    'enum': ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'],
                    'default': 'INFO'
                },
                'feature_flags': {
                    'type': 'object',
                    'title': 'Feature Flags',
                    'description': 'Toggle experimental or optional features',
                    'properties': {
                        'enable_azure_cache': {
                            'type': 'boolean',
                            'title': 'Enable Azure Cache',
                            'description': 'Cache Azure DevOps API responses',
                            'default': True
                        },
                        'enable_brotli_middleware': {
                            'type': 'boolean',
                            'title': 'Enable Brotli Compression',
                            'description': 'Compress HTTP responses with Brotli',
                            'default': True
                        },
                        'enable_history_plugin': {
                            'type': 'boolean',
                            'title': 'Enable History Plugin',
                            'description': 'Track work item history changes',
                            'default': False
                        }
                    },
                    'additionalProperties': {
                        'type': 'boolean'
                    }
                }
            },
            'required': ['server_name', 'azure_devops_organization']
        },
        'projects': {
            'type': 'object',
            'title': 'Project Configuration',
            'description': 'Map projects to Azure DevOps area paths',
            'properties': {
                'project_map': {
                    'type': 'array',
                    'title': 'Project Mappings',
                    'items': {
                        'type': 'object',
                        'properties': {
                            'name': {
                                'type': 'string',
                                'title': 'Project Name',
                                'minLength': 1
                            },
                            'area_path': {
                                'type': 'string',
                                'title': 'Area Path',
                                'description': 'Azure DevOps area path (e.g., Project\\Team)',
                                'minLength': 1
                            },
                            'type': {
                                'type': 'string',
                                'title': 'Type',
                                'enum': ['project', 'team'],
                                'default': 'project'
                            },
                            'task_types': {
                                'type': 'array',
                                'title': 'Work Item Types',
                                'description': 'Types of work items to include',
                                'items': {
                                    'type': 'string',
                                    'enum': ['feature', 'epic', 'user story', 'task', 'bug']
                                },
                                'default': ['feature', 'epic']
                            },
                            'include_states': {
                                'type': 'array',
                                'title': 'Work Item States',
                                'description': 'States of work items to include',
                                'items': {
                                    'type': 'string'
                                },
                                'default': ['new', 'active', 'defined', 'resolved']
                            }
                        },
                        'required': ['name', 'area_path']
                    }
                }
            },
            'required': ['project_map']
        },
        'teams': {
            'type': 'object',
            'title': 'Team Configuration',
            'description': 'Team definitions with names and short identifiers',
            'properties': {
                'team_map': {
                    'type': 'array',
                    'title': 'Team Mappings',
                    'description': 'List of teams with their identifiers',
                    'items': {
                        'type': 'object',
                        'properties': {
                            'name': {
                                'type': 'string',
                                'title': 'Team Name',
                                'description': 'Full team name',
                                'minLength': 1
                            },
                            'short_name': {
                                'type': 'string',
                                'title': 'Short Name',
                                'description': 'Abbreviated team identifier (2-4 characters)',
                                'minLength': 2
                            }
                        },
                        'required': ['name', 'short_name']
                    }
                }
            },
            'required': ['team_map']
        },
        'area_mappings': {
            'type': 'object',
            'title': 'Area to Plan Mappings',
            'description': 'Map Azure DevOps area paths to delivery plans',
            'additionalProperties': {
                'type': 'object',
                'properties': {
                    'areas': {
                        'type': 'object',
                        'additionalProperties': {
                            'type': 'object',
                            'properties': {
                                'plans': {
                                    'type': 'array',
                                    'items': {
                                        'type': 'string'
                                    }
                                },
                                'last_update': {
                                    'type': 'string',
                                    'format': 'date-time'
                                }
                            }
                        }
                    },
                    'last_update': {
                        'type': 'string',
                        'format': 'date-time'
                    }
                }
            }
        },
        'cost': {
            'type': 'object',
            'title': 'Cost Configuration',
            'description': 'Working hours and hourly rates per site',
            'properties': {
                'schema_version': {
                    'type': 'integer',
                    'title': 'Schema Version',
                    'description': 'Configuration schema version (read-only)',
                    'default': 1,
                    'minimum': 1,
                    'readOnly': True
                },
                'working_hours': {
                    'type': 'object',
                    'title': 'Working Hours by Site',
                    'description': 'Monthly working hours (internal/external) per site',
                    'patternProperties': {
                        '^[A-Z]+$': {
                            'type': 'object',
                            'title': 'Site',
                            'properties': {
                                'internal': {
                                    'type': 'integer',
                                    'title': 'Internal Hours',
                                    'description': 'Monthly hours for internal staff',
                                    'minimum': 0,
                                    'default': 160
                                },
                                'external': {
                                    'type': 'integer',
                                    'title': 'External Hours',
                                    'description': 'Monthly hours for external contractors',
                                    'minimum': 0,
                                    'default': 160
                                }
                            },
                            'required': ['internal', 'external']
                        }
                    },
                    'additionalProperties': False
                },
                'internal_cost': {
                    'type': 'object',
                    'title': 'Internal Cost',
                    'description': 'Default hourly rate for internal staff',
                    'properties': {
                        'default_hourly_rate': {
                            'type': 'number',
                            'title': 'Default Hourly Rate',
                            'description': 'Default rate for internal staff (EUR/hour)',
                            'minimum': 0
                        }
                    },
                    'required': ['default_hourly_rate']
                },
                'external_cost': {
                    'type': 'object',
                    'title': 'External Cost',
                    'description': 'Hourly rates for external contractors',
                    'properties': {
                        'default_hourly_rate': {
                            'type': 'number',
                            'title': 'Default Hourly Rate',
                            'description': 'Default rate for external contractors (EUR/hour)',
                            'minimum': 0
                        },
                        'external': {
                            'type': 'object',
                            'title': 'Named Contractor Rates',
                            'description': 'Specific hourly rates for named contractors',
                            'patternProperties': {
                                '.*': {
                                    'type': 'number',
                                    'title': 'Hourly Rate',
                                    'minimum': 0
                                }
                            },
                            'additionalProperties': False
                        }
                    },
                    'required': ['default_hourly_rate']
                }
            },
            'required': ['schema_version', 'working_hours', 'internal_cost', 'external_cost']
        }
    }
    
    schema = schemas.get(config_type)
    if not schema:
        raise HTTPException(status_code=404, detail={'error': 'unknown_schema', 'message': f'No schema defined for {config_type}'})
    
    return schema


@router.get('/admin/v1/cost')
@require_admin_session
async def admin_get_cost(request: Request):
    """Return the raw contents of `data/config/cost_config.yml` as text, pretty-printed when possible.""" 
    try:
        admin_svc = resolve_service(request, 'admin_service')
        storage = admin_svc._config_storage
        try:
            data = storage.load('config', 'cost_config')
        except Exception:
            data = None
        if data is None:
            return {'content': ''}
        if isinstance(data, (dict, list)):
            return {'content': data}
        return {'content': str(data)}
    except Exception as e:
        logger.exception('Failed to load cost config: %s', e)
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


@router.post('/admin/v1/cost')
@require_admin_session
async def admin_save_cost(request: Request):
    """Save cost configuration to data/config/cost_config.yml."""
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Expecting JSON body'})

    content = payload.get('content')
    if content is None:
        raise HTTPException(status_code=400, detail={'error': 'missing_content', 'message': 'Payload must include content field'})

    try:
        admin_svc = resolve_service(request, 'admin_service')
        storage = admin_svc._config_storage
        _backup_existing(storage, 'cost_config', 'cost_config')
        storage.save('config', 'cost_config', content)
        return {'ok': True}
    except Exception as e:
        logger.exception('Failed to save cost config: %s', e)
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
