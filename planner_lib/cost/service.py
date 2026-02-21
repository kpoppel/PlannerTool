from typing import List, Dict, Any, Optional
from .engine import calculate, invalidate_team_rates_cache
import logging
from datetime import datetime, timezone
from planner_lib.storage.interfaces import StorageProtocol
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
        storage: StorageProtocol,
        project_service: ProjectServiceProtocol,
        team_service: TeamServiceProtocol,
        people_service: PeopleServiceProtocol,
        cache_storage: StorageProtocol,
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
        # Load cost configuration once at service construction by reading the
        # underlying storage directly. This removes the need for a separate
        # helper to be called from the application.
        try:
            cost_cfg = {}
            db_cfg = {}
            cost_cfg = {}
            try:
                cost_cfg = self._storage.load("config", "cost_config") or {}
            except Exception:
                cost_cfg = {}

            # Get people from PeopleService
            people = []
            try:
                people = self._people_service.get_people()
            except Exception:
                people = []
            
            database = {"people": people}

            # Validate team consistency against configured teams where possible.
            try:
                self._validate_team_consistency(database)
            except ValueError:
                # Do not raise on validation failure at startup; log and continue.
                logger.debug('Team consistency validation failed during CostService init')

            self._cfg = {"cost": cost_cfg or {}, "database": database or {}}
        except Exception:
            self._cfg = {"cost": {}, "database": {}}

    def _validate_team_consistency(self, db: dict) -> None:
        """Ensure teams declared in server config are used by people in `database`.

        Raises ValueError if inconsistencies are found. The check builds the canonical
        set of team ids (slugified as `team-<slug>`) and the set of team ids present
        in people entries (slugified similarly). If some configured teams are not
        referenced by any person, this function raises a ValueError listing the
        missing team names.
        """
        from planner_lib.util import slugify

        # Extract configured team names from teams configuration (teams_service)
        teams_list = self._team_service.list_teams() or []
        configured_ids = set(elem.get("id", "") for elem in teams_list)

        #logger.debug("Configured team ids: %s", configured_ids)

        # Extract team names referenced by people
        people = db.get('people', [])
        people_team_ids = set()
        for p in people or []:
            raw = p.get('team_name') or p.get('team') or ''
            raw = str(raw).strip()
            if not raw:
                continue
            people_team_ids.add(slugify(raw, prefix='team-'))

        #logger.debug("Team ids referenced by people in database: %s", people_team_ids)

        # Find configured but unused teams, and teams present in database but not configured
        missing_configured = sorted(list(configured_ids - people_team_ids))
        missing_in_db = sorted(list(people_team_ids - configured_ids))

        logger.debug("Missing configured teams (not referenced by any person): %s", missing_configured)
        logger.debug("Teams present in database but not configured: %s", missing_in_db)

        if missing_configured or missing_in_db:
            parts = []
            if missing_configured:
                human_missing = ', '.join(sorted([m.replace('team-', '') for m in missing_configured]))
                parts.append(f"configured-but-unused: {human_missing}")
            if missing_in_db:
                human_extra = ', '.join(sorted([m.replace('team-', '') for m in missing_in_db]))
                parts.append(f"in-database-but-not-configured: {human_extra}")
            raise ValueError("Team configuration mismatch: " + '; '.join(parts))
        ## TODO: simplify the above logic a lot. It just loads two keys from storage!!!

    def invalidate_cache(self) -> None:
        """Invalidate the team rates cache.
        
        Call this after updating teams, people, or cost configuration to force
        recomputation of team aggregates on the next cost calculation.
        """
        invalidate_team_rates_cache(self._cache_storage)
        logger.debug("CostService: team rates cache invalidated")

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
        # This helps us identify which work items are projects
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
                            # Check if the parent is actually a project type (not a team)
                            # Only set has_project_parent if we know the type, don't assume
                            if parent_proj in project_types:
                                parent_type = project_types[parent_proj]
                                if parent_type == 'project':
                                    has_project_parent = True
            
            # Determine which projects should include this feature
            target_projects = []
            
            # Add the feature's own project if valid
            if project_id and (not isinstance(allowed_projects, set) or not allowed_projects or project_id in allowed_projects):
                target_projects.append(project_id)
            
            # Add parent projects (if different from own project)
            for parent_proj in parent_project_ids:
                if parent_proj != project_id and (not isinstance(allowed_projects, set) or not allowed_projects or parent_proj in allowed_projects):
                    target_projects.append(parent_proj)
            
            # Skip if no valid project to assign to
            if not target_projects:
                if project_id:
                    logger.debug("Skipping feature %s: project %s not in configured projects", fid, project_id)
                continue
            
            start = f.get("start")
            end = f.get("end")
            capacity = f.get("capacity", [])

            # Calculate cost for projects
            cost = calculate(cfg, start=start, end=end, capacity=capacity, cache_storage=self._cache_storage)
            # Add has_project_parent metadata for filtering
            cost_with_meta = dict(cost)
            cost_with_meta['has_project_parent'] = has_project_parent
            for target_project_id in target_projects:
                if target_project_id not in projects:
                    projects[target_project_id] = {}
                projects[target_project_id][fid] = cost_with_meta

        # Return both the projects dict and the type mapping
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
        features = []
        for fid, fval in val.items():
            if fid == "totals":
                continue
            if not isinstance(fval, dict):
                continue
            metrics = {"internal": {}, "external": {}, "misc": {}}
            for m_k, m_v in fval.items():
                if m_k.startswith("internal_"):
                    metric_name = m_k.split("internal_", 1)[1]
                    metrics["internal"][metric_name] = m_v
                elif m_k.startswith("external_"):
                    metric_name = m_k.split("external_", 1)[1]
                    metrics["external"][metric_name] = m_v
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

