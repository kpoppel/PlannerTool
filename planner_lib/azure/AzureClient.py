from __future__ import annotations
from typing import List, Optional, Any
from planner_lib.storage.interfaces import StorageProtocol
from abc import ABC, abstractmethod
import logging
import re
from contextlib import contextmanager

logger = logging.getLogger(__name__)

# Import operation classes
from planner_lib.azure.work_items import WorkItemOperations
from planner_lib.azure.teams_plans import TeamPlanOperations
from planner_lib.azure.markers import MarkersOperations


class AzureClient(ABC):
    """Base Azure client containing shared helpers and default SDK operations.

    This class uses composition to delegate operations to specialized modules:
    - WorkItemOperations: work item queries and updates
    - TeamPlanOperations: team and plan queries
    - MarkersOperations: delivery plan markers
    
    Subclasses must implement `get_work_items` and `invalidate_work_items`.
    """

    def __init__(self, organization_url: str, storage: StorageProtocol, *, cache_plans: bool = True):
        self.organization_url = organization_url
        self._connected = False
        self.conn: Optional[Any] = None
        # optional storage backend (may be used by caching client)
        self.storage = storage
        # Whether to enable caching for plans/teams. Subclasses may honor this.
        self.cache_plans = bool(cache_plans)
        
        # Initialize operation classes
        self._work_item_ops = WorkItemOperations(self)
        self._team_plan_ops = TeamPlanOperations(self)
        self._markers_ops = MarkersOperations(self, self._team_plan_ops)

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
        """Convert Azure API URL to web UI link."""
        return self._work_item_ops.api_url_to_ui_link(api_url)

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
        """Sanitize area path for WIQL queries."""
        return self._work_item_ops._sanitize_area_path(path)

    def _safe_type(self, type: Optional[str]) -> str:
        """Convert work item type to normalized string."""
        return self._work_item_ops._safe_type(type)

    def _safe_date(self, d):
        """Convert date value to ISO date string."""
        return self._work_item_ops._safe_date(d)

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

        Delegates to TeamPlanOperations.
        """
        return self._team_plan_ops.get_all_teams(project)

    def get_all_plans(self, project: str) -> List[dict]:
        """Return lightweight plan dicts for the given project.

        Delegates to TeamPlanOperations.
        """
        return self._team_plan_ops.get_all_plans(project)

    def get_markers_for_plan(self, project: str, plan_id: str) -> List[dict]:
        """Return markers for a single plan identified by `plan_id` in `project`.

        Delegates to MarkersOperations.
        """
        return self._markers_ops.get_markers_for_plan(project, plan_id)
    
    def get_team_from_area_path(self, project: str, area_path: str) -> List[str]:
        """Return team IDs that own `area_path`.

        Delegates to TeamPlanOperations.
        """
        return self._team_plan_ops.get_team_from_area_path(project, area_path)

    def prefetch_team_fields(self, project: str) -> None:
        """Prefetch team field values for all teams in `project` and cache them.

        Delegates to TeamPlanOperations.
        """
        return self._team_plan_ops.prefetch_team_fields(project)

    def get_cached_team_fields(self, project: str, team_name: str) -> Optional[list]:
        """Return cached team field values for a team or `None` if not cached.
        
        Delegates to TeamPlanOperations.
        """
        return self._team_plan_ops.get_cached_team_fields(project, team_name)

    def _model_to_primitive(self, obj):
        """Convert a SDK model or value to a small primitive dict.
        
        Delegates to MarkersOperations.
        """
        return self._markers_ops._model_to_primitive(obj)

    def get_markers(self, area_path: str) -> List[dict]:
        """Return markers (milestones/annotations) for delivery plans that reference the given `area_path`.

        Delegates to MarkersOperations.
        """
        return self._markers_ops.get_markers(area_path)

    def update_work_item_dates(self, work_item_id: int, start: Optional[str] = None, end: Optional[str] = None):
        """Update start and/or end dates for a work item.
        
        Delegates to WorkItemOperations.
        """
        return self._work_item_ops.update_work_item_dates(work_item_id, start=start, end=end)

    def update_work_item_description(self, work_item_id: int, description: str):
        """Update the description field for a work item.
        
        Delegates to WorkItemOperations.
        """
        return self._work_item_ops.update_work_item_description(work_item_id, description)

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