"""HistoryService: provides per-task change history for timeline display.

This service fetches work item revision history from Azure DevOps and
extracts only the changes relevant to the timeline view: start date,
end date, and iteration path changes.
"""
from __future__ import annotations

from typing import List, Optional, Dict, Any
from datetime import datetime
import logging

from planner_lib.storage.base import StorageBackend

logger = logging.getLogger(__name__)


class HistoryService:
    """Service responsible for fetching and processing task history.
    
    The service integrates with Azure DevOps to fetch work item revisions
    and returns a filtered, deduplicated history suitable for frontend display.
    """

    def __init__(self, storage_config: StorageBackend, azure_client=None):
        """Initialize with storage config and optional Azure client.
        
        Args:
            storage_config: Storage backend for reading configuration
            azure_client: Azure client instance (can be injected for testing)
        """
        self._storage_config = storage_config
        self._azure_client = azure_client

    def _get_project_config(self, project_id: str) -> Optional[Dict[str, Any]]:
        """Get configuration for a specific project.
        
        Args:
            project_id: Project identifier (slugified name)
            
        Returns:
            Project configuration dict or None if not found
        """
        try:
            cfg = self._storage_config.load("config", "projects")
            project_map = cfg.get("project_map", [])
            
            from planner_lib.util import slugify
            for project in project_map:
                if slugify(project.get("name"), prefix="project-") == project_id:
                    return project
        except Exception as e:
            logger.warning(f"Failed to load project config: {e}")
        
        return None

    def _get_field_mappings(self, project_config: Optional[Dict[str, Any]]) -> Dict[str, str]:
        """Extract field name mappings from project configuration.
        
        Args:
            project_config: Project configuration dict
            
        Returns:
            Dict with 'start_field', 'end_field', 'iteration_field' keys
        """
        defaults = {
            'start_field': 'Microsoft.VSTS.Scheduling.StartDate',
            'end_field': 'Microsoft.VSTS.Scheduling.TargetDate',
            'iteration_field': 'System.IterationPath'
        }
        
        if not project_config:
            return defaults
        
        # Check for field mappings in config (may be under 'field_mappings' or direct)
        field_mappings = project_config.get('field_mappings', {})
        return {
            'start_field': field_mappings.get('start_field', defaults['start_field']),
            'end_field': field_mappings.get('end_field', defaults['end_field']),
            'iteration_field': field_mappings.get('iteration_field', defaults['iteration_field'])
        }

    def _deduplicate_history(self, history: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Remove consecutive duplicate values from history entries.
        
        Args:
            history: List of history entries sorted by changed_at
            
        Returns:
            Deduplicated list of history entries
        """
        if not history:
            return []
        
        # Track last seen value for each field
        last_values = {}
        result = []
        
        for entry in history:
            field = entry.get('field')
            value = entry.get('value')
            
            if field not in last_values or last_values[field] != value:
                result.append(entry)
                last_values[field] = value
        
        return result

    def _compute_pairing_hints(self, history: List[Dict[str, Any]], delta_seconds: int = 60) -> List[Dict[str, Any]]:
        """Add pair_id hints to history entries that occurred at similar times.
        
        This helps the frontend identify which start/end changes belong together
        (e.g., when a user moved both dates in a single edit session).
        
        Args:
            history: List of history entries with changed_at timestamps
            delta_seconds: Time window (in seconds) to consider as paired
            
        Returns:
            History entries with pair_id added where applicable
        """
        if not history:
            return []
        
        # Parse timestamps and group by proximity
        parsed = []
        for entry in history:
            try:
                # Parse ISO timestamp
                timestamp_str = entry.get('changed_at', '')
                if not timestamp_str:
                    parsed.append((None, entry))
                    continue
                
                # Handle various timestamp formats
                if 'T' in timestamp_str:
                    if '+' in timestamp_str or timestamp_str.endswith('Z'):
                        # ISO format with timezone
                        timestamp_str = timestamp_str.replace('Z', '+00:00')
                        timestamp = datetime.fromisoformat(timestamp_str)
                    else:
                        # ISO format without timezone
                        timestamp = datetime.fromisoformat(timestamp_str)
                else:
                    # Date-only format
                    timestamp = datetime.fromisoformat(timestamp_str + 'T00:00:00')
                
                parsed.append((timestamp, entry))
            except Exception as e:
                logger.debug(f"Failed to parse timestamp '{entry.get('changed_at')}': {e}")
                parsed.append((None, entry))
        
        # Assign pair IDs based on temporal proximity
        pair_id = 1
        pair_assignments = {}  # Track which indices have been assigned pair_ids
        
        for i, (timestamp, entry) in enumerate(parsed):
            if timestamp is None:
                continue
            
            # Skip if already paired
            if i in pair_assignments:
                continue
            
            # Look for a matching entry within delta_seconds
            for j in range(i + 1, min(len(parsed), i + 4)):
                # Skip if already paired
                if j in pair_assignments:
                    continue
                
                other_timestamp, other_entry = parsed[j]
                if other_timestamp is None:
                    continue
                
                # Check if same changed_by and within time delta
                time_diff = abs((timestamp - other_timestamp).total_seconds())
                same_user = entry.get('changed_by') == other_entry.get('changed_by')
                different_field = entry.get('field') != other_entry.get('field')
                
                if same_user and different_field and time_diff <= delta_seconds:
                    # This is a pair - assign same pair_id to both
                    pair_assignments[i] = pair_id
                    pair_assignments[j] = pair_id
                    pair_id += 1
                    break
        
        # Build result with pair_id assignments
        result = []
        for i, (timestamp, entry) in enumerate(parsed):
            entry_with_pair = dict(entry)
            if i in pair_assignments:
                entry_with_pair['pair_id'] = pair_assignments[i]
            result.append(entry_with_pair)
        
        return result

    def invalidate_cache(
        self,
        azure_client,
        project_id: Optional[str] = None
    ) -> int:
        """Invalidate cached revision history for tasks in a project.

        Delegates to ``azure_client.invalidate_history_cache()`` when that
        public method is available (i.e. when the client is an
        ``AzureCachingClient``).  For non-caching clients the method returns 0.

        Args:
            azure_client: Azure client instance (caching or plain)
            project_id: Currently unused; reserved for future per-project scoping

        Returns:
            Number of cache entries invalidated
        """
        if not hasattr(azure_client, 'invalidate_history_cache'):
            logger.warning("Azure client does not support history cache invalidation, nothing to clear")
            return 0
        return azure_client.invalidate_history_cache()

    def list_task_history(
        self,
        pat: str,
        task_service,
        azure_client,
        project_id: Optional[str] = None,
        team_id: Optional[str] = None,
        plan_id: Optional[str] = None,
        since: Optional[str] = None,
        until: Optional[str] = None,
        page: int = 1,
        per_page: int = 100
    ) -> Dict[str, Any]:
        """Fetch history for tasks matching the given filters.
        
        Args:
            pat: Personal Access Token for Azure authentication
            task_service: TaskService instance for fetching tasks
            azure_client: Azure client instance for fetching revisions
            project_id: Optional project filter
            team_id: Optional team filter
            plan_id: Optional plan filter
            since: Optional start date filter (ISO format)
            until: Optional end date filter (ISO format)
            page: Page number (1-indexed)
            per_page: Items per page
            
        Returns:
            Dict with 'page', 'per_page', 'total', and 'tasks' (list of task history)
        """
        if not pat:
            logger.error("PAT is required for fetching history")
            return {'page': page, 'per_page': per_page, 'total': 0, 'tasks': []}
        
        logger.info(f"list_task_history called: project={project_id}, team={team_id}, plan={plan_id}")
        
        tasks = task_service.list_tasks(pat=pat, project_id=project_id)
        
        logger.info(f"Retrieved {len(tasks)} tasks from task_service")
        if tasks:
            logger.debug(f"Sample task: {tasks[0]}")
        
        # Apply filters
        filtered_tasks = tasks
        
        if team_id:
            # Filter by team (tasks have team info via area_path or other means)
            # For now, we'll skip team filtering as it requires more context
            pass
        
        if plan_id:
            # Filter by plan_id if tasks have that field
            filtered_tasks = [t for t in filtered_tasks if t.get('plan_id') == plan_id]
            logger.info(f"After plan_id filter ({plan_id}): {len(filtered_tasks)} tasks")
        
        # Pagination
        total = len(filtered_tasks)
        start_idx = (page - 1) * per_page
        end_idx = start_idx + per_page
        page_tasks = filtered_tasks[start_idx:end_idx]
        
        logger.info(f"Paginating: total={total}, page={page}, per_page={per_page}, page_tasks={len(page_tasks)}")
        
        # Fetch history for each task
        result_tasks = []
        
        # Get project config for field mappings
        project_config = None
        if project_id:
            project_config = self._get_project_config(project_id)
        
        field_mappings = self._get_field_mappings(project_config)
        
        logger.info(f"Fetching history for {len(page_tasks)} tasks with field mappings: {field_mappings}")
        
        with azure_client.connect(pat) as client:
            # Collect all valid work item IDs
            task_map = {}  # work_item_id -> task
            valid_ids = []
            
            for task in page_tasks:
                work_item_id = int(task.get('id', 0))
                if work_item_id == 0:
                    logger.warning(f"Skipping task with invalid ID: {task}")
                    continue
                task_map[work_item_id] = task
                valid_ids.append(work_item_id)
            
            # Batch fetch revision history if available (AzureCachingClient)
            if hasattr(client, 'get_task_revision_history_batch'):
                logger.debug(f"Using batch fetch for {len(valid_ids)} work items")
                revisions_map = client.get_task_revision_history_batch(
                    work_item_ids=valid_ids,
                    start_field=field_mappings['start_field'],
                    end_field=field_mappings['end_field'],
                    iteration_field=field_mappings['iteration_field']
                )
            else:
                # Fallback to individual fetches
                logger.debug(f"Batch method not available, fetching individually for {len(valid_ids)} work items")
                revisions_map = {}
                for work_item_id in valid_ids:
                    logger.debug(f"Fetching revision history for work item {work_item_id}")
                    try:
                        if hasattr(client, 'get_task_revision_history'):
                            revisions = client.get_task_revision_history(
                                work_item_id=work_item_id,
                                start_field=field_mappings['start_field'],
                                end_field=field_mappings['end_field'],
                                iteration_field=field_mappings['iteration_field']
                            )
                        else:
                            revisions = client._work_item_ops.get_task_revision_history(
                                work_item_id=work_item_id,
                                start_field=field_mappings['start_field'],
                                end_field=field_mappings['end_field'],
                                iteration_field=field_mappings['iteration_field']
                            )
                        revisions_map[work_item_id] = revisions
                    except Exception as e:
                        logger.warning(f"Failed to fetch history for work item {work_item_id}: {e}")
                        revisions_map[work_item_id] = []
            
            # Process all fetched revisions
            for work_item_id in valid_ids:
                task = task_map[work_item_id]
                revisions = revisions_map.get(work_item_id, [])
                
                logger.debug(f"Got {len(revisions)} revision records for work item {work_item_id}")
                
                try:
                    # Flatten revision changes into individual history entries
                    history_entries = []
                    for rev in revisions:
                        changed_at = rev.get('changed_at', '')
                        changed_by = rev.get('changed_by', '')
                        
                        for change in rev.get('changes', []):
                            history_entries.append({
                                'field': change.get('field'),
                                'value': change.get('new_value'),
                                'changed_at': changed_at,
                                'changed_by': changed_by
                            })
                    
                    # Sort by timestamp
                    history_entries.sort(key=lambda x: x.get('changed_at', ''))
                    
                    # Deduplicate consecutive identical values
                    history_entries = self._deduplicate_history(history_entries)
                    
                    # Add pairing hints
                    history_entries = self._compute_pairing_hints(history_entries)
                    
                    # Apply date range filter if specified
                    if since or until:
                        filtered_history = []
                        for entry in history_entries:
                            entry_date = entry.get('changed_at', '')[:10]  # Extract date part
                            if since and entry_date < since:
                                continue
                            if until and entry_date > until:
                                continue
                            filtered_history.append(entry)
                        history_entries = filtered_history
                    
                    result_tasks.append({
                        'task_id': work_item_id,
                        'title': task.get('title', ''),
                        'plan_id': task.get('plan_id', ''),
                        'history': history_entries
                    })
                    
                except Exception as e:
                    logger.warning(f"Failed to process history for task {work_item_id}: {e}")
                    # Still include task with empty history
                    result_tasks.append({
                        'task_id': work_item_id,
                        'title': task.get('title', ''),
                        'plan_id': task.get('plan_id', ''),
                        'history': []
                    })
        
        return {
            'page': page,
            'per_page': per_page,
            'total': total,
            'tasks': result_tasks
        }
