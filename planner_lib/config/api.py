from fastapi import APIRouter, HTTPException
from planner_lib.config.config import config_manager, AccountPayload
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post('/config')
async def save_config(payload: AccountPayload):
    logger.debug("Saving config for email %s", payload.email)
    try:
        status = config_manager.save(payload)
        if not status:
            raise HTTPException(status_code=400, detail={'error': 'invalid_email', 'message': 'Invalid email'})
    except Exception as e:
        # some generic failure happened (should never get here)
        raise HTTPException(status_code=500, detail=str(e))
    return status
