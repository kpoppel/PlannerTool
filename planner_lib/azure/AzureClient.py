from __future__ import annotations
from typing import List, Optional, Any
from planner_lib.storage.interfaces import StorageProtocol
from abc import ABC, abstractmethod
import logging
import re
from contextlib import contextmanager

logger = logging.getLogger(__name__)

class AzureClient(ABC):
    """Base Azure client containing shared helpers and default SDK operations.

    Subclasses must implement `get_work_items` and `invalidate_work_items`.
    Other SDK helper methods are provided here to avoid duplication.
    """

    def __init__(self, organization_url: str, storage: StorageProtocol, *, cache_plans: bool = True):
        self.organization_url = organization_url
        self._connected = False
        self.conn: Optional[Any] = None
        # optional storage backend (may be used by caching client)
        self.storage = storage
        # Whether to enable caching for plans/teams. Subclasses may honor this.
        self.cache_plans = bool(cache_plans)
        # in-memory cache for expensive team field value lookups
        # key: (project, team_name) -> list[str] of area paths
        self._team_field_cache: dict[tuple, list] = {}

    def _connect_with_pat(self, pat: str) -> None:
        """Low-level connect using an explicit PAT.

        This method sets up the azure-devops SDK connection object.
        """
        try:
            from azure.devops.connection import Connection
            from msrest.authentication import BasicAuthentication
        except Exception:
            raise RuntimeError("azure-devops package not installed. Install 'azure-devops' to use Azure features")

        # If already connected, we can reuse the SDK connection for this
        # instance only for the duration of the current context. Do not
        # rely on any previously-stored PAT.
        if self._connected:
            return

        creds = BasicAuthentication('', pat)
        self.conn = Connection(base_url=f"https://dev.azure.com/{self.organization_url}", creds=creds)
        self._connected = True

    def connect(self, pat: str):
        """Context-manager that connects with the supplied PAT and yields
        a connected client for the duration of the context. The client will
        always raise if SDK operations are attempted while not connected.
        """
        if not isinstance(pat, str) or not pat:
            raise ValueError("PAT must be a non-empty string")

        @contextmanager
        def _cm():
            try:
                self._connect_with_pat(pat)
                try:
                    yield self
                finally:
                    try:
                        self.close()
                    except Exception:
                        pass
            finally:
                # Explicitly clear any sensitive references (none are stored)
                pass

        return _cm()

    def close(self) -> None:
        # clear references; SDK connection has no explicit close
        self.conn = None
        self._connected = False

    def api_url_to_ui_link(self, api_url: str) -> str:
        m = re.match(r"https://dev\.azure\.com/([^/]+)/([^/]+)/_apis/wit/workItems/(\d+)", api_url)
        if not m:
            raise ValueError("Invalid API URL format")
        org, project, work_item_id = m.groups()
        return f"https://dev.azure.com/{org}/{project}/_workitems/edit/{work_item_id}"

    def _flatten_area_nodes(self, node) -> List[str]:
        paths = []
        if getattr(node, 'path', None):
            paths.append(node.path)
        elif getattr(node, 'name', None):
            paths.append(node.name)
        children = getattr(node, 'children', None)
        if children:
            for c in children:
                paths.extend(self._flatten_area_nodes(c))
        return paths

    def _sanitize_area_path(self, path: str) -> str:
        if not isinstance(path, str):
            return path
        return path.lstrip('/\\').replace('/', '\\').replace('Area\\', '')

    def _safe_type(self, type: Optional[str]) -> str:
        if not type:
            return "feature"
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

    def get_projects(self) -> List[str]:
        if not self._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        assert self.conn is not None
        core_client = self.conn.clients.get_core_client()
        projects = core_client.get_projects()
        items = getattr(projects, 'value', projects)
        names: List[str] = []
        for p in items or []:
            try:
                names.append(p.name)
            except Exception:
                names.append(str(p))
        return names

    def get_area_paths(self, project: str, root_path: str = '/') -> List[str]:
        """ Fetch a list of areas paths given a root_path (default is all areas). 
            This is used by the setup wizard to list available areas.
            TODO: route this through to the admin interface because the setup is disabled.
        """
        if not self._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        assert self.conn is not None
        wit = self.conn.clients.get_work_item_tracking_client()
        try:
            path = root_path.strip('/\\') or None
            depth = 10
            if path is None:
                logger.debug("Fetching area nodes from root for project %s", project)
                node = wit.get_classification_node(project=project, structure_group='areas', depth=depth)
            else:
                logger.debug("Fetching area nodes from root for project %s with path %s", project, path)
                node = wit.get_classification_node(project=project, structure_group='areas', path=path, depth=depth)
            paths = self._flatten_area_nodes(node)
            normed = [self._sanitize_area_path(p) for p in paths]
            return normed
        except Exception:
            return []

    def query_by_wiql(self, project: str, wiql: str):
        """ TODO: This function is only used by some scripts and tests. Consider removing and reworking call sites."""
        if not self._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        assert self.conn is not None
        wit = self.conn.clients.get_work_item_tracking_client()
        from azure.devops.v7_1.work_item_tracking.models import Wiql
        q = Wiql(query=wiql)
        return wit.query_by_wiql(q)

    def get_work_items_by_wiql(self, project: str, wiql: str, fields: Optional[list[str]] = None):
        """
        Retrieve work items matching the supplied WIQL query.
        TODO: The function is only used in a test. Consider removing and reworking call sites.
        
        :param self: Description
        :param project: Description
        :type project: str
        :param wiql: Description
        :type wiql: str
        :param fields: Description
        :type fields: Optional[list[str]]
        """
        if not self._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        assert self.conn is not None
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

    def get_all_teams(self, project: str) -> List[dict]:
        """Return lightweight team dicts for the given project.

        Default implementation uses the SDK `get_core_client().get_teams` and
        returns a list of dicts with `id` and `name` keys.
        """
        if not self._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        assert self.conn is not None
        core_client = self.conn.clients.get_core_client()
        teams = core_client.get_teams(project_id=project)
        items = getattr(teams, 'value', teams) or []
        out: List[dict] = []
        for t in items:
            try:
                out.append({'id': str(t.id), 'name': t.name})
            except Exception:
                try:
                    out.append({'id': str(getattr(t, 'id', '')), 'name': str(t)})
                except Exception:
                    continue
        return out

    def get_all_plans(self, project: str) -> List[dict]:
        """Return lightweight plan dicts for the given project.

        Default implementation uses `get_work_client().get_plans` and returns
        a list of dicts with `id` and `name` keys.
        """
        if not self._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        assert self.conn is not None
        work_client = self.conn.clients.get_work_client()
        plans = work_client.get_plans(project=project)
        items = getattr(plans, 'value', plans) or []
        out: List[dict] = []
        for p in items:
            try:
                out.append({'id': str(p.id), 'name': p.name})
            except Exception:
                try:
                    out.append({'id': str(getattr(p, 'id', '')), 'name': str(p)})
                except Exception:
                    continue
        return out

    def get_markers_for_plan(self, project: str, plan_id: str) -> List[dict]:
        """Return markers for a single plan identified by `plan_id` in `project`.

        Default implementation calls the SDK `get_plan` and returns the
        `properties['markers']` list converted to primitives. Returns an empty
        list when no markers are present.
        """
        if not self._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        assert self.conn is not None
        work_client = self.conn.clients.get_work_client()
        try:
            full_plan = None
            if hasattr(work_client, 'get_plan'):
                try:
                    full_plan = work_client.get_plan(project=project, id=plan_id)
                except TypeError:
                    full_plan = work_client.get_plan(project, plan_id)
            props = None
            if full_plan is not None:
                props = getattr(full_plan, 'properties', None) or (full_plan.get('properties') if isinstance(full_plan, dict) else None)
            markers_prop = None
            if props:
                markers_prop = props.get('markers') if isinstance(props, dict) and 'markers' in props else None
                if markers_prop is None:
                    markers_prop = getattr(props, 'markers', None)
            if not markers_prop:
                return []
            out = []
            for m in markers_prop:
                out.append(self._model_to_primitive(m))
            return out
        except Exception:
            return []
    def get_team_from_area_path(self, project: str, area_path: str) -> List[str]:
        """Return team IDs that own `area_path`.

        Default implementation iterates teams in the project and calls
        `get_team_field_values` for each team to inspect their area mappings.
        """
        if not self._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        assert self.conn is not None
        core_client = self.conn.clients.get_core_client()
        work_client = self.conn.clients.get_work_client()

        teams = self.get_all_teams(project)
        if not teams:
            return []

        team_ids: List[str] = []
        try:
            from azure.devops.v7_1.work.models import TeamContext
        except Exception:
            TeamContext = None

        targ = area_path.rstrip('\\/')
        for t in teams:
            tid = t.get('id')
            tname = t.get('name')

            cache_key = (project, tname)
            vals = self._team_field_cache.get(cache_key)
            if vals is None:
                try:
                    if TeamContext is not None:
                        tc = TeamContext(project=project, team=tname)
                        fv = work_client.get_team_field_values(team_context=tc)
                    else:
                        fv = work_client.get_team_field_values(project=project, team=tname)
                except Exception:
                    self._team_field_cache[cache_key] = []
                    continue

                values = getattr(fv, 'values', None) or []
                vals = []
                for entry in values:
                    try:
                        val = getattr(entry, 'value', None) if not isinstance(entry, dict) else entry.get('value')
                        if val:
                            vals.append(str(val).rstrip('\\/'))
                    except Exception:
                        continue
                self._team_field_cache[cache_key] = vals

            for candidate in (vals or []):
                try:
                    if candidate == targ or targ.startswith(candidate + '\\'):
                        team_ids.append(str(tid))
                        break
                except Exception:
                    continue

        return team_ids

    def prefetch_team_fields(self, project: str) -> None:
        """Prefetch team field values for all teams in `project` and cache them.

        This performs a single `get_team_field_values` call per team and stores
        the resolved area paths in the in-memory cache so subsequent lookups
        are fast.
        """
        if not self._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        assert self.conn is not None
        work_client = self.conn.clients.get_work_client()
        teams = self.get_all_teams(project) or []
        try:
            from azure.devops.v7_1.work.models import TeamContext
        except Exception:
            TeamContext = None

        for t in teams:
            tname = t.get('name')
            cache_key = (project, tname)
            if cache_key in self._team_field_cache:
                continue
            try:
                if TeamContext is not None:
                    tc = TeamContext(project=project, team=tname)
                    fv = work_client.get_team_field_values(team_context=tc)
                else:
                    fv = work_client.get_team_field_values(project=project, team=tname)
            except Exception:
                self._team_field_cache[cache_key] = []
                continue
            values = getattr(fv, 'values', None) or []
            vals = []
            for entry in values:
                try:
                    val = getattr(entry, 'value', None) if not isinstance(entry, dict) else entry.get('value')
                    if val:
                        vals.append(str(val).rstrip('\\/'))
                except Exception:
                    continue
            self._team_field_cache[cache_key] = vals

    def get_cached_team_fields(self, project: str, team_name: str) -> list:
        """Return cached team field values for a team or `None` if not cached."""
        return self._team_field_cache.get((project, team_name))

    def _model_to_primitive(self, obj):
        """Convert a SDK model or value to a small primitive dict for logging/return.

        This is defensive: model objects vary between SDK versions, so prefer
        common attribute names and fall back to repr truncated.
        """
        if obj is None:
            return None
        if isinstance(obj, dict):
            return obj
        # try common attributes
        out = {}
        for attr in ('id', 'markerId', 'title', 'name', 'teamId', 'teamName', 'date', 'startDate', 'endDate', 'workItemId'):
            try:
                val = getattr(obj, attr, None)
                if val is not None:
                    out[attr] = val
            except Exception:
                continue
        # if we found something useful, return it
        if out:
            return out
        # fallback: build small dict of public non-callable attrs
        try:
            for k in dir(obj):
                if k.startswith('_'):
                    continue
                try:
                    v = getattr(obj, k)
                except Exception:
                    continue
                if callable(v):
                    continue
                # limit size
                sval = repr(v)
                if len(sval) > 200:
                    sval = sval[:200] + '...'
                out[k] = sval
                if len(out) >= 8:
                    break
        except Exception:
            return {'repr': repr(obj)[:200]}
        return out or {'repr': repr(obj)[:200]}

    def get_markers(self, area_path: str) -> List[dict]:
        """Return markers (milestones/annotations) for delivery plans that reference the given `area_path`.

        Returned list contains entries with plan/team context and a primitive marker object.
        """
        if not self._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        assert self.conn is not None

        # derive project and normalize area path
        if not isinstance(area_path, str) or not area_path:
            return []
        project = area_path.split('\\')[0] if '\\' in area_path else area_path.split('/')[0]
        targ_area = area_path.rstrip('\\/')

        # find owning teams for the area path
        owner_team_ids = self.get_team_from_area_path(project, area_path)
        if not owner_team_ids:
            # nothing to do
            return []

        work_client = self.conn.clients.get_work_client()
        markers_out: list[dict] = []

        # find plans that reference these teams
        plans = self.get_all_plans(project)
        if not plans:
            return []

        for pl in plans:
            plan_id = pl.get('id')
            plan_name = pl.get('name')
            plan_teams = pl.get('teams') or []
            # check if any team in plan_teams matches our owner_team_ids
            matched = False
            matched_team_ids = []
            for t in plan_teams:
                tid = t.get('id') if isinstance(t, dict) else str(t)
                if tid in owner_team_ids:
                    matched = True
                    matched_team_ids.append((tid, t.get('name') if isinstance(t, dict) else None))
            if not matched:
                continue

            # Prefer markers stored directly on the plan properties (common in some APIs)
            try:
                full_plan = None
                if hasattr(work_client, 'get_plan'):
                    try:
                        full_plan = work_client.get_plan(project=project, id=plan_id)
                    except TypeError:
                        # Some SDK versions expect positional args
                        full_plan = work_client.get_plan(project, plan_id)
                props = None
                if full_plan is not None:
                    props = getattr(full_plan, 'properties', None) or (full_plan.get('properties') if isinstance(full_plan, dict) else None)
                markers_prop = None
                if props:
                    # properties may be a dict-like or model
                    markers_prop = props.get('markers') if isinstance(props, dict) and 'markers' in props else None
                    # sometimes properties is a model with attribute access
                    if markers_prop is None:
                        markers_prop = getattr(props, 'markers', None)
                if markers_prop:
                    for m in markers_prop:
                        markers_out.append({
                            'plan_id': plan_id,
                            'plan_name': plan_name,
                            'team_id': matched_team_ids[0][0] if matched_team_ids else None,
                            'team_name': matched_team_ids[0][1] if matched_team_ids and matched_team_ids[0][1] else None,
                            'marker': self._model_to_primitive(m),
                        })
                    # If plan contains explicit markers, prefer those and skip timeline parsing
                    continue
            except Exception:
                # non-fatal; fall back to timeline parsing
                pass

            # fetch timeline data for the plan
            try:
                timeline = None
                if hasattr(work_client, 'get_delivery_timeline_data'):
                    timeline = work_client.get_delivery_timeline_data(project, plan_id)
                else:
                    timeline = None
            except Exception:
                timeline = None

            if timeline is None:
                continue

            # find the team entries in the timeline and extract marker-like attributes
            team_entries = getattr(timeline, 'teams', None) or (timeline.get('teams') if isinstance(timeline, dict) else None) or []
            for te in team_entries or []:
                # determine team id
                tid = None
                tname = None
                try:
                    tid = getattr(te, 'id', None) or getattr(te, 'teamId', None) or (te.get('id') if isinstance(te, dict) else None)
                except Exception:
                    tid = None
                try:
                    tname = getattr(te, 'name', None) or getattr(te, 'teamName', None) or (te.get('name') if isinstance(te, dict) else None)
                except Exception:
                    tname = None

                if str(tid) not in owner_team_ids:
                    continue

                # collect marker-like fields from the team entry
                # prefer explicit attribute names that contain 'marker'
                candidate_attrs = [a for a in dir(te) if 'marker' in a.lower()] if not isinstance(te, dict) else [k for k in te.keys() if 'marker' in k.lower()]
                found = []
                # try attributes
                for a in candidate_attrs:
                    try:
                        val = getattr(te, a) if not isinstance(te, dict) else te.get(a)
                        if val:
                            # convert model to primitive
                            found.append(self._model_to_primitive(val))
                    except Exception:
                        continue

                # also inspect nested rows/items for markers
                if not found:
                    rows = getattr(te, 'rows', None) if not isinstance(te, dict) else te.get('rows')
                    if rows:
                        for r in rows:
                            # look for marker attributes on row
                            for a in (k for k in dir(r) if 'marker' in k.lower()):
                                try:
                                    val = getattr(r, a)
                                    if val:
                                        found.append(self._model_to_primitive(val))
                                except Exception:
                                    continue

                # If we found marker data, append to output with context
                for fm in found:
                    markers_out.append({
                        'plan_id': plan_id,
                        'plan_name': plan_name,
                        'team_id': str(tid),
                        'team_name': tname,
                        'marker': fm,
                    })

        return markers_out

    def update_work_item_dates(self, work_item_id: int, start: Optional[str] = None, end: Optional[str] = None):
        if not self._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        assert self.conn is not None
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
        if not self._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        assert self.conn is not None
        wit = self.conn.clients.get_work_item_tracking_client()
        ops = [{"op": "add", "path": "/fields/System.Description", "value": description}]
        try:
            return wit.update_work_item(document=ops, id=work_item_id)
        except Exception as e:
            raise RuntimeError(f"Failed to update work item {work_item_id} description: {e}")

    def invalidate_plans(self, project: str, plan_ids: Optional[List[str]] = None) -> None:
        """Invalidate cached plan-related artifacts for a project.

        Default implementation is a no-op. Caching clients (e.g. ``AzureCachingClient``)
        should override this to remove cached plan lists, per-plan markers and any
        area->plan mappings. Callers may invoke this method unconditionally on
        any client implementation.
        """
        # no-op in base client; subclasses may override
        return None

    # Abstract methods: subclass must implement these
    @abstractmethod
    def get_work_items(self, area_path: str) -> List[dict]:
        raise NotImplementedError()

    @abstractmethod
    def invalidate_work_items(self, work_item_ids: List[int]) -> None:
        raise NotImplementedError()