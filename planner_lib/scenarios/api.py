import asyncio

from fastapi import APIRouter, Request, Body, HTTPException
from planner_lib.middleware import require_session
from planner_lib.middleware.session import get_session_id_from_request
from planner_lib.services.resolver import resolve_service

import logging
router = APIRouter()
logger = logging.getLogger(__name__)


def _payload_item_id(data: dict | None) -> str | None:
    if not isinstance(data, dict):
        return None
    if data.get('id'):
        return data.get('id')
    meta = data.get('_meta')
    if isinstance(meta, dict) and meta.get('id'):
        return meta.get('id')
    return None


def _validate_scenario_payload(data: dict | None) -> None:
    """Reject malformed scenario payloads before they are persisted."""
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail='Scenario data must be an object')

    # Enforce the store/server contract at the boundary so callers can rely on the fields existing.
    data.setdefault('overrides', {})
    data.setdefault('filters', {})
    data.setdefault('view', {})
    data.setdefault('groupOverrides', {})
    data.setdefault('scenarioGroups', [])
    data.setdefault('pluginData', {})

    for key in ('id', 'name'):
        value = data.get(key)
        if value is not None and str(value).strip() == '':
            raise HTTPException(status_code=400, detail=f'Scenario {key} cannot be empty')

    if not isinstance(data.get('overrides'), dict):
        raise HTTPException(status_code=400, detail='Scenario overrides must be an object')
    if not isinstance(data.get('filters'), dict):
        raise HTTPException(status_code=400, detail='Scenario filters must be an object')
    if not isinstance(data.get('view'), dict):
        raise HTTPException(status_code=400, detail='Scenario view must be an object')
    if not isinstance(data.get('groupOverrides'), dict):
        raise HTTPException(status_code=400, detail='Scenario groupOverrides must be an object')

    groups = data.get('scenarioGroups')
    if not isinstance(groups, list):
        raise HTTPException(status_code=400, detail='Scenario scenarioGroups must be a list')
    for group in groups:
        if not isinstance(group, dict):
            raise HTTPException(status_code=400, detail='Scenario group entries must be objects')
        group_id = group.get('id')
        group_name = group.get('name')
        if group_id is None or str(group_id).strip() == '':
            raise HTTPException(status_code=400, detail='Scenario group id cannot be empty')
        if group_name is None or str(group_name).strip() == '':
            raise HTTPException(status_code=400, detail='Scenario group name cannot be empty')

    # pluginData is an opaque, per-plugin-key bag (e.g. {'plugin-annotations': [...]});
    # the scenario layer only enforces that it is a dict and does not interpret its contents.
    if not isinstance(data.get('pluginData'), dict):
        raise HTTPException(status_code=400, detail='Scenario pluginData must be an object')


@router.get('/scenario')
@require_session
async def api_scenario_get(request: Request):
    sid = get_session_id_from_request(request)
    logger.debug("Fetching scenario(s) for session %s", sid)

    session_mgr = resolve_service(request, 'session_manager')
    user_id = session_mgr.get_val(sid, 'email') or ''
    scenario_id = request.query_params.get('id')
    scenario_repo = resolve_service(request, 'scenario_repository')
    try:
        if scenario_id:
            return await asyncio.to_thread(scenario_repo.get_scenario, user_id, scenario_id)
        else:
            return await asyncio.to_thread(scenario_repo.list_scenarios, user_id)
    except KeyError:
        raise HTTPException(status_code=404, detail='Scenario not found')
    except Exception as e:
        logger.exception("Error fetching scenario: %s", e)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post('/scenario')
@require_session
async def api_scenario_post(request: Request, payload: dict = Body(default={})):
    sid = get_session_id_from_request(request)
    logger.debug("Saving/deleting scenario for session %s", sid)

    session_mgr = resolve_service(request, 'session_manager')
    user_id = session_mgr.get_val(sid, 'email') or ''
    op = (payload or {}).get('op')
    data = (payload or {}).get('data')
    if not op:
        raise HTTPException(status_code=400, detail='Missing op')
    scenario_repo = resolve_service(request, 'scenario_repository')
    try:
        if op == 'save':
            if isinstance(data, dict) and data.get('readonly'):
                raise HTTPException(status_code=400, detail='Cannot save readonly scenario')
            _validate_scenario_payload(data)
            scenario_id = _payload_item_id(data)
            return await asyncio.to_thread(scenario_repo.save_scenario, user_id, scenario_id, data)
        elif op == 'delete':
            scenario_id = _payload_item_id(data)
            if not scenario_id:
                raise HTTPException(status_code=400, detail='Missing scenario id for delete')
            try:
                scenario = await asyncio.to_thread(scenario_repo.get_scenario, user_id, scenario_id)
                if isinstance(scenario, dict) and scenario.get('readonly'):
                    raise HTTPException(status_code=400, detail='Cannot delete readonly scenario')
            except KeyError:
                raise HTTPException(status_code=404, detail='Scenario not found')
            if not await asyncio.to_thread(scenario_repo.delete_scenario, user_id, scenario_id):
                raise HTTPException(status_code=404, detail='Scenario not found')
            return {'ok': True, 'id': scenario_id}
        else:
            raise HTTPException(status_code=400, detail='Unsupported op')
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")
