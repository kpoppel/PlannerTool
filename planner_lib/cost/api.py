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
            tasks = await asyncio.to_thread(task_repo.read, credential=cred)
            features = []
            for t in (tasks or []):
                features.append({
                    'id': t.get('id'),
                    'project': t.get('project'),
                    'start': t.get('start'),
                    'end': t.get('end'),
                    'capacity': t.get('capacity') or [],
                })

        ctx = dict(ctx)
        ctx['features'] = features

        cost_svc = resolve_service(request, 'cost_service')
        result = await asyncio.to_thread(cost_svc.estimate_costs, ctx) or {'projects': {}, 'project_types': {}}
        raw = result.get('projects', {})
        project_types = result.get('project_types', {})
        return build_cost_schema(raw, mode='full', session_features=ctx.get('features'), project_types=project_types)
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
        tasks = await asyncio.to_thread(task_repo.read, credential=cred)
        features = []
        for t in tasks or []:
            features.append({
                'id': t.get('id'),
                'project': t.get('project'),
                'start': t.get('start'),
                'end': t.get('end'),
                'capacity': t.get('capacity'),
                'title': t.get('title'),
                'type': t.get('type'),
                'state': t.get('state'),
                'relations': t.get('relations', []),
            })

        ctx = dict(ctx)
        ctx['features'] = features
        # If no features are present in the session, return a minimal schema
        if not features:
            return build_cost_schema({}, mode='schema', session_features=None)

        cost_svc = resolve_service(request, 'cost_service')
        result = await asyncio.to_thread(cost_svc.estimate_costs, ctx) or {'projects': {}, 'project_types': {}}
        raw = result.get('projects', {})
        project_types = result.get('project_types', {})
        return build_cost_schema(raw, mode='full', session_features=features, project_types=project_types)

    except Exception as e:
        logger.exception('Failed to fetch cost data: %s', e)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get('/cost/teams')
@require_session
async def api_cost_teams(request: Request):
    try:
        from planner_lib.util import slugify
        from planner_lib.services.resolver import resolve_service

        cost_svc = resolve_service(request, 'cost_service')
        people_repo = resolve_service(request, 'people_repository')
        cost_cfg = cost_svc.get_cost_config()

        try:
            people = people_repo.list_people()
        except Exception:
            people = []

        site_hours_map = cost_cfg.get('working_hours', {}) or {}
        external_cfg = cost_cfg.get('external_cost', {}) or {}
        ext_rates = external_cfg.get('external', {}) or {}
        default_ext_rate = float(external_cfg.get('default_hourly_rate', 0) or 0)
        internal_default_rate = float(cost_cfg.get('internal_cost', {}).get('default_hourly_rate', 0) or 0)

        teams_map = {}
        for p in people:
            raw_team = p.get('team_name') or p.get('team') or ''
            team_key = slugify(raw_team)
            if not team_key:
                continue
            entry = teams_map.setdefault(team_key, {
                'id': 'team-' + team_key,
                'name': raw_team or team_key,
                'members': [],
                'totals': {
                    'internal_count': 0,
                    'external_count': 0,
                    'internal_hours_total': 0,
                    'external_hours_total': 0,
                    'internal_hourly_rate_total': 0.0,
                    'external_hourly_rate_total': 0.0,
                }
            })

            name = p.get('name') or ''
            site = p.get('site') or ''
            is_external = bool(p.get('external'))
            if is_external:
                hourly_rate = float(ext_rates.get(name, default_ext_rate) or 0)
                hours = int(site_hours_map.get(site, {}).get('external', 0) or 0)
                entry['totals']['external_count'] += 1
                entry['totals']['external_hourly_rate_total'] += hourly_rate
                entry['totals']['external_hours_total'] += hours
            else:
                hourly_rate = float(internal_default_rate or 0)
                hours = int(site_hours_map.get(site, {}).get('internal', 0) or 0)
                entry['totals']['internal_count'] += 1
                entry['totals']['internal_hourly_rate_total'] += hourly_rate
                entry['totals']['internal_hours_total'] += hours

            entry['members'].append({
                'name': name,
                'external': is_external,
                'site': site,
                'hourly_rate': hourly_rate,
                'hours_per_month': hours,
            })

        teams = list(teams_map.values())
        return { 'teams': teams }
    except Exception as e:
        logger.exception('Failed to build teams data: %s', e)
        raise HTTPException(status_code=500, detail="Internal server error")
