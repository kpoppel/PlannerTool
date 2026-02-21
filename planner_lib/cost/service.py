from typing import List, Dict, Any, Optional
from .engine import calculate
import logging
from datetime import datetime, timezone
from planner_lib.storage.interfaces import StorageProtocol
from planner_lib.projects.project_service import ProjectServiceProtocol
from planner_lib.projects.interfaces import TeamServiceProtocol

logger = logging.getLogger(__name__)


class CostService:
    """Service responsible for cost estimation and schema formatting.

    The service is composed with a YAML `storage` instance so it can read
    `projects.yml`, `teams.yml` and `cost_config.yml` via the storage layer.
    """

    def __init__(
        self,
        storage: StorageProtocol,
        project_service: ProjectServiceProtocol,
        team_service: TeamServiceProtocol,
        people_storage: StorageProtocol,
    ):
        # `storage` is the config/cost storage (yaml). `people_storage` may
        # be provided separately (specific file backend). The `team_service`
        # must be provided and will be used exclusively for configured
        # teams lookup; there is no fallback to loading teams from storage.
        self._storage = storage
        self._people_storage = people_storage
        self._project_service = project_service
        self._team_service = team_service
        # Load cost configuration once at service construction by reading the
        # underlying storage directly. This removes the need for a separate
        # helper to be called from the application.
        ## TODO: From here:
        try:
            cost_cfg = {}
            db_cfg = {}
            cost_cfg = {}
            raw_db = {}
            try:
                cost_cfg = self._storage.load("config", "cost_config") or {}
            except Exception:
                cost_cfg = {}

            try:
                raw_db = self._people_storage.load("config", "database") or {}
            except Exception:
                raw_db = {}

            database = raw_db.get('database', {})

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
        """Ensure teams declared in server config `teams` are used by people in `database`.

        Ensure teams declared in server config `team_map` are used by people in `database`.

        Raises ValueError if inconsistencies are found. The check builds the canonical
        set of team ids from `team_map` (slugified as `team-<slug>`) and the set of
        team ids present in people entries (slugified similarly). If some configured
        teams are not referenced by any person, this function raises a ValueError
        listing the missing team names.
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

    def estimate_costs(self, session: Dict[str, Any]) -> Dict[str, Dict[str, Dict[str, Any]]]:
        """Traverse features/tasks from a session-like dict and compute costs.

        Returns nested mapping { project_id: { task_id: cost_dict } }
        """
        cfg = self._cfg
        features = session.get("features", []) if session else []
        # Determine allowed project ids via the composed ProjectService.
        allowed_projects = None
        try:
            if self._project_service:
                proj_list = self._project_service.list_projects()
                allowed_projects = {p.get('id') for p in proj_list if isinstance(p, dict) and p.get('id')}
        except Exception:
            allowed_projects = None

        projects: Dict[str, Dict[str, Dict[str, Any]]] = {}

        for f in features:
            logger.debug("Estimating cost for feature/task: %s", f)
            fid = f.get("id")
            project_id = f.get("project")
            if isinstance(allowed_projects, set) and allowed_projects and project_id not in allowed_projects:
                logger.debug("Skipping feature %s: project %s not in configured projects", fid, project_id)
                continue
            start = f.get("start")
            end = f.get("end")
            capacity = f.get("capacity")

            cost = calculate(cfg, start=start, end=end, capacity=capacity)

            if project_id not in projects:
                projects[project_id] = {}
            projects[project_id][fid] = cost

        return projects


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


def build_cost_schema(src: Dict[str, Any], mode: str = 'full', session_features: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Convert the raw cost mapping returned by `estimate_costs` into the
    normalized strongly-structured schema used by the UI. Optionally enrich
    features with metadata from `session_features` and compute dataset bounds.
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
        name = proj_id.replace("project-", "", 1).capitalize() if proj_id.startswith("project-") else proj_id
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
            if overrides is not None:
                feature_obj['overrides_applied'] = overrides
            if delta is not None:
                feature_obj['delta'] = delta
                feature_obj['status'] = 'changed'
            else:
                feature_obj['status'] = 'unchanged'

            features.append(feature_obj)
        projects.append({
            "id": proj_id,
            "name": name,
            "totals": totals,
            "features": features
        })
    out = {
        "meta": meta,
        "configuration": configuration,
        "projects": projects
    }
    if isinstance(src.get("meta"), dict):
        out["meta"].update({k: v for k, v in src["meta"].items() if k in ("scenario_id", "applied_overrides", "deltas")})
    return out

