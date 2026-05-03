"""REST API endpoints for view management."""
import asyncio

from fastapi import APIRouter, Request, Body, HTTPException
from planner_lib.middleware import require_session
from planner_lib.middleware.session import get_session_id_from_request
from planner_lib.services.resolver import resolve_service

import logging
router = APIRouter()
logger = logging.getLogger(__name__)


@router.get('/view')
@require_session
async def api_view_get(request: Request):
    """Return a specific view or list all views for the current user."""
    sid = get_session_id_from_request(request)
    session_mgr = resolve_service(request, 'session_manager')
    user_id = session_mgr.get_val(sid, 'email') or ''
    view_id = request.query_params.get('id')
    view_repo = resolve_service(request, 'view_repository')
    try:
        if view_id:
            return await asyncio.to_thread(view_repo.get_view, user_id, view_id)
        else:
            return await asyncio.to_thread(view_repo.list_views, user_id)
    except KeyError:
        raise HTTPException(status_code=404, detail='View not found')
    except Exception as e:
        logger.error("Error fetching view: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post('/view')
@require_session
async def api_view_post(request: Request, payload: dict = Body(default={})):
    """Save or delete a view for the current user."""
    sid = get_session_id_from_request(request)
    session_mgr = resolve_service(request, 'session_manager')
    user_id = session_mgr.get_val(sid, 'email') or ''
    op = (payload or {}).get('op')
    data = (payload or {}).get('data')
    if not op:
        raise HTTPException(status_code=400, detail='Missing op')
    view_repo = resolve_service(request, 'view_repository')
    try:
        if op == 'save':
            if not isinstance(data, dict):
                raise HTTPException(status_code=400, detail='View data must be an object')
            if not data.get('name'):
                raise HTTPException(status_code=400, detail='View name is required')
            meta = await asyncio.to_thread(view_repo.save_view, user_id, data.get('id'), data)
            logger.info("Saved view '%s' (id=%s) for user %s", data.get('name'), meta['id'], user_id)
            return meta
        elif op == 'delete':
            if not isinstance(data, dict) or not data.get('id'):
                raise HTTPException(status_code=400, detail='Missing view id for delete')
            if not await asyncio.to_thread(view_repo.delete_view, user_id, data['id']):
                raise HTTPException(status_code=404, detail='View not found')
            return {'ok': True, 'id': data['id']}
        else:
            raise HTTPException(status_code=400, detail='Unsupported op')
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error processing view operation: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")



