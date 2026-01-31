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

    def __init__(self, organization_url: str, storage: StorageProtocol):
        self.organization_url = organization_url
        self._connected = False
        self.conn: Optional[Any] = None
        # optional storage backend (may be used by caching client)
        self.storage = storage

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
        if not self._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        assert self.conn is not None
        wit = self.conn.clients.get_work_item_tracking_client()
        from azure.devops.v7_1.work_item_tracking.models import Wiql
        q = Wiql(query=wiql)
        return wit.query_by_wiql(q)

    def get_work_items_by_wiql(self, project: str, wiql: str, fields: Optional[list[str]] = None):
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

    # Abstract methods: subclass must implement these
    @abstractmethod
    def get_work_items(self, area_path: str) -> List[dict]:
        raise NotImplementedError()

    @abstractmethod
    def invalidate_work_items(self, work_item_ids: List[int]) -> None:
        raise NotImplementedError()