"""Azure mock client that generates synthetic fixture data from config files.

Instead of replaying pre-recorded SDK responses, this module programmatically
builds a coherent, referentially consistent dataset that mirrors the structure
and statistical variety of real Azure DevOps data.

Data is derived from the existing planner config files:

  data/config/projects.yml  — area paths, team names, allowed task types,
                              include/display states per team
  data/config/teams.yml     — team short names
  data/config/people.yml    — person pool (optional; falls back to
                              ``people_per_team`` synthetic persons)

The generator is a drop-in replacement for ``AzureMockClient``::

    feature_flags:
      use_azure_mock_generator: true
      data_dir: data            # root of the config/ and cache/ directories
      generator_config:
        seed: 42                 # reproducibility; omit for random each run
        n_plans: 6
        default_items_per_area: 20
        n_pis: 6                 # Program Increments to generate
        sprints_per_pi: 4
        revisions_min: 2
        revisions_max: 12
        people_per_team: 7       # used when people.yml is empty
        state_weights:           # New / Defined / Active / Resolved / Closed
          Feature:   [35, 20, 25, 12, 8]
          Epic:      [40, 20, 20, 12, 8]
          default:   [35, 20, 25, 12, 8]
        items_per_area:          # per-area overrides (key = area_path)
          "Platform_Development\\\\eSW\\\\Teams\\\\Architecture": 30

It can also be used standalone::

    from planner_lib.azure.AzureMockGeneratorClient import AzureMockGeneratorClient
    from planner_lib.storage import create_storage

    storage = create_storage(data_dir='data')
    client = AzureMockGeneratorClient('my-org', storage=storage, data_dir='data')
    with client.connect('dummy-pat') as c:
        teams = c.get_all_teams('Platform_Development')
"""
from __future__ import annotations

import hashlib
import logging
import random
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

try:
    import yaml as _yaml
    _YAML_OK = True
except ImportError:
    _yaml = None  # type: ignore[assignment]
    _YAML_OK = False

from planner_lib.azure.AzureCachingClient import AzureCachingClient
from planner_lib.azure.AzureMockClient import _MockClientsAccessor, _safe_key
from planner_lib.storage.base import StorageBackend

# ---------------------------------------------------------------------------
# Default configuration
# ---------------------------------------------------------------------------

_DEFAULT_CONFIG: Dict[str, Any] = {
    "seed": 42,
    "n_plans": 6,
    "default_items_per_area": 20,
    "n_pis": 6,
    "sprints_per_pi": 4,
    "revisions_min": 2,
    "revisions_max": 12,
    "people_per_team": 7,
    # Weight vector per type: [New, Defined, Active, Resolved, Closed]
    "state_weights": {
        "Feature":    [35, 20, 25, 12, 8],
        "Epic":       [40, 20, 20, 12, 8],
        "Initiative": [45, 15, 28,  8, 4],
        "User Story": [30, 20, 28, 14, 8],
        "Bug":        [30,  0, 30, 20, 20],
        "default":    [35, 20, 25, 12, 8],
    },
    # Per-area-path item count overrides  {area_path: n}
    "items_per_area": {},
}

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_STATE_NAMES = ["New", "Defined", "Active", "Resolved", "Closed"]

_STATE_PROGRESSIONS: Dict[str, List[str]] = {
    "Feature":    ["New", "Defined", "Active", "Resolved", "Closed"],
    "Epic":       ["New", "Defined", "Active", "Resolved", "Closed"],
    "Initiative": ["New", "Active"],
    "User Story": ["New", "Defined", "Active", "Resolved", "Closed"],
    "Bug":        ["New", "Active", "Resolved", "Closed"],
    "Task":       ["New", "Active", "Closed"],
}

# Reason reported when entering a state (most recent transition reason)
_ENTRY_REASONS: Dict[str, str] = {
    "New":      "New",
    "Defined":  "Requirements complete",
    "Active":   "Implementation started",
    "Resolved": "Implementation complete",
    "Closed":   "Accepted",
    "Removed":  "Removed",
}

# ADO meta-state categories
_STATE_CATEGORIES: Dict[str, str] = {
    "New":      "Proposed",
    "Defined":  "Proposed",
    "Active":   "InProgress",
    "Resolved": "InProgress",
    "Closed":   "Completed",
    "Removed":  "Removed",
}

# Complete model hierarchy (highest → lowest)
_TYPE_HIERARCHY = ["Initiative", "Epic", "Feature", "Bug", "User Story", "Task"]

# [min, max] number of children to generate per parent type
_CHILDREN_RANGE: Dict[str, tuple] = {
    "Initiative": (2, 4),
    "Epic":       (2, 5),
    "Feature":    (2, 5),
    "Bug":        (0, 0),
    "User Story": (0, 0),
    "Task":       (0, 0),
}

_WORK_ITEM_COLORS: Dict[str, str] = {
    "Initiative": "004B50",
    "Epic":       "FF7B00",
    "Feature":    "773B93",
    "User Story": "009CCC",
    "Bug":        "CC293D",
    "Task":       "F2CB1D",
}

_VALUE_AREAS = ["Business", "Architectural"]

_TAG_POOL = [
    "CI/CD", "Infrastructure", "Documentation", "Blocked",
    "Enabler", "Technical Debt", "Architecture", "Performance",
    "Security", "Testing", "Integration", "API",
    "Migration", "Refactoring", "Release", "Dependency",
    "Review", "Research", "Prototype", "Spike",
]

# Stable reference date for generated timestamps (keeps tests deterministic)
_REF_DATE = datetime(2026, 4, 1, tzinfo=timezone.utc)

# Namespace UUID for deterministic UUID5 generation
_NS = uuid.UUID("12345678-1234-5678-1234-567812345678")

# ---------------------------------------------------------------------------
# Low-level helpers
# ---------------------------------------------------------------------------


def _det_uuid(seed_str: str) -> str:
    """Return a deterministic UUID5 string derived from *seed_str*."""
    return str(uuid.uuid5(_NS, seed_str))


def _det_hex32(seed_str: str) -> str:
    """Return a 32-character uppercase hex string (like a GUID without dashes)."""
    return hashlib.md5(seed_str.encode()).hexdigest().upper()


def _iso(dt: datetime) -> str:
    """Format *dt* as the ISO-8601 string used in ADO fixture files."""
    ms = dt.microsecond // 1000
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{ms:03d}Z"


