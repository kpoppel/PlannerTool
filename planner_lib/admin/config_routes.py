"""Admin configuration CRUD route handlers.

Covers: projects, global-settings, iterations, area-mappings (CRUD +
refresh + toggle), teams, people (CRUD + inspect), schema, backup,
restore, cost (CRUD + inspect), system, ado (Azure DevOps config), and
events-config (event backend selection).
"""
import asyncio
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
import logging

from planner_lib.middleware import require_admin_session
from planner_lib.services.resolver import resolve_service
from planner_lib.middleware.session import get_session_id_from_request as _get_session_id_or_raise
from planner_lib.admin import schema as admin_schema
from planner_lib.admin import cost_inspector
from planner_lib.admin import people_inspector
from planner_lib.admin import area_mapping_service
from planner_lib.admin.plugin_runtime_config import normalize_plugin_runtime_config
from planner_lib.repository.iteration_repository import IterationRepository

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
        content = payload.get('content', None)
        if content is None:
            raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Empty content'})

        if not isinstance(content, (dict, list)):
            raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': 'Unsupported content type'})

        admin_svc = resolve_service(request, 'admin_service')
        admin_svc.save_config('projects', content)
        return {'ok': True}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to save projects: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


# ---------------------------------------------------------------------------
# Global settings
# ---------------------------------------------------------------------------

def _normalize_global_settings(content):
    data = content if isinstance(content, dict) else {}
    return {
        'task_type_hierarchy': data.get('task_type_hierarchy') or [],
        'state_display_sequence': data.get('state_display_sequence') or [],
    }

