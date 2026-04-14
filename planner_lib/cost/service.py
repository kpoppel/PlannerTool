from typing import List, Dict, Any, Optional
from .engine import calculate, invalidate_team_rates_cache
from . import engine as _engine
import logging
from datetime import datetime, timezone
from planner_lib.storage.base import StorageBackend
from planner_lib.projects.project_service import ProjectServiceProtocol
from planner_lib.projects.interfaces import TeamServiceProtocol
from planner_lib.people.interfaces import PeopleServiceProtocol

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
        project_service: ProjectServiceProtocol,
        team_service: TeamServiceProtocol,
        people_service: PeopleServiceProtocol,
        cache_storage: StorageBackend,
    ):
        # `storage` is the config/cost storage (yaml). `people_service` provides
        # access to the people database with overrides. The `team_service`
        # must be provided and will be used exclusively for configured
        # teams lookup; there is no fallback to loading teams from storage.
        # `cache_storage` is used for caching team rates computations.
        self._storage = storage
        self._people_service = people_service
        self._project_service = project_service
        self._team_service = team_service
        self._cache_storage = cache_storage
        self._cfg = self._load_cfg()

    def _load_cfg(self) -> dict:
        """Load cost configuration and people data from storage.

        Only catches expected missing-key / file-not-found errors. Unexpected
        exceptions (schema errors, corrupt data, etc.) are allowed to propagate
        so they are visible rather than silently producing empty config.
        """
        try:
            cost_cfg = self._storage.load("config", "cost_config") or {}
        except KeyError:
            cost_cfg = {}
        people = []
        try:
            people = self._people_service.get_people()
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

    def estimate_costs(self, session: Dict[str, Any]) -> Dict[str, Dict[str, Dict[str, Any]]]:
        """Traverse features/tasks from a session-like dict and compute costs.

        Returns nested mapping { project_id: { task_id: cost_dict } }
        """
        cfg = self._cfg
        features = session.get("features", []) if session else []
        # Determine allowed project ids and build type mapping via the composed ProjectService.
        allowed_projects = None
        project_types: Dict[str, str] = {}
        try:
            if self._project_service:
                proj_list = self._project_service.list_projects()
                allowed_projects = {p.get('id') for p in proj_list if isinstance(p, dict) and p.get('id')}
                # Build a mapping of project_id -> type for later use
                for p in proj_list:
                    if isinstance(p, dict) and p.get('id'):
                        project_types[p.get('id')] = p.get('type', 'project')
        except Exception:
            allowed_projects = None

        # First pass: build a mapping from work item ID to project ID
        # This helps us identify which work items are projects. Allow plans
        # of all types to participate in the Project View - do not filter by
        # configured project types here.
        workitem_to_project: Dict[str, str] = {}
        for f in features:
            fid = str(f.get("id", ""))
            project_id = f.get("project")
            if fid and project_id:
                workitem_to_project[fid] = project_id

        projects: Dict[str, Dict[str, Dict[str, Any]]] = {}

        # Second pass: calculate costs and assign to appropriate projects and teams
        for f in features:
            fid = f.get("id")
            project_id = f.get("project")
            title = f.get("title", "") or f.get("name", "")
            
            # Check if this feature has a parent that is a project via relations
            # Treat any parent project id as valid (plans of all types allowed)
            parent_project_ids = []
            has_project_parent = False
            relations = f.get("relations", [])
            if isinstance(relations, list):
                for rel in relations:
                    if isinstance(rel, dict) and rel.get("type") == "Parent":
                        parent_id = str(rel.get("id", ""))
                        # Look up the parent's project in our mapping
                        parent_proj = workitem_to_project.get(parent_id)
                        if parent_proj:
                            parent_project_ids.append(parent_proj)
                            # mark that a project parent exists (no type-based filtering)
                            has_project_parent = True
            
            # Determine which projects should include this feature
            target_projects = []
            
            # Add the feature's own project (allow any project/plan id)
            if project_id:
                target_projects.append(project_id)
            
            # Add parent projects (if different from own project). Include
            # descendants/parent links regardless of configured project types.
            for parent_proj in parent_project_ids:
                if parent_proj != project_id:
                    target_projects.append(parent_proj)
            
            # Skip if no valid project to assign to
            if not target_projects:
                if project_id:
                    logger.debug("Skipping feature %s: project %s not in configured projects", fid, project_id)
                continue
            
            start = f.get("start")
            end = f.get("end")
            capacity = f.get("capacity", [])

            # Calculate detailed cost for projects (including per-team monthly allocations)
            cost = _engine.calculate_detailed(cfg, start=start, end=end, capacity=capacity, cache_storage=self._cache_storage)
            # Add has_project_parent metadata for filtering
            cost_with_meta = dict(cost)
            cost_with_meta['has_project_parent'] = has_project_parent
            # Instrumentation: when inspecting a specific feature, log per-team contributions
            try:
                if str(f.get('id')) == '688051':
                    try:
                        ta = _engine._team_members(self._cfg, cache_storage=self._cache_storage)
                        logger.debug("[INSTR][server] feature=688051 start=%s end=%s capacity=%s", start, end, capacity)
                        for team_entry in (capacity or []):
                            team_key = team_entry.get('team')
                            cap_pct = float(team_entry.get('capacity') or 0)
                            if team_key not in ta:
                                logger.debug("[INSTR][server] team=%s missing from aggregates", team_key)
                                continue
                            summary = ta[team_key]
                            try:
                                base_hours_internal = _engine._hours_between(start, end, int(summary.get('internal_hours_total') or 0))
                            except Exception:
                                base_hours_internal = float(summary.get('internal_hours_total') or 0)
                            alloc_hours_internal = round(base_hours_internal * (cap_pct / 100.0), 2)
                            internal_cost = 0.0
                            if summary.get('internal_hours_total'):
                                fraction_internal = base_hours_internal / max(1.0, float(summary.get('internal_hours_total')))
                                internal_cost = round(float(summary.get('internal_monthly_cost_total', 0.0)) * (cap_pct / 100.0) * fraction_internal, 2)

                            try:
                                base_hours_external = _engine._hours_between(start, end, int(summary.get('external_hours_total') or 0))
                            except Exception:
                                base_hours_external = float(summary.get('external_hours_total') or 0)
                            alloc_hours_external = round(base_hours_external * (cap_pct / 100.0), 2)
                            external_cost = 0.0
                            if summary.get('external_hours_total'):
                                fraction_external = base_hours_external / max(1.0, float(summary.get('external_hours_total')))
                                external_cost = round(float(summary.get('external_monthly_cost_total', 0.0)) * (cap_pct / 100.0) * fraction_external, 2)

                            logger.debug("[INSTR][server] feature=688051 team=%s cap=%s alloc_hours_int=%s alloc_hours_ext=%s internal_cost=%s external_cost=%s sites=%s", team_key, cap_pct, alloc_hours_internal, alloc_hours_external, internal_cost, external_cost, summary.get('sites'))
                    except Exception as e:
                        logger.exception('Failed to instrument feature 688051 internals: %s', e)
            except Exception:
                pass
            for target_project_id in target_projects:
                if target_project_id not in projects:
                    projects[target_project_id] = {}
                projects[target_project_id][fid] = cost_with_meta

        # Return both the projects dict and the type mapping
        # Additionally compute per-project per-site monthly totals so the
        # frontend can present site-level internal breakdown directly.
        team_aggregates = _engine._team_members(self._cfg, cache_storage=self._cache_storage)
        # Debug: log specific team aggregates for investigation
        try:
            logger.debug("[DBG] team_aggregates['team-architecture'] = %s", team_aggregates.get('team-architecture'))
        except Exception:
            pass
        project_sites: Dict[str, Dict[str, Dict[str, Dict[str, float]]]] = {}
        # Determine which features are parents (have children) so we can
        # treat children as authoritative and skip parent entries when
        # computing per-project site totals. This mirrors the client-side
        # behavior that only counts leaf features.
        parent_has_children = set()
        for ftmp in features:
            rels = ftmp.get('relations') or []
            if isinstance(rels, list):
                for rel in rels:
                    if isinstance(rel, dict) and rel.get('type') == 'Parent':
                        parent_id = rel.get('id')
                        if parent_id is not None:
                            parent_has_children.add(str(parent_id))

        # Track which features have already been counted per project to
        # avoid duplicate allocations when the same feature appears multiple
        # times in the dataset (e.g., via relations or multiple mappings).
        seen_per_project: Dict[str, set] = {}

        for f in features:
                fid = f.get('id')
                fid_s = str(fid) if fid is not None else None
                # Skip parent features — children are authoritative
                if fid_s and fid_s in parent_has_children:
                    continue
                project_id = f.get('project')
                start = f.get('start')
                end = f.get('end')
                capacity = f.get('capacity', []) or []
                # Determine target projects same as above logic
                target_projects = []
                if project_id and (not isinstance(allowed_projects, set) or not allowed_projects or project_id in allowed_projects):
                    target_projects.append(project_id)
                relations = f.get('relations', [])
                if isinstance(relations, list):
                    for rel in relations:
                        if isinstance(rel, dict) and rel.get('type') == 'Parent':
                            parent_id = str(rel.get('id', ''))
                            parent_proj = workitem_to_project.get(parent_id)
                            if parent_proj and parent_proj != project_id:
                                target_projects.append(parent_proj)

                for target_project_id in target_projects:
                    # ensure we only count each feature once per project
                    seen = seen_per_project.setdefault(target_project_id, set())
                    if fid_s and fid_s in seen:
                        continue
                    if fid_s:
                        seen.add(fid_s)
                    proj_sites = project_sites.setdefault(target_project_id, {})
                    for team in (capacity or []):
                        team_key = team.get('team')
                        cap = float(team.get('capacity', 0)) / 100.0
                        if not team_key or team_key not in team_aggregates:
                            continue
                        team_summary = team_aggregates[team_key]
                        # only consider internal site breakdown here
                        if not team_summary.get('internal_hours_total'):
                            continue
                        # allocate base hours per month for the team over the span
                        month_buckets = _engine._allocate_months(start, end, int(team_summary.get('internal_hours_total') or 0))
                        # gather per-site info inside team
                        sites_info = team_summary.get('sites', {}) or {}
                        denom = sum((sv.get('internal_hours_total', 0) or 0) for sv in sites_info.values()) or float(team_summary.get('internal_hours_total') or 1)
                        for m_k, base_hours in (month_buckets or {}).items():
                            alloc_hours_team = base_hours * cap
                            # cost per hour for the team average
                            team_cost_per_hour = 0.0
                            if team_summary.get('internal_hours_total'):
                                team_cost_per_hour = float(team_summary.get('internal_monthly_cost_total', 0.0)) / max(1.0, float(team_summary.get('internal_hours_total')))
                            for site, sv in sites_info.items():
                                site_hours_share = (sv.get('internal_hours_total', 0) or 0) / denom if denom else 0
                                site_hours = alloc_hours_team * site_hours_share
                                # prefer site-specific cost per hour when available
                                if sv.get('internal_hours_total'):
                                    site_cost_per_hour = float(sv.get('internal_monthly_cost_total', 0.0)) / max(1.0, float(sv.get('internal_hours_total')))
                                else:
                                    site_cost_per_hour = team_cost_per_hour
                                site_cost = site_hours * site_cost_per_hour
                                site_entry = proj_sites.setdefault(site, {'hours': {}, 'cost': {}})
                                site_entry['hours'][m_k] = site_entry['hours'].get(m_k, 0.0) + round(site_hours, 2)
                                site_entry['cost'][m_k] = site_entry['cost'].get(m_k, 0.0) + round(site_cost, 2)
        # NOTE: intentionally do not swallow exceptions here — let errors
        # propagate so issues are visible and cannot be silently ignored.

        # Attach computed site totals into the projects dict under a 'totals' key
        for pid, pdata in projects.items():
            totals = pdata.setdefault('totals', {})
            sites = project_sites.get(pid) or {}
            if sites:
                totals['sites'] = sites

        return {'projects': projects, 'project_types': project_types}


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