def _person_dict(display_name: str, uid: str, email: str, base_url: str) -> dict:
    import base64
    raw_bytes = uid.replace("-", "").encode()
    descriptor = "aad." + base64.b64encode(raw_bytes).decode().rstrip("=")
    return {
        "displayName": display_name,
        "url": f"{base_url}/_apis/Identities/{uid}",
        "id": uid,
        "uniqueName": email,
        "descriptor": descriptor,
    }


def _area_to_project(area_path: str) -> str:
    """Extract the Azure DevOps project name (first path segment) from *area_path*."""
    return area_path.split("\\")[0]


def _load_yaml(path: Path) -> Any:
    if not _YAML_OK:
        logger.warning("PyYAML not available; skipping %s", path)
        return None
    if not path.exists():
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            return _yaml.safe_load(fh)
    except Exception as exc:
        logger.warning("Generator: could not read %s: %s", path, exc)
        return None

# ---------------------------------------------------------------------------
# Config loader
# ---------------------------------------------------------------------------


class GeneratorConfig:
    """Merges user-supplied overrides over ``_DEFAULT_CONFIG``."""

    def __init__(self, config_dict: Optional[dict] = None) -> None:
        cfg: Dict[str, Any] = dict(_DEFAULT_CONFIG)
        cfg["state_weights"] = dict(_DEFAULT_CONFIG["state_weights"])
        cfg["items_per_area"] = dict(_DEFAULT_CONFIG["items_per_area"])

        if config_dict:
            if "state_weights" in config_dict:
                cfg["state_weights"].update(config_dict["state_weights"])
            if "items_per_area" in config_dict:
                cfg["items_per_area"].update(config_dict["items_per_area"])
            cfg.update({k: v for k, v in config_dict.items()
                        if k not in ("state_weights", "items_per_area")})

        self.seed: int = int(cfg["seed"]) if cfg.get("seed") is not None else int(
            random.getrandbits(32)
        )
        self.n_plans: int = int(cfg["n_plans"])
        self.default_items_per_area: int = int(cfg["default_items_per_area"])
        self.n_pis: int = int(cfg["n_pis"])
        self.sprints_per_pi: int = int(cfg["sprints_per_pi"])
        self.revisions_min: int = int(cfg["revisions_min"])
        self.revisions_max: int = int(cfg["revisions_max"])
        self.people_per_team: int = int(cfg["people_per_team"])
        self.state_weights: Dict[str, List[int]] = cfg["state_weights"]
        self.items_per_area: Dict[str, int] = cfg["items_per_area"]


# ---------------------------------------------------------------------------
# Config file loaders
# ---------------------------------------------------------------------------


def _load_projects_config(data_dir: str) -> List[dict]:
    """Return the ``project_map`` list from *data_dir*/config/projects.yml."""
    data = _load_yaml(Path(data_dir) / "config" / "projects.yml")
    if not data:
        return []
    return data.get("project_map", [])


def _load_teams_config(data_dir: str) -> Dict[str, str]:
    """Return ``{team_name: short_name}`` from *data_dir*/config/teams.yml."""
    data = _load_yaml(Path(data_dir) / "config" / "teams.yml")
    if not data:
        return {}
    teams = data.get("teams", [])
    return {
        t["name"]: t.get("short_name", t["name"][:3].upper())
        for t in teams if "name" in t
    }


def _build_person_pool(
    data_dir: str,
    area_configs: List[dict],
    config: GeneratorConfig,
    base_url: str,
) -> List[dict]:
    """Build the person pool from people.yml or generate synthetic entries."""
    data = _load_yaml(Path(data_dir) / "config" / "people.yml")
    real_people: List[dict] = []
    if data:
        db_people = (data.get("database") or {}).get("people", [])
        for p in db_people:
            name = p.get("name", "")
            if name:
                uid = _det_uuid(f"person:{name}")
                email = name.lower().replace(" ", ".") + "@example.com"
                real_people.append(_person_dict(name, uid, email, base_url))

    if real_people:
        return real_people

    # Fallback: synthetic pool.  Generate people_per_team per distinct team, but
    # cap total count so the pool stays manageable.
    n_teams = len([a for a in area_configs if a.get("type") == "team"])
    total = max(config.people_per_team, min(n_teams * 2, 60))
    result = []
    for i in range(1, total + 1):
        name = f"Person {i}"
        uid = _det_uuid(f"person:synthetic:{i}")
        email = f"person{i}@example.com"
        result.append(_person_dict(name, uid, email, base_url))
    return result


# ---------------------------------------------------------------------------
# Iteration tree generator
# ---------------------------------------------------------------------------


def _build_iteration_tree(
    project: str,
    config: GeneratorConfig,
    base_url: str,
    project_id: str,
) -> dict:
    """Return an iteration classification-node tree for *project*.

    Structure::

        <project root>
          └── eSW
                └── Platform
                      ├── 2024.Q3  (PI, has start/finish)
                      │     ├── 2024_S1
                      │     ├── 2024_S2
                      │     ...
                      └── 2025.Q1
                            ...

    The sprint name (e.g. ``2025_S3``) is used verbatim as
    ``System.IterationPath`` prefix inside generated work items.
    """
    sprint_weeks = 2
    pi_weeks = sprint_weeks * config.sprints_per_pi
    total_weeks = pi_weeks * config.n_pis

    # Start date: enough PIs in the past so current date is in the last PI
    start_dt = _REF_DATE - timedelta(weeks=total_weeks - pi_weeks)
    start_dt -= timedelta(days=start_dt.weekday())  # align to Monday

    node_id_counter = [2000]

    def _next_nid() -> int:
        node_id_counter[0] += 1
        return node_id_counter[0]

    def _make_node(
        name: str,
        path_segments: List[str],
        start: Optional[datetime],
        end: Optional[datetime],
        children: List[dict],
    ) -> dict:
        path = "\\" + project + "\\Iteration\\" + "\\".join(path_segments)
        attrs: Optional[dict] = None
        if start and end:
            attrs = {
                "startDate": start.strftime("%Y-%m-%dT00:00:00Z"),
                "finishDate": end.strftime("%Y-%m-%dT00:00:00Z"),
            }
        url_path = "/".join(path_segments)
        return {
            "url": (
                f"{base_url}/{project_id}/_apis/wit/"
                f"classificationNodes/Iterations/{url_path}"
            ),
            "attributes": attrs,
            "has_children": bool(children),
            "children": children,
            "id": _next_nid(),
            "identifier": _det_uuid(f"iter:{project}:{path}"),
            "name": name,
            "path": path,
            "structure_type": "iteration",
        }

    # Build PI / Sprint nodes
    cur = start_dt
    sprint_num = 0
    pi_nodes: List[dict] = []

    for _ in range(config.n_pis):
        year = cur.year
        quarter = (cur.month - 1) // 3 + 1
        pi_name = f"{year}.Q{quarter}"
        pi_start = cur
        sprint_nodes: List[dict] = []

        for _ in range(config.sprints_per_pi):
            sprint_num += 1
            s_name = f"{cur.year}_S{sprint_num}"
            s_end = cur + timedelta(weeks=sprint_weeks) - timedelta(days=1)
            sprint_nodes.append(
                _make_node(s_name, ["eSW", "Platform", pi_name, s_name], cur, s_end, [])
            )
            cur += timedelta(weeks=sprint_weeks)

        pi_end = cur - timedelta(days=1)
        pi_nodes.append(
            _make_node(pi_name, ["eSW", "Platform", pi_name], pi_start, pi_end, sprint_nodes)
        )

    platform_end = cur - timedelta(days=1)
    platform_node = _make_node(
        "Platform", ["eSW", "Platform"], start_dt, platform_end, pi_nodes
    )
    esw_node = _make_node("eSW", ["eSW"], start_dt, platform_end, [platform_node])

    return {
        "url": f"{base_url}/{project_id}/_apis/wit/classificationNodes/Iterations",
        "_links": {},
        "has_children": True,
        "children": [esw_node],
        "id": 1999,
        "identifier": _det_uuid(f"iter:{project}:root"),
        "name": project,
        "path": f"\\{project}\\Iteration",
        "structure_type": "iteration",
    }


