from typing import List, Dict, Any, Optional
from .config import load_cost_config
from .engine import calculate
import logging
from datetime import datetime
logger = logging.getLogger(__name__)


# def build_cost_schema(raw: Dict[str, Any], mode: str = 'full', session_features: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
#     """Build the standard response schema around raw estimator output.

#     Accepts optional `session_features` (list of feature dicts from the session)
#     which are used to enrich feature entries with `name`, `start`, and `end` and
#     to compute the dataset `configuration.dataset_start` / `dataset_end`.
#     """
#     return format_cost_response(raw or {}, mode=mode, session_features=session_features)

def estimate_costs(session: Dict[str, Any]) -> Dict[str, Dict[str, Dict[str, Any]]]:
    """Traverse features/tasks from a session-like dict and compute costs using `calculate`.

    Returns nested mapping { project_id: { task_id: cost_dict } }
    """
    cfg = load_cost_config()
    features = session.get("features", []) if session else []

    # Respect server configuration: only include features belonging to
    # configured projects. Use the loaded BackendConfig from planner_lib.setup
    # to determine allowed project ids (slugified with prefix 'project-').
    try:
        from planner_lib.setup import get_loaded_config
        from planner_lib.util import slugify
        loaded_cfg = get_loaded_config()
        allowed_projects = None
        if loaded_cfg and getattr(loaded_cfg, "project_map", None):
            _tmp = set()
            for p in loaded_cfg.project_map:
                if isinstance(p, dict) and isinstance(p.get("name"), str):
                    _tmp.add(slugify(p.get("name"), prefix="project-"))
            if _tmp:
                allowed_projects = _tmp
    except Exception:
        allowed_projects = None

    projects: Dict[str, Dict[str, Dict[str, Any]]] = {}

    for f in features:
        logger.debug("Estimating cost for feature/task: %s", f)
        fid = f.get("id")
        project_id = f.get("project")
        # If server config defines a project map, ignore features not in that map
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
        "generated_at": datetime.utcnow().isoformat() + "Z",
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
