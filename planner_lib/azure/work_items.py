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

    def update_work_item_state(self, work_item_id: int, state_value: str) -> Any:
        """Update the System.State field for a work item.

        Args:
            work_item_id: Work item ID
            state_value: New state value (string)

        Returns:
            Azure SDK response object
        """
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")

        assert self.client.conn is not None
        wit = self.client.conn.clients.get_work_item_tracking_client()

        ops = [{"op": "add", "path": "/fields/System.State", "value": state_value}]

        try:
            return wit.update_work_item(document=ops, id=work_item_id)
        except Exception as e:
            raise RuntimeError(f"Failed to update work item {work_item_id} state: {e}")

    def update_work_item_relations(self, work_item_id: int, relations_ops: list) -> Any:
        """Update work item relations.

        relations_ops is a list of operations. Supported operations:
          - { op: 'add', type: 'Parent'|'Related'|'Predecessor'|'Successor'|'Child', id: '<id>' }
          - { op: 'remove', type: <type>, id: '<id>' }
          - { op: 'set', type: 'Parent', id: '<id>' }  # remove existing of type then add this

        Returns the Azure SDK response object or raises on failure.
        """
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")

        assert self.client.conn is not None
        wit = self.client.conn.clients.get_work_item_tracking_client()

        # Mapping from semantic type to Azure rel name
        rel_map = {
            'Parent': 'System.LinkTypes.Hierarchy-Reverse',
            'Child': 'System.LinkTypes.Hierarchy-Forward',
            'Predecessor': 'System.LinkTypes.Dependency-Forward',
            'Successor': 'System.LinkTypes.Dependency-Reverse',
            'Related': 'System.LinkTypes.Related'
        }

        # Fetch current relations to support remove operations
        try:
            current = wit.get_work_item(work_item_id, expand='relations')
            current_relations = getattr(current, 'relations', []) or []
        except Exception:
            current_relations = []

        ops = []

        for r in relations_ops or []:
            op = (r.get('op') or '').lower()
            typ = r.get('type') or r.get('relationType') or r.get('relation') or 'Related'
            other_id = str(r.get('id') or '')

            if op == 'set':
                # Remove any existing relations of this type, then add the supplied id
                # Remove in reverse index order to keep indices stable
                remove_indices = []
                for idx, cr in enumerate(current_relations):
                    try:
                        name = cr.attributes.get('name')
                    except Exception:
                        name = None
                    url = getattr(cr, 'url', '') or ''
                    if name == typ and url.endswith('/' + other_id):
                        remove_indices.append(idx)
                for idx in sorted(remove_indices, reverse=True):
                    ops.append({'op': 'remove', 'path': f'/relations/{idx}'})
                # Add new relation
                api_url = f"{self.client.conn.base_url}/_apis/wit/workItems/{other_id}"
                relname = rel_map.get(typ, 'System.LinkTypes.Related')
                ops.append({'op': 'add', 'path': '/relations/-', 'value': {'rel': relname, 'url': api_url, 'attributes': {'name': typ}}})

            elif op == 'remove':
                # remove matching relation(s)
                for idx, cr in enumerate(current_relations):
                    try:
                        name = cr.attributes.get('name')
                    except Exception:
                        name = None
                    url = getattr(cr, 'url', '') or ''
                    if name == typ and (not other_id or url.endswith('/' + other_id)):
                        ops.append({'op': 'remove', 'path': f'/relations/{idx}'})

            elif op == 'add':
                api_url = f"{self.client.conn.base_url}/_apis/wit/workItems/{other_id}"
                relname = rel_map.get(typ, 'System.LinkTypes.Related')
                ops.append({'op': 'add', 'path': '/relations/-', 'value': {'rel': relname, 'url': api_url, 'attributes': {'name': typ}}})
            else:
                # Unsupported op - skip
                continue

        if not ops:
            return None

        try:
            return wit.update_work_item(document=ops, id=work_item_id)
        except Exception as e:
            raise RuntimeError(f"Failed to update work item {work_item_id} relations: {e}")
    
    def get_work_item_revision(self, work_item_id: int) -> Optional[int]:
        """Get current revision number for a work item (lightweight API call).
        
        This method fetches only the System.Rev field to minimize data transfer.
        Useful for checking if a work item has changed without fetching full details.
        
        Args:
            work_item_id: Work item ID
            
        Returns:
            Current revision number or None if work item not found
        """
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        
        assert self.client.conn is not None
        wit = self.client.conn.clients.get_work_item_tracking_client()
        
        try:
            # Only fetch the System.Rev field for minimal data transfer
            work_item = wit.get_work_item(
                id=work_item_id,
                fields=["System.Rev"]
            )
            return work_item.fields.get("System.Rev")
        except Exception as e:
            logger.warning(f"Failed to get revision for work item {work_item_id}: {e}")
            return None
    
    def get_work_item_revisions_batch(self, work_item_ids: List[int]) -> dict[int, Optional[int]]:
        """Get current revision numbers for multiple work items (batch API call).
        
        This method fetches only the System.Rev field for multiple work items in
        a single API call to minimize network overhead.
        
        Args:
            work_item_ids: List of work item IDs
            
        Returns:
            Dictionary mapping work item ID to revision number (or None if not found)
        """
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        
        if not work_item_ids:
            return {}
        
        assert self.client.conn is not None
        wit = self.client.conn.clients.get_work_item_tracking_client()
        
        result = {}
        
        # Batch in chunks of 200 (Azure API limit)
        def chunks(lst, n):
            for i in range(0, len(lst), n):
                yield lst[i:i+n]
        
        try:
            for batch in chunks(work_item_ids, 200):
                # Fetch only System.Rev field for minimal data transfer
                work_items = wit.get_work_items(
                    ids=batch,
                    fields=["System.Rev"]
                )
                
                for work_item in work_items:
                    work_item_id = work_item.id
                    revision = work_item.fields.get("System.Rev")
                    result[work_item_id] = revision
                
                # Mark items not found as None
                for work_item_id in batch:
                    if work_item_id not in result:
                        result[work_item_id] = None
            
            logger.debug(f"Batch fetched revisions for {len(work_item_ids)} work items")
            return result
            
        except Exception as e:
            logger.warning(f"Failed to batch fetch revisions for {len(work_item_ids)} work items: {e}")
            # Return None for all items on error
            return {wid: None for wid in work_item_ids}
    
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
                type_name = wi_type.name
                types.append(type_name)
                
                # Retrieve states for this specific type
                if hasattr(wi_type, 'states') and wi_type.states:
                    states = [state.name for state in wi_type.states]
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
            # Return defaults if metadata retrieval fails (using typical Azure DevOps case)
            return {
                'types': ['Feature', 'Epic', 'User Story', 'Task', 'Bug'],
                'states': ['New', 'Active', 'Defined', 'Resolved', 'Closed', 'Removed'],
                'states_by_type': {}
            }
    
    def get_task_revision_history(
        self, 
        work_item_id: int, 
        start_field: str = "Microsoft.VSTS.Scheduling.StartDate",
        end_field: str = "Microsoft.VSTS.Scheduling.TargetDate",
        iteration_field: str = "System.IterationPath"
    ) -> List[dict]:
        """Fetch revision history for a work item focusing on start, end, and iteration changes.
        
        Args:
            work_item_id: Work item ID
            start_field: Field name for start date (project-specific)
            end_field: Field name for end/target date (project-specific)
            iteration_field: Field name for iteration path
            
        Returns:
            List of normalized revision records, each with:
                - changed_at: ISO timestamp string
                - changed_by: User display name
                - changes: List of field changes with field, old_value, new_value
        """
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        
        assert self.client.conn is not None
        wit_client = self.client.conn.clients.get_work_item_tracking_client()
        
        try:
            # Fetch all revisions for the work item
            revisions = wit_client.get_revisions(id=work_item_id)
            
            tracked_fields = {start_field, end_field, iteration_field}
            result = []
            prev_values = {}
            
            for revision in revisions:
                fields = getattr(revision, 'fields', {})
                if not fields:
                    continue
                
                # Extract metadata
                changed_at = fields.get('System.ChangedDate')
                changed_by_obj = fields.get('System.ChangedBy')
                changed_by = ''
                
                if isinstance(changed_by_obj, dict):
                    changed_by = changed_by_obj.get('displayName', '')
                elif isinstance(changed_by_obj, str):
                    changed_by = changed_by_obj
                
                # Check for changes in tracked fields
                changes = []
                for field_name in tracked_fields:
                    current_value = fields.get(field_name)
                    old_value = prev_values.get(field_name)
                    
                    # Detect change
                    if current_value != old_value or (current_value is not None and field_name not in prev_values):
                        # Determine field label
                        if field_name == start_field:
                            field_label = 'start'
                        elif field_name == end_field:
                            field_label = 'end'
                        elif field_name == iteration_field:
                            field_label = 'iteration'
                        else:
                            continue
                        
                        # Normalize values (dates to ISO date strings)
                        if field_label in ('start', 'end'):
                            new_value = self._safe_date(current_value) if current_value else None
                            old_val = self._safe_date(old_value) if old_value else None
                        else:
                            new_value = current_value
                            old_val = old_value
                        
                        # Only record if there's an actual change in normalized values
                        if new_value != old_val:
                            changes.append({
                                'field': field_label,
                                'old_value': old_val,
                                'new_value': new_value
                            })
                    
                    # Update tracking
                    if current_value is not None:
                        prev_values[field_name] = current_value
                
                # Add record if there were relevant changes
                if changes:
                    # Convert changed_at to ISO string
                    changed_at_str = str(changed_at) if changed_at else ''
                    result.append({
                        'changed_at': changed_at_str,
                        'changed_by': changed_by,
                        'changes': changes
                    })
            
            logger.debug(f"Fetched {len(result)} revision records for work item {work_item_id}")
            return result
            
        except Exception as e:
            logger.warning(f"Failed to fetch revision history for work item {work_item_id}: {e}")
            return []
