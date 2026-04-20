"""AzureClient implementation with caching

This client adds TTL-based caching on top of the base AzureClient operations.
It uses the CacheManager to handle all cache storage, TTL checks, and invalidation.
"""
from __future__ import annotations
from typing import List, Optional, Any
import logging
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)

from planner_lib.azure.AzureClient import AzureClient
from planner_lib.azure.caching import (
    CacheManager, HistoryCacheManager, CACHE_TTL, HISTORY_CACHE_TTL, NAMESPACE,
    key_for_area, key_for_teams, key_for_plans, key_for_area_plan,
    key_for_plan_markers, key_for_iterations, key_for_revision_history,
)
from planner_lib.storage.base import StorageBackend


def _merge_ranked(task_ids: list, area_cache: dict, limited_wiql: bool) -> list:
    """Return items from *area_cache* ordered by *task_ids* (WIQL StackRank).

    When *limited_wiql* is True the WIQL only returned recently-changed items;
    cached items not present in the WIQL result are appended after the
    StackRank-ordered items so that the full set is always returned.
    """
    wiql_ordered = [area_cache[str(tid)] for tid in task_ids if str(tid) in area_cache]
    if not limited_wiql:
        return wiql_ordered
    wiql_ids_set = {str(tid) for tid in task_ids}
    remaining = [area_cache[cid] for cid in area_cache if cid not in wiql_ids_set]
    return wiql_ordered + remaining