def _collect_sprint_paths(tree: dict) -> List[str]:
    """Return leaf iteration paths (sprint level) ready for ``System.IterationPath``."""
    children = tree.get("children") or []
    if not children:
        # Leaf node — convert classification-node path to work-item iteration path
        node_path: str = tree.get("path") or ""
        # \\Project\\Iteration\\eSW\\Platform\\PI\\Sprint → Project\\eSW\\Platform\\PI\\Sprint
        if node_path.startswith("\\"):
            parts = node_path[1:].split("\\")
            # parts[0]=project, parts[1]='Iteration', parts[2:]=rest
            if len(parts) > 2 and parts[1] == "Iteration":
                return ["\\".join([parts[0]] + parts[2:])]
        return []
    result: List[str] = []
    for child in children:
        result.extend(_collect_sprint_paths(child))
    return result


# ---------------------------------------------------------------------------
# Work item and revision generators
# ---------------------------------------------------------------------------


def _pick_state(
    wit: str,
    include_states: List[str],
    config: GeneratorConfig,
    rng: random.Random,
) -> str:
    """Choose a terminal state for a work item, respecting include_states."""
    progression = _STATE_PROGRESSIONS.get(wit, _STATE_PROGRESSIONS["Feature"])
    valid = [s for s in progression if s in include_states]
    if not valid:
        valid = [include_states[0]] if include_states else ["New"]

    weights_key = wit if wit in config.state_weights else "default"
    raw_weights = config.state_weights[weights_key]
    adj: List[float] = []
    for s in valid:
        idx = _STATE_NAMES.index(s) if s in _STATE_NAMES else 2
        adj.append(float(raw_weights[idx]) if idx < len(raw_weights) else 1.0)

    return rng.choices(valid, weights=adj, k=1)[0]


