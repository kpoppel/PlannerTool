"""Azure DevOps helper wrapper.

Provides a thin wrapper around the `azure-devops` Python package to centralize
all Azure DevOps interactions. Functions are defensive: if the package is not
installed or a call fails, informative RuntimeErrors are raised.
"""
from __future__ import annotations
from typing import List, Optional
import logging
import os
from datetime import datetime, timezone
from azure.devops.connection import Connection
from msrest.authentication import BasicAuthentication
from azure.devops.v7_1.work_item_tracking.models import Wiql
import logging

logger = logging.getLogger(__name__)


class AzureClient:
    def __init__(self, organization_url: str, pat: str):
        if Connection is None or BasicAuthentication is None:
            raise RuntimeError("azure-devops package not installed. Install 'azure-devops' to use Azure features")
        creds = BasicAuthentication('', pat)
        self.conn = Connection(base_url=organization_url, creds=creds)

    def get_projects(self) -> List[str]:
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

    def get_area_paths(self, project: str, root_path: str = '/') -> List[str]:
        """Return area paths under `root_path` for the given `project`.

        Returns a list of area path strings (e.g. "Project\\Area\\Sub").
        """
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
            normed = [p.replace('/', '\\') for p in paths]
            return normed
        except Exception:
            # best-effort: return empty list if the server doesn't support nodes or call fails
            return []

    def query_by_wiql(self, project: str, wiql: str):
        """Run a WIQL query against `project` and return the results.

        This returns whatever the SDK returns; callers should handle objects.
        """
        wit = self.conn.clients.get_work_item_tracking_client()
        #from azure.devops.v7_1.work_item_tracking.models import Wiql
        q = Wiql(query=wiql)
        return wit.query_by_wiql(q)

    def get_work_items(self, project, area_path):
        # Item 516412 has a parent link to 516154
        # Item 516154 has 6 links to children
        # Fetch both and see their relations
        wit_client = self.conn.clients.get_work_item_tracking_client()
        # Fetch all work items IDs in the project area path ('Platform_Development\eSW\Teams\Architecture')
#        WHERE [System.TeamProject] = {project}
        wiql_query = f"""
        SELECT [System.Id]
        FROM WorkItems
        WHERE [System.WorkItemType] IN ('Epic','Feature')
        AND [System.AreaPath] = '{area_path}' 
        AND [System.State] <> 'Closed'
        ORDER BY [Microsoft.VSTS.Common.StackRank] ASC
        """
        wiql_obj = Wiql(query=wiql_query)
        result = wit_client.query_by_wiql(wiql=wiql_obj)
        task_ids = [getattr(wi, "id", None) for wi in (getattr(result, "work_items", []) or [])]
        task_ids = [int(t) for t in task_ids if t is not None]
        logger.debug(f"Task IDs in 'eSW/Architects': {task_ids}")

        # Next retrieve the work items by ID
        ret = []
        as_of_date = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") # "2026-06-01T00:00:00Z"
        for id in task_ids:
            item = wit_client.get_work_item(id, as_of=as_of_date, expand="relations")
            #print(item)
            relations = getattr(item, "relations", []) or []
            relation_map = []
            parent_id = None
            for r in relations:
                if r.attributes["name"] in ("Parent", "Child"):
                    # Make a tuple of (type, url)
                    relation_map.append((
                        r.attributes["name"],    # 'Parent' or 'Child'
                        getattr(r, "url", None), # link URL
                        #getattr(r, "rel", None), # System.LinkTypes.Hierarchy-Forward/Reverse
                        ))
            assigned = item.fields.get("System.AssignedTo")
            assignedTo = assigned.get("displayName") if isinstance(assigned, dict) and "displayName" in assigned else ""
            try:
                ret.append({
                    "id": item.id,
                    "type": item.fields.get("System.WorkItemType"),
                    "title": item.fields.get("System.Title"),
                    "assignedTo": assignedTo,
                    "state": item.fields.get("System.State"),
                    "tags": item.fields.get("System.Tags"),
                    "description": item.fields.get("System.Description"),
                    "startDate": item.fields.get("Microsoft.VSTS.Scheduling.StartDate"),
                    "finishDate": item.fields.get("Microsoft.VSTS.Scheduling.FinishDate"),
                    "areaPath": item.fields.get("System.AreaPath"),
                    "iterationPath": item.fields.get("System.IterationPath"),
                    "relations": relation_map,
                    "azureUrl": item.url,
                })
            except Exception as e:
                print(f"Error processing item {id}: {e}")
        return ret

    def get_work_items_by_wiql(self, project: str, wiql: str, fields: Optional[list[str]] = None):
        """Run WIQL and return detailed work items for the resulting IDs.

        Encapsulates ID extraction shape differences and field selection.
        Returns a list of SDK work item objects (or dict-like) depending on SDK version.
        """
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


_client_instance: Optional[AzureClient] = None

def get_client(organization_url: Optional[str] = None, pat: Optional[str] = None) -> AzureClient:
    """Return a singleton AzureClient instance.

    If not yet created, instantiate using provided `organization_url` and `pat`,
    or fallback to environment variables `AZURE_DEVOPS_URL` and `AZURE_DEVOPS_PAT`.
    Subsequent calls return the same instance to avoid multiple connections.
    """
    global _client_instance
    if _client_instance is not None:
        return _client_instance

    org = organization_url or os.environ.get("AZURE_DEVOPS_URL")
    token = pat or os.environ.get("AZURE_DEVOPS_PAT", "")
    if not org:
        raise RuntimeError("Azure organization URL not provided. Set AZURE_DEVOPS_URL or pass organization_url.")
    _client_instance = AzureClient(org, token)
    return _client_instance