class AzureCachingClient(AzureClient):
    """Azure client with TTL-based file caching per-area.

    This client wraps the base Azure operations with a caching layer that:
    - Caches work items per area with TTL
    - Caches teams and plans per project with TTL
    - Caches markers per plan with TTL
    - Tracks invalidated work items and refetches them
    - Periodically prunes old cache entries
    """

    def __init__(self, organization_url: str, storage: StorageBackend, memory_cache=None):
        """Initialize caching client with storage backend and optional memory cache.

        The client is instantiated without a PAT; use the `connect(pat)` 
        context-manager to obtain a connected client.
        
        Args:
            organization_url: Azure DevOps organization URL
            storage: Disk storage backend (DiskCache)
            memory_cache: Optional MemoryCacheManager for hot in-memory caching
        """
        logger.info("Using AzureCachingClient (deferred connect) with storage backend")
        super().__init__(organization_url, storage=storage)
        self._cache = CacheManager(storage, namespace=NAMESPACE)
        self._history_cache = HistoryCacheManager(self._cache)
        self._memory_cache = memory_cache

        # History cache metrics
        self._history_metrics = {
            "history_cache_hits": 0,
            "history_cache_misses": 0,
            "history_api_calls_saved": 0,
            "revision_checks_performed": 0
        }
    
    @property
    def _has_memory_cache(self) -> bool:
        """Check if memory cache is available."""
        return self._memory_cache is not None
    
    def _read_memory_cache(self, key: str) -> tuple[Optional[Any], bool]:
        """Read from memory cache with staleness check.
        
        Returns:
            Tuple of (data, is_fresh) where is_fresh indicates if data is not stale
        """
        if not self._has_memory_cache:
            return None, False
        
        data = self._memory_cache.read(NAMESPACE, key)
        if data is None:
            return None, False
        
        # Check if stale
        metadata = self._memory_cache.get_metadata(NAMESPACE, key)
        is_fresh = metadata and not metadata.needs_refresh if metadata else True
        
        return data, is_fresh
    
    def _write_memory_cache(self, key: str, data: Any) -> None:
        """Write to memory cache."""
        if not self._has_memory_cache:
            return
        
        self._memory_cache.write(NAMESPACE, key, data)
    
    def _mark_stale(self, key: str) -> None:
        """Mark a cache key as stale in memory cache."""
        if not self._has_memory_cache:
            return
        
        self._memory_cache.mark_stale(NAMESPACE, key)

    # Cache key helpers are module-level functions in caching.py; call them directly.

    def _write_history_cache(self, work_item_id: int, history: List[dict], revision: int, timestamp=None) -> None:
        """Delegate to HistoryCacheManager."""
        self._history_cache.write(work_item_id, history, revision, timestamp=timestamp)

    def _read_history_cache(self, work_item_id: int, ttl: timedelta = HISTORY_CACHE_TTL):
        """Delegate to HistoryCacheManager."""
        return self._history_cache.read(work_item_id, ttl=ttl)

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
        - Three-tier caching: Memory (hot) → Disk (persistent) → Azure API
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
        
        # Use defaults if not provided
        if task_types is None:
            task_types = ['epic', 'feature']
        if include_states is None:
            include_states = []
        
        # Use _key_for_area for cache key (consistent with other cache keys)
        area_key = key_for_area(area_path)
        
        # FAST PATH: Check memory cache first (hot path, <1ms)
        if self._has_memory_cache:
            mem_data, is_fresh = self._read_memory_cache(area_key)
            if mem_data is not None and is_fresh:
                logger.debug(f"Memory cache HIT (fresh) for area '{area_key}' - returning {len(mem_data)} items")
                return mem_data
            elif mem_data is not None:
                logger.debug(f"Memory cache HIT (stale) for area '{area_key}' - will refresh")
        
        # Memory cache miss or stale - continue to disk/Azure refresh
        if not self._connected:
            raise RuntimeError("AzureCachingClient is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        
        assert self.conn is not None
        wit_client = self.conn.clients.get_work_item_tracking_client()
        
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

        logger.debug(f"Cache miss for area '{area_key}' - running WIQL (force_refresh={force_full_refresh}, invalidated={len(invalidated_in_area)})")

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
        
        # If nothing changed and no deletes, return cached data.
        if not items_to_fetch and not deleted_ids and not force_full_refresh:
            logger.debug(f"No changes detected for area '{area_key}' - using cache")
            result = _merge_ranked(task_ids, area_cache, limited_wiql)
            # Update memory cache if it was stale
            if self._has_memory_cache:
                self._write_memory_cache(area_key, result)
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
                            "type": item.fields.get("System.WorkItemType") or "",
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
        
        # Update memory cache (write-through)
        result = _merge_ranked(task_ids, area_cache, limited_wiql)
        if self._has_memory_cache:
            self._write_memory_cache(area_key, result)
            logger.debug(f"Updated memory cache for area '{area_key}' with {len(result)} items")

        return result

    def get_all_teams(self, project: str) -> List[dict]:
        """Fetch teams with memory and disk caching."""
        key = key_for_teams(project)
        
        # Check memory cache first
        if self._has_memory_cache:
            mem_data, is_fresh = self._read_memory_cache(key)
            if mem_data is not None and is_fresh:
                logger.debug(f"Memory cache HIT (fresh) for teams '{key}'")
                return mem_data
        
        if not self._connected:
            raise RuntimeError("AzureCachingClient is not connected.")
        
        # Check disk cache
        cached = self._cache.read(key)
        
        if cached and not self._cache.is_stale(key, ttl=CACHE_TTL):
            # Update memory cache
            if self._has_memory_cache:
                self._write_memory_cache(key, cached)
            return cached
        
        # Fetch from Azure
        teams = super().get_all_teams(project)
        
        # Write to disk cache
        self._cache.write(key, teams)
        self._cache.update_timestamp(key)
        
        # Write to memory cache
        if self._has_memory_cache:
            self._write_memory_cache(key, teams)
        
        return teams

    def get_all_plans(self, project: str) -> List[dict]:
        """Fetch plans with memory and disk caching."""
        key = key_for_plans(project)
        
        # Check memory cache first
        if self._has_memory_cache:
            mem_data, is_fresh = self._read_memory_cache(key)
            if mem_data is not None and is_fresh:
                logger.debug(f"Memory cache HIT (fresh) for plans '{key}'")
                return mem_data
        
        if not self._connected:
            raise RuntimeError("AzureCachingClient is not connected.")
        
        # Check disk cache
        cached = self._cache.read(key)
        
        if cached and not self._cache.is_stale(key, ttl=CACHE_TTL):
            # Update memory cache
            if self._has_memory_cache:
                self._write_memory_cache(key, cached)
            return cached
        
        # Fetch from Azure
        plans = super().get_all_plans(project)
        
        # Write to disk cache
        self._cache.write(key, plans)
        self._cache.update_timestamp(key)
        
        # Write to memory cache
        if self._has_memory_cache:
            self._write_memory_cache(key, plans)
        
        return plans

    def get_markers_for_plan(self, project: str, plan_id: str) -> List[dict]:
        """Fetch markers for a plan with memory and disk caching."""
        key = key_for_plan_markers(project, plan_id)
        
        # Check memory cache first
        if self._has_memory_cache:
            mem_data, is_fresh = self._read_memory_cache(key)
            # Memory cache stores the markers list directly (unwrapped)
            if mem_data is not None and is_fresh:
                logger.debug(f"Memory cache HIT (fresh) for plan markers '{key}'")
                return mem_data
        
        if not self._connected:
            raise RuntimeError("AzureCachingClient is not connected.")
        
        # Check disk cache
        cached = self._cache.read(key)
        
        if cached and isinstance(cached, dict) and 'markers' in cached:
            if not self._cache.is_stale(key, ttl=CACHE_TTL):
                logger.debug(f"Using cached markers for plan {plan_id} (key: {key})")
                markers = cached['markers']
                # Update memory cache with unwrapped list
                if self._has_memory_cache:
                    self._write_memory_cache(key, markers)
                return markers
        
        # Fetch from Azure
        logger.info(f"Fetching markers from Azure for plan {plan_id} in project {project}")
        markers = super().get_markers_for_plan(project, plan_id)
        
        # Write to disk cache (wrapped)
        payload = {'markers': markers, 'last_update': datetime.now(timezone.utc).isoformat()}
        self._cache.write(key, payload)
        self._cache.update_timestamp(key)
        
        # Write to memory cache (unwrapped list)
        if self._has_memory_cache:
            self._write_memory_cache(key, markers)
        
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
        map_key = key_for_area_plan(area_path)
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
        Also marks affected areas as stale in memory cache.
        """
        if not work_item_ids:
            return
        
        logger.debug(f"Invalidating {len(work_item_ids)} work items")
        
        # Try to map IDs to areas by scanning existing caches
        unmapped = set(work_item_ids)
        invalidated_keys = set()
        
        # Read index to get area keys
        try:
            for area_key in list(self._cache.list_area_keys()):
                # Check if any work items belong to this area
                area_list = self._cache.read(area_key) or []
                area_ids = {int(it.get('id')) for it in area_list if it.get('id')}
                
                matched = unmapped & area_ids
                if matched:
                    self._cache.mark_invalidated(area_key, list(matched))
                    invalidated_keys.add(area_key)
                    unmapped -= matched
                
                if not unmapped:
                    break
        except Exception as e:
            logger.warning(f"Error mapping work items to areas: {e}")
        
        # Store any unmapped IDs under special key
        if unmapped:
            self._cache.mark_invalidated('_unmapped', list(unmapped))
        
        # Mark affected areas as stale in memory cache
        if self._has_memory_cache:
            for area_key in invalidated_keys:
                self._mark_stale(area_key)
                logger.debug(f"Marked memory cache key '{area_key}' as stale")

    def invalidate_plans(self, project: str, plan_ids: Optional[List[str]] = None):
        """Invalidate cached plans and markers.
        
        If plan_ids is None, invalidates all plans for the project.
        Otherwise, only invalidates the specified plans.
        Also marks affected keys as stale in memory cache.
        """
        logger.debug(f"Invalidating plans for project {project}: {plan_ids}")
        
        invalidated_keys = set()
        
        # Invalidate plans list cache
        if plan_ids is None:
            plans_key = key_for_plans(project)
            self._cache.delete(plans_key)
            self._cache.invalidate([plans_key])
            invalidated_keys.add(plans_key)
        
        # Invalidate per-plan markers
        pids_to_invalidate = plan_ids if plan_ids else []
        
        if not pids_to_invalidate and plan_ids is None:
            # Need to get plan IDs from cache
            plans_key = key_for_plans(project)
            cached_plans = self._cache.read(plans_key) or []
            pids_to_invalidate = [p.get('id') for p in cached_plans if p.get('id')]
        
        for pid in pids_to_invalidate:
            key = key_for_plan_markers(project, str(pid))
            self._cache.delete(key)
            self._cache.invalidate([key])
            invalidated_keys.add(key)
        
        # Clean up area->plan mappings that reference invalidated plans
        try:
            for area_key in list(self._cache.list_area_keys()):
                map_key = key_for_area_plan(area_key)
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
                    invalidated_keys.add(map_key)
                else:
                    # Remove specific plans from mapping
                    new_plans = [p for p in plans if p not in plan_ids]
                    if len(new_plans) != len(plans):
                        mapping['plans'] = new_plans
                        mapping['last_update'] = datetime.now(timezone.utc).isoformat()
                        self._cache.write(map_key, mapping)
                        self._cache.update_timestamp(map_key)
                        # Mark as stale so it refreshes from disk next time
                        invalidated_keys.add(map_key)
        except Exception as e:
            logger.exception(f"Error cleaning area->plan mappings: {e}")
        
        # Mark affected keys as stale in memory cache
        if self._has_memory_cache:
            for key in invalidated_keys:
                self._mark_stale(key)
                logger.debug(f"Marked memory cache key '{key}' as stale")

    def update_work_item_dates(self, work_item_id: int, **kwargs):
        """Update work item dates and invalidate cache."""
        logger.debug(f"Updating work item {work_item_id}: {kwargs}")
        result = super().update_work_item_dates(work_item_id, **kwargs)
        try:
            self.invalidate_work_items([work_item_id])
        except Exception:
            logger.exception(f"Failed to invalidate work item {work_item_id} after update")
        return result

    def update_work_item_iteration_path(self, work_item_id: int, iteration_path):
        """Update work item iteration path and invalidate cache."""
        logger.debug(f"Updating work item {work_item_id} iteration path: {iteration_path}")
        result = super().update_work_item_iteration_path(work_item_id, iteration_path)
        try:
            self.invalidate_work_items([work_item_id])
        except Exception:
            logger.exception(f"Failed to invalidate work item {work_item_id} after iteration path update")
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
        """Fetch iterations with memory and disk caching per root path.
        
        Args:
            project: Project name or ID
            root_path: Optional root iteration path to filter by
            depth: Depth to fetch classification nodes (default 10)
            
        Returns:
            List of cached or freshly-fetched iteration dicts sorted by startDate
        """
        key = key_for_iterations(project, root_path)
        
        # Check memory cache first
        if self._has_memory_cache:
            mem_data, is_fresh = self._read_memory_cache(key)
            if mem_data is not None and is_fresh:
                logger.debug(f"Memory cache HIT (fresh) for iterations '{key}'")
                return mem_data
        
        if not self._connected:
            raise RuntimeError("AzureCachingClient is not connected.")
        
        # Check disk cache
        cached = self._cache.read(key)
        
        if cached and isinstance(cached, list) and not self._cache.is_stale(key, ttl=CACHE_TTL):
            logger.debug(f"Using cached iterations for project={project}, root={root_path}")
            # Update memory cache
            if self._has_memory_cache:
                self._write_memory_cache(key, cached)
            return cached
        
        # Fetch from Azure
        logger.info(f"Fetching iterations from Azure for project={project}, root={root_path}")
        iterations = super().get_iterations(project, root_path=root_path, depth=depth)
        
        # Write to disk cache
        self._cache.write(key, iterations)
        self._cache.update_timestamp(key)
        
        # Write to memory cache
        if self._has_memory_cache:
            self._write_memory_cache(key, iterations)
        
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
                key = key_for_revision_history(work_item_id)
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
            key = key_for_revision_history(work_item_id)
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
                    key = key_for_revision_history(work_item_id)
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
    
    def invalidate_history_cache(self) -> int:
        """Delete all cached revision-history entries (keys starting with 'history_').

        Returns:
            Number of cache entries deleted.
        """
        history_keys = [k for k in self._cache.list_all_index_keys() if k.startswith('history_')]
        logger.info(f"Found {len(history_keys)} history cache entries to invalidate")
        invalidated = 0
        for key in history_keys:
            try:
                self._cache.delete(key)
                invalidated += 1
            except Exception as e:
                logger.warning(f"Failed to delete cache key {key}: {e}")
        logger.info(f"Invalidated {invalidated} history cache entries")
        return invalidated

    def invalidate_all_caches(self) -> dict:
        """Invalidate all cached data.

        This clears all work items, teams, plans, markers, and iterations
        from the cache, forcing a complete refresh on the next fetch.
        Also cleans up any orphaned index entries.
        Clears both disk and memory caches.

        Returns:
            Dictionary with count of cleared entries
        """
        logger.info("Invalidating all caches")
        
        # First clean up orphaned keys
        orphaned = self._cache.cleanup_orphaned_keys()
        if orphaned > 0:
            logger.info(f"Cleaned up {orphaned} orphaned keys before cache clear")
        
        # Clear disk caches
        count = self._cache.clear_all_caches()
        
        # Clear memory cache
        memory_cleared = 0
        if self._has_memory_cache:
            memory_cleared = self._memory_cache.clear(NAMESPACE)
            logger.info(f"Cleared {memory_cleared} items from memory cache")
        
        return {
            'ok': True,
            'cleared': count,
            'memory_cleared': memory_cleared,
            'orphaned_cleaned': orphaned
        }
    
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

