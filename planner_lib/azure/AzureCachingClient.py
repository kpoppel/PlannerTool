"""AzureClient implementation with caching

Changelog / Cache semantics (short summary):

- TTL and refresh
    - Each area cache entry in the on-disk index stores `last_update` as a
        full ISO8601 UTC timestamp. This is used to determine staleness.
    - On read, if the last_update for an area is older than 30 minutes the
        client will force a full refresh (omit the `ModifiedDate` filter) to
        avoid missing updates. Otherwise a date-only `ModifiedDate` is used
        when constructing WIQL (Azure rejects time components for date-precise
        WIQL queries), which significantly reduces returned candidate ids.

- Per-area invalidation
    - Writes to work items mark affected work items as invalidated in the
        index under the `_invalidated` key. The implementation prefers a
        per-area mapping (`{ area_key: [ids] }`) when it can map work item ids
        to areas; if mapping is not possible it falls back to a legacy global
        list of invalidated ids. This allows selective refetching only for the
        changed items instead of forcing a full area refetch.
    - When `get_work_items` runs, invalidated ids that belong to that area
        are added to the fetch list so they will be refetched even if WIQL
        returned no recent ids. Successfully fetched invalidated ids are
        removed from the index; if nothing was fetched for an area the
        per-area invalidation entry may remain (conservative behavior).

- Inline updates on writes
    - After a successful write (update description or dates), the client
        attempts an inline update of the matching item in the area's cache
        (if the area can be discovered). This avoids an immediate refetch in
        many cases and keeps the cache reasonably fresh for reads.
    - The client still marks the work item as invalidated after the inline
        update to ensure a subsequent read will revalidate against Azure (this
        is a conservative choice to avoid subtle stale-state races).

- Behavior tradeoffs
    - The implementation favors correctness over absolute minimal network
        calls: inline updates reduce unnecessary refetches, while forced
        invalidation guarantees eventual alignment with Azure's authoritative
        state. If you need stricter performance, consider removing the forced
        invalidation step or making the TTL shorter/longer depending on your
        environment.

"""
from __future__ import annotations
from typing import List, Optional
import logging
import threading
from datetime import datetime, timezone, timedelta
from planner_lib.storage.interfaces import StorageProtocol

logger = logging.getLogger(__name__)

from planner_lib.azure.AzureClient import AzureClient
NAMESPACE = 'azure_workitems'
# Cache TTL for markers and area->plan mappings. Keep in sync with area cache policy.
# Tweak this constant to change staleness window for markers mapping cache.
CACHE_TTL = timedelta(minutes=30)