def _generate_area_items(
    area_config: dict,
    rng: random.Random,
    person_pool: List[dict],
    sprint_paths: List[str],
    project_id: str,
    id_counter: Callable[[], int],
    base_url: str,
    config: GeneratorConfig,
) -> List[dict]:
    """Generate a hierarchical list of work items for one area (team).

    Referential integrity guarantees:
    - ``System.Parent`` always points to an ID present in the returned list.
    - Every ``System.LinkTypes.Hierarchy-*`` relation URL embeds a valid ID.
    - ``System.IterationPath`` is drawn from *sprint_paths*.
    """
    task_types: List[str] = area_config.get("task_types") or ["Feature", "User Story"]
    area_path: str = area_config["area_path"]
    project: str = _area_to_project(area_path)
    include_states: List[str] = area_config.get("include_states") or _STATE_NAMES

    active_types = [t for t in _TYPE_HIERARCHY if t in task_types]
    if not active_types:
        return []

    # How many root-level items to generate for this area
    n_roots = max(1, config.items_per_area.get(area_path, config.default_items_per_area) // 3)

    # Per-team Kanban GUID (deterministic)
    kanban_guid = _det_hex32(area_path)
    kanban_col_key = f"ORG.{kanban_guid}_Kanban.Column"
    kanban_done_key = f"ORG.{kanban_guid}_Kanban.Column.Done"

    # Fallback sprint path when list is empty
    fallback_sprint = area_path

    items: List[dict] = []

    def _wi_url(wid: int) -> str:
        return f"{base_url}/{project_id}/_apis/wit/workItems/{wid}"

    def _make_item(
        wit: str,
        state: str,
        sprint: str,
        parent_id: Optional[int],
        created: datetime,
        changed: datetime,
    ) -> dict:
        wid = id_counter()
        reason = _ENTRY_REASONS.get(state, "New")

        tags = ""
        if rng.random() < 0.55:
            n_tags = rng.randint(1, 3)
            tags = "; ".join(rng.sample(_TAG_POOL, min(n_tags, len(_TAG_POOL))))

        priority = rng.choice([1, 2, 2, 2, 3, 3, 4])
        stack_rank = rng.uniform(100_000_000, 999_999_999)

        creator = rng.choice(person_pool) if person_pool else None
        assignee_chance = 0.45 if wit in ("Feature", "User Story", "Bug") else 0.25
        assignee = rng.choice(person_pool) if person_pool and rng.random() < assignee_chance else None

        fields: Dict[str, Any] = {
            "System.AreaPath": area_path,
            "System.TeamProject": project,
            "System.IterationPath": sprint,
            "System.WorkItemType": wit,
            "System.State": state,
            "System.Reason": reason,
            "System.CreatedDate": _iso(created),
            "System.CreatedBy": creator,
            "System.ChangedDate": _iso(changed),
            "System.ChangedBy": creator,
            "System.CommentCount": rng.randint(0, 8),
            "System.Title": f"Work Item {wid}",
            "System.BoardColumn": state,
            "System.BoardColumnDone": state in ("Resolved", "Closed"),
            "System.Rev": 1,
            "Microsoft.VSTS.Common.StateChangeDate": _iso(changed),
            "Microsoft.VSTS.Common.Priority": priority,
            "Microsoft.VSTS.Common.StackRank": stack_rank,
            "Microsoft.VSTS.Common.ValueArea": rng.choice(_VALUE_AREAS),
            "System.Description": "<p>Generated work item for testing purposes.</p>",
            "System.Tags": tags,
            "System.History": None,
            # ORG custom fields: track when the item entered each state
            "ORG.WIT.AutoGen.NewEnteredBy": creator,
            "ORG.WIT.AutoGen.NewEnteredDate": _iso(created),
            # Per-team Kanban board column
            kanban_col_key: state,
            kanban_done_key: state in ("Resolved", "Closed"),
        }

        if assignee:
            fields["System.AssignedTo"] = assignee

        if parent_id is not None:
            fields["System.Parent"] = parent_id

        if wit == "Feature":
            fields["ORG.WIT.Feature.ValueArea"] = fields["Microsoft.VSTS.Common.ValueArea"]

        # State-specific timestamp fields
        if state in ("Active", "Resolved", "Closed"):
            activated = created + timedelta(days=rng.randint(5, 60))
            act_person = assignee or creator
            fields["Microsoft.VSTS.Common.ActivatedDate"] = _iso(activated)
            fields["Microsoft.VSTS.Common.ActivatedBy"] = act_person
            fields["ORG.WIT.AutoGen.ActiveEnteredBy"] = act_person
            fields["ORG.WIT.AutoGen.ActiveEnteredDate"] = _iso(activated)

        if state == "Defined":
            def_date = created + timedelta(days=rng.randint(2, 30))
            fields["ORG.WIT.AutoGen.DefinedEnteredBy"] = creator
            fields["ORG.WIT.AutoGen.DefinedEnteredDate"] = _iso(def_date)

        # Optional scheduling fields on higher-level items
        if wit in ("Feature", "Epic", "Initiative") and rng.random() < 0.6:
            target_offset = rng.randint(30, 300)
            target_dt = _REF_DATE + timedelta(days=target_offset)
            start_dt = target_dt - timedelta(days=rng.randint(30, 180))
            fields["Microsoft.VSTS.Scheduling.TargetDate"] = _iso(target_dt)
            fields["Microsoft.VSTS.Scheduling.StartDate"] = _iso(start_dt)

        # Initial relations list (child links appended later by caller)
        relations: List[dict] = []
        if parent_id is not None:
            relations.append({
                "attributes": {"isLocked": False, "name": "Parent"},
                "rel": "System.LinkTypes.Hierarchy-Reverse",
                "url": _wi_url(parent_id),
            })

        item = {
            "id": wid,
            "url": _wi_url(wid),
            "rev": 1,
            "fields": fields,
            "relations": relations,
        }
        items.append(item)
        return item

    def _generate_node(type_idx: int, parent_id: Optional[int]) -> int:
        """Recursively generate a work item and its children.  Returns the new ID."""
        wit = active_types[type_idx]
        state = _pick_state(wit, include_states, config, rng)
        sprint = rng.choice(sprint_paths) if sprint_paths else fallback_sprint

        # Random creation offset in the past 2 years
        created = _REF_DATE - timedelta(days=rng.randint(30, 730))
        changed = created + timedelta(days=rng.randint(0, min(120, (_REF_DATE - created).days)))

        item = _make_item(wit, state, sprint, parent_id, created, changed)
        wid: int = item["id"]

        # Generate children of the next type in the hierarchy
        if type_idx + 1 < len(active_types):
            lo, hi = _CHILDREN_RANGE.get(wit, (0, 0))
            n_children = rng.randint(lo, hi)
            for _ in range(n_children):
                child_id = _generate_node(type_idx + 1, wid)
                item["relations"].append({
                    "attributes": {"isLocked": False, "name": "Child"},
                    "rel": "System.LinkTypes.Hierarchy-Forward",
                    "url": _wi_url(child_id),
                })

        return wid

    for _ in range(n_roots):
        _generate_node(0, None)

    return items


def _generate_revisions(
    item: dict,
    rng: random.Random,
    config: GeneratorConfig,
) -> List[dict]:
    """Generate a plausible revision history for *item*.

    The history shows a progressive state walk from ``New`` to the item's
    final state.  The item's ``rev`` / ``System.Rev`` is updated to match.
    """
    fields = item["fields"]
    wit: str = fields.get("System.WorkItemType", "Feature")
    final_state: str = fields.get("System.State", "New")

    progression = _STATE_PROGRESSIONS.get(wit, _STATE_PROGRESSIONS["Feature"])
    if final_state in progression:
        states_to_visit = progression[: progression.index(final_state) + 1]
    else:
        states_to_visit = [final_state]

    n_revs = rng.randint(config.revisions_min, config.revisions_max)

    # Distribute n_revs across states (more revs in earlier states)
    rev_state_seq: List[str] = []
    per_state = max(1, n_revs // max(1, len(states_to_visit)))
    for s in states_to_visit:
        rev_state_seq.extend([s] * per_state)
    rev_state_seq = rev_state_seq[:n_revs]
    while len(rev_state_seq) < n_revs:
        rev_state_seq.append(final_state)

    base_dt = datetime.fromisoformat(
        fields["System.CreatedDate"].replace("Z", "+00:00")
    )
    cur_dt = base_dt
    now_dt = _REF_DATE

    revisions: List[dict] = []
    for rev_num, state in enumerate(rev_state_seq, 1):
        delta_days = rng.uniform(0.5, 30.0)
        cur_dt = min(cur_dt + timedelta(days=delta_days), now_dt)

        rev_fields: Dict[str, Any] = {
            "System.WorkItemType": wit,
            "System.State": state,
            "System.Reason": _ENTRY_REASONS.get(state, "New"),
            "System.CreatedDate": fields["System.CreatedDate"],
            "System.CreatedBy": fields.get("System.CreatedBy"),
            "System.ChangedDate": _iso(cur_dt),
            "System.ChangedBy": fields.get("System.ChangedBy"),
            "System.CommentCount": rng.randint(0, 5),
            "System.TeamProject": fields["System.TeamProject"],
            "System.AreaPath": fields["System.AreaPath"],
            "System.IterationPath": fields["System.IterationPath"],
            "System.BoardColumn": state,
            "System.BoardColumnDone": state in ("Resolved", "Closed"),
            "Microsoft.VSTS.Common.StateChangeDate": _iso(cur_dt),
            "System.Title": fields["System.Title"],
            "Microsoft.VSTS.Common.Priority": fields.get("Microsoft.VSTS.Common.Priority", 2),
            "Microsoft.VSTS.Common.ValueArea": fields.get("Microsoft.VSTS.Common.ValueArea", "Business"),
            "ORG.WIT.AutoGen.NewEnteredBy": fields.get("ORG.WIT.AutoGen.NewEnteredBy"),
            "ORG.WIT.AutoGen.NewEnteredDate": fields.get("ORG.WIT.AutoGen.NewEnteredDate"),
        }

        # Carry forward state-specific timestamp fields once the state is reached
        if state in ("Active", "Resolved", "Closed"):
            for key in (
                "Microsoft.VSTS.Common.ActivatedDate",
                "Microsoft.VSTS.Common.ActivatedBy",
                "ORG.WIT.AutoGen.ActiveEnteredBy",
                "ORG.WIT.AutoGen.ActiveEnteredDate",
            ):
                if key in fields:
                    rev_fields[key] = fields[key]

        if state == "Defined":
            for key in ("ORG.WIT.AutoGen.DefinedEnteredBy", "ORG.WIT.AutoGen.DefinedEnteredDate"):
                if key in fields:
                    rev_fields[key] = fields[key]

        revisions.append({
            "id": item["id"],
            "rev": rev_num,
            "url": f"{item['url']}/revisions/{rev_num}",
            "fields": rev_fields,
        })

    # Update the live item's rev to match the generated history length
    item["rev"] = len(revisions)
    item["fields"]["System.Rev"] = len(revisions)

    return revisions


# ---------------------------------------------------------------------------
# Backlog-config and work-item-types builders
# ---------------------------------------------------------------------------


def _make_work_item_types(type_names: set, project: str, base_url: str) -> List[dict]:
    """Return the ``work_item_types`` list for a project."""
    result = []
    for wit in _TYPE_HIERARCHY:
        if wit not in type_names:
            continue
        progression = _STATE_PROGRESSIONS.get(wit, _STATE_PROGRESSIONS["Feature"])
        states = [
            {"name": s, "category": _STATE_CATEGORIES.get(s, "InProgress")}
            for s in progression
        ]
        result.append({
            "name": wit,
            "reference_name": f"Microsoft.VSTS.WorkItemTypes.{wit.replace(' ', '')}",
            "color": _WORK_ITEM_COLORS.get(wit, "000000"),
            "states": states,
            "url": f"{base_url}/_apis/wit/workItemTypes/{wit.replace(' ', '%20')}",
        })
    return result


def _make_backlog_config(
    task_types: List[str],
    include_states: List[str],
    project: str,
    base_url: str,
) -> dict:
    """Return a backlog-configuration dict for a team."""
    type_mapped_states = []
    for wit in task_types:
        progression = _STATE_PROGRESSIONS.get(wit, _STATE_PROGRESSIONS["Feature"])
        states_map = {
            s: _STATE_CATEGORIES.get(s, "InProgress")
            for s in progression
            if s in include_states
        }
        type_mapped_states.append({
            "work_item_type_name": wit,
            "states": states_map,
        })

    req_type = task_types[0] if task_types else "Feature"
    return {
        "backlog_fields": {
            "type_fields": {
                "Order": "Microsoft.VSTS.Common.StackRank",
                "Activity": "Microsoft.VSTS.Common.Activity",
            }
        },
        "bugs_behavior": "asBugs",
        "hidden_backlogs": [],
        "is_bugs_behavior_configured": True,
        "portfolio_backlogs": [],
        "requirement_backlog": {
            "add_panel_fields": [
                {"name": "Title", "reference_name": "System.Title",
                 "url": f"{base_url}/_apis/wit/fields/System.Title"}
            ],
            "color": _WORK_ITEM_COLORS.get(req_type, "009CCC"),
            "column_fields": [],
            "default_work_item_type": {"name": req_type},
            "name": "Stories",
            "rank": 1,
            "work_item_types": [{"name": t} for t in task_types],
        },
        "task_backlog": {
            "name": "Tasks",
            "rank": 0,
            "work_item_types": [{"name": "Task"}],
        },
        "url": f"{base_url}/_apis/work/backlogconfiguration",
        "work_item_type_mapped_states": type_mapped_states,
    }


# ---------------------------------------------------------------------------
# AzureDataset — top-level coordinator
# ---------------------------------------------------------------------------


class AzureDataset:
    """Generates and holds all synthetic fixture data in memory.

    Attributes mirror the lookup dicts used by ``_MockFixtures`` so that
    ``_GeneratedFixtures`` can expose them with the same duck-typed interface.

    Parameters
    ----------
    persist_dir:
        Optional path to a directory where all generated ``sdk_*.json``
        fixture files are written after ``build()``.  When set, mutations
        from ``update_work_item`` are also persisted back to those files.
        The directory is created on first use.  If the directory already
        contains an ``_manifest.json``, the data was previously written by
        this dataset; the files are overwritten on the next ``build()``.
    """

    def __init__(
        self,
        data_dir: str,
        config_dict: Optional[dict] = None,
        base_url: str = "https://dev.azure.com/anonymous-org",
        persist_dir: Optional[str] = None,
    ) -> None:
        self.data_dir = data_dir
        self.config = GeneratorConfig(config_dict)
        self.base_url = base_url
        self.persist_dir: Optional[Path] = Path(persist_dir) if persist_dir else None
        self._built = False

        # Lookup dicts — identical key conventions to _MockFixtures
        self.teams: Dict[str, list] = {}
        self.plans: Dict[str, list] = {}
        self.iterations: Dict[str, dict] = {}
        self.work_item_types: Dict[str, list] = {}
        self.timelines: Dict[str, dict] = {}
        self.plan_markers: Dict[str, list] = {}
        self.team_field_values: Dict[str, list] = {}
        self.backlog_configs: Dict[str, dict] = {}
        self.wiql_results: Dict[str, list] = {}
        self.work_item_by_id: Dict[int, dict] = {}
        self.revisions: Dict[int, list] = {}

        # Reverse index built during persistence: wid → area_path
        # (populated by _persist() and kept in sync after mutations)
        self._wid_to_area: Dict[int, str] = {}

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def build(self) -> None:
        """Generate all fixture data.  Safe to call multiple times (idempotent)."""
        if self._built:
            return
        self._built = True

        rng = random.Random(self.config.seed)
        area_configs = _load_projects_config(self.data_dir)

        if not area_configs:
            logger.warning(
                "AzureMockGeneratorClient: projects.yml not found in '%s'; "
                "using minimal fallback dataset",
                self.data_dir,
            )
            area_configs = [
                {
                    "name": "TestTeam",
                    "area_path": "TestProject\\TestTeam",
                    "type": "team",
                    "task_types": ["Epic", "Feature", "User Story"],
                    "include_states": ["New", "Defined", "Active", "Resolved", "Closed"],
                    "display_states": ["New", "Defined", "Active", "Resolved", "Closed"],
                }
            ]

        projects = sorted(set(_area_to_project(a["area_path"]) for a in area_configs))
        project_ids = {p: _det_uuid(f"project:{p}") for p in projects}
        person_pool = _build_person_pool(self.data_dir, area_configs, self.config, self.base_url)

        # Iteration trees
        for proj in projects:
            tree = _build_iteration_tree(
                proj, self.config, self.base_url, project_ids[proj]
            )
            self.iterations[_safe_key(proj)] = tree

        # Sprint path pools per project (used for work item assignment)
        sprint_paths: Dict[str, List[str]] = {
            proj: _collect_sprint_paths(self.iterations[_safe_key(proj)])
            for proj in projects
        }

        # Work-item types per project (aggregate across all teams in that project)
        for proj in projects:
            all_types: set = set()
            for a in area_configs:
                if _area_to_project(a["area_path"]) == proj:
                    all_types.update(a.get("task_types") or [])
            self.work_item_types[_safe_key(proj)] = _make_work_item_types(
                all_types, proj, self.base_url
            )

        # Shared sequential ID counter (unique across all areas)
        _id = [100_000]

        def next_id() -> int:
            _id[0] += 1
            return _id[0]

        # Group area configs by project
        by_project: Dict[str, List[dict]] = {p: [] for p in projects}
        for a in area_configs:
            by_project[_area_to_project(a["area_path"])].append(a)

        # Build teams, field values, backlog configs, work items per project
        all_team_ids: Dict[str, str] = {}  # team_name → uuid

        for proj in projects:
            proj_id = project_ids[proj]
            team_list: List[dict] = []

            for area in by_project[proj]:
                team_name: str = area["name"]
                team_id = _det_uuid(f"team:{proj}:{team_name}")
                all_team_ids[team_name] = team_id

                team_list.append({
                    "id": team_id,
                    "name": team_name,
                    "url": (
                        f"{self.base_url}/_apis/projects/{proj_id}"
                        f"/teams/{team_id}"
                    ),
                    "description": f"Team {team_name}",
                    "identity_url": f"{self.base_url}/_apis/Identities/{team_id}",
                    "project_id": proj_id,
                    "project_name": proj,
                })

                tfv_key = f"{_safe_key(proj)}__{_safe_key(team_name)}"

                self.team_field_values[tfv_key] = [
                    {"include_children": False, "value": area["area_path"]}
                ]

                self.backlog_configs[tfv_key] = _make_backlog_config(
                    area.get("task_types") or ["Feature", "User Story"],
                    area.get("include_states") or _STATE_NAMES,
                    proj,
                    self.base_url,
                )

                # Generate work items for this area
                p_sprints = sprint_paths.get(proj) or [area["area_path"]]
                area_items = _generate_area_items(
                    area_config=area,
                    rng=rng,
                    person_pool=person_pool,
                    sprint_paths=p_sprints,
                    project_id=proj_id,
                    id_counter=next_id,
                    base_url=self.base_url,
                    config=self.config,
                )

                wiql_ids: List[dict] = []
                for item in area_items:
                    wid: int = item["id"]
                    self.work_item_by_id[wid] = item
                    wiql_ids.append({"id": wid})
                    self.revisions[wid] = _generate_revisions(item, rng, self.config)

                self.wiql_results[_safe_key(area["area_path"])] = wiql_ids

            self.teams[_safe_key(proj)] = team_list

        self._build_plans(rng, projects, project_ids, by_project, all_team_ids)

        logger.info(
            "AzureMockGeneratorClient: generated %d work items across %d areas, "
            "%d plans, seed=%d",
            len(self.work_item_by_id),
            len(self.wiql_results),
            sum(len(v) for v in self.plans.values()),
            self.config.seed,
        )

        if self.persist_dir is not None:
            self._persist()

    # ------------------------------------------------------------------
    # Persistence (private)
    # ------------------------------------------------------------------

    def _write_json(self, dest: Path, data: Any) -> None:
        """Write *data* as pretty-printed JSON to *dest* (atomic via tmp file)."""
        import json as _json
        import tempfile
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(".tmp")
        try:
            tmp.write_text(
                _json.dumps(data, indent=2, default=str, ensure_ascii=False),
                encoding="utf-8",
            )
            tmp.replace(dest)
        except Exception:
            tmp.unlink(missing_ok=True)
            raise

    def _persist(self) -> None:
        """Write all generated fixture data as ``sdk_*.json`` files to ``persist_dir``.

        The output format is identical to what ``record_azure_mock.py`` produces,
        so the resulting directory can be used directly with ``AzureMockClient``
        (``use_azure_mock: true``, ``azure_mock_data_dir: <persist_dir>``).
        """
        import json as _json
        pdir = self.persist_dir
        assert pdir is not None
        pdir.mkdir(parents=True, exist_ok=True)

        # Collect all area paths + build / refresh wid → area reverse index
        areas_by_project: Dict[str, Dict[str, list]] = {}  # project_key → {area_path → [items]}
        self._wid_to_area = {}
        for wid, item in self.work_item_by_id.items():
            area_path: str = item["fields"].get("System.AreaPath", "")
            proj_key = _safe_key(_area_to_project(area_path))
            areas_by_project.setdefault(proj_key, {}).setdefault(area_path, []).append(item)
            self._wid_to_area[wid] = area_path

        # sdk_work_items__<project>__<area>.json  (list of work item dicts)
        for proj_key, area_map in areas_by_project.items():
            for area_path, items in area_map.items():
                stem = "sdk_work_items__" + _safe_key(area_path)
                self._write_json(pdir / f"{stem}.json", items)

        # sdk_revisions__<id>.json  (list of revision dicts)
        for wid, revs in self.revisions.items():
            self._write_json(pdir / f"sdk_revisions__{wid}.json", revs)

        # sdk_teams__<project>.json
        for proj_key, teams in self.teams.items():
            self._write_json(pdir / f"sdk_teams__{proj_key}.json", teams)

        # sdk_plans__<project>.json
        for proj_key, plans in self.plans.items():
            self._write_json(pdir / f"sdk_plans__{proj_key}.json", plans)

        # sdk_iterations__<project>.json
        for proj_key, tree in self.iterations.items():
            self._write_json(pdir / f"sdk_iterations__{proj_key}.json", tree)

        # sdk_work_item_types__<project>.json
        for proj_key, wit_list in self.work_item_types.items():
            self._write_json(pdir / f"sdk_work_item_types__{proj_key}.json", wit_list)

        # sdk_timeline__<project>__<plan_id>.json
        for key, tl in self.timelines.items():
            self._write_json(pdir / f"sdk_timeline__{key}.json", tl)

        # sdk_plan_markers__<project>__<plan_id>.json
        for key, markers in self.plan_markers.items():
            self._write_json(pdir / f"sdk_plan_markers__{key}.json", markers)

        # sdk_team_field_values__<project>__<team>.json
        for key, tfv in self.team_field_values.items():
            self._write_json(pdir / f"sdk_team_field_values__{key}.json", tfv)

        # sdk_backlog_config__<project>__<team>.json
        for key, cfg in self.backlog_configs.items():
            self._write_json(pdir / f"sdk_backlog_config__{key}.json", cfg)

        # sdk_wiql__<area>.json
        for area_key, ids in self.wiql_results.items():
            self._write_json(pdir / f"sdk_wiql__{area_key}.json", ids)

        # _manifest.json — summary metadata
        all_projects = sorted({
            _area_to_project(item["fields"].get("System.AreaPath", ""))
            for item in self.work_item_by_id.values()
        })
        all_areas = sorted(self._wid_to_area.values())
        manifest = {
            "organization": "generated",
            "projects": all_projects,
            "areas": sorted(set(all_areas)),
            "plan_count": sum(len(v) for v in self.plans.values()),
            "work_item_count": len(self.work_item_by_id),
            "history_count": len(self.revisions),
            "with_history": True,
            "generator_seed": self.config.seed,
        }
        self._write_json(pdir / "_manifest.json", manifest)

        logger.info(
            "AzureMockGeneratorClient: persisted %d work items, %d revision sets "
            "to '%s'",
            len(self.work_item_by_id),
            len(self.revisions),
            pdir,
        )

    def persist_work_item(self, wid: int) -> None:
        """Re-write the area file for a single mutated work item.

        Called after ``update_work_item`` mutates the in-memory dict so the
        change is immediately visible on disk (no full re-persist needed).
        Only has effect when ``persist_dir`` is set.
        """
        if self.persist_dir is None:
            return
        item = self.work_item_by_id.get(int(wid))
        if item is None:
            return
        area_path: str = item["fields"].get("System.AreaPath", "")
        self._wid_to_area[int(wid)] = area_path

        # Collect all items for this area and rewrite the file
        area_items = [
            i for i in self.work_item_by_id.values()
            if i["fields"].get("System.AreaPath") == area_path
        ]
        stem = "sdk_work_items__" + _safe_key(area_path)
        self._write_json(self.persist_dir / f"{stem}.json", area_items)
        logger.debug(
            "AzureMockGeneratorClient: persisted %d items for area '%s'",
            len(area_items), area_path,
        )

    # ------------------------------------------------------------------
    # Plan / timeline builder (private)
    # ------------------------------------------------------------------

    def _build_plans(
        self,
        rng: random.Random,
        projects: List[str],
        project_ids: Dict[str, str],
        by_project: Dict[str, List[dict]],
        all_team_ids: Dict[str, str],
    ) -> None:
        for proj in projects:
            proj_id = project_ids[proj]
            areas = by_project.get(proj, [])
            if not areas:
                continue

            n = min(self.config.n_plans, max(1, len(areas)))
            shuffled = list(areas)
            rng.shuffle(shuffled)

            plan_list: List[dict] = []
            creator_id = _det_uuid(f"plan-creator:{proj}")
            creator = {"display_name": "Admin", "id": creator_id}

            for plan_idx in range(n):
                plan_id = _det_uuid(f"plan:{proj}:{plan_idx}")
                plan_name = f"Plan {plan_idx + 1}"

                # Assign 2-4 teams to this plan (cyclic rotation for coverage)
                n_plan_teams = min(rng.randint(2, 4), len(shuffled))
                start_i = (plan_idx * 2) % len(shuffled)
                plan_areas = shuffled[start_i: start_i + n_plan_teams]
                # Wrap around if needed
                if len(plan_areas) < n_plan_teams:
                    plan_areas += shuffled[:n_plan_teams - len(plan_areas)]

                plan_list.append({
                    "id": plan_id,
                    "name": plan_name,
                    "description": f"Delivery timeline — {proj} ({plan_name})",
                    "type": "deliveryTimelineView",
                    "revision": 1,
                    "created_by_identity": creator,
                    "created_date": "2025-01-01T00:00:00.000Z",
                    "modified_by_identity": creator,
                    "modified_date": "2025-01-01T00:00:00.000Z",
                    "url": (
                        f"{self.base_url}/{proj}/_apis/work/plans/{plan_id}"
                    ),
                    "user_permissions": "view",
                })

                # Plan markers (empty — matches real fixture behaviour)
                self.plan_markers[f"{_safe_key(proj)}__{plan_id}"] = []

                # Timeline
                tl_teams = []
                for area in plan_areas:
                    tname = area["name"]
                    tid = all_team_ids.get(tname, _det_uuid(f"team:{proj}:{tname}"))
                    tl_teams.append({
                        "id": tid,
                        "name": tname,
                        "project_id": proj_id,
                        "backlog": None,
                        "is_expanded": True,
                        "status": None,
                        "team_field_name": None,
                    })

                self.timelines[f"{_safe_key(proj)}__{plan_id}"] = {
                    "id": plan_id,
                    "revision": 1,
                    "criteria_status": None,
                    "end_date": "2026-12-31T00:00:00Z",
                    "child_id_to_parent_id_map": {},
                    "max_expanded_teams": 5,
                    "start_date": "2025-01-01T00:00:00Z",
                    "teams": tl_teams,
                }

            self.plans[_safe_key(proj)] = plan_list


# ---------------------------------------------------------------------------
# _GeneratedFixtures — duck-type twin of _MockFixtures
# ---------------------------------------------------------------------------


class _GeneratedFixtures:
    """Implements the same interface as ``_MockFixtures``, backed by ``AzureDataset``.

    All ``get_*`` methods call ``dataset.build()`` implicitly on first use so
    that the dataset is only generated when actually needed.

    When ``dataset.persist_dir`` is set, ``on_item_mutated(wid)`` is wired up
    to ``dataset.persist_work_item()`` so every ``update_work_item`` call is
    immediately reflected on disk.
    """

    def __init__(self, dataset: AzureDataset) -> None:
        self._ds = dataset

    def on_item_mutated(self, wid: int) -> None:
        """Called after an in-memory update; persists the item if persist_dir is set."""
        self._ds.persist_work_item(wid)

    def _ensure(self) -> None:
        self._ds.build()

    # --- mirror _MockFixtures public methods ---

    def load(self) -> None:
        self._ensure()

    def get_teams(self, project: str) -> list:
        self._ensure()
        return self._ds.teams.get(_safe_key(project), [])

    def get_plans(self, project: str) -> list:
        self._ensure()
        return self._ds.plans.get(_safe_key(project), [])

    def get_timeline(self, project: str, plan_id: str) -> dict:
        self._ensure()
        return self._ds.timelines.get(
            f"{_safe_key(project)}__{plan_id}", {"teams": []}
        )

    def get_plan_markers(self, project: str, plan_id: str) -> list:
        self._ensure()
        return self._ds.plan_markers.get(
            f"{_safe_key(project)}__{plan_id}", []
        )

    def get_team_field_values(self, project: str, team_name: str) -> list:
        self._ensure()
        return self._ds.team_field_values.get(
            f"{_safe_key(project)}__{_safe_key(team_name)}", []
        )

    def get_backlog_config(self, project: str, team_name: str) -> dict:
        self._ensure()
        return self._ds.backlog_configs.get(
            f"{_safe_key(project)}__{_safe_key(team_name)}", {}
        )

    def get_iterations(self, project: str) -> Optional[dict]:
        self._ensure()
        return self._ds.iterations.get(_safe_key(project))

    def get_work_item_types(self, project: str) -> list:
        self._ensure()
        return self._ds.work_item_types.get(_safe_key(project), [])

    def get_wiql_result(self, area_path: str) -> list:
        self._ensure()
        return self._ds.wiql_results.get(_safe_key(area_path), [])

    def get_work_item(self, wid: int) -> Optional[dict]:
        self._ensure()
        return self._ds.work_item_by_id.get(int(wid))

    def get_revisions(self, wid: int) -> list:
        self._ensure()
        return self._ds.revisions.get(int(wid), [])

    # _MockWITClient.update_work_item mutates this dict directly
    @property
    def work_item_by_id(self) -> Dict[int, dict]:
        self._ensure()
        return self._ds.work_item_by_id


# ---------------------------------------------------------------------------
# _GeneratedConnection — drop-in for _MockConnection
# ---------------------------------------------------------------------------


class _PersistingMockClientsAccessor(_MockClientsAccessor):
    """Replaces the WIT client with one that also calls ``on_item_mutated``
    on the fixtures after every ``update_work_item`` invocation."""

    def __init__(self, fixtures: _GeneratedFixtures) -> None:
        super().__init__(fixtures)
        # Replace the WIT client singleton with a persistence-aware version
        from planner_lib.azure.AzureMockClient import _MockWITClient

        _base_wit = self._wit
        _on_mutated = fixtures.on_item_mutated

        class _PersistingWITClient(_MockWITClient):
            def update_work_item(self, document, id, **kwargs):
                result = super().update_work_item(document, id, **kwargs)
                _on_mutated(int(id))
                return result

        # Re-create with the same fixtures reference but a persisting WIT client
        self._wit = _PersistingWITClient(_base_wit._f)


class _GeneratedConnection:
    """Replaces ``_MockConnection`` with a connection backed by generated data."""

    def __init__(self, organization_url: str, dataset: AzureDataset) -> None:
        fixtures = _GeneratedFixtures(dataset)
        if dataset.persist_dir is not None:
            self.clients = _PersistingMockClientsAccessor(fixtures)
        else:
            self.clients = _MockClientsAccessor(fixtures)
        self.base_url = f"https://dev.azure.com/{organization_url}"


# ---------------------------------------------------------------------------
# AzureMockGeneratorClient
# ---------------------------------------------------------------------------


class AzureMockGeneratorClient(AzureCachingClient):
    """Extends ``AzureCachingClient`` with a fully generated Azure DevOps dataset.

    Overrides only ``_connect_with_pat`` to install a ``_GeneratedConnection``
    instead of the real SDK ``Connection``.  Every other method (caching,
    revision-checking, normalisation) runs unchanged from ``AzureCachingClient``.

    Parameters
    ----------
    organization_url:
        Azure DevOps organisation name (used in base_url construction).
    storage:
        Same storage backend used by the caching client.
    data_dir:
        Root directory containing the ``config/`` sub-directory with
        ``projects.yml``, ``teams.yml``, and ``people.yml``.
    config_dict:
        Optional overrides for the generator (see ``GeneratorConfig``).
        If this dict contains a ``persist_dir`` key, the generated data
        is written to that directory (relative to the working directory).
    memory_cache:
        Optional shared in-memory cache (passed through to the caching client).
    persist_dir:
        Directory path where generated ``sdk_*.json`` fixture files are
        written.  Mutations from ``update_work_item`` are also persisted
        back to these files.  Takes precedence over ``config_dict['persist_dir']``
        when both are specified.
    """

    def __init__(
        self,
        organization_url: str,
        storage: StorageBackend,
        data_dir: str = "data",
        config_dict: Optional[dict] = None,
        memory_cache: Any = None,
        persist_dir: Optional[str] = None,
    ) -> None:
        super().__init__(organization_url, storage=storage, memory_cache=memory_cache)
        self._data_dir = data_dir
        cfg = dict(config_dict) if config_dict else {}
        # persist_dir: explicit param wins over config_dict entry
        self._persist_dir: Optional[str] = persist_dir or cfg.pop("persist_dir", None)
        self._config_dict: Optional[dict] = cfg or None
        self._dataset: Optional[AzureDataset] = None

    # ------------------------------------------------------------------
    # Override — called by AzureClient.connect() context manager
    # ------------------------------------------------------------------

    def _connect_with_pat(self, pat: str) -> None:
        """Override: inject a _GeneratedConnection instead of the real SDK."""
        if self._connected:
            return
        base_url = f"https://dev.azure.com/{self.organization_url}"
        if self._dataset is None:
            self._dataset = AzureDataset(
                data_dir=self._data_dir,
                config_dict=self._config_dict,
                base_url=base_url,
                persist_dir=self._persist_dir,
            )
        # Build eagerly so that persist_dir files are written at connect time
        # and so the first request is not slowed by generation.
        self._dataset.build()
        logger.info(
            "AzureMockGeneratorClient: using generated dataset "
            "(data_dir='%s', seed=%s, persist_dir=%r, no Azure connection made)",
            self._data_dir,
            self._dataset.config.seed,
            self._persist_dir,
        )
        self.conn = _GeneratedConnection(self.organization_url, self._dataset)
        self._connected = True
