"""Azure mock client that intercepts at the Azure DevOps SDK level.

Instead of replacing the planner_lib client, this module injects a
``_MockConnection`` into ``AzureCachingClient._connect_with_pat``.
Every layer above the SDK — caching, revision-checking, incremental
updates, normalisation in work_items.py / teams_plans.py / markers.py —
runs completely unchanged.  Only the raw ``azure.devops`` SDK calls are
answered from pre-recorded JSON fixture files.

This means:
  - ``AzureCachingClient`` exercises its real disk + memory caching logic
    against stable, reproducible fixture data.
  - All normalisation / business logic in the planner_lib azure layer remains
    under test.
  - No changes to any calling code are required.

Enable in server_config.yml:
    feature_flags:
        use_azure_mock: true
        azure_mock_data_dir: data/azure_mock   # optional, this is the default

Produce fixture files (requires a live Azure DevOps PAT):
    AZURE_DEVOPS_PAT=<pat> python scripts/record_azure_mock.py
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from planner_lib.azure.AzureCachingClient import AzureCachingClient
from planner_lib.storage.base import StorageBackend as StorageProtocol

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_key(value: str) -> str:
    """Same key convention as ``record_azure_mock.py``."""
    safe = value.replace('\\', '__').replace('/', '__').replace(' ', '_')
    return re.sub(r'[^A-Za-z0-9_\-]', '', safe)


def _extract_area_from_wiql(query: str) -> Optional[str]:
    """Extract the area path from a WIQL WHERE clause.

    ``AzureCachingClient`` escapes the path before embedding it:
      - single quotes doubled: ``''`` → ``'``
      - backslashes doubled:   ``\\\\`` → ``\\``
    """
    m = re.search(
        r"\[System\.AreaPath\]\s*=\s*'((?:[^']|'')*)'", query, re.IGNORECASE
    )
    if not m:
        return None
    raw = m.group(1)
    return raw.replace("''", "'").replace('\\\\', '\\')


def _find_classification_node(
    node: "_SdkClassificationNode", path: str
) -> Optional["_SdkClassificationNode"]:
    """Depth-first search for a classification node whose path/name matches."""
    node_path = node.path or ""
    if (
        node_path == path
        or node_path.endswith('\\' + path)
        or node_path.endswith('/' + path)
        or node.name == path
    ):
        return node
    for child in node.children or []:
        found = _find_classification_node(child, path)
        if found:
            return found
    return None


# ===========================================================================
# SDK mock model objects
# These mirror the attribute/method interface that work_items.py,
# teams_plans.py, and markers.py consume from the real azure-devops SDK.
# ===========================================================================

class _SdkRelationAttributes:
    """Wraps a relation-attributes dict; exposes ``.get()`` as the SDK does."""
    def __init__(self, d: dict) -> None:
        self._d = d

    def get(self, key: str, default: Any = None) -> Any:
        return self._d.get(key, default)

    def __contains__(self, key: str) -> bool:
        return key in self._d


class _SdkRelation:
    def __init__(self, d: dict) -> None:
        self.rel = d.get('rel', '')
        self.url = d.get('url', '')
        self.attributes = _SdkRelationAttributes(d.get('attributes', {}))


class _SdkWorkItem:
    """Mirrors the Azure SDK ``WorkItem`` model."""
    def __init__(self, d: dict) -> None:
        self.id = d.get('id')
        self.url = d.get('url', '')
        self.rev = d.get('rev') or (d.get('fields') or {}).get('System.Rev')
        # Keep fields as a plain Python dict so .get() and isinstance(..., dict) work
        self.fields: dict = d.get('fields') or {}
        self.relations: List[_SdkRelation] = [
            _SdkRelation(r) for r in (d.get('relations') or [])
        ]


class _SdkWIQLItem:
    """Mini item in a WIQL result — only ``.id`` is consumed."""
    def __init__(self, item_id: int) -> None:
        self.id = item_id


class _SdkWIQLResult:
    """Mirrors the object returned by ``wit_client.query_by_wiql``."""
    def __init__(self, items: List[dict]) -> None:
        self.work_items = [_SdkWIQLItem(i['id']) for i in items]


class _SdkTeam:
    def __init__(self, d: dict) -> None:
        self.id = d.get('id')
        self.name = d.get('name')


class _SdkPlan:
    def __init__(self, d: dict) -> None:
        self.id = d.get('id')
        self.name = d.get('name')


class _SdkTimelineTeam:
    """Team entry inside a delivery timeline; both attribute-access patterns supported."""
    def __init__(self, d: dict) -> None:
        self.teamId = d.get('teamId') or d.get('id')
        self.teamName = d.get('teamName') or d.get('name')
        self.id = self.teamId
        self.name = self.teamName


class _SdkTimeline:
    def __init__(self, d: dict) -> None:
        self.teams = [_SdkTimelineTeam(t) for t in (d.get('teams') or [])]


class _SdkPlanProperties:
    """plan.properties — supports both ``.markers`` attribute and ``.get()``."""
    def __init__(self, markers: list) -> None:
        self.markers = markers

    def get(self, key: str, default: Any = None) -> Any:
        return self.markers if key == 'markers' else default

    def __contains__(self, key: str) -> bool:
        return key == 'markers'


class _SdkFullPlan:
    def __init__(self, markers: list) -> None:
        self.properties = _SdkPlanProperties(markers)


class _SdkTeamFieldValue:
    def __init__(self, d: dict) -> None:
        self.value = d.get('value')
        self.include_children = d.get('includeChildren', False)


class _SdkTeamFieldValues:
    def __init__(self, values: list) -> None:
        self.values = [_SdkTeamFieldValue(v) for v in values]


class _SdkClassificationNodeAttrs:
    """Mirrors iteration-node attributes; supports both ``.get()`` and direct access."""
    def __init__(self, d: dict) -> None:
        self._d = d
        self.startDate = d.get('startDate')
        self.finishDate = d.get('finishDate')
        # PascalCase aliases for older SDK variants
        self.StartDate = self.startDate
        self.FinishDate = self.finishDate

    def get(self, key: str, default: Any = None) -> Any:
        return self._d.get(key, default)


class _SdkClassificationNode:
    """Mirrors ``WorkItemClassificationNode``; recursive children supported."""
    def __init__(self, d: dict) -> None:
        self.path = d.get('path')
        self.name = d.get('name')
        attrs = d.get('attributes') or {}
        self.attributes = _SdkClassificationNodeAttrs(
            attrs if isinstance(attrs, dict) else {}
        )
        self.children: List[_SdkClassificationNode] = [
            _SdkClassificationNode(c) for c in (d.get('children') or [])
        ]


class _SdkWorkItemState:
    def __init__(self, d: dict) -> None:
        self.name = d.get('name')
        self.category = d.get('category')


class _SdkWorkItemType:
    def __init__(self, d: dict) -> None:
        self.name = d.get('name')
        self.states = [_SdkWorkItemState(s) for s in (d.get('states') or [])]


class _SdkRevision:
    """Mirrors the WorkItem revision objects returned by ``get_revisions``."""
    def __init__(self, d: dict) -> None:
        self.fields: dict = d.get('fields') or {}


class _SdkTypeMappedState:
    """Mirrors ``WorkItemTypeMappedStates``."""
    def __init__(self, d: dict) -> None:
        self.work_item_type_name = (
            d.get('work_item_type_name') or d.get('workItemTypeName')
        )
        self.states: dict = d.get('states') or {}


class _SdkBacklogConfig:
    """Mirrors ``BacklogConfiguration`` from ``get_backlog_configurations``."""
    def __init__(self, d: dict) -> None:
        raw = (
            d.get('work_item_type_mapped_states')
            or d.get('workItemTypeMappedStates')
            or []
        )
        self.work_item_type_mapped_states = [_SdkTypeMappedState(m) for m in raw]


# ===========================================================================
# Fixture store
# ===========================================================================

class _MockFixtures:
    """Loads and indexes all ``sdk_*.json`` fixture files on first access."""

    def __init__(self, fixture_dir: str) -> None:
        self._dir = Path(fixture_dir)
        self._loaded = False

        self.teams: Dict[str, list] = {}             # _safe_key(proj) -> [{id,name}]
        self.plans: Dict[str, list] = {}             # _safe_key(proj) -> [{id,name}]
        self.iterations: Dict[str, dict] = {}        # _safe_key(proj) -> node-tree dict
        self.work_item_types: Dict[str, list] = {}   # _safe_key(proj) -> [{name,states}]
        self.timelines: Dict[str, dict] = {}         # f"{proj}__{plan_id}" -> {teams}
        self.plan_markers: Dict[str, list] = {}      # f"{proj}__{plan_id}" -> [markers]
        self.team_field_values: Dict[str, list] = {} # f"{proj}__{team}" -> [{value,...}]
        self.backlog_configs: Dict[str, dict] = {}   # f"{proj}__{team}" -> backlog dict
        self.wiql_results: Dict[str, list] = {}      # _safe_key(area) -> [{id}]
        self.work_item_by_id: Dict[int, dict] = {}   # work_item_id -> full sdk dict
        self.revisions: Dict[int, list] = {}         # work_item_id -> [rev dicts]

    def _load(self) -> None:
        if self._loaded:
            return
        self._loaded = True

        if not self._dir.exists():
            logger.warning(
                "AzureMockClient: fixture directory '%s' does not exist — "
                "run 'python scripts/record_azure_mock.py' to generate fixtures.",
                self._dir,
            )
            return

        for f in sorted(self._dir.glob("sdk_*.json")):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
            except Exception as exc:
                logger.warning("AzureMockClient: could not load %s: %s", f.name, exc)
                continue

            s = f.stem  # filename without extension

            if s.startswith("sdk_teams__"):
                self.teams[s[len("sdk_teams__"):]] = data
            elif s.startswith("sdk_plans__"):
                self.plans[s[len("sdk_plans__"):]] = data
            elif s.startswith("sdk_iterations__"):
                self.iterations[s[len("sdk_iterations__"):]] = data
            elif s.startswith("sdk_work_item_types__"):
                self.work_item_types[s[len("sdk_work_item_types__"):]] = data
            elif s.startswith("sdk_timeline__"):
                self.timelines[s[len("sdk_timeline__"):]] = data
            elif s.startswith("sdk_plan_markers__"):
                self.plan_markers[s[len("sdk_plan_markers__"):]] = data
            elif s.startswith("sdk_team_field_values__"):
                self.team_field_values[s[len("sdk_team_field_values__"):]] = data
            elif s.startswith("sdk_backlog_config__"):
                self.backlog_configs[s[len("sdk_backlog_config__"):]] = data
            elif s.startswith("sdk_wiql__"):
                self.wiql_results[s[len("sdk_wiql__"):]] = data
            elif s.startswith("sdk_work_items__"):
                items = data if isinstance(data, list) else list(data.values())
                for item in items:
                    wid = item.get('id')
                    if wid is not None:
                        self.work_item_by_id[int(wid)] = item
            elif s.startswith("sdk_revisions__"):
                try:
                    self.revisions[int(s[len("sdk_revisions__"):])] = data
                except ValueError:
                    pass

        logger.info(
            "AzureMockClient: loaded %d area(s), %d work item(s), "
            "%d project(s), %d revision set(s) from '%s'",
            len(self.wiql_results),
            len(self.work_item_by_id),
            len(self.teams),
            len(self.revisions),
            self._dir,
        )

    def load(self) -> None:
        self._load()

    def get_teams(self, project: str) -> list:
        self._load(); return self.teams.get(_safe_key(project), [])

    def get_plans(self, project: str) -> list:
        self._load(); return self.plans.get(_safe_key(project), [])

    def get_timeline(self, project: str, plan_id: str) -> dict:
        self._load()
        return self.timelines.get(f"{_safe_key(project)}__{plan_id}", {'teams': []})

    def get_plan_markers(self, project: str, plan_id: str) -> list:
        self._load()
        return self.plan_markers.get(f"{_safe_key(project)}__{plan_id}", [])

    def get_team_field_values(self, project: str, team_name: str) -> list:
        self._load()
        return self.team_field_values.get(
            f"{_safe_key(project)}__{_safe_key(team_name)}", []
        )

    def get_backlog_config(self, project: str, team_name: str) -> dict:
        self._load()
        return self.backlog_configs.get(
            f"{_safe_key(project)}__{_safe_key(team_name)}", {}
        )

    def get_iterations(self, project: str) -> Optional[dict]:
        self._load(); return self.iterations.get(_safe_key(project))

    def get_work_item_types(self, project: str) -> list:
        self._load(); return self.work_item_types.get(_safe_key(project), [])

    def get_wiql_result(self, area_path: str) -> list:
        self._load(); return self.wiql_results.get(_safe_key(area_path), [])

    def get_work_item(self, wid: int) -> Optional[dict]:
        self._load(); return self.work_item_by_id.get(int(wid))

    def get_revisions(self, wid: int) -> list:
        self._load(); return self.revisions.get(int(wid), [])

    # ------------------------------------------------------------------
    # Persistence — write a mutated work item back to its area file
    # ------------------------------------------------------------------

    def persist_work_item(self, wid: int) -> None:
        """Rewrite the ``sdk_work_items__<area>.json`` file that contains *wid*.

        Only has effect when the fixture directory is writable.  Called after
        ``_MockWITClient.update_work_item`` mutates the in-memory dict.
        """
        item = self.work_item_by_id.get(int(wid))
        if item is None:
            return
        area_path: str = item["fields"].get("System.AreaPath", "")
        if not area_path:
            return

        # Collect all items whose AreaPath matches this area
        area_items = [
            i for i in self.work_item_by_id.values()
            if i["fields"].get("System.AreaPath") == area_path
        ]
        stem = "sdk_work_items__" + _safe_key(area_path)
        dest = self._dir / f"{stem}.json"
        tmp = dest.with_suffix(".json.tmp")
        try:
            tmp.write_text(
                json.dumps(area_items, indent=2, default=str, ensure_ascii=False),
                encoding="utf-8",
            )
            tmp.replace(dest)
            logger.debug(
                "AzureMockClient: persisted %d items for area '%s'",
                len(area_items), area_path,
            )
        except Exception as exc:
            logger.warning("AzureMockClient: could not persist area '%s': %s", area_path, exc)
            tmp.unlink(missing_ok=True)


# ===========================================================================
# Mock SDK clients
# Implement only the methods actually called by planner_lib code.
# ===========================================================================

class _MockWITClient:
    """Mock azure.devops Work Item Tracking client."""

    def __init__(self, fixtures: _MockFixtures) -> None:
        self._f = fixtures

    def query_by_wiql(
        self, wiql: Any, project: Any = None, top: Any = None
    ) -> _SdkWIQLResult:
        query_str = wiql.query if hasattr(wiql, 'query') else str(wiql)
        area_path = _extract_area_from_wiql(query_str)
        items = self._f.get_wiql_result(area_path) if area_path else []
        logger.debug("mock query_by_wiql: area='%s' → %d items", area_path, len(items))
        return _SdkWIQLResult(items)

    def get_work_items(
        self,
        ids: List[int],
        expand: Any = None,
        fields: Any = None,
        as_of: Any = None,
        error_policy: Any = None,
    ) -> List[_SdkWorkItem]:
        rev_only = bool(fields and list(fields) == ['System.Rev'])
        result: List[_SdkWorkItem] = []
        for wid in ids:
            d = self._f.get_work_item(int(wid))
            if d is None:
                continue
            if rev_only:
                minimal: dict = {
                    'id': d.get('id'),
                    'url': d.get('url', ''),
                    'fields': {'System.Rev': (d.get('fields') or {}).get('System.Rev', 1)},
                    'relations': [],
                }
                result.append(_SdkWorkItem(minimal))
            else:
                result.append(_SdkWorkItem(d))
        return result

    def get_work_item(
        self,
        id: int,
        expand: Any = None,
        fields: Any = None,
        as_of: Any = None,
    ) -> _SdkWorkItem:
        d = self._f.get_work_item(int(id))
        if d is None:
            return _SdkWorkItem({'id': id, 'fields': {'System.Rev': 1}, 'relations': []})
        return _SdkWorkItem(d)

    def get_revisions(self, id: int, top: Any = None, skip: Any = None) -> List[_SdkRevision]:
        return [_SdkRevision(r) for r in self._f.get_revisions(int(id))]

    def get_work_item_types(self, project: str) -> List[_SdkWorkItemType]:
        return [_SdkWorkItemType(t) for t in self._f.get_work_item_types(project)]

    def get_classification_node(
        self,
        project: str,
        structure_group: str,
        path: str = None,
        depth: int = 10,
    ) -> _SdkClassificationNode:
        node_data = self._f.get_iterations(project)
        if node_data is None:
            return _SdkClassificationNode({'path': project, 'name': project, 'children': []})
        root = _SdkClassificationNode(node_data)
        if path:
            found = _find_classification_node(root, path)
            return found if found else root
        return root

    def update_work_item(
        self,
        document: Any,
        id: int,
        validate_only: Any = None,
        bypass_rules: Any = None,
        suppress_notifications: Any = None,
    ) -> _SdkWorkItem:
        """Apply JSON Patch ops to the in-memory fixture item."""
        d = self._f.get_work_item(int(id))
        if d is None:
            d = {'id': id, 'fields': {}, 'relations': [], 'url': ''}
            self._f.work_item_by_id[int(id)] = d
        fields = d.setdefault('fields', {})
        for op in (document or []):
            op_dict: dict = op if isinstance(op, dict) else {}
            fp: str = op_dict.get('path', '')
            if fp.startswith('/fields/'):
                fields[fp[len('/fields/'):]] = op_dict.get('value')
        return _SdkWorkItem(d)


class _MockCoreClient:
    """Mock azure.devops Core client."""

    def __init__(self, fixtures: _MockFixtures) -> None:
        self._f = fixtures

    def get_teams(self, project_id: str, **kwargs: Any) -> List[_SdkTeam]:
        return [_SdkTeam(t) for t in self._f.get_teams(project_id)]

    def get_projects(self, **kwargs: Any) -> List[_SdkTeam]:
        self._f.load()
        return [_SdkTeam({'id': k, 'name': k}) for k in sorted(self._f.teams.keys())]


class _MockWorkClient:
    """Mock azure.devops Work client."""

    def __init__(self, fixtures: _MockFixtures) -> None:
        self._f = fixtures

    def get_plans(self, project: str) -> List[_SdkPlan]:
        return [_SdkPlan(p) for p in self._f.get_plans(project)]

    def get_plan(self, project: str = None, id: str = None, **kwargs: Any) -> _SdkFullPlan:
        # Also called positionally as get_plan(project, plan_id)
        if project is None and id is None and kwargs:
            args = list(kwargs.values())
            project, id = (args[0], args[1]) if len(args) >= 2 else (args[0], None)
        return _SdkFullPlan(self._f.get_plan_markers(project or '', str(id or '')))

    def get_delivery_timeline_data(
        self, project: str, id: str, **kwargs: Any
    ) -> _SdkTimeline:
        return _SdkTimeline(self._f.get_timeline(project, str(id)))

    def get_team_field_values(self, team_context: Any = None, **kwargs: Any) -> _SdkTeamFieldValues:
        ctx = team_context or kwargs.get('team_context')
        project = (
            getattr(ctx, 'project', None)
            or (ctx.get('project') if isinstance(ctx, dict) else None)
            or ''
        )
        team = (
            getattr(ctx, 'team', None)
            or (ctx.get('team') if isinstance(ctx, dict) else None)
            or ''
        )
        return _SdkTeamFieldValues(self._f.get_team_field_values(project, team))

    def get_backlog_configurations(self, team_context: Any = None, **kwargs: Any) -> _SdkBacklogConfig:
        ctx = team_context or kwargs.get('team_context')
        project = (
            getattr(ctx, 'project', None)
            or (ctx.get('project') if isinstance(ctx, dict) else None)
            or ''
        )
        team = (
            getattr(ctx, 'team', None)
            or (ctx.get('team') if isinstance(ctx, dict) else None)
            or ''
        )
        return _SdkBacklogConfig(self._f.get_backlog_config(project, team))


class _MockClientsAccessor:
    def __init__(self, fixtures: _MockFixtures) -> None:
        self._wit = _MockWITClient(fixtures)
        self._core = _MockCoreClient(fixtures)
        self._work = _MockWorkClient(fixtures)

    def get_work_item_tracking_client(self) -> _MockWITClient:
        return self._wit

    def get_core_client(self) -> _MockCoreClient:
        return self._core

    def get_work_client(self) -> _MockWorkClient:
        return self._work


class _MockConnection:
    """Replaces ``azure.devops.connection.Connection`` for offline development."""

    def __init__(self, fixture_dir: str, persist_enabled: bool = False) -> None:
        self._fixtures = _MockFixtures(fixture_dir)
        if persist_enabled:
            self.clients = _PersistingMockClientsAccessor(self._fixtures)
        else:
            self.clients = _MockClientsAccessor(self._fixtures)
        # Placeholder that preserves the URL structure for api_url_to_ui_link
        self.base_url = "https://dev.azure.com/anonymous-org"


class _PersistingMockClientsAccessor(_MockClientsAccessor):
    """Wraps the WIT client so every ``update_work_item`` call is immediately
    written back to the fixture file on disk."""

    def __init__(self, fixtures: _MockFixtures) -> None:
        super().__init__(fixtures)

        _base_wit = self._wit
        _on_mutated = fixtures.persist_work_item

        class _PersistingWITClient(_MockWITClient):
            def update_work_item(self, document, id, **kwargs):
                result = super().update_work_item(document, id, **kwargs)
                _on_mutated(int(id))
                return result

        self._wit = _PersistingWITClient(_base_wit._f)


# ===========================================================================
# AzureMockClient
# ===========================================================================

class AzureMockClient(AzureCachingClient):
    """Extends ``AzureCachingClient`` with a mocked Azure DevOps SDK connection.

    Overrides only ``_connect_with_pat`` to install a ``_MockConnection``
    instead of the real SDK ``Connection``.  Every other method
    (``get_work_items``, ``get_all_teams``, ``get_iterations``, etc.)
    is inherited unchanged from ``AzureCachingClient`` — including all
    caching, revision-checking, and normalisation logic.

    Parameters
    ----------
    persist_enabled:
        When ``True``, every ``update_work_item`` call (date, state, description,
        relations) immediately rewrites the affected ``sdk_work_items__<area>.json``
        fixture file in *fixture_dir*.  Useful for testing save-to-cloud operations
        against anonymised fixture data.
    """

    def __init__(
        self,
        organization_url: str,
        storage: StorageProtocol,
        fixture_dir: str = "data/azure_mock",
        memory_cache: Any = None,
        persist_enabled: bool = False,
    ) -> None:
        super().__init__(organization_url, storage=storage, memory_cache=memory_cache)
        self._fixture_dir = fixture_dir
        self._persist_enabled = persist_enabled

    def connect(self, pat: str):
        """Override: skip PAT validation — no live Azure connection is made."""
        from contextlib import contextmanager

        @contextmanager
        def _cm():
            self._connect_with_pat(pat or "")
            try:
                yield self
            finally:
                try:
                    self.close()
                except Exception:
                    pass

        return _cm()

    def _connect_with_pat(self, pat: str) -> None:
        """Override: inject a MockConnection instead of the real Azure SDK."""
        if self._connected:
            return
        logger.info(
            "AzureMockClient: using fixture data from '%s' "
            "(persist_enabled=%s, no Azure connection made)",
            self._fixture_dir,
            self._persist_enabled,
        )
        self.conn = _MockConnection(self._fixture_dir, persist_enabled=self._persist_enabled)
        self._connected = True
