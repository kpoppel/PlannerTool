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
from planner_lib.azure.caching import CacheManager, CACHE_TTL, NAMESPACE
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

    def get_projects(self) -> List[str]:
        """Fetch projects (not cached)."""
        return super().get_projects()

    def get_work_items(self, area_path: str) -> List[dict]:
        """Fetch work items with caching and invalidation support.
        
        This implements:
        - TTL-based cache refresh (30 min default)
        - Per-area invalidation tracking
        - Incremental updates using ModifiedDate filter
        - Cache hit optimization when no changes detected
        """
        logger.debug(f"Fetching work items for area path: {area_path}")
        
        if not self._connected:
            raise RuntimeError("AzureCachingClient is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        
        assert self.conn is not None
        wit_client = self.conn.clients.get_work_item_tracking_client()
        area_key = self._sanitize_area_path(area_path)

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

        # Cache hit: skip WIQL if cache is fresh and no invalidations
        if not force_full_refresh and not invalidated_in_area and last_update:
            logger.debug(f"Cache hit for area '{area_key}' ({len(area_cache)} items) - skipping WIQL")
            return list(area_cache.values())
        
        logger.debug(f"Cache miss for area '{area_key}' - running WIQL (force_refresh={force_full_refresh}, invalidated={len(invalidated_in_area)})")

        # Build WIQL query with optional ModifiedDate filter
        modified_where = f"AND [System.ChangedDate] > '{last_update}'" if last_update and not force_full_refresh else ''
        
        wiql_area = area_key
        wiql_area_escaped = wiql_area.replace("'", "''").replace('\\', '\\\\')

        wiql_query = f"""
        SELECT [System.Id]
        FROM WorkItems
        WHERE [System.WorkItemType] IN ('Epic','Feature')
        AND [System.AreaPath] = '{wiql_area_escaped}'
        {modified_where}
        AND [System.State] NOT IN ('Closed', 'Removed')
        ORDER BY [Microsoft.VSTS.Common.StackRank] ASC
        """

        from azure.devops.v7_1.work_item_tracking.models import Wiql
        wiql_obj = Wiql(query=wiql_query)
        
        try:
            result = wit_client.query_by_wiql(wiql=wiql_obj)
        except Exception as e:
            logger.warning(f"WIQL query for area '{area_path}' failed: {e}")
            return []
        
        candidate_ws = getattr(result, 'work_items', []) or []
        # Extract IDs safely with type filtering
        task_ids = []
        for wi in candidate_ws:
            wid = getattr(wi, 'id', None)
            if wid is not None:
                task_ids.append(int(wid))
        
        # Add invalidated items to fetch list
        if invalidated_in_area:
            task_ids = list(set(task_ids) | invalidated_in_area)
            logger.debug(f"Added {len(invalidated_in_area)} invalidated work items to fetch list")
        
        logger.debug(f"WIQL returned {len(candidate_ws)} candidates, total to fetch: {len(task_ids)}")

        # Fetch work items in batches
        updated_items = []
        if task_ids:
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

        # Update cache with fetched items
        changed = False
        updated_count = 0
        for wi in updated_items:
            if wi['id'] not in area_cache or area_cache[wi['id']] != wi:
                area_cache[wi['id']] = wi
                changed = True
                updated_count += 1

        logger.debug(f"Area '{area_key}': cached={cached_count}, fetched={len(updated_items)}, updated={updated_count}")

        # Write cache and update timestamps
        self._cache.write(area_key, list(area_cache.values()))
        self._cache.update_timestamp(area_key)
        
        # Clear invalidated items that were successfully fetched
        if invalidated_in_area:
            self._cache.clear_invalidated(area_key, invalidated_in_area)
        
        # Periodic pruning
        self._cache.prune_old_entries(keep_count=50)

        return list(area_cache.values())

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

