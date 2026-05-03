import asyncio

from fastapi import APIRouter, Request, Body, HTTPException
from planner_lib.middleware import require_session
from planner_lib.middleware.session import get_session_id_from_request
from planner_lib.services.resolver import resolve_service

import logging
router = APIRouter()
logger = logging.getLogger(__name__)


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
            scenario_id = data.get('id') if isinstance(data, dict) else None
            return await asyncio.to_thread(scenario_repo.save_scenario, user_id, scenario_id, data)
        elif op == 'delete':
            if not isinstance(data, dict) or not data.get('id'):
                raise HTTPException(status_code=400, detail='Missing scenario id for delete')
            try:
                scenario = await asyncio.to_thread(scenario_repo.get_scenario, user_id, data['id'])
                if isinstance(scenario, dict) and scenario.get('readonly'):
                    raise HTTPException(status_code=400, detail='Cannot delete readonly scenario')
            except KeyError:
                raise HTTPException(status_code=404, detail='Scenario not found')
            if not await asyncio.to_thread(scenario_repo.delete_scenario, user_id, data['id']):
                raise HTTPException(status_code=404, detail='Scenario not found')
            return {'ok': True, 'id': data['id']}
        else:
            raise HTTPException(status_code=400, detail='Unsupported op')
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")
