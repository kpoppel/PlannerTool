"""Project listing utilities used by the API.

This module returns configured project names from the loaded server
configuration when available, falling back to stored projects in the
file-backed storage under the `projects` namespace.
"""
from __future__ import annotations
from typing import Any, List
import re
from planner_lib.storage.file_backend import FileStorageBackend
import logging

logger = logging.getLogger(__name__)

# File-backed storage used for persisted projects
#_storage = FileStorageBackend(data_dir="./data")

def slugify(text, prefix: str = "") -> str:
    """Create a URL-safe slug optionally prefixed.

    Ensures consistent IDs across API responses. When `prefix` is provided,
    it will be prepended to the slug (e.g., prefix="project-" -> "project-alpha").
    """
    text = str(text).lower()
    text = re.sub(r'[^a-z0-9]+', '-', text)
    base = text.strip('-')
    return base
    return (prefix + base) if prefix else base

def list_projects() -> List[str]:
    """Return a list of project names. """
    from planner_lib.setup import get_loaded_config

    cfg = get_loaded_config()
    if cfg and getattr(cfg, "project_map", None):
        names = []
        for p in cfg.project_map:
            if isinstance(p, dict):
                n = p.get("name")
                if isinstance(n, str):
                    names.append({"id": slugify(n, prefix="project-"), "name": n})
        logger.debug("Returning %d configured projects", len(names))
        return names
    else:
        logger.exception("Failed to read configured projects")
        return []
        
def list_teams() -> List[dict]:
    """Return a list of project names.
        Make sure the returned data format matches the expected format in the front-end.
        { id:'alpha', name:'Project Alpha', selected:true }, etc.
    """
    from planner_lib.setup import get_loaded_config

    cfg = get_loaded_config()
    if cfg and getattr(cfg, "team_map", None):
        names = []
        for p in cfg.team_map:
            if isinstance(p, dict):
                n = p.get("name")
                s = p.get("short_name")
                if isinstance(n, str):
                    entry = {"id": slugify(n, prefix="team-"), "name": n, "short_name": s}
                    names.append(entry)
        logger.debug("Returning %d configured teams", len(names))
        return names
    else:
        logger.exception("Failed to read configured teams")
        return []
        

