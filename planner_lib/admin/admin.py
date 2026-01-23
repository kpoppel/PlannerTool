from fastapi import APIRouter, HTTPException, Request
from planner_lib.middleware import require_session
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post('/admin/v1/reload-config')
@require_session
async def api_admin_reload_config(request: Request):
    sid = request.cookies.get('session') or ''
    logger.debug("Reloading server and cost configuration for session %s", sid)
    try:
        from planner_lib.cost import config as cost_config
        from planner_lib.cost import engine as cost_engine

        try:
            cfg = request.app.state.server_config_storage.load("server_config")
            from planner_lib import setup as setup_module
            if hasattr(setup_module, '_loaded_config'):
                setup_module._loaded_config.clear()
                setup_module._loaded_config.append(cfg)
        except Exception:
            logger.debug('No server config present to reload')

        _ = cost_config.load_cost_config()
        try:
            cost_engine.invalidate_team_rates_cache()
        except Exception:
            logger.debug('Cost engine cache invalidation not available')

        try:
            request.app.state.account_manager.load(request.cookies.get('session') or '')
        except Exception:
            pass

        return { 'ok': True }
    except Exception as e:
        logger.exception('Failed to reload configuration: %s', e)
        raise HTTPException(status_code=500, detail=str(e))
