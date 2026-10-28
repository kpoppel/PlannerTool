from __future__ import annotations
from typing import List, Optional, Any, ContextManager
from planner_lib.storage.base import StorageBackend
import logging
import re
import threading
from contextlib import contextmanager

logger = logging.getLogger(__name__)

# Import operation classes
from planner_lib.azure.work_items import WorkItemOperations
from planner_lib.azure.teams_plans import TeamPlanOperations
from planner_lib.azure.markers import MarkersOperations
from planner_lib.azure.processes import ProcessOperations
from planner_lib.azure.authentication import (
    azure_devops_authentication,
    azure_devops_pat_authentication,
    token_from_credential,
)
from planner_lib.backend.port import BackendCredential


class AzureClient:
    """Azure client for live Azure DevOps operations.

    Uses composition to delegate operations to specialised modules:
    - WorkItemOperations: work item queries and updates
    - TeamPlanOperations: team and plan queries
    - MarkersOperations: delivery plan markers

    Mock clients (AzureMockClient, AzureMockGeneratorClient) extend this class
    and override only ``_connect_with_pat`` to inject a fake SDK connection.
    Domain responses are cached by CachingBackend. The team/plan operation
    helper may separately cache Azure discovery calls behind explicit
    project-level and global invalidation methods.
    """

    def __init__(self, organization_url: str, storage: StorageBackend, *, cache_plans: bool = True,
                 credential_provider=None):
        self.organization_url = organization_url
        self._credential_provider = credential_provider
        self._connection_state = threading.local()
        self._connected = False
        self.conn: Optional[Any] = None
        # optional storage backend (may be used by caching client)
        self.storage = storage
        
        # Initialize operation classes
        self._work_item_ops = WorkItemOperations(self)
        self._team_plan_ops = TeamPlanOperations(self, cache_enabled=cache_plans)
        self._markers_ops = MarkersOperations(self, self._team_plan_ops)
        self._process_ops = ProcessOperations(self)

    @property
    def _connected(self) -> bool:
        return getattr(self._connection_state, 'connected', False)

    @_connected.setter
    def _connected(self, value: bool) -> None:
        self._connection_state.connected = value

    @property
    def conn(self) -> Optional[Any]:
        return getattr(self._connection_state, 'connection', None)

    @conn.setter
    def conn(self, value: Optional[Any]) -> None:
        self._connection_state.connection = value

    def _connect_with_pat(self, pat: str) -> None:
        """Low-level connect using an explicit PAT.

        This method sets up the azure-devops SDK connection object.
        """
        self._connect_with_authentication(azure_devops_pat_authentication(pat))

    def _connect_with_authentication(self, authentication) -> None:
        try:
            from azure.devops.connection import Connection
        except ImportError as error:
            raise RuntimeError(
                "azure-devops package not installed. Install 'azure-devops' to use Azure features"
            ) from error

        # If already connected, we can reuse the SDK connection for this
        # instance only for the duration of the current context. Do not
        # rely on any previously-stored PAT.
        if self._connected:
            return

        self.conn = Connection(base_url=f"https://dev.azure.com/{self.organization_url}", creds=authentication)
        self._connected = True

    def connect(self, credential: BackendCredential) -> ContextManager["AzureClient"]:
        """Context-manager that connects with a validated operation credential."""
        token = token_from_credential(credential)
        return self._connection_context(token, credential=credential)

    def connect_pat(self, pat: str) -> ContextManager["AzureClient"]:
        """Context-manager for an explicit PAT-only connection outside a user credential."""
        if not isinstance(pat, str) or not pat:
            raise ValueError("PAT must be a non-empty string")
        return self._connection_context(pat)

    @contextmanager
    def _connection_context(
        self, token: str, *, credential: BackendCredential | None = None,
    ) -> ContextManager["AzureClient"]:
        """Connect with the transport selected by the credential contract and
        yield a connected client for the duration of the context.
        """
        authentication = None
        try:
            if credential is not None and credential['kind'] == 'bearer':
                authentication = azure_devops_authentication(credential, self._credential_provider)
                self._connect_with_authentication(authentication)
            else:
                self._connect_with_pat(token)
            yield self
        except Exception as error:
            from planner_lib.backend.errors import BackendAuthError, classify_ado_exception
            classified = classify_ado_exception(error)
            if isinstance(classified, BackendAuthError):
                classified.credential = (authentication.credential
                    if authentication is not None and self._credential_provider is not None else credential)
                raise classified from error
            raise
        finally:
            self.close()

    def close(self) -> None:
        # clear references; SDK connection has no explicit close
        self.conn = None
        self._connected = False

    # ------------------------------------------------------------------
    # SDK sub-client properties — operation helpers must use these instead
    # of reaching through self.client.conn.clients.get_*() directly.
    # ------------------------------------------------------------------

    @property
    def wit_client(self):
        """Return the work-item-tracking SDK client for the active connection."""
        assert self.conn is not None
        return self.conn.clients.get_work_item_tracking_client()

    @property
    def work_client(self):
        """Return the work SDK client for the active connection."""
        assert self.conn is not None
        return self.conn.clients.get_work_client()

    @property
    def core_client(self):
        """Return the core SDK client for the active connection."""
        assert self.conn is not None
        return self.conn.clients.get_core_client()

    @property
    def base_url(self) -> str:
        """Return the organization base URL from the active SDK connection."""
        assert self.conn is not None
        return self.conn.base_url

    def get_linked_work_items(self, seeds: List[dict], *, catalogue: dict) -> List[dict]:
        """Expand seeds only through imported process types."""
        return self._work_item_ops.get_linked_work_items(seeds, catalogue=catalogue)

    def list_processes(self) -> List[dict]:
        return self._process_ops.list_processes()

    def get_process_types(self, process_id: str) -> List[dict]:
        return self._process_ops.get_process_types(process_id)

    def get_work_item(self, work_item_id: int, fields=None) -> Any:
        """Fetch a single work item by ID.

        Provides a stable public method so callers (e.g. TaskService) can
        retrieve a work item without reaching through conn.clients directly.
        """
        if not self._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(credential):' to obtain a connected client.")
        assert self.conn is not None
        if fields:
            return self.wit_client.get_work_item(work_item_id, fields=fields)
        return self.wit_client.get_work_item(work_item_id)

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

    def _safe_date(self, d):
        """Convert date value to ISO date string."""
        return self._work_item_ops._safe_date(d)

    def get_projects(self) -> List[str]:
        if not self._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(credential):' to obtain a connected client.")
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

    def get_wikis(self, project: str) -> List[dict]:
        """Return all wikis for *project* as a list of ``{id, name, type}`` dicts.

        Uses the v7.0 wiki client so the call works with the same credentials
        and connection as all other ADO operations.
        """
        if not self._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(credential):' to obtain a connected client.")
        assert self.conn is not None
        wiki_client = self.conn.clients_v7_0.get_wiki_client()
        wikis = wiki_client.get_all_wikis(project=project)
        result = []
        for w in (wikis or []):
            result.append({
                'id':   getattr(w, 'id',   None) or '',
                'name': getattr(w, 'name', None) or '',
                'type': getattr(w, 'type', None) or '',
            })
        return result

    def get_wiki_pages(self, project: str, wiki_id: str, top: int = 100) -> List[str]:
        """Return a flat list of all page paths in *wiki_id*.

        Uses ``get_page`` with ``recursion_level='full'`` on the root path to
        walk the entire wiki tree.  ``top`` is retained as a parameter for
        API compatibility but is no longer used; the full tree is always
        returned.

        Parameters
        ----------
        project:
            Azure DevOps project name or GUID.
        wiki_id:
            Wiki name or GUID.
        top:
            Retained for backward-compatibility; ignored.
        """
        if not self._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(credential):' to obtain a connected client.")
        assert self.conn is not None
        wiki_client = self.conn.clients_v7_0.get_wiki_client()
        response = wiki_client.get_page(
            project=project,
            wiki_identifier=wiki_id,
            path='/',
            recursion_level='full',
        )
        paths: List[str] = []

        def _walk(page) -> None:
            if page is None:
                return
            path = getattr(page, 'path', None)
            if path:
                paths.append(path)
            for sub in (getattr(page, 'sub_pages', None) or []):
                _walk(sub)

        page = getattr(response, 'page', response)
        _walk(page)
        return sorted(paths)

    def get_area_paths(self, project: str, root_path: str = '/') -> List[str]:
        """ Fetch a list of areas paths given a root_path (default is all areas). 
            This is used by the setup wizard to list available areas.
            TODO: route this through to the admin interface because the setup is disabled.
        """
        if not self._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(credential):' to obtain a connected client.")
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

    def update_work_item_dates(self, work_item_id: int, **kwargs):
        """Update start and/or end dates for a work item.

        Forwards kwargs directly to WorkItemOperations so the sentinel logic
        (distinguishing absent from explicit None) is preserved.
        """
        return self._work_item_ops.update_work_item_dates(work_item_id, **kwargs)

    def update_work_item_iteration_path(self, work_item_id: int, iteration_path):
        """Update (or clear) the iteration path for a work item.

        Delegates to WorkItemOperations.
        """
        return self._work_item_ops.update_work_item_iteration_path(work_item_id, iteration_path)

    def update_work_item_description(self, work_item_id: int, description: str):
        """Update the description field for a work item.
        
        Delegates to WorkItemOperations.
        """
        return self._work_item_ops.update_work_item_description(work_item_id, description)

    def update_work_item_state(self, work_item_id: int, state_value: str):
        """Update the state field for a work item.

        Delegates to WorkItemOperations.
        """
        return self._work_item_ops.update_work_item_state(work_item_id, state_value)

    def update_work_item_tags(self, work_item_id: int, tags_value: Optional[str]):
        """Update the tags field for a work item.

        Delegates to WorkItemOperations.
        """
        return self._work_item_ops.update_work_item_tags(work_item_id, tags_value)

    def update_work_item_relations(self, work_item_id: int, relations_ops: list):
        """Update work item relations (delegates to WorkItemOperations)."""
        return self._work_item_ops.update_work_item_relations(work_item_id, relations_ops)

    def get_work_item_description(self, work_item_id: int) -> str:
        """Fetch the description field of a single work item.

        Delegates to WorkItemOperations. Callers should prefer this over
        reaching through ``client.conn`` directly.
        """
        return self._work_item_ops.get_work_item_description(work_item_id)
    
    def get_work_items_by_ids(self, ids: list) -> list:
        """Fetch minimal work-item dicts (id, type, state, relations) by explicit IDs.

        Used by the closed-task filter to resolve parent items that were not
        returned by the area-path WIQL query.  Delegates to WorkItemOperations.
        """
        return self._work_item_ops.get_work_items_by_ids(ids)

    def invalidate_plans(self, project: str, plan_ids: Optional[List[str]] = None) -> None:
        """Invalidate provider discovery data cached for one project."""
        self._team_plan_ops.invalidate_project(project)

    def invalidate_all_caches(self) -> dict:
        """Invalidate all provider-level discovery caches."""
        self._team_plan_ops.invalidate_all()
        return {'ok': True, 'cleared': 'all'}
    
    def get_iterations(self, project: str, root_path: Optional[str] = None, depth: int = 10) -> List[dict]:
        """Fetch iterations for a project, optionally filtered by root path.
        
        Delegates to TeamPlanOperations.
        
        Args:
            project: Project name or ID
            root_path: Optional root iteration path to filter by
            depth: Depth to fetch classification nodes (default 10)
            
        Returns:
            List of iteration dicts sorted by startDate
        """
        return self._team_plan_ops.get_iterations(project, root_path=root_path, depth=depth)

    def get_work_items(
        self,
        area_path: str,
        task_types: List[str],
        *, catalogue: dict, closed_history_days: int = 0,
    ) -> List[dict]:
        """Fetch work items for an area path, delegating to WorkItemOperations."""
        return self._work_item_ops.get_work_items(
            area_path,
            task_types=task_types,
            catalogue=catalogue,
            closed_history_days=closed_history_days,
        )

    def invalidate_work_items(self, work_item_ids: List[int]) -> None:
        """No-op: cache invalidation is handled by CachingBackend."""
        return None

    def get_all_teams(self, project: str) -> List[dict]:
        """Fetch teams from Azure DevOps."""
        return self._team_plan_ops.get_all_teams(project)

    def get_all_plans(self, project: str) -> List[dict]:
        """Fetch plans through the team and plan operations owner."""
        return self._team_plan_ops.get_all_plans(project)

    def get_task_revision_history(
        self,
        work_item_id: int,
        start_field: str = "Microsoft.VSTS.Scheduling.StartDate",
        end_field: str = "Microsoft.VSTS.Scheduling.TargetDate",
        iteration_field: str = "System.IterationPath",
    ) -> List[dict]:
        """Fetch revision history for a work item (no caching; always fresh)."""
        return self._work_item_ops.get_task_revision_history(
            work_item_id=work_item_id,
            start_field=start_field,
            end_field=end_field,
            iteration_field=iteration_field,
        )