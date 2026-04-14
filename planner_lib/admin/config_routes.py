"""Admin configuration CRUD route handlers.

Covers: projects, global-settings, iterations, area-mappings (CRUD +
refresh + toggle), teams, people (CRUD + inspect), schema, backup,
restore, cost (CRUD + inspect), and system.
"""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
import logging
import json

from planner_lib.middleware import require_admin_session
from planner_lib.services.resolver import resolve_service
from planner_lib.middleware.session import get_session_id_from_request as _get_session_id_or_raise
from planner_lib.admin import schema as admin_schema
from planner_lib.admin import cost_inspector
from planner_lib.admin import people_inspector
from planner_lib.admin import area_mapping_service

router = APIRouter()
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Private helper — kept for backward compatibility with existing tests
# ---------------------------------------------------------------------------

def _backup_existing(storage, key, backup_prefix=None):
    """Create a timestamped backup of *key* in the ``config`` namespace.

    Falls back to ``storage._backend.save`` when the primary
    ``storage.save`` raises (e.g. serialiser cannot handle raw bytes).
    Note: config CRUD via route handlers now delegates to ConfigManager;
    this helper is retained for isolated unit-test use.
    """
    try:
        existing = storage.load('config', key)
    except KeyError:
        return
    from datetime import datetime, timezone
    ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup_key = f"{(backup_prefix or key)}_backup_{ts}"
    try:
        storage.save('config', backup_key, existing)
    except Exception as e:
        logger.debug('storage.save backup failed for %s: %s; falling back to backend save', backup_key, e)
        backend = getattr(storage, '_backend', None)
        if backend is not None:
            try:
                backend.save('config', backup_key, existing)
            except Exception as e2:
                logger.exception('Backend save also failed for backup %s: %s', backup_key, e2)
        else:
            try:
                storage.save('config', backup_key, str(existing))
            except Exception:
                logger.exception('Failed to write backup %s', backup_key)


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

@router.get('/admin/v1/projects')
@require_admin_session
async def admin_get_projects(request: Request):
    """Return projects configuration as JSON."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        return {'content': admin_svc.get_config('projects', default='')}
    except Exception as e:
        logger.exception('Failed to load projects: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/projects')
@require_admin_session
async def admin_save_projects(request: Request):
    """Save edited projects configuration; creates a timestamped backup first."""
    try:
        payload = await request.json()
        content = payload.get('content', '')
        if not content:
            raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Empty content'})
        try:
            parsed = json.loads(content)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail={'error': 'invalid_json', 'message': 'Content is not valid JSON'})
        admin_svc = resolve_service(request, 'admin_service')
        admin_svc.save_config('projects', parsed)
        return {'ok': True}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to save projects: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


# ---------------------------------------------------------------------------
# Global settings
# ---------------------------------------------------------------------------

@router.get('/admin/v1/global-settings')
@require_admin_session
async def admin_get_global_settings(request: Request):
    """Return the server-wide global settings."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        return {'content': admin_svc.get_config('global_settings', default={'task_type_hierarchy': []})}
    except Exception as e:
        logger.exception('Failed to load global settings: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/global-settings')
@require_admin_session
async def admin_save_global_settings(request: Request):
    """Save server-wide global settings; creates a timestamped backup first."""
    try:
        payload = await request.json()
        content = payload.get('content')
        if content is None:
            raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Missing content'})
        admin_svc = resolve_service(request, 'admin_service')
        admin_svc.save_config('global_settings', content)
        return {'ok': True}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to save global settings: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


# ---------------------------------------------------------------------------
# Iterations
# ---------------------------------------------------------------------------