def list_tasks(pat: str | None = None, project_id: str | None = None) -> List[dict]:
    """Return tasks for all configured projects in a frontend-friendly format.

    Uses WIQL queries from `project_map` to fetch work items and formats them
    into dicts expected by the frontend provider (id, type, title, project, etc.).
    """
    from planner_lib.setup import get_loaded_config
    from planner_lib.azure import get_client
    from datetime import date, timedelta

    cfg = get_loaded_config()
    if not cfg or not getattr(cfg, "project_map", None):
        logger.warning("No configured projects found in server config")
        return []

    # Initialize Azure client using URL and interactive/token-less flow is not supported here.
    # Expect PAT via environment variable for server context if needed; otherwise rely on AzureClient's internal mechanism.
    items: List[dict] = []
    client = get_client(cfg.azure_devops_organization, pat)

    def _parse_team_loads(description: str | None) -> List[dict]:
        """Parse team load block from description.

        Expected format:
        [PlannerTool Team Capacity]\n<short_name>: <percent_load>\n...\n[/PlannerTool Team Capacity]
        Returns a list of { team, load }.
        """
        if not description or not isinstance(description, str):
            return []
        try:
            # Normalize HTML content to plain text: convert <br> to newlines, strip tags, unescape entities
            desc = description
            # Replace <br> variants with newline
            desc = re.sub(r"<br\s*/?>", "\n", desc, flags=re.I)
            # Ensure adjacent tags don't concatenate text (e.g. </div><div> -> newline)
            desc = re.sub(r">\s*<", ">\n<", desc)
            # Strip other HTML tags but keep text content
            desc = re.sub(r"</?\w+[^>]*>", "", desc)
            # Unescape common entities (&amp; -> &, &lt; -> <, &gt; -> >)
            desc = desc.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")

            m = re.search(r"\[PlannerTool Team Capacity\](.*?)\[/PlannerTool Team Capacity\]", desc, flags=re.S)
            if not m:
                return []
            body = m.group(1)
            loads: List[dict] = []
            for raw_line in (body.splitlines() or []):
                line = raw_line.strip()
                if not line:
                    continue
                # Allow comments starting with '#'
                if line.startswith('#'):
                    continue
                mm = re.match(r"^([^:]+)\s*:\s*(\d+)%?\s*$", line)
                if not mm:
                    continue
                team = mm.group(1).strip()
                try:
                    load = int(mm.group(2))
                except Exception:
                    continue
                # Clamp to 0-100
                if load < 0:
                    load = 0
                if load > 100:
                    load = 100
                loads.append({"team": team, "load": load})
            return loads
        except Exception:
            return []

    def _map_team_token_to_id(token: str, cfg) -> str:
        """Map a team token (name or short_name) to the canonical frontend team id.

        Returns slugified id with prefix 'team-' if a match is found; otherwise
        returns the original token.
        """
        if not token:
            return token
        if not cfg or not getattr(cfg, "team_map", None):
            return token
        tkn = str(token).strip()
        for tm in getattr(cfg, "team_map", []):
            name = str(tm.get("name", ""))
            short = str(tm.get("short_name", ""))
            if tkn.lower() == name.lower() or (short and tkn.lower() == short.lower()):
                return slugify(name, prefix="team-")
        return token

    # For each project fetch task data
    wis = []
    items: List[dict] = []
    # TODO: Remove mocking data once we have graphs working successfully.
    # Helper: backend-side mock team loads using configured team short names
    def _mock_team_loads() -> List[dict]:
        # Build pool of canonical frontend team ids (team-<slug(name)>)
        team_ids: List[str] = []
        try:
            for tm in getattr(cfg, "team_map", []):
                name = tm.get("name") or ""
                if name:
                    team_ids.append(slugify(str(name), prefix="team-"))
        except Exception:
            pass
        import random
        random.seed()  # non-deterministic
        k = max(1, min(4, random.randint(1, 4)))
        picks: List[str] = []
        pool = team_ids[:]
        for _ in range(min(k, len(pool))):
            idx = random.randrange(len(pool))
            picks.append(pool.pop(idx))
        return [{"team": p, "load": random.randint(1, 3)} for p in picks]
    ###################################
    for p in cfg.project_map:
        name = p.get("name")
        path = p.get("area_path")
        # If a specific project_id is requested, skip non-matching entries
        if project_id:
            pid = slugify(name, prefix="project-")
            if pid != project_id:
                continue
        wis = client.get_work_items(name, path)
        # Returned data is list of dict:
        # [{'id': 535825, 'type': 'Feature', 'title': 'Architecture team requests incoming',
        #   'state': 'Active', 'tags': None, 'areaPath': 'Platform_Development\\eSW\\Teams\\Architecture',
        #  'iterationPath': 'Platform_Development',
        #  'relations': [
        #        {'type': 'Parent', 'id': 123456, 'url': 'https://.../516154'}, # System.LinkTypes.Hierarchy-Reverse
        #        {'type': 'Child', 'id': 643127, 'url': 'https://.../643127'}, # System.LinkTypes.Hierarchy-Forward
        #        {'type': 'Predecessor', 'id': 643127, 'url': 'https://.../643127'},
        #        {'type': 'Successor', 'id': 643127, 'url': 'https://.../643127'},
        #        {'type': 'Related', 'id': 643127, 'url': 'https://.../643127'},
        #       ]}]
        logger.debug(f"Fetched {len(wis)} work items for project '{name}'")
        # Now format into frontend-friendly shape
        for wi in wis or []:
            # If the item has no scheduled dates place it 4 months prior to allow the user to see what has been scheduled and schedule it.
            today_minus_120 = str((date.today() - timedelta(days=120)).isoformat())
            today_minus_90 = str((date.today() - timedelta(days=90)).isoformat())
            parsed_loads = _parse_team_loads(wi.get("description"))
            parsed_loads = [
                {"team": _map_team_token_to_id(str(entry.get("team") or ""), cfg), "load": entry.get("load", 0)}
                for entry in parsed_loads
            ]
            logger.debug(f"Parsed team loads for work item {wi['id']}: {parsed_loads} based on description {wi.get('description')}.")
            # Enrich the existing work item dict instead of rebuilding it from scratch.
            # This preserves any additional fields returned by the client and only adds/overrides
            # the computed values we need for the frontend.
            entry = dict(wi)  # shallow copy to avoid mutating original source
            entry["project"] = slugify(name, prefix="project-")
            entry["start"] = entry.get("startDate") or today_minus_120
            entry["end"] = entry.get("finishDate") or today_minus_90
            entry["teamLoads"] = parsed_loads if parsed_loads else _mock_team_loads()
            items.append(entry)
    logger.debug("Returning total %d tasks from all projects", len(items))
    return items

def update_tasks(updates: List[dict], pat: str | None = None) -> dict:
    """Apply date updates to Azure work items.

    `updates` should be a list of dicts: { id: str|int, start?: str, end?: str }
    Returns a summary dict: { ok: bool, updated: int, errors: List }.
    """
    from planner_lib.setup import get_loaded_config
    from planner_lib.azure import get_client

    cfg = get_loaded_config()
    if not cfg:
        return { "ok": False, "updated": 0, "errors": ["No server config loaded"] }

    client = get_client(cfg.azure_devops_organization, pat)
    updated = 0
    errors: List[str] = []
    for u in updates or []:
        try:
            wid = int(u.get('id') or 0)
        except Exception:
            errors.append(f"Invalid work item id: {u}")
            continue
        start = u.get('start')
        end = u.get('end')
        try:
            client.update_work_item_dates(wid, start=start, end=end)
            updated += 1
        except Exception as e:
            errors.append(f"{wid}: {e}")
    return { "ok": len(errors) == 0, "updated": updated, "errors": errors }

## TODO: Add later the option to load saved project definitions from the user configurations saved.
# def load_user_projects() -> List[str]:
    # # Fallback: read stored projects from the file backend
    # names: List[str] = []
    # try:
    #     for key in _storage.list_keys("projects"):
    #         try:
    #             obj = _storage.load("projects", key)
    #         except KeyError:
    #             continue
    #         # Attempt to extract a name from the stored object
    #         if isinstance(obj, dict):
    #             n = obj.get("name") or obj.get("id") or obj.get("project_name")
    #         else:
    #             n = getattr(obj, "name", None) or getattr(obj, "id", None)
    #         if n:
    #             names.append(n)
    # except Exception:
    #     logger.exception("Error while listing stored projects")

    # logger.debug("Returning %d stored projects", len(names))
    # return names


# def save_project(project_id: str, project_obj: Any) -> None:
#     """Save a project object under `projects/<project_id>`.

#     This preserves the previous storage behavior for consumers that still
#     call this helper.
#     """
#     _storage.save("projects", project_id, project_obj)
