from typing import List, Dict, Any, Optional
from .allocation_rule import (
    allocation_conflicts, build_allocation_graph, has_valid_allocation_span,
    resolve_effective_allocations,
)
from . import engine as _engine
import logging
from datetime import datetime, timezone
from planner_lib.storage.base import StorageBackend
from planner_lib.domain.teams import TeamCatalogue
from planner_lib.domain.workforce import WorkforceCatalogue

logger = logging.getLogger(__name__)


class WorkforceCostService:
    """Canonical runtime pricing; requires migrated schemas and has no people/rate fallback."""

    def __init__(self, storage: StorageBackend, project_repository: Any) -> None:
        self._storage = storage
        self._projects = project_repository

    def _catalogues(self) -> tuple[TeamCatalogue, WorkforceCatalogue]:
        with self._storage.transaction():
            teams = TeamCatalogue(self._storage.load('config', 'teams'))
            workforce = WorkforceCatalogue(self._storage.load('config', 'workforce'), teams)
            return teams, workforce

    def invalidate_cache(self) -> None:
        """No derived rate cache exists: every estimate reads a coherent current snapshot."""
        return None

    def reload(self) -> None:
        """Validate the current canonical snapshot without retaining stale workforce bases."""
        self._catalogues()

    def team_bases(self) -> dict[str, Any]:
        """Expose anonymous member bases and separately identified non-charged group rollups."""
        teams, workforce = self._catalogues()
        return {'catalogue': teams.definitions(), 'teams': workforce.team_bases(),
            'groups': workforce.group_bases(), 'suppliers': workforce.definitions()['suppliers']}

    def estimate_costs(self, session: Dict[str, Any]) -> Dict[str, Any]:
        """Resolve complete reservations before projecting costs into configured owner plans."""
        teams, workforce = self._catalogues()
        definitions = teams.definitions()
        memberships = {
            item['id']: item['group_id'] for item in definitions
            if item['kind'] == 'team' and item['group_id'] is not None
        }
        features = session['features']
        graph = build_allocation_graph(features)
        by_id, parents, _ = graph
        conflicts = allocation_conflicts(features, memberships)
        if conflicts:
            raise ValueError(f'Allocation graph has group/member conflicts: {conflicts}')
        allocations = resolve_effective_allocations(features, graph, memberships)
        plans = self._projects.list_projects()
        plan_ids = {plan['id'] for plan in plans}
        known = {item['id'] for item in definitions}
        unknown = []
        projects: dict[str, Any] = {}
        for feature in features:
            if feature.get('stateCategory') == 'Removed' or feature.get('ancestorOnly', False):
                continue
            feature_id = str(feature['id'])
            unknown.extend({'feature_id': feature['id'], **item}
                           for item in feature.get('capacity', []) if item['team'] not in known)
            target_ids: set[str] = set()
            pending = [feature_id]
            visited: set[str] = set()
            while pending:
                current_id = pending.pop()
                if current_id in visited:
                    continue
                visited.add(current_id)
                current = by_id[current_id]
                if current.get('project') and not current.get('ancestorOnly', False):
                    target_ids.add(current['project'])
                target_ids.update(current.get('sourcePlanIds', []))
                pending.extend(parents[current_id])
            target_ids.intersection_update(plan_ids)
            cost = _engine.calculate_workforce_detailed(
                teams, workforce, feature.get('start'), feature.get('end'), allocations[feature_id],
            )
            original = feature.get('capacity', []) if has_valid_allocation_span(feature) else []
            estimate = _engine.calculate_workforce_detailed(
                teams, workforce, feature.get('start'), feature.get('end'), original,
            )
            cost['estimate_teams'] = estimate['teams']
            cost['effective_capacity'] = allocations[feature_id]
            cost['has_project_parent'] = bool(parents[feature_id])
            for project_id in sorted(target_ids):
                project = projects.setdefault(project_id, {'totals': {
                    'internal': {'hours': {}, 'cost': {}},
                    'external': {'hours': {}, 'cost': {}}, 'complete': True,
                }})
                project[feature['id']] = cost
                project['totals']['complete'] = project['totals']['complete'] and cost['complete']
                for team in cost['teams'].values():
                    for account in ('internal', 'external'):
                        for metric in ('hours', 'cost'):
                            months = project['totals'][account][metric]
                            for month, value in team[metric][account].items():
                                months[month] = round(months.get(month, 0) + value, 2)
        return {
            'projects': projects,
            'project_types': {plan['id']: plan['type'] for plan in plans},
            'project_names': {plan['id']: plan['name'] for plan in plans},
            'project_container_order': {plan['id']: plan['container_order'] for plan in plans},
            'unknown_teams': unknown, 'complete': not unknown,
        }