@router.get('/admin/v1/global-settings')
@require_admin_session
async def admin_get_global_settings(request: Request):
    """Return the server-wide global settings."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        cfg = admin_svc.get_config(
            'global_settings',
            default={'task_type_hierarchy': [], 'state_display_sequence': []},
        )
        return {'content': _normalize_global_settings(cfg)}
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
        admin_svc.save_config('global_settings', _normalize_global_settings(content))
        return {'ok': True}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to save global settings: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


# ---------------------------------------------------------------------------
# Iterations
# ---------------------------------------------------------------------------

def _to_v2_iterations_config(content: Any) -> Dict[str, Any]:
    raw = content if isinstance(content, dict) else {}
    normalized = IterationRepository._normalize_iterations_config(raw, area_project='')
    default_obj = normalized.get('default') if isinstance(normalized.get('default'), dict) else {}
    default_source = str(default_obj.get('source_project') or raw.get('azure_project') or '').strip()
    default_roots = IterationRepository._clean_roots(default_obj.get('roots'))

    rules: List[Dict[str, Any]] = []
    for idx, rule in enumerate(normalized.get('rules') or []):
        if not isinstance(rule, dict):
            continue
        match_obj = rule.get('match') if isinstance(rule.get('match'), dict) else {}
        out_match: Dict[str, Any] = {}
        project_names = IterationRepository._as_string_list(match_obj.get('project_names'))
        area_prefixes = IterationRepository._as_string_list(match_obj.get('area_path_prefixes'))
        if project_names:
            out_match['project_names'] = project_names
        if area_prefixes:
            out_match['area_path_prefixes'] = area_prefixes

        rules.append({
            'rule_id': str(rule.get('rule_id') or f'rule-{idx + 1}'),
            'enabled': bool(rule.get('enabled', True)),
            'priority': int(rule.get('priority', 100)),
            'match': out_match,
            'source_project': str(rule.get('source_project') or '').strip(),
            'roots': IterationRepository._clean_roots(rule.get('roots')),
        })

    return {
        'schema_version': 2,
        'default': {
            'source_project': default_source,
            'roots': default_roots,
        },
        'rules': rules,
    }


def _validate_iterations_v2(config: Dict[str, Any]) -> Dict[str, List[str]]:
    errors: List[str] = []
    warnings: List[str] = []

    default_obj = config.get('default') if isinstance(config.get('default'), dict) else {}
    default_source = str(default_obj.get('source_project') or '').strip()
    if not default_source:
        warnings.append('default.source_project is empty; area-path project fallback will be used')

    rule_ids = set()
    for idx, rule in enumerate(config.get('rules') or []):
        if not isinstance(rule, dict):
            errors.append(f'rules[{idx}] must be an object')
            continue
        rule_id = str(rule.get('rule_id') or '').strip()
        if not rule_id:
            errors.append(f'rules[{idx}].rule_id is required')
        elif rule_id in rule_ids:
            errors.append(f'duplicate rule_id: {rule_id}')
        else:
            rule_ids.add(rule_id)

        try:
            int(rule.get('priority', 100))
        except Exception:
            errors.append(f'rules[{idx}].priority must be an integer')

        match_obj = rule.get('match') if isinstance(rule.get('match'), dict) else {}
        project_names = IterationRepository._as_string_list(match_obj.get('project_names'))
        area_prefixes = IterationRepository._as_string_list(match_obj.get('area_path_prefixes'))
        if not project_names and not area_prefixes:
            warnings.append(f'rules[{idx}] has no match constraints and will act as a global rule')

        source_project = str(rule.get('source_project') or '').strip()
        if not source_project:
            warnings.append(f'rules[{idx}] has empty source_project; default source will be used')

    return {
        'errors': errors,
        'warnings': warnings,
    }


def _get_configured_projects(admin_svc) -> List[Dict[str, Any]]:
    projects_cfg = admin_svc.get_config('projects', default={}) or {}
    project_map = projects_cfg.get('project_map') if isinstance(projects_cfg, dict) else []
    return [p for p in (project_map or []) if isinstance(p, dict)]

@router.get('/admin/v1/iterations')
@require_admin_session
async def admin_get_iterations(request: Request):
    """Return the iterations configuration as JSON."""
    try:
        admin_svc = resolve_service(request, 'admin_service')
        stored = admin_svc.get_config('iterations', default={}) or {}
        content = _to_v2_iterations_config(stored)
        validation = _validate_iterations_v2(content)
        return {
            'content': content,
            'validation': validation,
        }
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

        normalized = _to_v2_iterations_config(content)
        validation = _validate_iterations_v2(normalized)
        if validation['errors']:
            raise HTTPException(
                status_code=400,
                detail={
                    'error': 'invalid_iterations_config',
                    'errors': validation['errors'],
                    'warnings': validation['warnings'],
                },
            )

        admin_svc = resolve_service(request, 'admin_service')
        admin_svc.save_config('iterations', normalized)
        return {
            'ok': True,
            'validation': validation,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to save iterations config: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/iterations/migrate')
@require_admin_session
async def admin_migrate_iterations(request: Request):
    """Migrate legacy iterations config to canonical v2 shape.

    Payload:
      {
        "content": optional object,
        "dry_run": boolean (default false)
      }
    """
    try:
        payload = await request.json()
        dry_run = bool(payload.get('dry_run', False))

        admin_svc = resolve_service(request, 'admin_service')
        source = payload.get('content')
        if source is None:
            source = admin_svc.get_config('iterations', default={}) or {}

        migrated = _to_v2_iterations_config(source)
        validation = _validate_iterations_v2(migrated)
        if validation['errors']:
            raise HTTPException(
                status_code=400,
                detail={
                    'error': 'invalid_iterations_config',
                    'errors': validation['errors'],
                    'warnings': validation['warnings'],
                },
            )

        if not dry_run:
            admin_svc.save_config('iterations', migrated)

        return {
            'ok': True,
            'dry_run': dry_run,
            'content': migrated,
            'validation': validation,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to migrate iterations config: %s', e)
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
            iterations = await asyncio.to_thread(
                client.get_iterations, project, root_path=root_path, depth=depth
            )

        return {'iterations': iterations}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to browse iterations: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')


@router.post('/admin/v1/iterations/resolve-preview')
@require_admin_session
async def admin_iterations_resolve_preview(request: Request):
    """Preview rule resolution per configured project with optional Azure fetch diagnostics.

    Payload:
      {
        "content": optional iterations config object,
        "project_ids": optional list of configured project ids,
        "fetch": optional bool (default true)
      }
    """
    try:
        payload = await request.json()
        fetch = bool(payload.get('fetch', True))

        admin_svc = resolve_service(request, 'admin_service')
        source = payload.get('content')
        if source is None:
            source = admin_svc.get_config('iterations', default={}) or {}
        config = _to_v2_iterations_config(source)
        validation = _validate_iterations_v2(config)
        if validation['errors']:
            raise HTTPException(
                status_code=400,
                detail={
                    'error': 'invalid_iterations_config',
                    'errors': validation['errors'],
                    'warnings': validation['warnings'],
                },
            )

        requested_ids = payload.get('project_ids') if isinstance(payload.get('project_ids'), list) else []
        requested_ids = [str(x) for x in requested_ids if str(x).strip()]
        projects = _get_configured_projects(admin_svc)
        if requested_ids:
            projects = [p for p in projects if str(p.get('id') or '') in requested_ids]

        results = []
        total_iterations = 0
        fetch_errors = 0

        azure_context = None
        if fetch:
            sid = _get_session_id_or_raise(request)
            session_mgr = resolve_service(request, 'session_manager')
            pat = session_mgr.get_val(sid, 'pat')
            if not pat:
                raise HTTPException(status_code=401, detail={'error': 'missing_pat', 'message': 'Personal Access Token required'})
            azure_svc = resolve_service(request, 'azure_client')
            azure_context = azure_svc.connect(pat)

        if azure_context is None:
            for project in projects:
                resolution = IterationRepository._resolve_iteration_source(project, config)
                results.append({
                    'projectId': str(project.get('id') or ''),
                    'projectName': str(project.get('name') or ''),
                    'areaPath': str(project.get('area_path') or ''),
                    'resolution': resolution,
                    'fetch': {
                        'attempted': False,
                        'totalIterations': 0,
                        'roots': [],
                    },
                })
        else:
            with azure_context as client:
                for project in projects:
                    resolution = IterationRepository._resolve_iteration_source(project, config)
                    source_project = str(resolution.get('sourceProject') or '').strip()
                    roots = resolution.get('roots') or []

                    root_results = []
                    project_total = 0
                    for root in roots or [None]:
                        full_root = f"{source_project}\\Iteration\\{root}" if root else None
                        try:
                            items = await asyncio.to_thread(
                                client.get_iterations,
                                source_project,
                                full_root,
                                10,
                            )
                            count = len(items or [])
                            project_total += count
                            root_results.append({
                                'root': root,
                                'fullRootPath': full_root,
                                'ok': True,
                                'count': count,
                            })
                        except Exception as exc:
                            fetch_errors += 1
                            root_results.append({
                                'root': root,
                                'fullRootPath': full_root,
                                'ok': False,
                                'count': 0,
                                'error': str(exc),
                            })

                    total_iterations += project_total
                    results.append({
                        'projectId': str(project.get('id') or ''),
                        'projectName': str(project.get('name') or ''),
                        'areaPath': str(project.get('area_path') or ''),
                        'resolution': resolution,
                        'fetch': {
                            'attempted': True,
                            'totalIterations': project_total,
                            'roots': root_results,
                        },
                    })

        return {
            'ok': True,
            'validation': validation,
            'projects': results,
            'summary': {
                'projectCount': len(results),
                'totalIterations': total_iterations,
                'fetchErrors': fetch_errors,
                'fetchAttempted': fetch,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to preview iteration resolution: %s', e)
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
        sid = _get_session_id_or_raise(request)
        session_mgr = resolve_service(request, 'session_manager')
        pat = session_mgr.get_val(sid, 'pat')
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
            people_repo = resolve_service(request, 'people_repository')
            people_repo.reload()
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
        people_repo = resolve_service(request, 'people_repository')
        team_repo = resolve_service(request, 'team_repository')
        return await asyncio.to_thread(
            people_inspector.inspect, admin_svc, people_repo, team_repo
        )
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
        return JSONResponse(content=await asyncio.to_thread(admin_svc.get_backup))
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
        result = await asyncio.to_thread(admin_svc.restore_backup, payload, current_user_email)
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
        people_repo = resolve_service(request, 'people_repository')
        team_repo = resolve_service(request, 'team_repository')
        return await asyncio.to_thread(
            cost_inspector.inspect, admin_svc, people_repo, team_repo
        )
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


# ---------------------------------------------------------------------------
# Azure DevOps configuration (ado_config in diskcache)
# ---------------------------------------------------------------------------

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
        activated = [p for p in normalized.get('plugins', []) if p.get('activated')]
        logger.info('Saved plugin runtime config: %d plugins (%d activated)', num_plugins, len(activated))
        return {'ok': True}
    except ValueError as e:
        logger.warning('Invalid plugin runtime config payload: %s', e)
        raise HTTPException(status_code=400, detail={'error': 'invalid_payload', 'message': str(e)})
    except Exception as e:
        logger.exception('Failed to save plugin runtime config: %s', e)
        raise HTTPException(status_code=500, detail='Internal server error')




