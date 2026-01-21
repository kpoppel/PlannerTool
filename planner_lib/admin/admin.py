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
        from planner_lib.setup import YamlConfigStore, setup as _setup
        from planner_lib.config.config import config_manager
        from planner_lib.cost import config as cost_config
        from planner_lib.cost import engine as cost_engine
        from planner_lib.storage.file_backend import FileStorageBackend

        STORE_NS = "config"
        STORE_KEY = "server_config.yml"
        storage = FileStorageBackend()
        storage.configure(mode="text")

        store = YamlConfigStore(storage, namespace=STORE_NS)
        try:
            cfg = store.load(STORE_KEY)
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
            config_manager.load(request.cookies.get('session') or '')
        except Exception:
            pass

        return { 'ok': True }
    except Exception as e:
        logger.exception('Failed to reload configuration: %s', e)
        raise HTTPException(status_code=500, detail=str(e))
