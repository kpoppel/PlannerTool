"""AzureClient implementation with caching

This client adds TTL-based caching on top of the base AzureClient operations.
It uses the CacheManager to handle all cache storage, TTL checks, and invalidation.
"""
from __future__ import annotations
from typing import List, Optional
import logging
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)

from planner_lib.azure.AzureClient import AzureClient
from planner_lib.azure.caching import CacheManager, CACHE_TTL, HISTORY_CACHE_TTL, NAMESPACE
from planner_lib.storage.interfaces import StorageProtocol


class AzureCachingClient(AzureClient):
    """Azure client with TTL-based file caching per-area.

    This client wraps the base Azure operations with a caching layer that:
    - Caches work items per area with TTL
    - Caches teams and plans per project with TTL
    - Caches markers per plan with TTL
    - Tracks invalidated work items and refetches them
    - Periodically prunes old cache entries
    """

    def __init__(self, organization_url: str, storage: StorageProtocol):
        """Initialize caching client with storage backend.

        The client is instantiated without a PAT; use the `connect(pat)` 
        context-manager to obtain a connected client.
        """
        logger.info("Using AzureCachingClient (deferred connect) with storage backend")
        super().__init__(organization_url, storage=storage)
        self._cache = CacheManager(storage, namespace=NAMESPACE)
        
        # History cache metrics
        self._history_metrics = {
            "history_cache_hits": 0,
            "history_cache_misses": 0,
            "history_api_calls_saved": 0,
            "revision_checks_performed": 0
        }
    
    @property
    def _fetch_count(self):
        """Expose fetch count for tests."""
        return self._cache._fetch_count
    
    @_fetch_count.setter
    def _fetch_count(self, value):
        """Set fetch count for tests."""
        self._cache._fetch_count = value

    def _key_for_area(self, area_path: str) -> str:
        """Generate cache key for an area path."""
        safe = area_path.replace('\\', '__').replace('/', '__').replace(' ', '_')
        safe = ''.join(c for c in safe if c.isalnum() or c in ('_', '-'))
        return safe

    def _key_for_teams(self, project: str) -> str:
        """Generate cache key for project teams."""
        safe = project.replace(' ', '_').replace('/', '__').replace('\\', '__')
        return f"teams_{safe}"

    def _key_for_plans(self, project: str) -> str:
        """Generate cache key for project plans."""
        safe = project.replace(' ', '_').replace('/', '__').replace('\\', '__')
        return f"plans_{safe}"

    def _key_for_area_plan(self, area_path: str) -> str:
        """Generate cache key for area->plan mapping."""
        safe = self._key_for_area(area_path)
        return f"area_plan_{safe}"

    def _key_for_plan_markers(self, project: str, plan_id: str) -> str:
        """Generate cache key for plan markers."""
        safe_proj = project.replace(' ', '_').replace('/', '__').replace('\\', '__')
        safe_plan = str(plan_id).replace(' ', '_')
        return f"plan_markers_{safe_proj}_{safe_plan}"
    
    def _key_for_iterations(self, project: str, root_path: Optional[str] = None) -> str:
        """Generate cache key for iterations."""
        safe_proj = project.replace(' ', '_').replace('/', '__').replace('\\', '__')
        if root_path:
            safe_root = root_path.replace('\\', '__').replace('/', '__').replace(' ', '_')
            safe_root = ''.join(c for c in safe_root if c.isalnum() or c in ('_', '-'))
            return f"iterations_{safe_proj}_{safe_root}"
        return f"iterations_{safe_proj}_all"
    
    def _key_for_revision_history(self, work_item_id: int) -> str:
        """Generate cache key for work item revision history."""
        return f"history_{work_item_id}"

    def _write_history_cache(self, work_item_id: int, history: List[dict], revision: int, timestamp: Optional[datetime] = None) -> None:
        """Write revision history to cache with revision and timestamp metadata.
        
        Args:
            work_item_id: Work item ID
            history: List of revision records
            revision: Current revision number of the work item
        """
        key = self._key_for_revision_history(work_item_id)
        if timestamp is None:
            timestamp = datetime.now(timezone.utc)
        cache_entry = {
            "data": history,
            "metadata": {
                "revision": revision,
                "work_item_id": work_item_id,
                "timestamp": timestamp.isoformat()
            }
        }
        self._cache.write(key, cache_entry)
        self._cache.update_timestamp(key)
    
    def _read_history_cache(self, work_item_id: int, ttl: timedelta = HISTORY_CACHE_TTL) -> tuple[Optional[List[dict]], Optional[int], bool]:
        """Read revision history from cache with revision metadata and TTL check.
        
        Args:
            work_item_id: Work item ID
            ttl: Time-to-live for cache (default 24 hours)
            
        Returns:
            Tuple of (history list, revision number, is_fresh)
            - (None, None, False) if not cached
            - (history, revision, True) if cached and within TTL
            - (history, revision, False) if cached but TTL expired
        """
        key = self._key_for_revision_history(work_item_id)
        cached = self._cache.read(key)
        
        if cached is None:
            return None, None, False
        
        # Expected format with metadata
        if isinstance(cached, dict) and "data" in cached and "metadata" in cached:
            history = cached["data"]
            metadata = cached["metadata"]
            revision = metadata.get("revision")
            timestamp_str = metadata.get("timestamp")
            
            # Check TTL if timestamp available
            is_fresh = False
            if timestamp_str:
                try:
                    timestamp = datetime.fromisoformat(timestamp_str)
                    age = datetime.now(timezone.utc) - timestamp
                    is_fresh = age < ttl
                    if is_fresh:
                        logger.debug(f"History cache fresh for {work_item_id} (age={age}, ttl={ttl})")
                    else:
                        logger.debug(f"History cache stale for {work_item_id} (age={age}, ttl={ttl})")
                except (ValueError, TypeError) as e:
                    logger.warning(f"Invalid timestamp in cache for {work_item_id}: {e}")
            
            return history, revision, is_fresh
        
        # Invalid format - return None to force refetch
        logger.warning(f"Invalid cache format for work item {work_item_id}, will refetch")
        return None, None, False

    def _get_current_revision(self, work_item_id: int) -> Optional[int]:
        """Get current work item revision number (lightweight API call).
        
        Args:
            work_item_id: Work item ID
            
        Returns:
            Current revision number or None if work item not found
        """
        return self._work_item_ops.get_work_item_revision(work_item_id)
    
    def _get_current_revisions_batch(self, work_item_ids: List[int]) -> dict[int, Optional[int]]:
        """Get current revision numbers for multiple work items (batch API call).
        
        Args:
            work_item_ids: List of work item IDs
            
        Returns:
            Dictionary mapping work item ID to revision number
        """
        return self._work_item_ops.get_work_item_revisions_batch(work_item_ids)

    def get_projects(self) -> List[str]:
        """Fetch projects (not cached)."""
        return super().get_projects()

    def get_work_items(
        self, 
        area_path: str,
        task_types: Optional[List[str]] = None,
        include_states: Optional[List[str]] = None
    ) -> List[dict]:
        """Fetch work items with caching and invalidation support.
        
        This implements:
        - TTL-based cache refresh (30 min default)
        - Per-area invalidation tracking
        - Incremental updates using ModifiedDate filter
        - Revision-based change detection (catches rank changes automatically)
        - StackRank ordering preservation (items always returned in Azure backlog order)
        - Minimal API calls: WIQL for rank order, get_work_items only for changed items
        
        Args:
            area_path: Azure DevOps area path
            task_types: List of work item types to include (e.g., ['epic', 'feature']).
                       Defaults to ['epic', 'feature'] if not provided.
            include_states: List of states to include (e.g., ['new', 'active']).
                           If not provided, excludes 'Closed' and 'Removed' states.
        
        Returns:
            List of work items sorted by StackRank (Azure backlog order)
        
        Note: Uses _key_for_area() for cache keys to ensure consistent key format
        across all cache operations (converts backslashes to double underscores).
        Uses _sanitize_area_path() for WIQL queries (preserves backslashes).
        
        Performance: WIQL is always executed (lightweight: ~50ms), but expensive
        get_work_items() calls only happen for items with changed revisions.
        """
        logger.debug(f"Fetching work items for area path: {area_path}")
        
        if not self._connected:
            raise RuntimeError("AzureCachingClient is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        
        assert self.conn is not None
        wit_client = self.conn.clients.get_work_item_tracking_client()
        
        # Use defaults if not provided
        if task_types is None:
            task_types = ['epic', 'feature']
        if include_states is None:
            include_states = []
        
        # Use _key_for_area for cache key (consistent with other cache keys)
        area_key = self._key_for_area(area_path)
        # Use _sanitize_area_path for WIQL query (needs backslashes)
        wiql_area = self._sanitize_area_path(area_path)

        # Load cache
        area_cache_list = self._cache.read(area_key) or []
        area_cache = {it.get('id'): it for it in area_cache_list}
        cached_count = len(area_cache)
        logger.debug(f"Area '{area_key}' cache loaded: {cached_count} items")

        # Check TTL and determine if full refresh needed
        force_full_refresh = self._cache.is_stale(area_key, ttl=CACHE_TTL)
        last_update_dt = self._cache.get_timestamp(area_key)
        
        # Build ModifiedDate filter for WIQL
        last_update = None
        if last_update_dt and not force_full_refresh:
            # Use date-only precision for WIQL (Azure rejects time components)
            last_update = last_update_dt.date().isoformat()
        
        logger.debug(f"Cache TTL for area '{area_key}': last_update={last_update_dt}, force_refresh={force_full_refresh}")

        # Get invalidated IDs for this area
        invalidated_ids = self._cache.get_invalidated(area_key)
        cached_ids_in_area = {int(cid) for cid in area_cache.keys() if cid}
        invalidated_in_area = invalidated_ids & cached_ids_in_area

        # Always run WIQL to get current rank order (even for cache hits)
        # The WIQL query is lightweight (just IDs and Revs) and provides the
        # canonical StackRank ordering that must be preserved for the UI
        logger.debug(f"Running WIQL for area '{area_key}' (force_refresh={force_full_refresh}, invalidated={len(invalidated_in_area)})")

        # Build WIQL query with optional ModifiedDate filter
        modified_where = f"AND [System.ChangedDate] > '{last_update}'" if last_update and not force_full_refresh else ''
        # If `modified_where` is set we are doing a limited WIQL that only
        # returns changed items since `last_update`. Remember this so we do
        # not treat missing IDs from that limited query as deletions.
        limited_wiql = bool(modified_where)
        
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

        # Query for IDs and Revisions for change detection
        wiql_query = f"""
        SELECT [System.Id], [System.Rev]
        FROM WorkItems
        WHERE [System.WorkItemType] IN ({types_clause})
        AND [System.AreaPath] = '{wiql_area_escaped}'
        {modified_where}
        {states_clause}
        ORDER BY [Microsoft.VSTS.Common.StackRank] ASC
        """

        from azure.devops.v7_1.work_item_tracking.models import Wiql
        wiql_obj = Wiql(query=wiql_query)
        
        try:
            result = wit_client.query_by_wiql(wiql=wiql_obj)
        except Exception as e:
            logger.warning(f"WIQL query for area '{area_path}' failed: {e}")
            # On WIQL failure, return whatever is in the cache instead of
            # an empty list. This ensures fast refreshes that briefly fail
            # (e.g. transient API/connectivity errors) still show cached
            # work items to the frontend.
            return list(area_cache.values())
        
        candidate_ws = getattr(result, 'work_items', []) or []
        
        # Extract IDs
        task_ids = []
        for wi in candidate_ws:
            wid = getattr(wi, 'id', None)
            if wid is not None:
                task_ids.append(int(wid))
        
        # Get current revisions with lightweight fetch (just System.Rev field)
        current_revisions = {}  # id -> revision
        if task_ids:
            # Fetch revisions in batches to avoid large single requests
            def chunks(lst, n):
                for i in range(0, len(lst), n):
                    yield lst[i:i+n]
            
            for batch in chunks(task_ids, 200):
                try:
                    rev_items = wit_client.get_work_items(batch, fields=['System.Rev'])
                    for item in rev_items or []:
                        item_id = getattr(item, 'id', None)
                        if item_id:
                            fields = getattr(item, 'fields', {})
                            rev = fields.get('System.Rev', 0) if fields else 0
                            current_revisions[int(item_id)] = rev
                except Exception as e:
                    logger.warning(f"Failed to fetch revisions for batch: {e}")
                    # Fall back to assuming all items need fetching
                    for wid in batch:
                        current_revisions[wid] = 0
        
        # Get cached revisions for comparison
        cached_revisions = self._cache.get_revisions(area_key)
        
        # Determine which items actually changed
        items_to_fetch = set()
        
        # Add invalidated items
        if invalidated_in_area:
            items_to_fetch.update(invalidated_in_area)
            logger.debug(f"Added {len(invalidated_in_area)} invalidated work items to fetch list")
        
        # Compare revisions to find changed/new items
        for wid in task_ids:
            # If item not in cache revisions, it's new - fetch it
            if wid not in cached_revisions:
                items_to_fetch.add(wid)
            else:
                # Item exists in cache - check if revision changed
                cached_rev = cached_revisions[wid]
                current_rev = current_revisions.get(wid, 0)
                
                if cached_rev != current_rev:
                    items_to_fetch.add(wid)
        
        # Check for deleted items (in cache but not in current query)
        # If we ran a limited WIQL (modified_where present) the query only
        # returns changed items and cannot be used to infer deletions, so
        # don't mark deletes in that case. Otherwise compare cached IDs to
        # the full WIQL result to detect deletions.
        cached_item_ids = {int(k) for k in area_cache.keys()}
        if limited_wiql:
            deleted_ids = set()
        else:
            deleted_ids = cached_item_ids - set(task_ids)
        
        task_ids_to_fetch = list(items_to_fetch)
        
        logger.debug(f"WIQL returned {len(candidate_ws)} candidates")
        logger.debug(f"Changed/new items: {len(items_to_fetch)}, Deleted: {len(deleted_ids)}")
        logger.debug(f"Skipping {len(task_ids) - len(items_to_fetch)} unchanged items")
        
        # If nothing changed and no deletes, return cached data. If we ran a
        # limited WIQL we don't have a full rank ordering, so return the
        # cached list as-is; otherwise preserve WIQL order.
        if not items_to_fetch and not deleted_ids and not force_full_refresh:
            logger.debug(f"No changes detected for area '{area_key}' - using cache")
            if limited_wiql:
                return list(area_cache.values())
            # Sort by task_ids order (preserves StackRank from WIQL)
            result = [area_cache[str(tid)] for tid in task_ids if str(tid) in area_cache]
            return result

        # Fetch only changed work items in batches
        updated_items = []
        if task_ids_to_fetch:
            def chunks(lst, n):
                for i in range(0, len(lst), n):
                    yield lst[i:i+n]

            for batch in chunks(task_ids_to_fetch, 200):
                items = wit_client.get_work_items(batch, expand="relations")
                for item in items or []:
                    relations = getattr(item, "relations", []) or []
                    relation_map = []
                    for r in relations:
                        if r.attributes.get("name") in ("Parent", "Child", "Related", "Predecessor", "Successor"):
                            relation_map.append({
                                "type": r.attributes.get("name"),
                                "id": str(r.url.split('/')[-1]),
                                "url": self.api_url_to_ui_link(getattr(r, "url", "")),
                            })

                    assigned = item.fields.get("System.AssignedTo")
                    assignedTo = assigned.get("displayName") if isinstance(assigned, dict) and "displayName" in assigned else ""
                    url = self.api_url_to_ui_link(getattr(item, "url", ""))
                    
                    try:
                        wi = {
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
                        }
                        updated_items.append(wi)
                    except Exception as e:
                        logger.exception(f"Error processing item {getattr(item, 'id', '?')}: {e}")

        logger.debug(f"Fetched {len(updated_items)} updated work items for area '{area_key}'")

        # Merge updated items with cache
        changed = False
        updated_count = 0
        for wi in updated_items:
            if wi['id'] not in area_cache or area_cache[wi['id']] != wi:
                area_cache[wi['id']] = wi
                changed = True
                updated_count += 1
        
        # Remove deleted items from cache
        for del_id in deleted_ids:
            if del_id in area_cache:
                del area_cache[del_id]
                changed = True

        logger.debug(f"Area '{area_key}': cached={cached_count}, fetched={len(updated_items)}, updated={updated_count}, deleted={len(deleted_ids)}")

        # Write cache and update timestamps
        self._cache.write(area_key, list(area_cache.values()))
        self._cache.update_timestamp(area_key)
        
        # Store updated revisions for next comparison
        self._cache.store_revisions(area_key, current_revisions)
        
        # Clear invalidated items that were successfully fetched
        if invalidated_in_area:
            self._cache.clear_invalidated(area_key, invalidated_in_area)
        
        # Periodic pruning
        self._cache.prune_old_entries(keep_count=50)
        
        # Sort by task_ids order (preserves StackRank from WIQL) before returning
        result = [area_cache[str(tid)] for tid in task_ids if str(tid) in area_cache]

        return result

    def get_all_teams(self, project: str) -> List[dict]:
        """Fetch teams with caching."""
        if not self._connected:
            raise RuntimeError("AzureCachingClient is not connected.")
        
        key = self._key_for_teams(project)
        cached = self._cache.read(key)
        
        if cached and not self._cache.is_stale(key, ttl=CACHE_TTL):
            return cached
        
        # Fetch from Azure
        teams = super().get_all_teams(project)
        
        # Cache the result
        self._cache.write(key, teams)
        self._cache.update_timestamp(key)
        
        return teams

    def get_all_plans(self, project: str) -> List[dict]:
        """Fetch plans with caching."""
        if not self._connected:
            raise RuntimeError("AzureCachingClient is not connected.")
        
        key = self._key_for_plans(project)
        cached = self._cache.read(key)
        
        if cached and not self._cache.is_stale(key, ttl=CACHE_TTL):
            return cached
        
        # Fetch from Azure
        plans = super().get_all_plans(project)
        
        # Cache the result
        self._cache.write(key, plans)
        self._cache.update_timestamp(key)
        
        return plans

    def get_markers_for_plan(self, project: str, plan_id: str) -> List[dict]:
        """Fetch markers for a plan with caching."""
        if not self._connected:
            raise RuntimeError("AzureCachingClient is not connected.")
        
        key = self._key_for_plan_markers(project, plan_id)
        cached = self._cache.read(key)
        
        if cached and isinstance(cached, dict) and 'markers' in cached:
            if not self._cache.is_stale(key, ttl=CACHE_TTL):
                logger.debug(f"Using cached markers for plan {plan_id} (key: {key})")
                return cached['markers']
        
        # Fetch from Azure
        logger.info(f"Fetching markers from Azure for plan {plan_id} in project {project}")
        markers = super().get_markers_for_plan(project, plan_id)
        
        # Cache with timestamp
        payload = {'markers': markers, 'last_update': datetime.now(timezone.utc).isoformat()}
        self._cache.write(key, payload)
        self._cache.update_timestamp(key)
        logger.debug(f"Cached {len(markers)} markers for plan {plan_id} with key: {key}")
        return markers

    def get_markers(self, area_path: str) -> List[dict]:
        """Fetch markers with area->plan mapping cache.
        
        Note: This method is primarily used for admin area mapping discovery.
        Production marker fetching uses get_markers_for_plan directly.
        """
        if not self._connected:
            raise RuntimeError("AzureCachingClient is not connected.")
        
        if not isinstance(area_path, str) or not area_path:
            return []
        
        project = area_path.split('\\')[0] if '\\' in area_path else area_path.split('/')[0]

        # Check if we have cached area->plan mapping
        map_key = self._key_for_area_plan(area_path)
        mapping = self._cache.read(map_key)
        
        if mapping and isinstance(mapping, dict) and 'plans' in mapping:
            if not self._cache.is_stale(map_key, ttl=CACHE_TTL):
                plan_ids = mapping['plans']
                logger.debug(f"Using cached area->plan mapping for {area_path}, found {len(plan_ids)} plans")
                
                markers_out = []
                for pid in plan_ids:
                    try:
                        pm = self.get_markers_for_plan(project, pid)
                        for m in pm:
                            markers_out.append({
                                'plan_id': pid, 
                                'plan_name': None, 
                                'team_id': None, 
                                'team_name': None, 
                                'marker': m
                            })
                    except Exception:
                        continue
                return markers_out

        # No cached mapping - compute via base implementation
        logger.info(f"Computing markers for area {area_path} via base implementation")
        computed = super().get_markers(area_path)
        
        # Cache the area->plan mapping for future use
        plan_set = {entry.get('plan_id') for entry in computed if entry.get('plan_id')}
        plan_list = list(plan_set)
        
        payload = {'plans': plan_list, 'last_update': datetime.now(timezone.utc).isoformat()}
        self._cache.write(map_key, payload)
        self._cache.update_timestamp(map_key)
        logger.debug(f"Cached area->plan mapping for {area_path}: {len(plan_list)} plans")
        
        # Pre-cache markers for each discovered plan
        for pid in plan_list:
            try:
                self.get_markers_for_plan(project, pid)
            except Exception:
                continue
        
        return computed

    def invalidate_work_items(self, work_item_ids: List[int]):
        """Mark work items as invalidated for refetch.
        
        Attempts to map work item IDs to their areas for per-area invalidation.
        Falls back to storing unmapped IDs under a special key.
        """
        if not work_item_ids:
            return
        
        logger.debug(f"Invalidating {len(work_item_ids)} work items")
        
        # Try to map IDs to areas by scanning existing caches
        unmapped = set(work_item_ids)
        
        # Read index to get area keys
        try:
            index = self._cache._read_index()
            for area_key in list(index.keys()):
                if area_key == '_invalidated':
                    continue
                
                # Check if any work items belong to this area
                area_list = self._cache.read(area_key) or []
                area_ids = {int(it.get('id')) for it in area_list if it.get('id')}
                
                matched = unmapped & area_ids
                if matched:
                    self._cache.mark_invalidated(area_key, list(matched))
                    unmapped -= matched
                
                if not unmapped:
                    break
        except Exception as e:
            logger.warning(f"Error mapping work items to areas: {e}")
        
        # Store any unmapped IDs under special key
        if unmapped:
            self._cache.mark_invalidated('_unmapped', list(unmapped))

    def invalidate_plans(self, project: str, plan_ids: Optional[List[str]] = None):
        """Invalidate cached plans and markers.
        
        If plan_ids is None, invalidates all plans for the project.
        Otherwise, only invalidates the specified plans.
        """
        logger.debug(f"Invalidating plans for project {project}: {plan_ids}")
        
        # Invalidate plans list cache
        if plan_ids is None:
            plans_key = self._key_for_plans(project)
            self._cache.delete(plans_key)
            self._cache.invalidate([plans_key])
        
        # Invalidate per-plan markers
        pids_to_invalidate = plan_ids if plan_ids else []
        
        if not pids_to_invalidate and plan_ids is None:
            # Need to get plan IDs from cache
            plans_key = self._key_for_plans(project)
            cached_plans = self._cache.read(plans_key) or []
            pids_to_invalidate = [p.get('id') for p in cached_plans if p.get('id')]
        
        for pid in pids_to_invalidate:
            key = self._key_for_plan_markers(project, str(pid))
            self._cache.delete(key)
            self._cache.invalidate([key])
        
        # Clean up area->plan mappings that reference invalidated plans
        try:
            index = self._cache._read_index()
            for area_key in list(index.keys()):
                if area_key == '_invalidated':
                    continue
                
                map_key = self._key_for_area_plan(area_key)
                mapping = self._cache.read(map_key)
                
                if not mapping or not isinstance(mapping, dict):
                    continue
                
                plans = mapping.get('plans') or []
                if not plans:
                    continue
                
                if plan_ids is None:
                    # Remove entire mapping
                    self._cache.delete(map_key)
                    self._cache.invalidate([map_key])
                else:
                    # Remove specific plans from mapping
                    new_plans = [p for p in plans if p not in plan_ids]
                    if len(new_plans) != len(plans):
                        mapping['plans'] = new_plans
                        mapping['last_update'] = datetime.now(timezone.utc).isoformat()
                        self._cache.write(map_key, mapping)
                        self._cache.update_timestamp(map_key)
        except Exception as e:
            logger.exception(f"Error cleaning area->plan mappings: {e}")

    def update_work_item_dates(self, work_item_id: int, start: Optional[str] = None, end: Optional[str] = None):
        """Update work item dates and invalidate cache."""
        logger.debug(f"Updating work item {work_item_id}: start={start}, end={end}")
        result = super().update_work_item_dates(work_item_id, start=start, end=end)
        
        try:
            self.invalidate_work_items([work_item_id])
        except Exception:
            logger.exception(f"Failed to invalidate work item {work_item_id} after update")
        
        return result

    def update_work_item_description(self, work_item_id: int, description: str):
        """Update work item description and invalidate cache."""
        logger.debug(f"Updating work item {work_item_id} description")
        result = super().update_work_item_description(work_item_id, description)
        
        try:
            self.invalidate_work_items([work_item_id])
        except Exception:
            logger.exception(f"Failed to invalidate work item {work_item_id} after description update")
        
        return result

    def update_work_item_state(self, work_item_id: int, state_value: str):
        """Update work item state and invalidate cache.

        Delegates to the base implementation to perform the Azure update,
        then marks the work item as invalidated in the cache so subsequent
        `get_work_items` calls will refetch fresh data for the affected area.
        """
        logger.debug(f"Updating work item {work_item_id} state -> {state_value}")
        result = super().update_work_item_state(work_item_id, state_value)

        try:
            self.invalidate_work_items([work_item_id])
        except Exception:
            logger.exception(f"Failed to invalidate work item {work_item_id} after state update")

        return result
    
    def get_iterations(self, project: str, root_path: Optional[str] = None, depth: int = 10) -> List[dict]:
        """Fetch iterations with per-root-path caching.
        
        Args:
            project: Project name or ID
            root_path: Optional root iteration path to filter by
            depth: Depth to fetch classification nodes (default 10)
            
        Returns:
            List of cached or freshly-fetched iteration dicts sorted by startDate
        """
        if not self._connected:
            raise RuntimeError("AzureCachingClient is not connected.")
        
        key = self._key_for_iterations(project, root_path)
        cached = self._cache.read(key)
        
        if cached and isinstance(cached, list) and not self._cache.is_stale(key, ttl=CACHE_TTL):
            logger.debug(f"Using cached iterations for project={project}, root={root_path}")
            return cached
        
        # Fetch from Azure
        logger.info(f"Fetching iterations from Azure for project={project}, root={root_path}")
        iterations = super().get_iterations(project, root_path=root_path, depth=depth)
        
        # Cache the result
        self._cache.write(key, iterations)
        self._cache.update_timestamp(key)
        logger.debug(f"Cached {len(iterations)} iterations with key: {key}")
        
        return iterations
    
    def get_task_revision_history(
        self,
        work_item_id: int,
        start_field: str = "Microsoft.VSTS.Scheduling.StartDate",
        end_field: str = "Microsoft.VSTS.Scheduling.TargetDate",
        iteration_field: str = "System.IterationPath",
        force_refresh: bool = False
    ) -> List[dict]:
        """Fetch revision history for a work item with intelligent TTL-based caching.
        
        Uses TTL-based caching with revision-based change detection:
        1. If cache is fresh (within TTL), return immediately - no Azure calls
        2. If cache is stale, check revision (lightweight Azure call)
        3. If revision unchanged, update TTL and return cache
        4. If revision changed, fetch full history
        
        Args:
            work_item_id: Work item ID
            start_field: Field name for start date (project-specific)
            end_field: Field name for end/target date (project-specific)
            iteration_field: Field name for iteration path
            force_refresh: If True, bypass TTL and check revision
            
        Returns:
            List of normalized revision records
        """
        # Read cache with TTL check
        cached_history, cached_revision, is_fresh = self._read_history_cache(work_item_id)
        
        # Fast path: Fresh cache within TTL
        if is_fresh and cached_history is not None and not force_refresh:
            self._history_metrics["history_cache_hits"] += 1
            self._history_metrics["history_api_calls_saved"] += 2  # Saved both revision check and history fetch
            logger.debug(f"History cache fresh for {work_item_id} (TTL), no Azure call needed")
            return cached_history
        
        # Cache exists but stale (or force refresh) - check if revision changed
        if cached_history is not None and cached_revision is not None:
            # Check current revision (lightweight call)
            current_revision = self._get_current_revision(work_item_id)
            self._history_metrics["revision_checks_performed"] += 1
            
            if current_revision is None:
                # Work item deleted - invalidate cache
                logger.info(f"Work item {work_item_id} not found, clearing cache")
                key = self._key_for_revision_history(work_item_id)
                self._cache.delete(key)
                return []
            
            if current_revision == cached_revision:
                # Revision unchanged - update TTL and return cache
                self._history_metrics["history_cache_hits"] += 1
                self._history_metrics["history_api_calls_saved"] += 1
                logger.debug(f"History cache hit for {work_item_id} (rev {current_revision}), updating TTL")
                # Refresh TTL by rewriting cache with new timestamp
                self._write_history_cache(work_item_id, cached_history, current_revision)
                return cached_history
            
            logger.debug(f"History changed for {work_item_id}: {cached_revision} → {current_revision}")
            self._history_metrics["history_cache_misses"] += 1
        else:
            # No cached history, will need to fetch
            self._history_metrics["history_cache_misses"] += 1
        
        # Fetch fresh history
        result = self._work_item_ops.get_task_revision_history(
            work_item_id=work_item_id,
            start_field=start_field,
            end_field=end_field,
            iteration_field=iteration_field
        )
        
        # Get current revision for caching
        current_revision = self._get_current_revision(work_item_id)
        if current_revision:
            self._write_history_cache(work_item_id, result, current_revision)
            logger.debug(f"Cached {len(result)} revision records for work item {work_item_id} (rev {current_revision})")
        else:
            # Fallback to old caching if we can't get revision
            key = self._key_for_revision_history(work_item_id)
            self._cache.write(key, result)
            self._cache.update_timestamp(key)
            logger.debug(f"Cached {len(result)} revision records for work item {work_item_id} (no revision metadata)")
        
        return result
    
    def get_task_revision_history_batch(
        self,
        work_item_ids: List[int],
        start_field: str = "Microsoft.VSTS.Scheduling.StartDate",
        end_field: str = "Microsoft.VSTS.Scheduling.TargetDate",
        iteration_field: str = "System.IterationPath",
        force_refresh: bool = False
    ) -> dict[int, List[dict]]:
        """Fetch revision history for multiple work items with batch optimization.
        
        This method optimizes bulk fetching by:
        1. Returning fresh cached items immediately (within TTL)
        2. Batch checking revisions for stale items in one API call
        3. Only fetching full history for items with changed revisions
        
        Args:
            work_item_ids: List of work item IDs
            start_field: Field name for start date (project-specific)
            end_field: Field name for end/target date (project-specific)
            iteration_field: Field name for iteration path
            force_refresh: If True, bypass TTL and check revisions
            
        Returns:
            Dictionary mapping work item ID to list of revision records
        """
        result = {}
        items_to_check = []  # Items with stale cache that need revision check
        items_to_fetch = []  # Items that need full history fetch
        
        # Phase 1: Check cache and collect items needing revision check
        for work_item_id in work_item_ids:
            cached_history, cached_revision, is_fresh = self._read_history_cache(work_item_id)
            
            if is_fresh and cached_history is not None and not force_refresh:
                # Fresh cache - return immediately
                result[work_item_id] = cached_history
                self._history_metrics["history_cache_hits"] += 1
                self._history_metrics["history_api_calls_saved"] += 2
            elif cached_history is not None and cached_revision is not None:
                # Stale cache - need to check revision
                items_to_check.append((work_item_id, cached_history, cached_revision))
            else:
                # No cache - need full fetch
                items_to_fetch.append(work_item_id)
        
        logger.debug(f"Batch processing: {len(result)} fresh, {len(items_to_check)} to check, {len(items_to_fetch)} to fetch")
        
        # Phase 2: Batch check revisions for stale items
        if items_to_check:
            check_ids = [item[0] for item in items_to_check]
            current_revisions = self._get_current_revisions_batch(check_ids)
            self._history_metrics["revision_checks_performed"] += len(check_ids)
            
            for work_item_id, cached_history, cached_revision in items_to_check:
                current_revision = current_revisions.get(work_item_id)
                
                if current_revision is None:
                    # Work item deleted
                    logger.info(f"Work item {work_item_id} not found, clearing cache")
                    key = self._key_for_revision_history(work_item_id)
                    self._cache.delete(key)
                    result[work_item_id] = []
                elif current_revision == cached_revision:
                    # Revision unchanged - use cache and refresh TTL
                    result[work_item_id] = cached_history
                    self._history_metrics["history_cache_hits"] += 1
                    self._history_metrics["history_api_calls_saved"] += 1
                    # Refresh TTL
                    self._write_history_cache(work_item_id, cached_history, current_revision)
                else:
                    # Revision changed - need full fetch
                    logger.debug(f"History changed for {work_item_id}: {cached_revision} → {current_revision}")
                    items_to_fetch.append(work_item_id)
                    self._history_metrics["history_cache_misses"] += 1
        
        # Phase 3: Fetch full history for changed/missing items
        if items_to_fetch:
            logger.debug(f"Fetching full history for {len(items_to_fetch)} items")
            for work_item_id in items_to_fetch:
                history = self._work_item_ops.get_task_revision_history(
                    work_item_id=work_item_id,
                    start_field=start_field,
                    end_field=end_field,
                    iteration_field=iteration_field
                )
                result[work_item_id] = history
                
                # Cache the result
                current_revision = self._get_current_revision(work_item_id)
                if current_revision:
                    self._write_history_cache(work_item_id, history, current_revision)
        
        return result
    
    def invalidate_all_caches(self) -> dict:
        """Invalidate all cached data.
        
        This clears all work items, teams, plans, markers, and iterations
        from the cache, forcing a complete refresh on the next fetch.
        Also cleans up any orphaned index entries.
        
        Returns:
            Dictionary with count of cleared entries
        """
        logger.info("Invalidating all caches")
        
        # First clean up orphaned keys
        orphaned = self._cache.cleanup_orphaned_keys()
        if orphaned > 0:
            logger.info(f"Cleaned up {orphaned} orphaned keys before cache clear")
        
        # Then clear all caches
        count = self._cache.clear_all_caches()
        return {'ok': True, 'cleared': count, 'orphaned_cleaned': orphaned}
    
    def cleanup_orphaned_cache_keys(self) -> dict:
        """Clean up orphaned index entries without clearing cache data.
        
        This removes index entries for cache files that no longer exist,
        useful for cleaning up after area path changes.
        
        Returns:
            Dictionary with count of orphaned keys removed
        """
        logger.info("Cleaning up orphaned cache keys")
        count = self._cache.cleanup_orphaned_keys()
        return {'ok': True, 'orphaned_cleaned': count}

    def get_cache_stats(self) -> dict:
        """Get cache performance statistics.
        
        Returns dictionary with history cache metrics including hit rate,
        API calls saved, and revision checks performed.
        
        Returns:
            Dictionary with cache statistics
        """
        total_checks = (
            self._history_metrics["history_cache_hits"] + 
            self._history_metrics["history_cache_misses"]
        )
        hit_rate = (
            self._history_metrics["history_cache_hits"] / total_checks 
            if total_checks > 0 else 0
        )
        
        return {
            "history_cache_hit_rate": f"{hit_rate * 100:.1f}%",
            "api_calls_saved": self._history_metrics["history_api_calls_saved"],
            "history_cache_hits": self._history_metrics["history_cache_hits"],
            "history_cache_misses": self._history_metrics["history_cache_misses"],
            "revision_checks_performed": self._history_metrics["revision_checks_performed"],
            "total_history_requests": total_checks
        }

