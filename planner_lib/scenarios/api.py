from fastapi import APIRouter, Request, Body, HTTPException
from planner_lib.middleware import require_session
from planner_lib.middleware.session import get_session_id_from_request, session_manager
from .scenario_store import (
    save_user_scenario,
    load_user_scenario,
    delete_user_scenario,
    list_user_scenarios,
)

import logging
router = APIRouter()
logger = logging.getLogger(__name__)


@router.get('/scenario')
@require_session
async def api_scenario_get(request: Request):
    sid = get_session_id_from_request(request)
    logger.debug("Fetching scenario(s) for session %s", sid)

    user_id = session_manager.get_val(sid, 'email') or ''
    scenario_id = request.query_params.get('id')
    try:
        if scenario_id:
            data = load_user_scenario(request.app.state.scenarios_storage if hasattr(request.app.state, 'scenarios_storage') else None, user_id, scenario_id)
            return data
        else:
            return list_user_scenarios(request.app.state.scenarios_storage if hasattr(request.app.state, 'scenarios_storage') else None, user_id)
    except KeyError:
        raise HTTPException(status_code=404, detail='Scenario not found')
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/scenario')
@require_session
async def api_scenario_post(request: Request, payload: dict = Body(default={})): 
    sid = get_session_id_from_request(request)
    logger.debug("Saving/deleting scenario for session %s", sid)

    user_id = session_manager.get_val(sid, 'email') or ''
    op = (payload or {}).get('op')
    data = (payload or {}).get('data')
    if not op:
        raise HTTPException(status_code=400, detail='Missing op')
    try:
        if op == 'save':
            if isinstance(data, dict) and data.get('readonly'):
                raise HTTPException(status_code=400, detail='Cannot save readonly scenario')
            scenario_id = None
            if isinstance(data, dict):
                scenario_id = data.get('id')
            meta = save_user_scenario(request.app.state.scenarios_storage if hasattr(request.app.state, 'scenarios_storage') else None, user_id, scenario_id, data)
            return meta
        elif op == 'delete':
            if not isinstance(data, dict) or not data.get('id'):
                raise HTTPException(status_code=400, detail='Missing scenario id for delete')
            try:
                scenario = load_user_scenario(request.app.state.scenarios_storage if hasattr(request.app.state, 'scenarios_storage') else None, user_id, data['id'])
                if isinstance(scenario, dict) and scenario.get('readonly'):
                    raise HTTPException(status_code=400, detail='Cannot delete readonly scenario')
            except KeyError:
                raise HTTPException(status_code=404, detail='Scenario not found')
            ok = delete_user_scenario(request.app.state.scenarios_storage if hasattr(request.app.state, 'scenarios_storage') else None, user_id, data['id'])
            if not ok:
                raise HTTPException(status_code=404, detail='Scenario not found')
            return { 'ok': True, 'id': data['id'] }
        else:
            raise HTTPException(status_code=400, detail='Unsupported op')
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
