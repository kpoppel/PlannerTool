from fastapi import APIRouter, Request, Body, HTTPException
from planner_lib.middleware import require_session
from planner_lib.middleware.session import get_session_id_from_request, session_manager, SESSION_COOKIE
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post('/cost')
@require_session
async def api_cost_post(request: Request, payload: dict = Body(default={})):
    sid = get_session_id_from_request(request)
    logger.debug("Calculating cost for session %s", sid)
    try:
        from planner_lib.cost import estimate_costs, build_cost_schema
        from planner_lib.projects import list_tasks
        from planner_lib.scenarios.scenario_store import load_user_scenario

        ctx = session_manager.get(sid) or {}
        email = ctx.get('email')
        pat = ctx.get('pat')
        if email and not pat:
            try:
                loaded = request.app.state.config_manager.load(email) if hasattr(request.app.state, 'config_manager') else None
                if loaded:
                    pat = loaded.get('pat')
                    ctx['pat'] = pat
                    session_manager.set(sid, ctx)
            except Exception as e:
                logger.exception('Failed to load user config for %s: %s', email, e)

        user_id = email or ''
        features = (payload or {}).get('features')
        scenario_id = (payload or {}).get('scenarioId') or (payload or {}).get('scenario_id') or (payload or {}).get('scenario')

        if features is None:
            tasks = list_tasks(pat=pat)
            features = []
            for t in (tasks or []):
                capacity = t.get('capacity')
                if not isinstance(capacity, list):
                    capacity = []
                features.append({
                    'id': t.get('id'),
                    'project': t.get('project'),
                    'start': t.get('start'),
                    'end': t.get('end'),
                    'capacity': capacity,
                    'title': t.get('title'),
                    'type': t.get('type'),
                    'state': t.get('state'),
                })

        applied_overrides = None
        if scenario_id:
            try:
                scen = load_user_scenario(request.app.state.scenarios_storage if hasattr(request.app.state, 'scenarios_storage') else None, user_id, scenario_id)
                overrides = scen.get('overrides') if isinstance(scen, dict) else None
                if overrides:
                    applied_overrides = {}
                    new_features = []
                    for f in features:
                        fid = str(f.get('id'))
                        f_copy = dict(f)
                        if fid in overrides:
                            ov = overrides[fid]
                            if isinstance(ov, dict):
                                if 'start' in ov:
                                    f_copy['start'] = ov.get('start')
                                if 'end' in ov:
                                    f_copy['end'] = ov.get('end')
                                if 'capacity' in ov:
                                    capacity_override = ov.get('capacity')
                                    if isinstance(capacity_override, list):
                                        f_copy['capacity'] = capacity_override
                            applied_overrides[fid] = ov
                        new_features.append(f_copy)
                    features = new_features
            except KeyError:
                raise HTTPException(status_code=404, detail='Scenario not found')
            except HTTPException:
                raise
            except Exception as e:
                logger.exception('Failed to load scenario %s: %s', scenario_id, e)

        ctx = dict(ctx)
        ctx['features'] = features

        raw = estimate_costs(ctx) or {}
        if scenario_id:
            raw = dict(raw)
            raw_meta = raw.get('meta') if isinstance(raw.get('meta'), dict) else {}
            raw_meta.update({'scenario_id': scenario_id, 'applied_overrides': applied_overrides})
            raw['meta'] = raw_meta

        return build_cost_schema(raw, mode='full', session_features=ctx.get('features'))
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('Failed to calculate cost: %s', e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/cost')
@require_session
async def api_cost_get(request: Request):
    sid = request.headers.get("X-Session-Id") or request.cookies.get(SESSION_COOKIE)
    if not sid or not session_manager.exists(sid):
        from planner_lib.cost import build_cost_schema
        return build_cost_schema({}, mode='schema', session_features=None)

    sid = get_session_id_from_request(request)
    logger.debug("Fetching calculated cost for session %s", sid)
    ctx = session_manager.get(sid) or {}
    email = ctx.get('email')
    pat = ctx.get('pat')
    if email and not pat:
        try:
            loaded = request.app.state.config_manager.load(email) if hasattr(request.app.state, 'config_manager') else None
            if loaded:
                pat = loaded.get('pat')
                ctx['pat'] = pat
                session_manager.set(sid, ctx)
        except Exception as e:
            logger.exception('Failed to load user config for %s: %s', email, e)

    try:
        from planner_lib.projects import list_tasks
        from planner_lib.cost import build_cost_schema, estimate_costs

        tasks = list_tasks(pat=pat)
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
            })

        ctx = dict(ctx)
        ctx['features'] = features
        raw = estimate_costs(ctx)
        return build_cost_schema(raw, mode='full', session_features=features)

    except Exception as e:
        logger.exception('Failed to fetch cost data: %s', e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/cost/teams')
@require_session
async def api_cost_teams(request: Request):
    try:
        from planner_lib.cost.config import load_cost_config
        from planner_lib.util import slugify

        cfg = load_cost_config() or {}
        cost_cfg = cfg.get('cost', {}) or {}
        db_cfg = cfg.get('database', {}) or {}
        people = db_cfg.get('people', []) or []

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
        raise HTTPException(status_code=500, detail=str(e))
