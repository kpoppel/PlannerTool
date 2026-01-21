from fastapi import APIRouter, HTTPException, Response
from planner_lib.config.config import AccountPayload
from planner_lib.middleware.session import create_session
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post('/session')
async def api_session_post(payload: AccountPayload, response: Response):
    email = payload.email
    if not email or '@' not in email:
        raise HTTPException(status_code=400, detail='invalid email')

    try:
        sid = create_session(email)
    except KeyError:
        # No account exists for this email
        raise HTTPException(status_code=401, detail='Account not found')
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Inform middleware to set the session cookie centrally
    response.headers['x-set-session-id'] = sid
    logger.debug("Creating session for email %s with session ID %s", email, sid)
    return {"sessionId": sid}