def build_cost_schema(src: Dict[str, Any], mode: str = 'full', session_features: Optional[List[Dict[str, Any]]] = None, project_types: Optional[Dict[str, str]] = None, project_names: Optional[Dict[str, str]] = None, project_container_order: Optional[Dict[str, int]] = None, unknown_teams: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Convert the raw cost mapping returned by `estimate_costs` into the
    normalized strongly-structured schema used by the UI. Optionally enrich
    features with metadata from `session_features` and compute dataset bounds.
    
    Args:
        src: Raw cost mapping from estimate_costs
        mode: 'full' or 'schema'
        session_features: Optional list of feature metadata
        project_types: Optional mapping of project_id to configured container type
        project_names: Configured display names keyed by project_id
        project_container_order: Optional mapping of project_id to configured hierarchy order
    """
    meta = {
        "schema_version": "2.0",
        # Use timezone-aware UTC timestamp and render with 'Z'
        "generated_at": datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        "response_mode": mode,
        "scenario_id": None,
    }
    configuration = src.get("configuration") if isinstance(src.get("configuration"), dict) else {}

    # compute dataset bounds from provided session_features if available
    if session_features:
        starts = []
        ends = []
        for f in session_features:
            s = f.get('start')
            e = f.get('end')
            try:
                if s:
                    starts.append(datetime.fromisoformat(s))
            except Exception:
                pass
            try:
                if e:
                    ends.append(datetime.fromisoformat(e))
            except Exception:
                pass
        if starts:
            configuration['dataset_start'] = min(starts).date().isoformat()
        if ends:
            configuration['dataset_end'] = max(ends).date().isoformat()

    projects = []
    # convenience maps for quick lookup of feature metadata
    feature_meta: Dict[str, Dict[str, Any]] = {}
    if session_features:
        for f in session_features:
            fid = str(f.get('id'))
            # normalize and only keep keys we care about so downstream
            # code can safely read 'title', 'state', 'type', 'start', 'end'
            entry: Dict[str, Any] = {}
            if 'title' in f:
                entry['title'] = f.get('title')
            if 'state' in f:
                entry['state'] = f.get('state')
            if 'type' in f:
                entry['type'] = f.get('type')
            if 'start' in f:
                entry['start'] = f.get('start')
            if 'end' in f:
                entry['end'] = f.get('end')
            feature_meta[fid] = entry

    for key, val in (src or {}).items():
        if key == "configuration" or key == "meta":
            continue
        if not isinstance(val, dict):
            continue
        proj_id = key
        if project_names is None or proj_id not in project_names:
            raise ValueError(f'No configured display name for cost project {proj_id}')
        name = project_names[proj_id]
        totals = dict(val['totals'])
        features = []
        for fid, fval in val.items():
            if fid == "totals":
                continue
            if not isinstance(fval, dict):
                continue
            metrics = {"internal": {}, "external": {}, "misc": {}, "teams": {}}
            for m_k, m_v in fval.items():
                if m_k.startswith("internal_"):
                    metric_name = m_k.split("internal_", 1)[1]
                    metrics["internal"][metric_name] = m_v
                elif m_k.startswith("external_"):
                    metric_name = m_k.split("external_", 1)[1]
                    metrics["external"][metric_name] = m_v
                else:
                    # Preserve the teams structure if present directly on feature value
                    if m_k == 'teams' and isinstance(m_v, dict):
                        metrics["teams"] = m_v
                    elif m_k not in ('estimate_teams', 'effective_capacity', 'complete', 'missing_basis'):
                        metrics.setdefault("misc", {})[m_k] = m_v

            fid_s = str(fid)
            meta_entry = feature_meta.get(fid_s, {})
            # prefer 'title' or 'name' from session metadata for the feature name
            feature_name = meta_entry.get('title')
            feature_state = meta_entry.get('state') or 'unknown'
            feature_type = meta_entry.get('type')
            feature_start = meta_entry.get('start')
            feature_end = meta_entry.get('end')

            # attach overrides and delta if present in top-level meta
            overrides = None
            delta = None
            if isinstance(src.get('meta'), dict):
                overrides = src['meta'].get('applied_overrides', {}).get(fid_s)
                delta = src['meta'].get('deltas', {}).get(fid_s)

            feature_obj: Dict[str, Any] = {
                "id": fid_s,
                "title": feature_name,
                "type": feature_type,
                "state": feature_state,
                "start": feature_start,
                "end": feature_end,
                "metrics": metrics,
                "estimateTeams": fval.get('estimate_teams', {}),
                "effectiveCapacity": fval.get('effective_capacity', []),
            }
            if 'complete' in fval:
                feature_obj['complete'] = fval['complete']
                feature_obj['missingBasis'] = fval['missing_basis']
            # Derive per-month maps for metrics.internal and metrics.external
            # from the per-team monthly buckets when available. This allows the
            # frontend to render month columns directly from feature.metrics
            # without requiring client-side allocation fallbacks.
            try:
                teams_map = metrics.get('teams') or {}
                if isinstance(teams_map, dict) and teams_map:
                    # initialize month maps
                    mi_cost = {}
                    mi_hours = {}
                    me_cost = {}
                    me_hours = {}
                    for team_k, tval in teams_map.items():
                        if not isinstance(tval, dict):
                            continue
                        # cost and hours shapes expected: { cost: { internal: {m: v} }, hours: { internal: {m: v} } }
                        t_cost = tval.get('cost') or {}
                        t_hours = tval.get('hours') or {}
                        # internal
                        tinc = t_cost.get('internal') or {}
                        tinh = t_hours.get('internal') or {}
                        for m, v in (tinc.items() if isinstance(tinc, dict) else []):
                            mi_cost[m] = mi_cost.get(m, 0) + (float(v or 0))
                        for m, v in (tinh.items() if isinstance(tinh, dict) else []):
                            mi_hours[m] = mi_hours.get(m, 0) + (float(v or 0))
                        # external
                        tinc_e = t_cost.get('external') or {}
                        tinh_e = t_hours.get('external') or {}
                        for m, v in (tinc_e.items() if isinstance(tinc_e, dict) else []):
                            me_cost[m] = me_cost.get(m, 0) + (float(v or 0))
                        for m, v in (tinh_e.items() if isinstance(tinh_e, dict) else []):
                            me_hours[m] = me_hours.get(m, 0) + (float(v or 0))
                    # Only attach month maps if we collected any entries
                    if mi_cost or mi_hours or me_cost or me_hours:
                        metrics.setdefault('internal', {})
                        metrics.setdefault('external', {})
                        # Replace numeric totals with month maps if applicable
                        if mi_cost: metrics['internal']['cost'] = mi_cost
                        if mi_hours: metrics['internal']['hours'] = mi_hours
                        if me_cost: metrics['external']['cost'] = me_cost
                        if me_hours: metrics['external']['hours'] = me_hours
            except Exception:
                # be tolerant — if aggregation fails, leave metrics as-is
                pass
            # Include has_project_parent flag if present in cost data
            if 'has_project_parent' in fval:
                feature_obj['has_project_parent'] = fval.get('has_project_parent')
            if overrides is not None:
                feature_obj['overrides_applied'] = overrides
            if delta is not None:
                feature_obj['delta'] = delta
                feature_obj['status'] = 'changed'
            else:
                feature_obj['status'] = 'unchanged'

            features.append(feature_obj)
        proj_type = project_types.get(proj_id) if project_types is not None else None
        projects.append({
            "id": proj_id,
            "name": name,
            "type": proj_type,
            "totals": totals,
            "features": features
        })
        if project_container_order is not None:
            projects[-1]['container_order'] = project_container_order[proj_id]
    
    def sort_key(p):
        if project_container_order is not None:
            return (p['container_order'], str(p['id']))
        return str(p['id'])
    
    projects.sort(key=sort_key)
    
    out = {
        "meta": meta,
        "configuration": configuration,
        "projects": projects,
        "unknown_teams": [] if unknown_teams is None else unknown_teams,
    }
    out['complete'] = not out['unknown_teams'] and all(
        project['totals']['complete'] for project in projects if 'complete' in project['totals']
    )
    if isinstance(src.get("meta"), dict):
        out["meta"].update({k: v for k, v in src["meta"].items() if k in ("scenario_id", "applied_overrides", "deltas")})
    return out
