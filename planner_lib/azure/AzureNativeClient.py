"""AzureClient implementation with no caching"""
from __future__ import annotations
from typing import List, Optional
import logging
import os
from datetime import datetime, timezone
from azure.devops.connection import Connection
from msrest.authentication import BasicAuthentication
from azure.devops.v7_1.work_item_tracking.models import Wiql

logger = logging.getLogger(__name__)

from planner_lib.azure.AzureClient import AzureClient

class AzureNativeClient(AzureClient):
    def __init__(self, organization_url: str, pat: str):
        logger.info("Using AzureNativeClient (deferred connect)")
        super().__init__(organization_url, pat)

    def connect(self) -> None:
        if self._connected:
            return
        if Connection is None or BasicAuthentication is None:
            raise RuntimeError("azure-devops package not installed. Install 'azure-devops' to use Azure features")
        creds = BasicAuthentication('', self.pat)
        self.conn = Connection(base_url=f"https://dev.azure.com/{self.organization_url}", creds=creds)
        self._connected = True

    def close(self) -> None:
        # The azure-devops Connection doesn't provide an explicit close; clear refs
        self.conn = None
        self._connected = False

    def get_projects(self) -> List[str]:
        if not self._connected:
            self.connect()
        core_client = self.conn.clients.get_core_client()
        projects = core_client.get_projects()
        # SDK may return a collection object with .value or a plain list
        items = getattr(projects, 'value', projects)
        names: List[str] = []
        for p in items or []:
            try:
                names.append(p.name)
            except Exception:
                # defensive: if shape unexpected, attempt str()
                names.append(str(p))
        return names

    def _flatten_area_nodes(self, node) -> List[str]:
        # node has .name and .children (list)
        paths = []
        # Prefer the `path` attribute (full path like 'Project\\Area') if present
        if getattr(node, 'path', None):
            paths.append(node.path)
        elif getattr(node, 'name', None):
            # fallback: use name only
            paths.append(node.name)
        children = getattr(node, 'children', None)
        if children:
            for c in children:
                paths.extend(self._flatten_area_nodes(c))
        return paths

    def _sanitize_area_path(self, path: str) -> str:
        """Sanitize an area path so it is safe to include in a WIQL query.

        - Remove a leading backslash if present.
        - Remove any occurrences of the substring "Area\\" (and common typo "Aera\\")
            since Azure returns those in some listings but they must not be sent back
            to the Azure endpoint inside the WIQL AreaPath string.
        """
        if not isinstance(path, str):
            return path
        # strip leading backslash, convert / to \ and remove 'Area\' occurrences
        return path.lstrip('/\\').replace('/', '\\').replace('Area\\', '')

    def get_area_paths(self, project: str, root_path: str = '/') -> List[str]:
        """Return area paths under `root_path` for the given `project`.

        Returns a list of area path strings (e.g. "Project\\Area\\Sub").
        """
        if not self._connected:
            self.connect()
        wit = self.conn.clients.get_work_item_tracking_client()
        # The SDK exposes get_classification_node to fetch a node; try a depth=1/2 approach
        try:
            # The API expects a path without leading/trailing slashes
            path = root_path.strip('/\\') or None
            # depth controls recursion; use a reasonably deep default
            depth = 10
            if path is None:
                logging.debug("Fetching area nodes from root for project %s", project)
                node = wit.get_classification_node(project=project, structure_group='areas', depth=depth)
            else:
                # the SDK accepts a 'path' parameter for the classification node
                logging.debug("Fetching area nodes from root for project %s with path %s", project, path)
                node = wit.get_classification_node(project=project, structure_group='areas', path=path, depth=depth)

            # The returned node may be a top-level node with children; flatten to full paths
            paths = self._flatten_area_nodes(node)
            # Normalise to backslash-separated area paths (Azure DevOps uses backslashes)
            normed = [self._sanitize_area_path(p) for p in paths]
            return normed
        except Exception:
            # best-effort: return empty list if the server doesn't support nodes or call fails
            return []

    def query_by_wiql(self, project: str, wiql: str):
        """Run a WIQL query against `project` and return the results.

        This returns whatever the SDK returns; callers should handle objects.
        """
        if not self._connected:
            self.connect()
        wit = self.conn.clients.get_work_item_tracking_client()
        #from azure.devops.v7_1.work_item_tracking.models import Wiql
        q = Wiql(query=wiql)
        return wit.query_by_wiql(q)

    def api_url_to_ui_link(self, api_url: str) -> str:
        """
        Convert an Azure DevOps API URL to a UI link for the work item.
        """
        import re
        m = re.match(
            r"https://dev\.azure\.com/([^/]+)/([^/]+)/_apis/wit/workItems/(\d+)",
            api_url
        )
        if not m:
            raise ValueError("Invalid API URL format")
        org, project, work_item_id = m.groups()
        return f"https://dev.azure.com/{org}/{project}/_workitems/edit/{work_item_id}"

    def _safe_type(self, type: str) -> str:
        lt = type.lower()
        if "epic" in lt:
            return "epic"
        if "feature" in lt:
            return "feature"
        if "task" in lt or "user story" in lt or "story" in lt:
            return "feature"
        return "feature"

    def _safe_date(self, d):
        if not d:
            return None
        else:
            return str(d)[:10]

    def get_work_items(self, area_path) -> List[dict]:
        # Fetch all work items IDs in the area path
        if not self._connected:
            self.connect()
        wit_client = self.conn.clients.get_work_item_tracking_client()
        wiql_query = f"""
        SELECT [System.Id]
        FROM WorkItems
        WHERE [System.WorkItemType] IN ('Epic','Feature')
        AND [System.AreaPath] = '{area_path}' 
        AND [System.State] NOT IN ('Closed', 'Removed')
        ORDER BY [Microsoft.VSTS.Common.StackRank] ASC
        """
        wiql_obj = Wiql(query=wiql_query)
        result = wit_client.query_by_wiql(wiql=wiql_obj)
        task_ids = [getattr(wi, "id", None) for wi in (getattr(result, "work_items", []) or [])]
        task_ids = [int(t) for t in task_ids if t is not None]
        logger.debug(f"Task IDs in 'eSW/Architects': {task_ids}")

        # Next retrieve the work items by ID
        ret = []
        # Batch fetch up to 200 IDs per request for speed
        def chunks(lst, n):
            for i in range(0, len(lst), n):
                yield lst[i:i+n]
        for batch in chunks(task_ids, 200):
            items = wit_client.get_work_items(batch, expand="relations")
            for item in items or []:
                relations = getattr(item, "relations", []) or []
                relation_map = []
                for r in relations:
                    if r.attributes.get("name") in ("Parent", "Child", "Related", "Predecessor", "Successor"):
                        # A Relation is a dict ("type": Parent|Child|Related|Predecessor|Successor, "id": work item ID, "url:" UI URL)
                        relation_map.append({
                            "type": r.attributes.get("name"),
                            "id": str(r.url.split('/')[-1]),
                            "url": self.api_url_to_ui_link(getattr(r, "url", "")),
                        })
                        
                assigned = item.fields.get("System.AssignedTo")
                assignedTo = assigned.get("displayName") if isinstance(assigned, dict) and "displayName" in assigned else ""
                url = self.api_url_to_ui_link(getattr(item, "url", ""))
                try:
                    ret.append({
                        "id": str(item.id),
                        "type": self._safe_type(item.fields.get("System.WorkItemType")),
                        "title": item.fields.get("System.Title"),
                        "assignee": assignedTo,
                        "state": item.fields.get("System.State"),
                        "tags": item.fields.get("System.Tags"),
                        "description": item.fields.get("System.Description"),
                        "startDate": self._safe_date(item.fields.get("Microsoft.VSTS.Scheduling.StartDate")),
                        "finishDate": self._safe_date(item.fields.get("Microsoft.VSTS.Scheduling.TargetDate")),
                        "areaPath": item.fields.get("System.AreaPath"),
                        "iterationPath": item.fields.get("System.IterationPath"),
                        "relations": relation_map,
                        "url": url,
                    })
                except Exception as e:
                    logger.exception("Error processing item %s: %s", getattr(item, 'id', '?'), e)
        return ret

    def get_work_items_by_wiql(self, project: str, wiql: str, fields: Optional[list[str]] = None):
        """Run WIQL and return detailed work items for the resulting IDs.

        Encapsulates ID extraction shape differences and field selection.
        Returns a list of SDK work item objects (or dict-like) depending on SDK version.
        """
        if not self._connected:
            self.connect()
        wit = self.conn.clients.get_work_item_tracking_client()
        try:
            res = self.query_by_wiql(project, wiql)
        except Exception as e:
            raise RuntimeError(f"WIQL query failed for project {project}: {e}")

        ids: list[int] = []
        candidates = getattr(res, "work_items", None) or getattr(res, "workItems", None) or []
        for it in candidates:
            iid = getattr(it, "id", None)
            if iid is None and isinstance(it, dict):
                iid = it.get("id")
            if isinstance(iid, int):
                ids.append(iid)

        if not ids:
            return []

        try:
            return wit.get_work_items(ids, fields=fields) if fields else wit.get_work_items(ids)
        except Exception as e:
            raise RuntimeError(f"Failed to fetch work items for project {project}: {e}")

    def invalidate_work_items(self, work_item_ids: List[int]):
        """No-op for AzureNativeClient as it doesn't use caching."""
        pass

    def update_work_item_dates(self, work_item_id: int, start: Optional[str] = None, end: Optional[str] = None):
        """Update StartDate and/or TargetDate on a work item by ID.

        Dates should be ISO strings (YYYY-MM-DD). Returns SDK response object.
        """
        logger.debug("Updating work item %d: start=%s, end=%s", work_item_id, start, end)
        wit = self.conn.clients.get_work_item_tracking_client()
        ops = []
        if start is not None:
            ops.append({"op": "add", "path": "/fields/Microsoft.VSTS.Scheduling.StartDate", "value": start})
        if end is not None:
            ops.append({"op": "add", "path": "/fields/Microsoft.VSTS.Scheduling.TargetDate", "value": end})
        if not ops:
            return None
        try:
            return wit.update_work_item(document=ops, id=work_item_id)
        except Exception as e:
            raise RuntimeError(f"Failed to update work item {work_item_id}: {e}")

    def update_work_item_description(self, work_item_id: int, description: str):
        """Update the Description field on a work item by ID.

        Description should be HTML-formatted string. Returns SDK response object.
        """
        logger.debug("Updating work item %d description", work_item_id)
        wit = self.conn.clients.get_work_item_tracking_client()
        ops = [{"op": "add", "path": "/fields/System.Description", "value": description}]
        try:
            return wit.update_work_item(document=ops, id=work_item_id)
        except Exception as e:
            raise RuntimeError(f"Failed to update work item {work_item_id} description: {e}")