@router.get('/admin/v1/iterations')
@require_admin_session
async def admin_get_iterations(request: Request):
    """Return the iterations configuration as JSON."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        return {'content': admin_svc.get_config('iterations', default={'default_roots': [], 'project_overrides': {}})}
    except Exception as e:
        logger.exception('Failed to load iterations config: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/iterations')
@require_admin_session
async def admin_save_iterations(request: Request):
    """Save edited iterations configuration; creates a timestamped backup first."""
    try:
        payload = await request.json()
        content = payload.get('content', '')
        if content is None or content == '':
            raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Empty content'})
        admin_svc = resolve_service(request, 'admin_service')
        admin_svc.save_config('iterations', content)
        return {'ok': True}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to save iterations config: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/iterations/browse')
@require_admin_session
async def admin_browse_iterations(request: Request):
    """Browse iterations for a given Azure project.

    Payload: ``{ "project": "ProjectName", "root_path": "optional", "depth": 10 }``
    PAT is retrieved from the current session.
    """
    try:
        payload = await request.json()
        project = payload.get('project')
        if not project:
            raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Missing project'})

        root_path = payload.get('root_path')
        depth = payload.get('depth', 10)

        sid = _get_session_id_or_raise(request)
        session_mgr = resolve_service(request, 'session_manager')
        pat = session_mgr.get_val(sid, 'pat')
        if not pat:
            raise HTTPException(status_code=401, detail={'error': 'missing_pat', 'message': 'Personal Access Token required'})

        azure_svc = resolve_service(request, 'azure_client')
        with azure_svc.connect(pat) as client:
            iterations = client.get_iterations(project, root_path=root_path, depth=depth)

        return {'iterations': iterations}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to browse iterations: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


# ---------------------------------------------------------------------------
# Area mappings
# ---------------------------------------------------------------------------

@router.get('/admin/v1/area-mappings')
@require_admin_session
async def admin_get_area_mappings(request: Request):
    """Return the stored area→plan mapping from config storage."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        return {'content': admin_svc.get_config('area_plan_map', default={})}
    except Exception as e:
        logger.exception('Failed to load area mappings: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/area-mappings')
@require_admin_session
async def admin_save_area_mappings(request: Request):
    """Save edited area→plan mappings; creates a timestamped backup first."""
    try:
        payload = await request.json()
        content = payload.get('content', '')
        if not content:
            raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Empty content'})
        admin_svc = resolve_service(request, 'admin_service')
        admin_svc.save_config('area_plan_map', content)
        return {'ok': True}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to save area mappings: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/area-mapping/refresh')
@require_admin_session
async def admin_refresh_area_mapping(request: Request):
    """Resolve area→plan mapping for a single area_path via Azure and persist.

    Payload: ``{ "area_path": "Project\\\\Some\\\\Path" }``
    """
    try:
        payload = await request.json()
        area_path = payload.get('area_path')
        if not area_path or not isinstance(area_path, str):
            raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Missing or invalid area_path'})

        sid = _get_session_id_or_raise(request)
        session_mgr = resolve_service(request, 'session_manager')
        pat = session_mgr.get_val(sid, 'pat')
        azure_svc = resolve_service(request, 'azure_client')
        admin_svc = resolve_service(request, 'admin_service')
        try:
            return area_mapping_service.refresh_single(area_path, pat, azure_svc, admin_svc)
        except ValueError as e:
            raise HTTPException(status_code=400, detail={'error': 'invalid_request', 'message': str(e)})
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to refresh area mapping: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/area-mapping/refresh-all')
@require_admin_session
async def admin_refresh_all_area_mappings(request: Request):
    """Refresh mappings for all configured area_paths.  PAT from session."""
    try:
        sid = _get_session_id_or_raise(request)
        session_mgr = resolve_service(request, 'session_manager')
        pat = session_mgr.get_val(sid, 'pat')
        azure_svc = resolve_service(request, 'azure_client')
        admin_svc = resolve_service(request, 'admin_service')
        try:
            return area_mapping_service.refresh_all(pat, azure_svc, admin_svc)
        except ValueError as e:
            raise HTTPException(status_code=400, detail={'error': 'invalid_request', 'message': str(e)})
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to refresh all area mappings: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/area-mapping/toggle-plan')
@require_admin_session
async def admin_toggle_plan_enabled(request: Request):
    """Toggle the ``enabled`` flag of one plan inside an area mapping.

    Payload: ``{ "project_id", "area_path", "plan_id", "enabled" }``
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
        existing = admin_svc.get_config('area_plan_map') or {}

        proj_obj = existing.get(project_id)
        if not proj_obj or 'areas' not in proj_obj:
            raise HTTPException(status_code=404, detail={'error': 'not_found', 'message': 'Project not found'})

        area_obj = proj_obj['areas'].get(area_path)
        if not area_obj or 'plans' not in area_obj:
            raise HTTPException(status_code=404, detail={'error': 'not_found', 'message': 'Area not found'})

        plans = area_obj['plans']
        if not isinstance(plans, dict) or plan_id not in plans:
            raise HTTPException(status_code=404, detail={'error': 'not_found', 'message': 'Plan not found'})

        plans[plan_id]['enabled'] = bool(enabled)
        admin_svc.save_config_raw('area_plan_map', existing)

        return {'ok': True, 'plan_id': plan_id, 'enabled': enabled}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to toggle plan enabled state: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


# ---------------------------------------------------------------------------
# Teams
# ---------------------------------------------------------------------------

@router.get('/admin/v1/teams')
@require_admin_session
async def admin_get_teams(request: Request):
    """Return teams configuration as JSON."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        return {'content': admin_svc.get_config('teams', default='')}
    except Exception as e:
        logger.exception('Failed to load teams: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/teams')
