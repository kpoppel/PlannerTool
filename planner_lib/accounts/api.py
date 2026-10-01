from fastapi import APIRouter, HTTPException, Request
from planner_lib.accounts.config import AccountCredentialsPayload
from planner_lib.services.resolver import resolve_service
from planner_lib.middleware.session import get_session_context_from_request
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post('/config')
async def save_config(payload: AccountCredentialsPayload, request: Request):
    if get_session_context_from_request(request)['email'] != payload.email:
        raise HTTPException(status_code=403, detail='Cannot update another account')
    logger.debug("Saving config for email %s", payload.email)
    try:
        mgr = resolve_service(request, 'account_manager')
        status = mgr.update_credentials(payload)
        if not status:
            raise HTTPException(status_code=400, detail={'error': 'invalid_email', 'message': 'Invalid email'})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error")
    return status