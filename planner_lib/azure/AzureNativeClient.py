"""AzureClient implementation with no caching"""
from __future__ import annotations
from typing import List, Optional
import logging

logger = logging.getLogger(__name__)

from planner_lib.azure.AzureClient import AzureClient
from planner_lib.storage.interfaces import StorageProtocol

class AzureNativeClient(AzureClient):
    def __init__(self, organization_url: str, storage: StorageProtocol):
        logger.info("Using AzureNativeClient (deferred connect)")
        super().__init__(organization_url, storage=storage)

    def get_work_items(self, area_path) -> List[dict]:
        # Fetch all work items IDs in the area path
        if not self._connected:
            raise RuntimeError("AzureNativeClient is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        assert self.conn is not None
        wit_client = self.conn.clients.get_work_item_tracking_client()

        # Sanitize and escape the area path for inclusion in WIQL string literal.
        wiql_area = self._sanitize_area_path(area_path)
        wiql_area_escaped = wiql_area.replace("'", "''").replace('\\', '\\\\')

        wiql_query = f"""
        SELECT [System.Id]
        FROM WorkItems
        WHERE [System.WorkItemType] IN ('Epic','Feature')
        AND [System.AreaPath] = '{wiql_area_escaped}' 
        AND [System.State] NOT IN ('Closed', 'Removed')
        ORDER BY [Microsoft.VSTS.Common.StackRank] ASC
        """
        from azure.devops.v7_1.work_item_tracking.models import Wiql
        wiql_obj = Wiql(query=wiql_query)
        try:
            result = wit_client.query_by_wiql(wiql=wiql_obj)
        except Exception as e:
            # Azure may raise AzureDevOpsServiceError for non-existent area paths
            logger.warning("WIQL query for area '%s' failed: %s", area_path, e)
            return []
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

    def invalidate_work_items(self, work_item_ids: List[int]):
        """No-op for AzureNativeClient as it doesn't use caching."""
        return None