class AzureCachingClient(AzureClient):
    """Azure client with simple file-based caching per-area.

    Cache layout (under `data/azure_workitems` by default):
    - _index.pkl : dict mapping area_path -> {'last_update': ISO date str}
    - <sanitized_area>.pkl : list of work item dicts for that area
    """

    def __init__(self, organization_url: str, storage: StorageProtocol):
        """Initialize caching client with an explicit `StorageProtocol`.

        The client is instantiated without a PAT; callers should use the
        `connection(pat)` context-manager or otherwise ensure a PAT is set
        before invoking SDK-backed methods.
        """
        logger.info("Using AzureCachingClient (deferred connect) with storage backend")
        super().__init__(organization_url, storage=storage)
        self._storage: StorageProtocol = storage
        self._lock = threading.Lock()
        self._fetch_count = 0


    def get_projects(self) -> List[str]:
        # inherited from AzureClient
        return super().get_projects()

    def _key_for_area(self, area_path: str) -> str:
        # keep compatibility with legacy on-disk naming: return sanitized name
        safe = area_path.replace('\\', '__').replace('/', '__').replace(' ', '_')
        safe = ''.join(c for c in safe if c.isalnum() or c in ('_', '-'))
        return safe

    def _key_for_teams(self, project: str) -> str:
        safe = project.replace(' ', '_').replace('/', '__').replace('\\', '__')
        return f"teams_{safe}"

    def _key_for_plans(self, project: str) -> str:
        safe = project.replace(' ', '_').replace('/', '__').replace('\\', '__')
        return f"plans_{safe}"

    def _key_for_area_plan(self, area_path: str) -> str:
        safe = self._key_for_area(area_path)
        return f"area_plan_{safe}"

    def _key_for_plan_markers(self, project: str, plan_id: str) -> str:
        safe_proj = project.replace(' ', '_').replace('/', '__').replace('\\', '__')
        safe_plan = str(plan_id).replace(' ', '_')
        return f"plan_markers_{safe_proj}_{safe_plan}"

    # Backwards-compat filesystem helpers removed: storage-backed access only.

    def _read_index(self) -> dict:
        try:
            return self._storage.load(NAMESPACE, '_index') or {}
        except KeyError:
            return {}
        except Exception:
            return {}

    def _write_index(self, idx: dict):
        try:
            self._storage.save(NAMESPACE, '_index', idx)
        except Exception:
            logger.exception("Failed to write index via storage backend")

    def _read_area_cache(self, area_path: str) -> list:
        key = self._key_for_area(area_path)
        try:
            return self._storage.load(NAMESPACE, key) or []
        except KeyError:
            return []
        except Exception:
            return []

    def _write_area_cache(self, area_path: str, items: list):
        key = self._key_for_area(area_path)
        try:
            self._storage.save(NAMESPACE, key, items)
        except Exception:
            logger.exception("Failed to write area cache via storage backend")

    def _prune_if_needed(self, index: dict):
        self._fetch_count += 1
        if self._fetch_count % 100 != 0:
            return []
        # keep 50 most recently updated
        entries = [(k, v.get('last_update')) for k, v in index.items()]
        entries.sort(key=lambda kv: kv[1] or '')
        keep = set(k for k, _ in entries[-50:])
        removed = []
        for k in list(index.keys()):
            if k not in keep:
                try:
                    key = self._key_for_area(k)
                    if self._storage.exists(NAMESPACE, key):
                        self._storage.delete(NAMESPACE, key)
                except Exception:
                    pass
                removed.append(k)
                index.pop(k, None)
        return removed

    def get_work_items(self, area_path) -> List[dict]:
        logger.debug("Fetching work items for area path: %s", area_path)
        if not self._connected:
            raise RuntimeError("AzureCachingClient is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        assert self.conn is not None
        wit_client = self.conn.clients.get_work_item_tracking_client()
        area_key = self._sanitize_area_path(area_path)

        # single read of index and area cache
        with self._lock:
            index = self._read_index()
            area_cache_list = self._read_area_cache(area_key)
        area_cache = {it.get('id'): it for it in (area_cache_list or [])}
        cached_count = len(area_cache)
        logger.debug("Area '%s' cache loaded: %d items", area_key, cached_count)
        # TTL/age info will be logged after we compute `force_full_refresh`.

        # Get list of invalidated work items that need explicit refetch.
        # Support both legacy global list and new per-area mapping in the index.
        raw_invalid = index.get('_invalidated', [])
        invalidated_ids = set()
        if isinstance(raw_invalid, dict):
            # per-area mapping: area_key -> [ids]
            # include both global list for backward compat and area-specific
            for k, v in raw_invalid.items():
                if isinstance(v, list):
                    try:
                        invalidated_ids.update(int(i) for i in v if i is not None)
                    except Exception:
                        pass
        elif isinstance(raw_invalid, list):
            try:
                invalidated_ids.update(int(i) for i in raw_invalid if i is not None)
            except Exception:
                pass

        # Determine whether to use the ModifiedDate filter. If the area's
        # last_update timestamp is older than 30 minutes, force a full
        # refresh by omitting the ModifiedDate clause.
        last_update = None
        force_full_refresh = False
            # Read stored last_update and convert to date-only string for WIQL.
            # Azure WIQL rejects timestamps with time components when the field
            # uses date precision, so we ensure only 'YYYY-MM-DD' is used.
        try:
            if index.get(area_key) and index[area_key].get('last_update'):
                last_update = index[area_key]['last_update']
                try:
                    lu_dt = datetime.fromisoformat(last_update)
                    if lu_dt.tzinfo is None:
                        lu_dt = lu_dt.replace(tzinfo=timezone.utc)
                except Exception:
                    lu_dt = None

                if lu_dt is None:
                    last_update = None
                else:
                    now = datetime.now(timezone.utc)
                    if now - lu_dt > timedelta(minutes=30):
                        force_full_refresh = True
                    else:
                        # Use date-only precision for WIQL queries (Azure rejects time components)
                        last_update = lu_dt.date().isoformat()
        except Exception:
            last_update = None

        # Log TTL/age info for observability (now that force_full_refresh is set)
        try:
            lu = index.get(area_key, {}).get('last_update') if index else None
            logger.debug("Cache TTL for area '%s': last_update=%s, force_refresh=%s", area_key, lu, force_full_refresh)
        except Exception:
            pass

        if last_update and not force_full_refresh:
            modified_where = f"AND [System.ChangedDate] > '{last_update}'"
        else:
            modified_where = ''

        # If the cache is fresh (not forced to refresh) and there are no
        # invalidated items for this area, skip the WIQL query entirely and
        # return the cached items (cache hit).
        # Determine cached ids and area-specific invalidation.
        cached_ids_in_area = {int(cid) for cid in area_cache.keys() if cid}
        invalidated_in_area = set()
        raw_invalid = index.get('_invalidated', [])
        if isinstance(raw_invalid, dict):
            # area-specific mapping
            invalidated_in_area = set(int(i) for i in raw_invalid.get(area_key, []) if i is not None)
        else:
            try:
                invalidated_in_area = set(int(i) for i in (raw_invalid or []) if i is not None) & cached_ids_in_area
            except Exception:
                invalidated_in_area = set()

        if not force_full_refresh and not invalidated_in_area and last_update:
            logger.debug("Cache hit for area '%s' (%d items) - skipping WIQL", area_key, len(area_cache))
            return list(area_cache.values())
        else:
            logger.debug("Cache miss for area '%s' - running WIQL (force_refresh=%s, invalidated_in_area=%s)", area_key, force_full_refresh, bool(invalidated_in_area))

        # Use the sanitized area key for WIQL and escape characters that would
        # break the WIQL string literal. Azure WIQL expects backslashes in
        # area paths; represent them as double-backslashes in the query and
        # escape any single quotes by doubling them.
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
            logger.warning("WIQL query for area '%s' failed: %s", area_path, e)
            return []
        candidate_ws = getattr(result, 'work_items', []) or []
        task_ids = [getattr(wi, 'id', None) for wi in candidate_ws]
        task_ids = [int(t) for t in task_ids if t is not None]
        
        # Add any invalidated items that are in this area's cache to the fetch list
        # This ensures we refetch items we just updated, even if their ChangedDate hasn't caught up
        cached_ids_in_area = {int(cid) for cid in area_cache.keys() if cid}
        invalidated_in_area = invalidated_ids & cached_ids_in_area
        if invalidated_in_area:
            task_ids = list(set(task_ids) | invalidated_in_area)
            logger.debug("Added %d invalidated work items to fetch list for area '%s'", 
                        len(invalidated_in_area), area_key)
        
        logger.debug("WIQL returned %d candidate ids for area '%s' (since=%s), total to fetch: %d", 
                len(candidate_ws), area_key, last_update, len(task_ids))

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
                        logger.exception("Error processing item %s: %s", getattr(item, 'id', '?'), e)

        logger.debug("Fetched %d updated work items for area '%s'", len(updated_items), area_key)

        changed = False
        new_count = 0
        updated_count = 0
        for wi in updated_items:
            new_count += 1
            if wi['id'] not in area_cache:
                updated_count += 1
                area_cache[wi['id']] = wi
                changed = True
            else:
                # check for differences
                if area_cache[wi['id']] != wi:
                    updated_count += 1
                    area_cache[wi['id']] = wi
                    changed = True

        logger.debug("Area '%s': cache_items=%d, wiql_ids=%d, fetched=%d, updated=%d", area_key, cached_count, len(task_ids), new_count, updated_count)

        # Use full ISO8601 timestamp in UTC for precision and refresh checks
        new_last = datetime.now(timezone.utc).isoformat()

        # write index and area cache once
        with self._lock:
            index = self._read_index()
            index.setdefault(area_key, {})
            index[area_key]['last_update'] = new_last

            # Clear successfully fetched invalidated items from the index.
            # Support both legacy list and new per-area mapping formats.
            raw_invalid = index.get('_invalidated', [])
            if isinstance(raw_invalid, dict):
                # per-area mapping: remove those ids from this area's list
                area_list = set(raw_invalid.get(area_key, []))
                area_list -= invalidated_in_area
                # Always keep the per-area key present; store empty list when
                # there are no invalidated ids for the area. This keeps the
                # index consistently a dict of area -> list shapes.
                raw_invalid[area_key] = list(area_list)
                index['_invalidated'] = raw_invalid
            else:
                # legacy global list
                current_invalidated = set(raw_invalid or [])
                current_invalidated -= invalidated_in_area
                index['_invalidated'] = list(current_invalidated)
            if invalidated_in_area:
                logger.debug("Cleared %d invalidated items from index after successful fetch", 
                           len(invalidated_in_area))
            
            try:
                self._write_area_cache(area_key, list(area_cache.values()))
            except Exception:
                logger.exception("Failed to write area cache for %s", area_key)
            try:
                removed = self._prune_if_needed(index)
                if removed:
                    logger.debug("Pruned %d caches", len(removed))
            except Exception:
                logger.exception("Prune failed")
            try:
                self._write_index(index)
            except Exception:
                logger.exception("Failed to write index")

        return list(area_cache.values())

    def get_all_teams(self, project: str) -> List[dict]:
        """Return teams from storage cache or from Azure and persist to storage."""
        if not self._connected:
            raise RuntimeError("AzureCachingClient is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        assert self.conn is not None
        key = self._key_for_teams(project)
        try:
            cached = self._storage.load(NAMESPACE, key) or []
        except Exception:
            cached = []
        if cached:
            return cached

        core_client = self.conn.clients.get_core_client()
        try:
            teams = core_client.get_teams(project_id=project)
            items = getattr(teams, 'value', teams) or []
            out = []
            for t in items:
                try:
                    out.append({'id': str(t.id), 'name': t.name})
                except Exception:
                    continue
            try:
                self._storage.save(NAMESPACE, key, out)
            except Exception:
                logger.exception("Failed to persist teams cache for project %s", project)
            return out
        except Exception:
            return []

    def get_all_plans(self, project: str) -> List[dict]:
        """Return plans from storage cache or fetch from Azure and persist."""
        if not self._connected:
            raise RuntimeError("AzureCachingClient is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        assert self.conn is not None
        key = self._key_for_plans(project)
        try:
            cached = self._storage.load(NAMESPACE, key) or []
        except Exception:
            cached = []
        if cached:
            return cached

        work_client = self.conn.clients.get_work_client()
        try:
            plans = work_client.get_plans(project=project)
            items = getattr(plans, 'value', plans) or []
            out = []
            for p in items:
                try:
                    out.append({'id': str(p.id), 'name': p.name})
                except Exception:
                    continue
            try:
                self._storage.save(NAMESPACE, key, out)
            except Exception:
                logger.exception("Failed to persist plans cache for project %s", project)
            return out
        except Exception:
            return []

    def get_team_from_area_path(self, project: str, area_path: str) -> List[str]:
        """Determine team ids owning the supplied area path.

        Uses the cached team list (or fetches it) and then queries
        `get_team_field_values` for each team to determine ownership.
        """
        if not self._connected:
            raise RuntimeError("AzureCachingClient is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        assert self.conn is not None
        work_client = self.conn.clients.get_work_client()
        teams = self.get_all_teams(project)
        if not teams:
            return []

        try:
            from azure.devops.v7_1.work.models import TeamContext
        except Exception:
            TeamContext = None

        team_ids: list = []
        for t in teams:
            tid = t.get('id')
            tname = t.get('name')
            try:
                if TeamContext is not None:
                    tc = TeamContext(project=project, team=tname)
                    fv = work_client.get_team_field_values(team_context=tc)
                else:
                    fv = work_client.get_team_field_values(project=project, team=tname)
            except Exception:
                continue
            values = getattr(fv, 'values', None) or []
            for entry in values:
                try:
                    val = getattr(entry, 'value', None) if not isinstance(entry, dict) else entry.get('value')
                    include_children = getattr(entry, 'includeChildren', None) if not isinstance(entry, dict) else entry.get('include_children')
                    if include_children is None:
                        include_children = getattr(entry, 'include_children', None) if not isinstance(entry, dict) else entry.get('includeChildren')
                    if not val:
                        continue
                    targ = area_path.rstrip('\\/')
                    candidate = str(val).rstrip('\\/')
                    is_match = candidate == targ
                    is_parent = bool(include_children) and targ.startswith(candidate + '\\')
                    if is_match or is_parent:
                        team_ids.append(str(tid))
                        break
                except Exception:
                    continue
        return team_ids

    def get_markers_for_plan(self, project: str, plan_id: str) -> List[dict]:
        """Return markers for a single plan using storage-backed cache.

        Cached entries are stored under a plan-specific key and include a
        `last_update` timestamp. If the cached value is stale or missing,
        fetch from Azure and persist.
        """
        if not self._connected:
            raise RuntimeError("AzureCachingClient is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        assert self.conn is not None
        key = self._key_for_plan_markers(project, plan_id)
        try:
            cached = self._storage.load(NAMESPACE, key)
        except Exception:
            cached = None
        if cached and isinstance(cached, dict) and 'markers' in cached and 'last_update' in cached:
            try:
                lu = datetime.fromisoformat(cached['last_update'])
                if lu.tzinfo is None:
                    lu = lu.replace(tzinfo=timezone.utc)
                if datetime.now(timezone.utc) - lu <= CACHE_TTL:
                    return cached.get('markers') or []
            except Exception:
                pass

        # Not cached or stale: fetch from Azure
        markers = super().get_markers_for_plan(project, plan_id) if hasattr(super(), 'get_markers_for_plan') else []
        # persist
        try:
            payload = {'markers': markers, 'last_update': datetime.now(timezone.utc).isoformat()}
            self._storage.save(NAMESPACE, key, payload)
        except Exception:
            logger.exception("Failed to persist markers for plan %s/%s", project, plan_id)
        return markers

    def get_markers(self, area_path: str) -> List[dict]:
        """Return markers for the configured `area_path`, using storage cache for
        area->plan mappings and per-plan markers. Falls back to computing the
        mapping via the base implementation when no fresh mapping exists.
        """
        if not self._connected:
            raise RuntimeError("AzureCachingClient is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        assert self.conn is not None

        if not isinstance(area_path, str) or not area_path:
            return []
        project = area_path.split('\\')[0] if '\\' in area_path else area_path.split('/')[0]

        # Try to load area->plan mapping from storage
        map_key = self._key_for_area_plan(area_path)
        try:
            mapping = self._storage.load(NAMESPACE, map_key)
        except Exception:
            mapping = None

        now = datetime.now(timezone.utc)
        fresh = False
        plan_ids = []
        if mapping and isinstance(mapping, dict):
            lu = mapping.get('last_update')
            try:
                lu_dt = datetime.fromisoformat(lu) if lu else None
                if lu_dt and lu_dt.tzinfo is None:
                    lu_dt = lu_dt.replace(tzinfo=timezone.utc)
                if lu_dt and (now - lu_dt) <= CACHE_TTL:
                    plan_ids = mapping.get('plans') or []
                    fresh = True
            except Exception:
                fresh = False

        markers_out = []
        if fresh and plan_ids:
            # return cached markers for each plan (may cause per-plan fetch if plan markers stale)
            for pid in plan_ids:
                try:
                    pm = self.get_markers_for_plan(project, pid)
                    for m in pm:
                        markers_out.append({'plan_id': pid, 'plan_name': None, 'team_id': None, 'team_name': None, 'marker': m})
                except Exception:
                    continue
            return markers_out

        # No fresh mapping: compute via base implementation (this will call SDK)
        computed = super().get_markers(area_path)
        # computed is list of dicts with plan_id and marker entries already
        plan_set = set()
        for entry in computed:
            pid = entry.get('plan_id')
            if pid:
                plan_set.add(pid)
        plan_list = list(plan_set)

        # persist mapping for future fast lookup
        try:
            payload = {'plans': plan_list, 'last_update': now.isoformat()}
            self._storage.save(NAMESPACE, map_key, payload)
        except Exception:
            logger.exception("Failed to persist area->plan mapping for %s", area_path)

        # Also persist per-plan markers for quicker subsequent lookups
        for pid in plan_list:
            try:
                self.get_markers_for_plan(project, pid)
            except Exception:
                continue

        return computed

    def _update_area_cache_item(self, area_key: str, item: dict):
        """Update a single work item in the area cache file (if present).

        This avoids forcing a refetch after a successful write to Azure.
        """
        try:
            with self._lock:
                index = self._read_index()
                area_list = self._read_area_cache(area_key)
                ac_map = {it.get('id'): it for it in (area_list or [])}
                ac_map[item.get('id')] = item
                # write updated cache and bump last_update timestamp
                try:
                    self._write_area_cache(area_key, list(ac_map.values()))
                except Exception:
                    logger.exception("Failed to write area cache for %s", area_key)
                index.setdefault(area_key, {})
                index[area_key]['last_update'] = datetime.now(timezone.utc).isoformat()
                try:
                    self._write_index(index)
                except Exception:
                    logger.exception("Failed to write index during inline update")
                logger.debug("Inline-updated cache for area '%s' item %s", area_key, item.get('id'))
        except Exception:
            logger.exception("Failed to inline-update area cache for %s", area_key)



    def invalidate_work_items(self, work_item_ids: List[int]):
        """Invalidate cache for specific work items by ID.
        
        Marks the specified work items as invalidated in the index, forcing them to be
        refetched from Azure on the next request, regardless of their ChangedDate.
        """
        if not work_item_ids:
            return
        
        with self._lock:
            index = self._read_index()

            # Prefer per-area invalidation mapping if we can determine area keys.
            # We'll attempt to map ids to areas using existing caches; if not
            # possible, fall back to a global list for compatibility.
            per_area = index.get('_invalidated', {}) if isinstance(index.get('_invalidated', {}), dict) else {}
            unmapped = set()
            try:
                # Try to find the area for each id by scanning existing area files
                for wid in work_item_ids:
                    mapped = False
                    # iterate over keys in index to find candidate areas
                    for akey in list(index.keys()):
                        if akey == '_invalidated':
                            continue
                        try:
                            key = self._key_for_area(akey)
                            if not self._storage.exists(NAMESPACE, key):
                                continue
                            # cheap check: read area cache via storage
                            area_list = self._read_area_cache(akey)
                            if any(str(wid) == it.get('id') for it in (area_list or [])):
                                per_area.setdefault(akey, [])
                                if wid not in per_area[akey]:
                                    per_area[akey].append(wid)
                                mapped = True
                                break
                        except Exception:
                            continue
                    if not mapped:
                        unmapped.add(wid)
            except Exception:
                unmapped.update(work_item_ids)

            # Only support per-area mapping. If we couldn't map some ids to an
            # area, store them under a reserved '_unmapped' key inside the
            # per-area mapping so the index remains a dict shape.
            if unmapped:
                if per_area is None:
                    per_area = {}
                per_area.setdefault('_unmapped', [])
                # ensure uniqueness
                existing = set(per_area.get('_unmapped', []))
                existing.update(unmapped)
                per_area['_unmapped'] = list(existing)
            index['_invalidated'] = per_area

            try:
                self._write_index(index)
                logger.debug("Marked %d work items as invalidated in cache index (per-area=%s unmapped=%d)", len(work_item_ids), bool(unmapped), len(unmapped))
            except Exception as e:
                logger.warning("Failed to update index with invalidated items: %s", e)

    def invalidate_plans(self, project: str, plan_ids: Optional[List[str]] = None):
        """Force invalidation of cached plans and per-plan markers for a project.

        If ``plan_ids`` is None the stored plans list for the project and any
        cached per-plan markers will be removed. When a list of plan ids is
        supplied, only the per-plan marker caches for those ids are removed.

        The method also scans stored area->plan mappings and removes or trims
        mappings that reference invalidated plans so subsequent `get_markers`
        calls will recompute the mapping.
        """
        with self._lock:
            try:
                # Delete cached plans list when requested
                plans_key = self._key_for_plans(project)
                if plan_ids is None:
                    try:
                        if self._storage.exists(NAMESPACE, plans_key):
                            self._storage.delete(NAMESPACE, plans_key)
                    except Exception:
                        pass

                    # attempt to delete any per-plan markers for known cached plans
                    try:
                        cached = self._storage.load(NAMESPACE, plans_key) or []
                    except Exception:
                        cached = []
                    for p in (cached or []):
                        pid = p.get('id') if isinstance(p, dict) else p
                        if not pid:
                            continue
                        try:
                            key = self._key_for_plan_markers(project, str(pid))
                            if self._storage.exists(NAMESPACE, key):
                                self._storage.delete(NAMESPACE, key)
                        except Exception:
                            continue
                else:
                    for pid in plan_ids:
                        try:
                            key = self._key_for_plan_markers(project, str(pid))
                            if self._storage.exists(NAMESPACE, key):
                                self._storage.delete(NAMESPACE, key)
                        except Exception:
                            continue
            except Exception:
                logger.exception("Failed to invalidate plan cache entries for project %s", project)

            # Clean up area->plan mappings that reference invalidated plans
            try:
                index = self._read_index()
                changed = False
                for akey in list(index.keys()):
                    if akey == '_invalidated':
                        continue
                    map_key = self._key_for_area_plan(akey)
                    try:
                        mapping = self._storage.load(NAMESPACE, map_key)
                        if not mapping or not isinstance(mapping, dict):
                            continue
                        plans = mapping.get('plans') or []
                        if not plans:
                            continue
                        if plan_ids is None:
                            # remove the entire mapping for this area
                            try:
                                if self._storage.exists(NAMESPACE, map_key):
                                    self._storage.delete(NAMESPACE, map_key)
                                index.pop(akey, None)
                                changed = True
                            except Exception:
                                continue
                        else:
                            new_plans = [p for p in plans if p not in plan_ids]
                            if len(new_plans) != len(plans):
                                mapping['plans'] = new_plans
                                mapping['last_update'] = datetime.now(timezone.utc).isoformat()
                                try:
                                    self._storage.save(NAMESPACE, map_key, mapping)
                                    changed = True
                                except Exception:
                                    continue
                    except Exception:
                        continue

                if changed:
                    try:
                        self._write_index(index)
                    except Exception:
                        logger.exception("Failed to write index after plan invalidation")
            except Exception:
                logger.exception("Failed to cleanup area->plan mappings during plan invalidation")

    def update_work_item_dates(self, work_item_id: int, start: Optional[str] = None, end: Optional[str] = None):
        logger.debug("Updating work item %d: start=%s, end=%s", work_item_id, start, end)
        result = super().update_work_item_dates(work_item_id, start=start, end=end)
        try:
            self.invalidate_work_items([work_item_id])
        except Exception:
            logger.exception("Failed to mark work item %s invalidated after update", work_item_id)
        return result

    def update_work_item_description(self, work_item_id: int, description: str):
        """Update the Description field on a work item by ID.

        Description should be HTML-formatted string. Returns SDK response object.
        """
        logger.debug("Updating work item %d description", work_item_id)
        result = super().update_work_item_description(work_item_id, description)
        try:
            self.invalidate_work_items([work_item_id])
        except Exception:
            logger.exception("Failed to mark work item %s invalidated after description update", work_item_id)
        return result