def build_cost_schema(src: Dict[str, Any], mode: str = 'full', session_features: Optional[List[Dict[str, Any]]] = None, project_types: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """Convert the raw cost mapping returned by `estimate_costs` into the
    normalized strongly-structured schema used by the UI. Optionally enrich
    features with metadata from `session_features` and compute dataset bounds.
    
    Args:
        src: Raw cost mapping from estimate_costs
        mode: 'full' or 'schema'
        session_features: Optional list of feature metadata
        project_types: Optional mapping of project_id -> type (e.g., 'project', 'team')
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
        # Get type from project_types mapping, default to 'project'
        proj_type = (project_types or {}).get(proj_id, 'project')
        projects.append({
            "id": proj_id,
            "name": name,
            "type": proj_type,
            "totals": totals,
            "features": features
        })
    
    # Sort projects: actual projects (type='project') first, then teams (type='team')
    # Within each group, sort alphabetically by id for consistent ordering
    def sort_key(p):
        proj_type = str(p.get('type', 'project'))
        proj_id = str(p.get('id', ''))
        # Return tuple: (0 for projects, 1 for teams, 2 for others, id for alphabetical sort)
        type_order = 0 if proj_type == 'project' else (1 if proj_type == 'team' else 2)
        return (type_order, proj_id)
    
    projects.sort(key=sort_key)
    
    out = {
        "meta": meta,
        "configuration": configuration,
        "projects": projects
    }
    if isinstance(src.get("meta"), dict):
        out["meta"].update({k: v for k, v in src["meta"].items() if k in ("scenario_id", "applied_overrides", "deltas")})
    return out

