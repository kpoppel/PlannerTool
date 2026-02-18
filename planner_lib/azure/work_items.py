"""Work item operations for Azure DevOps.

This module contains operations related to fetching and updating work items.
"""
from __future__ import annotations
from typing import List, Optional, Any
import logging

logger = logging.getLogger(__name__)


class WorkItemOperations:
    """Handles work item queries and updates."""
    
    def __init__(self, client):
        """Initialize with a reference to the parent client.
        
        Args:
            client: Parent Azure client with connection and storage
        """
        self.client = client
    
    def _sanitize_area_path(self, path: str) -> str:
        """Sanitize an area path for use in WIQL queries.
        
        Args:
            path: Raw area path
            
        Returns:
            Sanitized area path
        """
        if not isinstance(path, str):
            return path
        return path.lstrip('/\\').replace('/', '\\').replace('Area\\', '')
    
    def _safe_type(self, work_item_type: Optional[str]) -> str:
        """Convert work item type to normalized string.
        
        Args:
            work_item_type: Raw work item type
            
        Returns:
            Normalized type ('epic' or 'feature')
        """
        if not work_item_type:
            return "feature"
        lt = work_item_type.lower()
        if "epic" in lt:
            return "epic"
        if "feature" in lt:
            return "feature"
        if "task" in lt or "user story" in lt or "story" in lt:
            return "feature"
        return "feature"
    
    def _safe_date(self, date_value: Any) -> Optional[str]:
        """Convert date value to ISO date string.
        
        Args:
            date_value: Date value from Azure API
            
        Returns:
            ISO date string (YYYY-MM-DD) or None
        """
        if not date_value:
            return None
        return str(date_value)[:10]
    
    def api_url_to_ui_link(self, api_url: str) -> str:
        """Convert Azure API URL to web UI link.
        
        Args:
            api_url: API URL for a work item
            
        Returns:
            Web UI URL
        """
        import re
        m = re.match(r"https://dev\.azure\.com/([^/]+)/([^/]+)/_apis/wit/workItems/(\d+)", api_url)
        if not m:
            raise ValueError("Invalid API URL format")
        org, project, work_item_id = m.groups()
        return f"https://dev.azure.com/{org}/{project}/_workitems/edit/{work_item_id}"
    
    def get_work_items(
        self, 
        area_path: str, 
        task_types: Optional[List[str]] = None,
        include_states: Optional[List[str]] = None
    ) -> List[dict]:
        """Fetch work items for a given area path.
        
        This implementation fetches work items based on the configured task types
        and states, or uses defaults if not specified.
        
        Args:
            area_path: Azure DevOps area path
            task_types: List of work item types to include (e.g., ['epic', 'feature']).
                       Defaults to ['epic', 'feature'] if not provided.
            include_states: List of states to include (e.g., ['new', 'active']).
                           If not provided, excludes 'Closed' and 'Removed' states.
            
        Returns:
            List of work item dictionaries
        """
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        
        assert self.client.conn is not None
        wit_client = self.client.conn.clients.get_work_item_tracking_client()
        
        # Use defaults if not provided
        if task_types is None:
            task_types = ['epic', 'feature']
        if include_states is None:
            include_states = []
        
        # Sanitize and escape area path for WIQL
        wiql_area = self._sanitize_area_path(area_path)
        wiql_area_escaped = wiql_area.replace("'", "''").replace('\\', '\\\\')
        
        # Build work item types clause
        # Capitalize first letter for Azure DevOps (Epic, Feature, etc.)
        types_list = [f"'{t.capitalize()}'" for t in task_types]
        types_clause = ','.join(types_list)
        
        # Build state filter clause
        if include_states:
            # Use positive filter: include only specified states
            # Capitalize first letter for Azure DevOps states
            states_list = [f"'{s.capitalize()}'" for s in include_states]
            states_clause = f"AND [System.State] IN ({','.join(states_list)})"
        else:
            # Use negative filter: exclude closed/removed by default
            states_clause = "AND [System.State] NOT IN ('Closed', 'Removed')"
        
        wiql_query = f"""
        SELECT [System.Id]
        FROM WorkItems
        WHERE [System.WorkItemType] IN ({types_clause})
        AND [System.AreaPath] = '{wiql_area_escaped}' 
        {states_clause}
        ORDER BY [Microsoft.VSTS.Common.StackRank] ASC
        """
        
        from azure.devops.v7_1.work_item_tracking.models import Wiql
        wiql_obj = Wiql(query=wiql_query)
        
        try:
            result = wit_client.query_by_wiql(wiql=wiql_obj)
        except Exception as e:
            logger.warning(f"WIQL query for area '{area_path}' failed: {e}")
            return []
        
        # Extract work item IDs
        task_ids = [getattr(wi, "id", None) for wi in (getattr(result, "work_items", []) or [])]
        task_ids = [int(t) for t in task_ids if t is not None]
        logger.debug(f"Found {len(task_ids)} work items for area '{area_path}'")
        
        # Fetch work items in batches
        ret = []
        
        def chunks(lst, n):
            for i in range(0, len(lst), n):
                yield lst[i:i+n]
        
        for batch in chunks(task_ids, 200):
            items = wit_client.get_work_items(batch, expand="relations")
            for item in items or []:
                try:
                    # Process relations
                    relations = getattr(item, "relations", []) or []
                    relation_map = []
                    for r in relations:
                        if r.attributes.get("name") in ("Parent", "Child", "Related", "Predecessor", "Successor"):
                            relation_map.append({
                                "type": r.attributes.get("name"),
                                "id": str(r.url.split('/')[-1]),
                                "url": self.api_url_to_ui_link(getattr(r, "url", "")),
                            })
                    
                    # Process assignee
                    assigned = item.fields.get("System.AssignedTo")
                    assignedTo = assigned.get("displayName") if isinstance(assigned, dict) and "displayName" in assigned else ""
                    
                    url = self.api_url_to_ui_link(getattr(item, "url", ""))
                    
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
                    logger.exception(f"Error processing item {getattr(item, 'id', '?')}: {e}")
        
        return ret
    
    def update_work_item_dates(self, work_item_id: int, start: Optional[str] = None, end: Optional[str] = None) -> Any:
        """Update start and/or end dates for a work item.
        
        Args:
            work_item_id: Work item ID
            start: Start date in ISO format (YYYY-MM-DD) or None
            end: End date in ISO format (YYYY-MM-DD) or None
            
        Returns:
            Azure SDK response object
        """
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        
        assert self.client.conn is not None
        wit = self.client.conn.clients.get_work_item_tracking_client()
        
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
    
    def update_work_item_description(self, work_item_id: int, description: str) -> Any:
        """Update the description field for a work item.
        
        Args:
            work_item_id: Work item ID
            description: HTML-formatted description text
            
        Returns:
            Azure SDK response object
        """
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        
        assert self.client.conn is not None
        wit = self.client.conn.clients.get_work_item_tracking_client()
        
        ops = [{"op": "add", "path": "/fields/System.Description", "value": description}]
        
        try:
            return wit.update_work_item(document=ops, id=work_item_id)
        except Exception as e:
            raise RuntimeError(f"Failed to update work item {work_item_id} description: {e}")
    
    def get_work_item_metadata(self, project: str) -> dict:
        """Retrieve work item types and states for a project.
        
        Args:
            project: Azure DevOps project name
            
        Returns:
            Dictionary with 'types' (list of work item type names) and
            'states' (dictionary mapping type names to lists of state names)
        """
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        
        assert self.client.conn is not None
        wit_client = self.client.conn.clients.get_work_item_tracking_client()
        
        try:
            # Retrieve all work item types for the project
            wi_types = wit_client.get_work_item_types(project)
            
            types = []
            states_by_type = {}
            
            for wi_type in wi_types:
                type_name = wi_type.name.lower()
                types.append(type_name)
                
                # Retrieve states for this specific type
                if hasattr(wi_type, 'states') and wi_type.states:
                    states = [state.name.lower() for state in wi_type.states]
                    states_by_type[type_name] = states
            
            # Collect all unique states across all types
            all_states = set()
            for states in states_by_type.values():
                all_states.update(states)
            
            return {
                'types': sorted(types),
                'states': sorted(all_states),
                'states_by_type': states_by_type
            }
        except Exception as e:
            logger.warning(f"Failed to retrieve work item metadata for project '{project}': {e}")
            # Return defaults if metadata retrieval fails
            return {
                'types': ['feature', 'epic', 'user story', 'task', 'bug'],
                'states': ['new', 'active', 'defined', 'resolved', 'closed', 'removed'],
                'states_by_type': {}
            }
