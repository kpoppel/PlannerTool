"""
REST API endpoints for view management.

Provides endpoints for saving, loading, deleting, and listing user views.
Views are UI configurations that capture selected projects, teams, and view options.
"""
from fastapi import APIRouter, Request, Body, HTTPException
from planner_lib.middleware import require_session
from planner_lib.middleware.session import get_session_id_from_request
from planner_lib.services.resolver import resolve_service
from .view_store import (
    save_user_view,
    load_user_view,
    delete_user_view,
    list_user_views,
)

import logging
router = APIRouter()
logger = logging.getLogger(__name__)


@router.get('/view')
@require_session
async def api_view_get(request: Request):
    """
    Get a specific view or list all views for the current user.
    
    Query params:
        id: View ID (optional) - if provided, returns the view data; otherwise lists all views
        
    Returns:
        - If id provided: View data object
        - If no id: List of view metadata objects
    """
    sid = get_session_id_from_request(request)
    logger.debug("Fetching view(s) for session %s", sid)

    session_mgr = resolve_service(request, 'session_manager')
    user_id = session_mgr.get_val(sid, 'email') or ''
    view_id = request.query_params.get('id')
    
    try:
        # Use views_storage service (will be registered in main.py)
        storage = resolve_service(request, 'views_storage')
        
        if view_id:
            # Load specific view
            data = load_user_view(storage, user_id, view_id)
            return data
        else:
            # List all views for user
            return list_user_views(storage, user_id)
    except KeyError:
        raise HTTPException(status_code=404, detail='View not found')
    except Exception as e:
        logger.error("Error fetching view: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/view')
@require_session
async def api_view_post(request: Request, payload: dict = Body(default={})): 
    """
    Save or delete a view for the current user.
    
    Body:
        {
            "op": "save" | "delete",
            "data": {
                "id": "view_id",  // Optional for save (generates new ID if not provided)
                "name": "View Name",  // Required for save
                "selectedProjects": {"proj1": true, "proj2": false},  // For save
                "selectedTeams": {"team1": true, "team2": false},  // For save
                "viewOptions": {  // For save
                    "timelineScale": "months",
                    "capacityViewMode": "team",
                    "condensedCards": false,
                    "featureSortMode": "rank",
                    "showUnassignedCards": true,
                    "showUnplannedWork": true
                }
            }
        }
        
    Returns:
        - For save: View metadata (id, user, name)
        - For delete: {"ok": true, "id": "view_id"}
    """
    sid = get_session_id_from_request(request)
    logger.debug("Saving/deleting view for session %s", sid)

    session_mgr = resolve_service(request, 'session_manager')
    user_id = session_mgr.get_val(sid, 'email') or ''
    op = (payload or {}).get('op')
    data = (payload or {}).get('data')
    
    if not op:
        raise HTTPException(status_code=400, detail='Missing op')
        
    try:
        storage = resolve_service(request, 'views_storage')
        
        if op == 'save':
            # Validate view data
            if not isinstance(data, dict):
                raise HTTPException(status_code=400, detail='View data must be an object')
            if not data.get('name'):
                raise HTTPException(status_code=400, detail='View name is required')
                
            view_id = data.get('id')
            meta = save_user_view(storage, user_id, view_id, data)
            logger.info("Saved view '%s' (id=%s) for user %s", data.get('name'), meta['id'], user_id)
            return meta
            
        elif op == 'delete':
            # Validate delete request
            if not isinstance(data, dict) or not data.get('id'):
                raise HTTPException(status_code=400, detail='Missing view id for delete')
                
            ok = delete_user_view(storage, user_id, data['id'])
            if not ok:
                raise HTTPException(status_code=404, detail='View not found')
                
            logger.info("Deleted view id=%s for user %s", data['id'], user_id)
            return {'ok': True, 'id': data['id']}
            
        else:
            raise HTTPException(status_code=400, detail='Unsupported op')
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error processing view operation: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
