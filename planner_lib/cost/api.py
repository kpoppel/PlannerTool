import asyncio

from fastapi import APIRouter, Request, Body, HTTPException
from planner_lib.middleware import require_session
from planner_lib.middleware.session import get_session_credentials_from_request
from planner_lib.services.resolver import resolve_service
from planner_lib.backend.port import BackendCredential
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post('/cost/features')
@require_session
async def api_cost_features_post(request: Request, payload: dict = Body(default={})):
    """New endpoint returning per-feature detailed allocations.

    Accepts payload: { features: [{ id, start?, end?, capacity? }, ...], mode?: 'full' }
    Falls back to session tasks if `features` not provided.
    """
    logger.debug("Calculating feature-level cost details")
    try:
        from planner_lib.cost import build_cost_schema
        ctx = get_session_credentials_from_request(request)

        features = (payload or {}).get('features')
        if features is None:
            task_repo = resolve_service(request, 'task_repository')
            _pat = ctx.get('pat')
            account_id = ctx['account_id']
            cred = BackendCredential(token=_pat, user_id=account_id) if _pat else None
            features = await asyncio.to_thread(task_repo.read, credential=cred)

        ctx = dict(ctx)
        ctx['features'] = features

        cost_svc = resolve_service(request, 'cost_service')
        result = await asyncio.to_thread(cost_svc.estimate_costs, ctx) or {'projects': {}, 'project_types': {}}
        raw = result.get('projects', {})
        project_types = result.get('project_types', {})
        return build_cost_schema(raw, mode='full', session_features=ctx.get('features'),
                     project_types=project_types,
                     project_container_order=result.get('project_container_order'),
                     unknown_teams=result.get('unknown_teams', []))
    except Exception as e:
        logger.exception('Failed to calculate feature costs: %s', e)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get('/cost')
@require_session
async def api_cost_get(request: Request):
    logger.debug("Fetching calculated cost")
    ctx = get_session_credentials_from_request(request)
    pat = ctx['pat']

    try:
        from planner_lib.cost import build_cost_schema

        task_repo = resolve_service(request, 'task_repository')
        cred = BackendCredential(token=pat, user_id=ctx['account_id']) if pat else None
        features = await asyncio.to_thread(task_repo.read, credential=cred)

        ctx = dict(ctx)
        ctx['features'] = features
        # If no features are present in the session, return a minimal schema
        if not features:
            return build_cost_schema({}, mode='schema', session_features=None)

        cost_svc = resolve_service(request, 'cost_service')
        result = await asyncio.to_thread(cost_svc.estimate_costs, ctx) or {'projects': {}, 'project_types': {}}
        raw = result.get('projects', {})
        project_types = result.get('project_types', {})
        return build_cost_schema(raw, mode='full', session_features=features,
                     project_types=project_types,
                     project_container_order=result.get('project_container_order'),
                     unknown_teams=result.get('unknown_teams', []))

    except Exception as e:
        logger.exception('Failed to fetch cost data: %s', e)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get('/cost/teams')
@require_session
async def api_cost_teams(request: Request):
    """Return anonymous bases and supplier profiles without personal workforce data."""
    try:
        cost_svc = resolve_service(request, 'cost_service')
        return await asyncio.to_thread(cost_svc.team_bases)
    except Exception as e:
        logger.exception('Failed to build teams data: %s', e)
        raise HTTPException(status_code=500, detail="Internal server error")
