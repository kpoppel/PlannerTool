from fastapi import APIRouter, HTTPException, Response, Request
from planner_lib.accounts.config import AccountPayload
from planner_lib.middleware.session import create_session
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post('/session')
async def api_session_post(payload: AccountPayload, response: Response, request: Request):
    email = payload.email
    if not email or '@' not in email:
        raise HTTPException(status_code=400, detail={'error': 'invalid_email', 'message': 'Invalid email address'})

    try:
        # pass the request so the session helper can look up the manager
        sid = create_session(email, request=request)
    except KeyError:
        # No account exists for this email
        raise HTTPException(status_code=401, detail={'error': 'account_not_found', 'message': 'Account not found'})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Inform middleware to set the session cookie centrally
    response.headers['x-set-session-id'] = sid
    logger.debug("Creating session for email %s with session ID %s", email, sid)
    return {"sessionId": sid}
