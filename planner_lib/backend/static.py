"""StaticBackend: read-only file-based BackendPort for standalone mode.

StaticBackend loads pre-translated DomainTask data from a YAML or JSON
file and serves it as-is.  No credentials are required for reads.
Write operations raise NotImplementedError — the static backend is
intentionally read-only.

Configuration (in server_config.yml feature_flags):
    use_static_backend: true
    static_data_path: data/static_tasks.yml   # default

YAML/JSON file format
---------------------
The file must be a mapping of area_path → list of DomainTask dicts.
Use the same field names as the frontend expects (id, title, type,
start, end, iterationPath, parentId, capacity, state, project, …).

Example::

    "MyOrg\\\\TeamA":
      - id: "42"
        title: "Implement feature X"
        type: "Feature"
        state: "Active"
        project: "project-team-a"
        start: "2026-05-01"
        end: "2026-06-30"
        capacity: []
        relations: []

Teams, plans, markers, and iterations are returned as empty lists / dicts
unless provided under optional top-level keys ``_teams``, ``_plans``,
``_markers``, and ``_iterations`` respectively.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from planner_lib.backend.port import BackendCredential, BackendPort
from planner_lib.domain.tasks import DomainTask, WriteResult
from planner_lib.domain.history import DomainHistoryEntry

logger = logging.getLogger(__name__)


class StaticBackend(BackendPort):
    """Read-only file-based backend for offline / standalone mode.

    Parameters
    ----------
    data_path:
        Path to the YAML or JSON data file (absolute or relative to cwd).
    """

    # Feature flag key in server_config feature_flags that activates this backend.
    FEATURE_FLAG: str = 'use_static_backend'

    @classmethod
    def config_schema(cls) -> Dict[str, Any]:
        """JSON Schema properties for this backend's feature_flags entries."""
        return {
            'use_static_backend': {
                'type': 'boolean',
                'title': 'Use Static File Backend',
                'description': (
                    'Load pre-translated DomainTask data from a YAML or JSON file. '
                    'Read-only; no Azure DevOps connection required. '
                    'Useful for fully offline demos or static exports.'
                ),
                'default': False,
            },
            'static_data_path': {
                'type': 'string',
                'title': 'Static Data File Path',
                'description': (
                    'Path to the YAML or JSON file mapping area_path → list of DomainTask dicts. '
                    'May be absolute or relative to the server working directory.'
                ),
                'default': 'data/static_tasks.yml',
                'x-showWhen': 'use_static_backend',
            },
        }

    @classmethod
    def build_from_flags(cls, feature_flags: Dict[str, Any], **services: Any) -> 'StaticBackend':
        """Construct a StaticBackend from feature_flags.

        ``services`` kwargs are accepted but not used (StaticBackend requires
        no external dependencies).
        """
        data_path = feature_flags.get('static_data_path', 'data/static_tasks.yml')
        return cls(data_path=data_path)

    def __init__(self, data_path: str) -> None:
        self._data_path = Path(data_path)
        self._data: Optional[Dict[str, Any]] = None
        logger.info("StaticBackend: initialised (data_path=%r)", str(data_path))

    def _load(self) -> Dict[str, Any]:
        """Lazy-load and cache the static data file."""
        if self._data is not None:
            return self._data

        path = self._data_path
        if not path.exists():
            logger.warning("StaticBackend: data file not found at '%s'", path)
            self._data = {}
            return self._data

        try:
            suffix = path.suffix.lower()
            if suffix in ('.yml', '.yaml'):
                import yaml
                with open(path, encoding='utf-8') as f:
                    self._data = yaml.safe_load(f) or {}
            elif suffix == '.json':
                with open(path, encoding='utf-8') as f:
                    self._data = json.load(f) or {}
            else:
                raise ValueError(f"Unsupported file format: {suffix!r}")
            logger.info("StaticBackend: loaded %d area entries from '%s'", len(self._data), path)
        except Exception as exc:
            logger.error("StaticBackend: failed to load '%s': %s", path, exc)
            self._data = {}

        return self._data

    # ------------------------------------------------------------------
    # BackendPort: fetch_tasks
    # ------------------------------------------------------------------

    def fetch_tasks(
        self,
        area_path: str,
        task_types: Optional[List[str]] = None,
        include_states: Optional[List[str]] = None,
        credential: Optional[BackendCredential] = None,
        **kwargs,
    ) -> List[DomainTask]:
        """Return pre-loaded DomainTask list for *area_path*.

        Filters by *task_types* and *include_states* when provided.
        No credential required.
        """
        data = self._load()
        items: List[DomainTask] = list(data.get(area_path, []))

        if task_types:
            types_lower = {t.lower() for t in task_types}
            items = [t for t in items if (t.get('type') or '').lower() in types_lower]

        if include_states:
            states_lower = {s.lower() for s in include_states}
            items = [t for t in items if (t.get('state') or '').lower() in states_lower]

        return items

    # ------------------------------------------------------------------
    # BackendPort: write_task — not supported
    # ------------------------------------------------------------------

    def write_task(
        self,
        task_id: int,
        updates: Dict[str, Any],
        credential: BackendCredential,
    ) -> WriteResult:
        raise NotImplementedError(
            "StaticBackend is read-only; write_task() is not supported."
        )

    # ------------------------------------------------------------------
    # BackendPort: fetch_history
    # ------------------------------------------------------------------

    def fetch_history(
        self,
        work_item_id: int,
        credential: Optional[BackendCredential] = None,
    ) -> List[DomainHistoryEntry]:
        """Return pre-loaded history entries for *work_item_id* if present."""
        data = self._load()
        history_map = data.get('_history', {})
        entries = history_map.get(str(work_item_id), [])
        return list(entries)

    # ------------------------------------------------------------------
    # BackendPort: fetch_teams / fetch_plans / fetch_markers / fetch_iterations
    # ------------------------------------------------------------------

    def fetch_teams(
        self,
        project: str,
        credential: Optional[BackendCredential] = None,
    ) -> List[Dict[str, Any]]:
        data = self._load()
        return list(data.get('_teams', {}).get(project, []))

    def fetch_plans(
        self,
        project: str,
        credential: Optional[BackendCredential] = None,
    ) -> List[Dict[str, Any]]:
        data = self._load()
        return list(data.get('_plans', {}).get(project, []))

    def fetch_markers(
        self,
        area_path: str,
        credential: Optional[BackendCredential] = None,
    ) -> List[Dict[str, Any]]:
        data = self._load()
        return list(data.get('_markers', {}).get(area_path, []))

    def fetch_iterations(
        self,
        project: str,
        root_paths: Optional[List[str]] = None,
        credential: Optional[BackendCredential] = None,
    ) -> Dict[str, Any]:
        data = self._load()
        return dict(data.get('_iterations', {}).get(project, {}))

    def fetch_people(
        self,
        credential: Optional[BackendCredential] = None,
    ):
        """Return people records from ``_people`` key in the static data file."""
        data = self._load()
        return list(data.get('_people', []))

    # ------------------------------------------------------------------
    # BackendPort: invalidate_cache
    # ------------------------------------------------------------------

    def invalidate_cache(self) -> Dict[str, Any]:
        """Clear the in-process data cache; next read reloads from disk."""
        self._data = None
        return {'ok': True, 'invalidated': ['static_data'], 'errors': []}
