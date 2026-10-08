from typing import List, Dict, Any, Optional
from .engine import invalidate_team_rates_cache
from .allocation_rule import build_allocation_graph, resolve_effective_allocations
from . import engine as _engine
import logging
from datetime import datetime, timezone
from planner_lib.storage.base import StorageBackend

logger = logging.getLogger(__name__)


class CostService:
    """Service responsible for cost estimation and schema formatting.

    The service is composed with a YAML `storage` instance so it can read
    `projects.yml`, `teams.yml` and `cost_config.yml` via the storage layer.
    It uses PeopleService to access people data.
    """

    def __init__(
        self,
        storage: StorageBackend,
        project_repository,
        team_repository,
        people_repository,
        cache_storage: StorageBackend,
    ):
        self._storage = storage
        self._people_repository = people_repository
        self._project_service = project_repository  # internal alias kept for brevity
        self._team_service = team_repository         # internal alias kept for brevity
        self._cache_storage = cache_storage
        self._cfg = self._load_cfg()

    def _load_cfg(self) -> dict:
        """Load cost configuration and people data from storage.

        Only catches expected missing-key / file-not-found errors. Unexpected
        exceptions (schema errors, corrupt data, etc.) are allowed to propagate
        so they are visible rather than silently producing empty config.
        """
        try:
            # cost_config lives in the diskcache config namespace after migration 0021.
            cost_cfg = self._storage.load("config", "cost_config") or {}
        except KeyError:
            cost_cfg = {}
        people = []
        try:
            people = self._people_repository.list_people()
        except KeyError:
            pass
        return {"cost": cost_cfg, "database": {"people": people}}

    def invalidate_cache(self) -> None:
        """Invalidate the team rates cache.

        Call this after updating teams, people, or cost configuration to force
        recomputation of team aggregates on the next cost calculation.
        """
        invalidate_team_rates_cache(self._cache_storage)
        logger.debug("CostService: team rates cache invalidated")

    def reload(self) -> None:
        """Reload cost configuration and people data from storage, then invalidate caches.

        Satisfies the Reloadable protocol. Call after an admin config save so
        subsequent requests see updated cost config without a restart.
        """
        self._cfg = self._load_cfg()
        self.invalidate_cache()
        logger.info("CostService: configuration reloaded")

    def get_cost_config(self) -> dict:
        """Return the raw cost_config dict (working_hours, external_cost, internal_cost, …)."""
        return self._cfg.get("cost", {})

    def estimate_costs(self, session: Dict[str, Any]) -> Dict[str, Any]:
        """Traverse features/tasks from a session-like dict and compute costs.

        Returns nested mapping { project_id: { task_id: cost_dict } }
        """
        features = session.get('features', [])
        plans = self._project_service.list_projects()
        allowed_projects = {plan['id'] for plan in plans}
        project_types = {plan['id']: plan['type'] for plan in plans}
        project_container_order = {plan['id']: plan['container_order'] for plan in plans}
        graph = build_allocation_graph(features)
        features_by_id, parents_by_child, _ = graph
        allocations = resolve_effective_allocations(features, graph)
        known_teams = {team['id'] for team in self._team_service.list_teams()}
        unknown_teams = []

        targets_by_id = {}
        for feature in features:
            target_ids = set()
            pending = [str(feature['id'])]
            visited = set()
            while pending:
                current_id = pending.pop()
                if current_id in visited:
                    continue
                visited.add(current_id)
                current = features_by_id[current_id]
                if current.get('project') and not current.get('ancestorOnly', False):
                    target_ids.add(current['project'])
                target_ids.update(current.get('sourcePlanIds', []))
                pending.extend(parents_by_child[current_id])
            if allowed_projects:
                target_ids.intersection_update(allowed_projects)
            targets_by_id[str(feature['id'])] = sorted(target_ids)

        projects = {}
        for feature in features:
            if feature.get('ancestorOnly', False) or feature.get('stateCategory') == 'Removed':
                continue
            feature_id = feature['id']
            for allocation in feature.get('capacity', []):
                if allocation['team'] not in known_teams:
                    unknown_teams.append({'feature_id': feature_id, **allocation})
            target_projects = targets_by_id[str(feature_id)]
            if not target_projects:
                continue
            cost = _engine.calculate_detailed(
                self._cfg, start=feature.get('start'), end=feature.get('end'),
                capacity=allocations[str(feature_id)], cache_storage=self._cache_storage,
            )
            cost['has_project_parent'] = bool(parents_by_child[str(feature_id)])
            for project_id in target_projects:
                project = projects.setdefault(project_id, {'totals': {}})
                project[feature_id] = cost
                for team in cost['teams'].values():
                    for site, metrics in team['internalSites'].items():
                        sites = project['totals'].setdefault('sites', {})
                        totals = sites.setdefault(site, {'hours': {}, 'cost': {}})
                        for metric, months in metrics.items():
                            for month, value in months.items():
                                totals[metric][month] = round(totals[metric].get(month, 0) + value, 2)
        return {'projects': projects, 'project_types': project_types,
                'project_container_order': project_container_order, 'unknown_teams': unknown_teams}


def _parse_totals(totals: dict) -> dict:
    out: Dict[str, Any] = {}
    for k, v in (totals or {}).items():
        parts = k.rsplit('_', 2)
        if len(parts) == 3:
            period, direction, metric = parts
            period_group = out.setdefault(period, {})
            dir_group = period_group.setdefault(direction, {})
            dir_group[metric] = v
        else:
            out.setdefault('misc', {})[k] = v
    return out


def build_cost_schema(src: Dict[str, Any], mode: str = 'full', session_features: Optional[List[Dict[str, Any]]] = None, project_types: Optional[Dict[str, str]] = None, project_container_order: Optional[Dict[str, int]] = None, unknown_teams: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Convert the raw cost mapping returned by `estimate_costs` into the
    normalized strongly-structured schema used by the UI. Optionally enrich
    features with metadata from `session_features` and compute dataset bounds.
    
    Args:
        src: Raw cost mapping from estimate_costs
        mode: 'full' or 'schema'
        session_features: Optional list of feature metadata
        project_types: Optional mapping of project_id to configured container type
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
        # Format name based on whether it's a project or team
        if proj_id.startswith("project-"):
            name = proj_id.replace("project-", "", 1).capitalize()
        elif proj_id.startswith("team-"):
            name = proj_id.replace("team-", "", 1).capitalize()
        else:
            name = proj_id
        totals = _parse_totals(val.get("totals", {}) if isinstance(val.get("totals", {}), dict) else {})
        # If the raw project data provided a structured 'sites' totals mapping,
        # carry that through to the schema so the frontend can render per-site
        # monthly totals directly.
        raw_totals = val.get('totals') if isinstance(val.get('totals'), dict) else {}
        if isinstance(raw_totals.get('sites'), dict):
            totals.setdefault('sites', raw_totals.get('sites'))
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
                    else:
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
            }
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
    if isinstance(src.get("meta"), dict):
        out["meta"].update({k: v for k, v in src["meta"].items() if k in ("scenario_id", "applied_overrides", "deltas")})
    return out

