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
                if isinstance(n, str):
                    names.append({"id": slugify(n, prefix="team-"), "name": n})
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

    def _safe_type(type: str) -> str:
        lt = type.lower()
        if "epic" in lt:
            return "epic"
        if "feature" in lt:
            return "feature"
        if "task" in lt or "user story" in lt or "story" in lt:
            return "feature"
        return "feature"

    def _safe_date(d):
        if not d:
            return None
        else:
            return str(d)[:10]

    # For each project fetch task data
    wis = []
    items: List[dict] = []
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
        #        {'https://.../516154', 'Parent','System.LinkTypes.Hierarchy-Reverse'},
        #        {'https://...643127', 'Child', 'System.LinkTypes.Hierarchy-Forward'},
        #       ]}]
        logger.debug(f"Fetched {len(wis)} work items for project '{name}'")
        # Now format into frontend-friendly shape
        for wi in wis or []:
            today = str(date.today().isoformat())
            today_plus_30 = str((date.today() + timedelta(days=30)).isoformat())
            depends_on_list = []
            for rel in wi.get("relations", []):
                if rel[0] == "Parent":
                    depends_on_list.append(str(rel[1].split('/')[-1]))
                #if rel[0] == "Child":
                #    depends_on_list.append(str(rel[1].split('/')[-1]))

            items.append({
                "id": str(wi["id"]),
                "type": _safe_type(wi.get("type")),
                "parentEpic": depends_on_list[0] if depends_on_list else None,
                "title": wi["title"],
                "project": slugify(name, prefix="project-"),
                "start": _safe_date(wi["startDate"]) or today,
                "end": _safe_date(wi["finishDate"]) or today_plus_30,
                "teamLoads": [{"team": "architecture", "load": 20}],
                "status": wi["state"],
                "assignee": wi["assignedTo"],
                "description": wi["description"],
                "azureUrl": wi["azureUrl"],
                "dependsOn": depends_on_list,
            })
    logger.debug("Returning total %d tasks from all projects", len(items))
    return items

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
