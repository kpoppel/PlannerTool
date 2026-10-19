"""Admin configuration CRUD route handlers.

Covers: projects, global-settings, iterations, area-mappings (CRUD +
refresh + toggle), schema, backup, restore, system, ado (Azure DevOps config), and
events-config (event backend selection).
"""
import asyncio
from datetime import datetime, timezone
from planner_lib.backend.errors import AreaNotReadableError, BackendAuthError, BackendUnavailableError

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
import logging

from planner_lib.middleware import require_admin_session
from planner_lib.middleware.admin import has_admin_access, require_permission
from planner_lib.accounts.constants import AccountPermissions
from planner_lib.services.resolver import resolve_service
from planner_lib.middleware.session import (
    get_session_context_from_request, get_session_credentials_from_request,
)
from planner_lib.admin import schema as admin_schema
from planner_lib.admin import area_mapping_service
from planner_lib.admin.plugin_runtime_config import normalize_plugin_runtime_config
from planner_lib.azure.catalogue import CatalogueError, validate_display

router = APIRouter()
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

@router.get('/admin/v1/projects')
@require_permission(AccountPermissions.MANAGE_PROJECTS, AccountPermissions.MANAGE_ITERATIONS)
async def admin_get_projects(request: Request):
    """Return projects configuration as JSON."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        return {'content': admin_svc.get_config('projects', default='')}
    except Exception as e:
        logger.exception('Failed to load projects: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/projects')
@require_permission(AccountPermissions.MANAGE_PROJECTS)
async def admin_save_projects(request: Request):
    """Save edited projects configuration; creates a timestamped backup first."""
    try:
        payload = await request.json()
        content = payload.get('content', None)
        if content is None:
            raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Empty content'})

        if not isinstance(content, dict):
            raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Unsupported content type'})

        types = content.get('container_types')
        plans = content.get('project_map')
        if (not isinstance(types, list) or not types or
                any(not isinstance(item, str) or not item.strip() for item in types) or
                len(types) != len({item.casefold() for item in types}) or
                not isinstance(plans, list) or
                any(not isinstance(plan, dict) or plan.get('type') not in types
                    for plan in plans)):
            raise HTTPException(status_code=400, detail={
                'error': 'invalid_container_hierarchy',
                'message': 'Container types must be unique and include every plan type',
            })

        admin_svc = resolve_service(request, 'admin_service')
        admin_svc.save_plans(content, payload.get('process_imports', {}))

        return {'ok': True}
    except HTTPException:
        raise
    except CatalogueError as error:
        raise HTTPException(status_code=400, detail={
            'error': error.code, 'message': str(error),
        }) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail={
            'error': 'invalid_allocation_availability', 'message': str(error),
        }) from error
    except Exception as e:
        logger.exception('Failed to save projects: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


# ---------------------------------------------------------------------------
# Global settings
# ---------------------------------------------------------------------------

@router.post('/admin/v1/projects/{plan_id}/refresh')
@require_permission(AccountPermissions.MANAGE_PROJECTS)
async def admin_refresh_plan(request: Request, plan_id: str):
    admin_svc = resolve_service(request, 'admin_service')
    plans = admin_svc.get_config('projects')['project_map']
    plan = next((entry for entry in plans if entry['id'] == plan_id), None)
    if plan is None:
        raise HTTPException(status_code=404, detail={'error': 'plan_not_found', 'plan_id': plan_id})
    if plan.get('archived') is True:
        raise HTTPException(status_code=400, detail={'error': 'plan_archived', 'plan_id': plan_id})
    context = get_session_credentials_from_request(request)
    credential = {'token': context['pat'], 'user_id': context['account_id']}
    repository = resolve_service(request, 'task_repository')
    try:
        tasks = await asyncio.to_thread(repository.rebuild_now, credential)
    except CatalogueError as error:
        raise HTTPException(status_code=409, detail={
            'error': error.code, 'message': str(error), 'plan_id': plan_id,
        }) from error
    except AreaNotReadableError as error:
        raise HTTPException(status_code=403, detail={
            'error': 'area_not_readable', 'message': str(error), 'plan_id': plan_id,
        }) from error
    except BackendUnavailableError as error:
        raise HTTPException(status_code=503, detail={
            'error': 'backend_unavailable', 'message': str(error), 'plan_id': plan_id,
        }) from error
    return {'plan_id': plan_id,
            'item_count': sum(plan_id in task['presentationPlanIds'] for task in tasks),
            'completed_at': datetime.now(timezone.utc).isoformat()}

@router.get('/admin/v1/global-settings')
@require_permission(AccountPermissions.MANAGE_PROJECTS)
async def admin_get_global_settings(request: Request):
    """Return the server-wide global settings."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        return {'content': admin_svc.get_config('global_settings')}
    except Exception as e:
        logger.exception('Failed to load global settings: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/global-settings')