@require_admin_session
async def admin_save_teams(request: Request):
    """Save teams configuration; invalidates cost cache on success."""
    try:
        payload = await request.json()
        content = payload.get('content', '')
        if not content:
            raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Empty content'})
        admin_svc = resolve_service(request, 'admin_service')
        admin_svc.save_config('teams', content)
        try:
            cost_service = resolve_service(request, 'cost_service')
            cost_service.invalidate_cache()
        except Exception as e:
            logger.warning('Failed to invalidate cost cache after teams save: %s', e)
        return {'ok': True}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to save teams: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


# ---------------------------------------------------------------------------
# People
# ---------------------------------------------------------------------------

@router.get('/admin/v1/people')
@require_admin_session
async def admin_get_people(request: Request):
    """Return people configuration as JSON."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        data = admin_svc.get_config('people')
        if data is None:
            import yaml
            data = yaml.safe_dump({'schema_version': 1, 'database_file': 'config/database.yaml', 'database': {'people': []}}, sort_keys=False)
        return {'content': data}
    except Exception as e:
        logger.exception('Failed to load people config: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/people')
@require_admin_session
async def admin_save_people(request: Request):
    """Save people configuration; reloads PeopleService and invalidates cost cache."""
    try:
        payload = await request.json()
        content = payload.get('content', '')
        if not content:
            raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Empty content'})
        admin_svc = resolve_service(request, 'admin_service')
        admin_svc.save_config('people', content)
        try:
            people_service = resolve_service(request, 'people_service')
            people_service.reload()
        except Exception as e:
            logger.warning('Failed to reload people service after save: %s', e)
        try:
            cost_service = resolve_service(request, 'cost_service')
            cost_service.invalidate_cache()
        except Exception as e:
            logger.warning('Failed to invalidate cost cache after people save: %s', e)
        return {'ok': True}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to save people config: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.get('/admin/v1/people/inspect')
@require_admin_session
async def admin_inspect_people(request: Request):
    """Inspect people data grouped by team; delegates to people_inspector."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        people_svc = resolve_service(request, 'people_service')
        team_svc = resolve_service(request, 'team_service')
        return people_inspector.inspect(admin_svc, people_svc, team_svc)
    except Exception as e:
        logger.exception('Failed to inspect people data: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

@router.get('/admin/v1/schema/{config_type}')
@require_admin_session
async def admin_get_schema(request: Request, config_type: str):
    """Return JSON Schema for a configuration type.  Delegates to admin_schema module."""
    schema = admin_schema.get_schema(config_type)
    if schema is None:
        raise HTTPException(status_code=404, detail={'error': 'unknown_schema', 'message': f'No schema defined for {config_type}'})
    if config_type == 'projects':
        try:
            sid = _get_session_id_or_raise(request)
            session_mgr = resolve_service(request, 'session_manager')
            pat = session_mgr.get_val(sid, 'pat')
            if pat:
                azure_svc = resolve_service(request, 'azure_client')
                admin_svc = resolve_service(request, 'admin_service')
                admin_schema.enrich_projects_schema(schema, azure_client=azure_svc, pat=pat, admin_svc=admin_svc)
        except Exception as e:
            logger.warning('Failed to enrich projects schema: %s', e)
    return schema


# ---------------------------------------------------------------------------
# Backup / Restore
# ---------------------------------------------------------------------------

@router.get('/admin/v1/backup')
@require_admin_session
async def admin_get_backup(request: Request):
    """Return a backup snapshot of all configuration and data."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        return JSONResponse(content=admin_svc.get_backup())
    except Exception as e:
        logger.exception('Failed to create backup: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/restore')
@require_admin_session
async def admin_restore_backup(request: Request):
    """Restore data from a backup payload."""
    try:
        payload = await request.json()
        admin_svc = resolve_service(request, 'admin_service')
        sid = _get_session_id_or_raise(request)
        session_mgr = resolve_service(request, 'session_manager')
        current_user_email = session_mgr.get_val(sid, 'email')
        result = admin_svc.restore_backup(payload, current_user_email)
        return JSONResponse(content=result)
    except ValueError as e:
        logger.info('Restore backup rejected: %s', e)
        raise HTTPException(status_code=400, detail={'error': 'restore_rejected', 'message': str(e)})
    except Exception as e:
        logger.exception('Failed to restore backup: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


# ---------------------------------------------------------------------------
# Cost
# ---------------------------------------------------------------------------

@router.get('/admin/v1/cost')
@require_admin_session
async def admin_get_cost(request: Request):
    """Return cost configuration as JSON."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        data = admin_svc.get_config('cost_config')
        return {'content': data if data is not None else ''}
    except Exception as e:
        logger.exception('Failed to load cost config: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.get('/admin/v1/cost/inspect')
@require_admin_session
async def admin_inspect_cost(request: Request):
    """Inspect team/cost matching for debugging.  Delegates to cost_inspector."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        people_service = resolve_service(request, 'people_service')
        team_service = resolve_service(request, 'team_service')
        return cost_inspector.inspect(admin_svc, people_service, team_service)
    except Exception as e:
        logger.exception('Failed to inspect cost configuration: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/cost')
@require_admin_session
async def admin_save_cost(request: Request):
    """Save cost configuration."""
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Expecting JSON body'})
    content = payload.get('content')
    if content is None:
        raise HTTPException(status_code=400, detail={'error': 'missing_content', 'message': 'Payload must include content field'})
    try:
        admin_svc = resolve_service(request, 'admin_service')
        admin_svc.save_config('cost_config', content)
        return {'ok': True}
    except Exception as e:
        logger.exception('Failed to save cost config: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


# ---------------------------------------------------------------------------
# System
# ---------------------------------------------------------------------------

@router.get('/admin/v1/system')
@require_admin_session
async def admin_get_system(request: Request):
    """Return the server configuration (system.yml) as JSON."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        return {'content': admin_svc.get_config('server_config', default='')}
    except Exception as e:
        logger.exception('Failed to load system: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/system')
@require_admin_session
async def admin_save_system(request: Request):
    """Save server configuration; triggers a config reload on success."""
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Expecting JSON body'})
    content = payload.get('content', '')
    if not content:
        raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Empty content'})
    try:
        admin_svc = resolve_service(request, 'admin_service')
        admin_svc.save_config('server_config', content)
        try:
            admin_svc.reload_config()
        except Exception as e:
            logger.exception('Failed to reload configuration after saving system: %s', e)
        return {'ok': True}
    except Exception as e:
        logger.exception('Failed to save system: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')
