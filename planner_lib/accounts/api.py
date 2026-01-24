from fastapi import APIRouter, HTTPException, Request
from planner_lib.accounts import config as config_mod
from planner_lib.accounts.config import AccountPayload, AccountManager
from planner_lib.services.resolver import resolve_service
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post('/config')
async def save_config(payload: AccountPayload, request: Request):
    logger.debug("Saving config for email %s", payload.email)
    try:
        # Tests sometimes assign a module-level `_storage` on planner_lib.accounts.config
        # so prefer using that storage when present to keep tests isolated.
        test_store = getattr(config_mod, '_storage', None)
        if test_store is not None:
            mgr = AccountManager(account_storage=test_store)
            status = mgr.save(payload)
        else:
            # Resolve account manager using centralized resolver
            mgr = resolve_service(request, 'account_manager')
            status = mgr.save(payload)
        if not status:
            raise HTTPException(status_code=400, detail={'error': 'invalid_email', 'message': 'Invalid email'})
    except Exception as e:
        # some generic failure happened (should never get here)
        raise HTTPException(status_code=500, detail=str(e))
    return status


@router.post('/account')
async def save_account(payload: AccountPayload, request: Request):
    """Compatibility route: frontend/tests expect POST /api/account.

    Delegate to the same account save logic as `/config`.
    """
    return await save_config(payload, request)