@require_permission(AccountPermissions.MANAGE_PROJECTS)
async def admin_save_global_settings(request: Request):
    """Save server-wide global settings; creates a timestamped backup first."""
    try:
        payload = await request.json()
        content = payload.get('content')
        if content is None:
            raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Missing content'})
        admin_svc = resolve_service(request, 'admin_service')
        validated = validate_display(admin_svc.get_ado_processes(), content)
        admin_svc.save_config('global_settings', validated)
        return {'ok': True}
    except HTTPException:
        raise
    except CatalogueError as error:
        raise HTTPException(status_code=400, detail={
            'error': error.code, 'message': str(error),
        }) from error
    except Exception as e:
        logger.exception('Failed to save global settings: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


# ---------------------------------------------------------------------------
# Iterations
# ---------------------------------------------------------------------------


def _normalize_iterations_content(raw: object) -> dict:
    """Normalize persisted iterations config to ``{'iteration_sets': [...]}``."""
    if isinstance(raw, dict) and isinstance(raw.get('iteration_sets'), list):
        return {'iteration_sets': raw.get('iteration_sets') or []}

    return {'iteration_sets': []}


def _validate_iteration_set_payload(content: object) -> dict:
    """Validate provider-neutral snapshots at the API boundary."""
    from planner_lib.domain.iteration_sets import validate_iteration_sets

    try:
        return validate_iteration_sets(content)
    except (ValueError, TypeError, KeyError, OverflowError) as error:
        raise HTTPException(status_code=400, detail={
            'error': 'invalid_payload', 'message': f'Invalid iteration data or dates: {error}',
        }) from error

@router.get('/admin/v1/iterations')
@require_permission(AccountPermissions.MANAGE_ITERATIONS, AccountPermissions.MANAGE_PROJECTS)
async def admin_get_iterations(request: Request):
    """Return the iterations configuration as JSON."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        cfg = admin_svc.get_config('iterations', default={'iteration_sets': []})
        projects = admin_svc.get_config('projects', default={'project_map': []})
        usage = {}
        for project in projects['project_map']:
            association = project.get('iteration_uuid')
            if association:
                usage.setdefault(association, []).append({'id': project.get('id'), 'name': project['name']})
        return {'content': {**_normalize_iterations_content(cfg), 'usage': usage}}
    except Exception as e:
        logger.exception('Failed to load iterations config: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/iterations')
@require_permission(AccountPermissions.MANAGE_ITERATIONS)
async def admin_save_iterations(request: Request):
    """Save edited iterations configuration; creates a timestamped backup first."""
    try:
        payload = await request.json()
        content = payload.get('content', None)
        if content is None:
            raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Missing content'})

        normalized_content = _validate_iteration_set_payload(content)
        admin_svc = resolve_service(request, 'admin_service')
        ids = {item['id'] for item in normalized_content['iteration_sets']}
        projects = admin_svc.get_config('projects', default={'project_map': []})
        referenced = [project for project in projects['project_map']
                      if project.get('iteration_uuid') and project['iteration_uuid'] not in ids]
        if referenced:
            raise HTTPException(status_code=409, detail={
                'error': 'referenced_by_projects',
                'message': 'Reassign plans before removing their iteration set',
            })
        current = admin_svc.get_config('iterations', default={'iteration_sets': []})
        previous = {item['id']: item for item in current['iteration_sets']}
        for item in normalized_content['iteration_sets']:
            old = previous.get(item['id'])
            if old is not None and (old['source_type'], old.get('source_project')) != (item['source_type'], item['source_project']):
                raise HTTPException(status_code=400, detail={
                    'error': 'immutable_source', 'message': 'Create a new set to use a different source',
                })
        admin_svc.save_config('iterations', normalized_content)
        return {'ok': True}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to save iterations config: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.delete('/admin/v1/iterations/{set_id}')
@require_permission(AccountPermissions.MANAGE_ITERATIONS)
async def admin_delete_iteration_set(request: Request, set_id: str):
    """Delete one iteration set by id, blocked when still referenced by projects."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        cfg = _normalize_iterations_content(admin_svc.get_config('iterations', default={'iteration_sets': []}))
        sets = cfg.get('iteration_sets') or []

        found = False
        next_sets = []
        for it in sets:
            if str(it.get('id')) == set_id:
                found = True
                continue
            next_sets.append(it)
        if not found:
            raise HTTPException(status_code=404, detail={'error': 'not_found', 'message': 'Iteration set not found'})

        projects_cfg = admin_svc.get_config('projects', default={'project_map': []}) or {}
        project_map = projects_cfg.get('project_map') if isinstance(projects_cfg, dict) else []
        if not isinstance(project_map, list):
            project_map = []

        referenced = []
        for p in project_map:
            if not isinstance(p, dict):
                continue
            if str(p.get('iteration_uuid') or '') == set_id:
                referenced.append({'id': p.get('id'), 'name': p.get('name')})

        if referenced:
            raise HTTPException(
                status_code=409,
                detail={
                    'error': 'referenced_by_projects',
                    'message': 'Iteration set is currently associated to one or more projects',
                    'projects': referenced,
                },
            )

        admin_svc.save_config('iterations', {'iteration_sets': next_sets})
        return {'ok': True, 'deleted': set_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to delete iteration set %s: %s', set_id, e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/iterations/{set_id}/unassociate-all')
@require_permission(AccountPermissions.MANAGE_ITERATIONS)
async def admin_unassociate_all_iterations(request: Request, set_id: str):
    """Clear all project associations to ``set_id`` by nulling ``iteration_uuid``."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        projects_cfg = admin_svc.get_config('projects', default={'project_map': []}) or {}
        if not isinstance(projects_cfg, dict):
            projects_cfg = {'project_map': []}
        project_map = projects_cfg.get('project_map')
        if not isinstance(project_map, list):
            project_map = []

        updated = 0
        for p in project_map:
            if not isinstance(p, dict):
                continue
            if str(p.get('iteration_uuid') or '') == set_id:
                p['iteration_uuid'] = None
                updated += 1

        projects_cfg['project_map'] = project_map
        admin_svc.save_config('projects', projects_cfg)
        return {'ok': True, 'unassociated': updated}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to unassociate projects from iteration set %s: %s', set_id, e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/iterations/browse')
@require_permission(AccountPermissions.MANAGE_ITERATIONS)
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

        pat = get_session_credentials_from_request(request)['pat']
        if not pat:
            raise HTTPException(status_code=401, detail={'error': 'missing_pat', 'message': 'Personal Access Token required'})

        azure_svc = resolve_service(request, 'azure_client')

        def fetch_iterations():
            """Keep the thread-local Azure connection on the worker."""
            with azure_svc.connect(pat) as client:
                return client.get_iterations(project, root_path=root_path, depth=depth)

        iterations = await asyncio.to_thread(fetch_iterations)

        return {'iterations': iterations}
    except (HTTPException, BackendAuthError, BackendUnavailableError):
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

        pat = get_session_credentials_from_request(request)['pat']
        azure_svc = resolve_service(request, 'azure_client')
        admin_svc = resolve_service(request, 'admin_service')
        try:
            return await asyncio.to_thread(
                area_mapping_service.refresh_single, area_path, pat, azure_svc, admin_svc
            )
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
        pat = get_session_credentials_from_request(request)['pat']
        azure_svc = resolve_service(request, 'azure_client')
        admin_svc = resolve_service(request, 'admin_service')
        try:
            return await asyncio.to_thread(
                area_mapping_service.refresh_all, pat, azure_svc, admin_svc
            )
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
# Schema
# ---------------------------------------------------------------------------

@router.get('/admin/v1/schema/{config_type}')
@require_permission(AccountPermissions.MANAGE_PROJECTS)
async def admin_get_schema(request: Request, config_type: str):
    """Return JSON Schema for a configuration type.  Delegates to admin_schema module."""
    if config_type not in ('projects', 'ado_processes') and not has_admin_access(request):
        raise HTTPException(403, detail='Administrator permission required')
    schema = admin_schema.get_schema(config_type)
    if schema is None:
        raise HTTPException(status_code=404, detail={'error': 'unknown_schema', 'message': f'No schema defined for {config_type}'})
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
        return JSONResponse(content=await asyncio.to_thread(admin_svc.get_backup))
    except Exception as e:
        logger.exception('Failed to create backup: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/restore/validate')
@require_admin_session
async def admin_validate_backup(request: Request):
    """Reject incompatible system backups before the administrator selects restore categories."""
    try:
        payload = await request.json()
        admin_svc = resolve_service(request, 'admin_service')
        return JSONResponse(content=await asyncio.to_thread(admin_svc.validate_backup, payload))
    except ValueError as error:
        raise HTTPException(status_code=400, detail={
            'error': 'restore_rejected', 'message': str(error),
        }) from error
    except Exception as error:
        logger.exception('Failed to validate backup compatibility')
        raise HTTPException(status_code=500, detail='Internal server error') from error


@router.post('/admin/v1/restore')
@require_admin_session
async def admin_restore_backup(request: Request):
    """Restore data from a backup payload."""
    try:
        payload = await request.json()
        admin_svc = resolve_service(request, 'admin_service')
        current_user_email = get_session_context_from_request(request)['email']
        result = await asyncio.to_thread(admin_svc.restore_backup, payload, current_user_email)
        try:
            await asyncio.to_thread(admin_svc.reload_config)
        except Exception as e:
            logger.exception('Failed to reload configuration after restoring backup: %s', e)
            if isinstance(result, dict):
                result['warning'] = 'Restore completed, but the live configuration reload failed. Reload the page and verify Data Sources.'
        return JSONResponse(content=result)
    except ValueError as e:
        logger.info('Restore backup rejected: %s', e)
        raise HTTPException(status_code=400, detail={'error': 'restore_rejected', 'message': str(e)})
    except Exception as e:
        logger.exception('Failed to restore backup: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


# ---------------------------------------------------------------------------
# Backup Snapshots (individual entries) — feature-flagged by manage_backup_snapshots
# ---------------------------------------------------------------------------

@router.get('/admin/v1/backup-snapshots')
@require_admin_session
async def admin_list_backup_snapshots(request: Request):
    """List all timestamped backup snapshot keys in the 'config' namespace."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        snapshots = await asyncio.to_thread(admin_svc.list_backup_snapshots)
        return JSONResponse(content={'snapshots': snapshots})
    except Exception as e:
        logger.exception('Failed to list backup snapshots: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/backup-snapshots/prune')
@require_admin_session
async def admin_prune_backup_snapshots(request: Request):
    """Prune backup snapshots, keeping the last N entries per config key."""
    try:
        payload = await request.json()
        keep_last = payload.get('keep_last', 5)
        if not isinstance(keep_last, int) or keep_last < 0:
            raise HTTPException(status_code=400, detail={'error': 'invalid_keep_last'})
        admin_svc = resolve_service(request, 'admin_service')
        result = await asyncio.to_thread(admin_svc.prune_snapshots, keep_last=keep_last)
        return JSONResponse(content=result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail={'error': str(e)})
    except Exception as e:
        logger.exception('Failed to prune backup snapshots: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.get('/admin/v1/backup-snapshots/{key}')
@require_admin_session
async def admin_get_backup_snapshot(request: Request, key: str):
    """Return the raw content of a single backup snapshot entry."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        content = await asyncio.to_thread(admin_svc.get_snapshot_content, key)
        return JSONResponse(content={'key': key, 'content': content})
    except KeyError:
        raise HTTPException(status_code=404, detail=f'Snapshot not found: {key}')
    except Exception as e:
        logger.exception('Failed to load backup snapshot %s: %s', key, e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/backup-snapshots/{key}')
@require_admin_session
async def admin_restore_backup_snapshot(request: Request, key: str):
    """Restore a config value from a backup snapshot entry."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        await asyncio.to_thread(admin_svc.restore_snapshot_entry, key)
        return JSONResponse(content={'ok': True, 'restored_key': key})
    except KeyError:
        raise HTTPException(status_code=404, detail=f'Snapshot not found: {key}')
    except Exception as e:
        logger.exception('Failed to restore backup snapshot %s: %s', key, e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.delete('/admin/v1/backup-snapshots/{key}')
@require_admin_session
async def admin_delete_backup_snapshot(request: Request, key: str):
    """Delete a single backup snapshot entry."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        await asyncio.to_thread(admin_svc.delete_snapshot_entry, key)
        return JSONResponse(content={'ok': True})
    except KeyError:
        raise HTTPException(status_code=404, detail=f'Snapshot not found: {key}')
    except Exception as e:
        logger.exception('Failed to delete backup snapshot %s: %s', key, e)
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


# ---------------------------------------------------------------------------
# Azure DevOps configuration (ado_config in diskcache)
# ---------------------------------------------------------------------------

@router.get('/admin/v1/browse-config')
@require_permission(AccountPermissions.MANAGE_PROJECTS, AccountPermissions.MANAGE_ITERATIONS)
async def admin_get_browse_config(request: Request):
    service = resolve_service(request, 'admin_service')
    config = service.get_config('ado_config', default={})
    return {'content': {'organization_url': config.get('organization_url', '')}}


@router.get('/admin/v1/ado')
@require_admin_session
async def admin_get_ado(request: Request):
    """Return the Azure DevOps configuration (organization_url + ADO feature flags)."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        return {'content': admin_svc.get_config('ado_config', default={})}
    except Exception as e:
        logger.exception('Failed to load ADO config: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/ado')
@require_admin_session
async def admin_save_ado(request: Request):
    """Save Azure DevOps configuration; triggers a config reload on success."""
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Expecting JSON body'})
    content = payload.get('content')
    if content is None:
        raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Missing content'})
    try:
        admin_svc = resolve_service(request, 'admin_service')
        admin_svc.save_config('ado_config', content)
        try:
            admin_svc.reload_config()
        except Exception as e:
            logger.exception('Failed to reload configuration after saving ADO config: %s', e)
        return {'ok': True}
    except Exception as e:
        logger.exception('Failed to save ADO config: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


# ---------------------------------------------------------------------------
# Event backend configuration (events_config in diskcache)
# ---------------------------------------------------------------------------

@router.get('/admin/v1/events-config')
@require_admin_session
async def admin_get_events_config(request: Request):
    """Return the event-backend configuration (backend selector + per-backend settings)."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        return {'content': admin_svc.get_config('event_config', default={})}
    except Exception as e:
        logger.exception('Failed to load events config: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/events-config')
@require_admin_session
async def admin_save_events_config(request: Request):
    """Save event-backend configuration; rebuilds the event_repository on success."""
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Expecting JSON body'})
    content = payload.get('content')
    if content is None:
        raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Missing content'})
    try:
        admin_svc = resolve_service(request, 'admin_service')
        admin_svc.save_config('event_config', content)
        try:
            admin_svc.reload_config()
        except Exception as e:
            logger.exception('Failed to reload configuration after saving events config: %s', e)
        return {'ok': True}
    except Exception as e:
        logger.exception('Failed to save events config: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


# ---------------------------------------------------------------------------
# Groups backend configuration (groups_config in diskcache)
# ---------------------------------------------------------------------------

@router.get('/admin/v1/groups-config')
@require_admin_session
async def admin_get_groups_config(request: Request):
    """Return the groups-backend configuration (backend selector + per-backend settings)."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        return {'content': admin_svc.get_config('groups_config', default={})}
    except Exception as e:
        logger.exception('Failed to load groups config: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/groups-config')
@require_admin_session
async def admin_save_groups_config(request: Request):
    """Save groups-backend configuration."""
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Expecting JSON body'})
    content = payload.get('content')
    if content is None:
        raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Missing content'})
    try:
        admin_svc = resolve_service(request, 'admin_service')
        admin_svc.save_config('groups_config', content)
        return {'ok': True}
    except Exception as e:
        logger.exception('Failed to save groups config: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


# ---------------------------------------------------------------------------
# Plugin runtime configuration (plugin_runtime_config in diskcache)
# ---------------------------------------------------------------------------

def _validate_plugin_dependency_order(_plugins):
    """Hook for dependency-order validation against modules.config.json.

    Intentionally no-op in phase 1; wiring exists so strict validation can be
    added without changing route behavior.
    
    Future enhancement: validate plugin dependencies and load order against
    the PluginManager's dependency graph to ensure circular dependencies
    and missing dependencies are caught at save time.
    """
    return None


@router.get('/admin/v1/plugins-config')
@require_admin_session
async def admin_get_plugins_config(request: Request):
    """Return normalized plugin runtime configuration.
    
    Handles:
    - Missing config (first time after upgrade): returns empty default
    - Schema migration: normalizes payload to current schema version
    - Validation: checks single activated, duplicate IDs, enabled=false forces activated=false
    """
    try:
        admin_svc = resolve_service(request, 'admin_service')
        content = admin_svc.get_config('plugin_runtime_config', default=None)
        result = normalize_plugin_runtime_config(
            content,
            dependency_validator=_validate_plugin_dependency_order,
        )
        logger.info('Loaded plugin runtime config: %d plugins', len(result.get('plugins', [])))
        return {'content': result}
    except ValueError as e:
        logger.warning('Invalid plugin runtime config payload: %s', e)
        raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': str(e)})
    except Exception as e:
        logger.exception('Failed to load plugin runtime config: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/plugins-config')
@require_admin_session
async def admin_save_plugins_config(request: Request):
    """Save plugin runtime configuration after lightweight normalization.
    
    Handles:
    - Validation: duplicate IDs, single activated, enabled/activated consistency
    - Normalization: enforces schema version, cleans up entries
    - Persistence: stores in backend config
    - Logging: records plugin count and any validation issues
    """
    try:
        payload = await request.json()
    except Exception:
        logger.warning('Failed to parse plugin config JSON request')
        raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Expecting JSON body'})

    content = payload.get('content') if isinstance(payload, dict) else None
    if content is None:
        logger.warning('Plugin config POST missing content field')
        raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Missing content'})

    try:
        normalized = normalize_plugin_runtime_config(
            content,
            dependency_validator=_validate_plugin_dependency_order,
        )
        admin_svc = resolve_service(request, 'admin_service')
        admin_svc.save_config('plugin_runtime_config', normalized)
        num_plugins = len(normalized.get('plugins', []))
        activated = [p for p in normalized.get('plugins', []) if p.get('activateOnStartup')]
        logger.info('Saved plugin runtime config: %d plugins (%d activated)', num_plugins, len(activated))
        return {'ok': True}
    except ValueError as e:
        logger.warning('Invalid plugin runtime config payload: %s', e)
        raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': str(e)})
    except Exception as e:
        logger.exception('Failed to save plugin runtime config: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')




