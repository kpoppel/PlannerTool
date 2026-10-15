"""ConfigBackend: diskcache-backed configuration data for all local config domains.

Implements the focused config protocols; reads and writes go directly to the
injected diskcache StorageBackend.  ConfigBackend is a peer of UserDataBackend:
both operate directly on diskcache with no separate TTL-caching layer.

Adding new config domains
--------------------------
1.  Add a new focused Protocol to port.py (e.g. BudgetBackend).
2.  Implement fetch_budget_lines() here.
3.  Create a BudgetRepository that depends on config_backend.
4.  No changes to any remote backend or other repository.

Admin write path
-----------------
``save_config(key, content)`` and ``save_config_raw(key, content)`` write
directly to diskcache.  No TTL is applied — config entries live until the
next admin write explicitly overwrites them.  No separate cache-invalidation
step is needed after a write because diskcache is the authoritative store.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, cast

from planner_lib.backend.port import (
    AdoConfigBackend,
    BackendCredential,
    EventConfigBackend,
    GroupsConfigBackend,
    ProjectConfigBackend,
    TeamConfigBackend,
    IterationConfigBackend,
    PlanConfigBackend,
)
from planner_lib.domain.allocation_availability import validate_project_availability
from planner_lib.domain.projects import DomainProject
from planner_lib.domain.teams import DomainTeam, TeamCatalogue
from planner_lib.storage.base import StorageBackend
from planner_lib.util import slugify

logger = logging.getLogger(__name__)


class ConfigBackend(
    AdoConfigBackend,
    EventConfigBackend,
    GroupsConfigBackend,
    ProjectConfigBackend,
    TeamConfigBackend,
    IterationConfigBackend,
    PlanConfigBackend,
):
    """Backend for locally-configured domain data stored in diskcache.

    Parameters
    ----------
    storage:
        StorageBackend backed by diskcache — the authoritative store for all
        config domains (projects, teams, workforce, iterations,
        area_plan_map, global_settings, ado_config).
    """

    def __init__(
        self,
        storage: StorageBackend,
    ) -> None:
        self._storage = storage
        logger.info("ConfigBackend: initialised (diskcache storage)")

    # ------------------------------------------------------------------
    # ProjectConfigBackend
    # ------------------------------------------------------------------

    def fetch_project_map(
        self,
        credential: Optional[BackendCredential] = None,
    ) -> List[dict]:
        """Return raw project entries (includes area_path etc.)."""
        cfg = self._storage.load("config", "projects") or {}
        project_map = cfg.get("project_map") or []
        return [dict(p, id=slugify(p.get("name"), prefix="project-")) for p in project_map]

    def fetch_projects(
        self,
        credential: Optional[BackendCredential] = None,
    ) -> List[DomainProject]:
        """Return all configured projects in frontend-ready shape."""
        cfg = self._storage.load("config", "projects") or {}
        project_map = cfg.get("project_map") or []
        if not project_map:
            return []
        container_order = {
            type_name: index for index, type_name in enumerate(cfg['container_types'])
        }

        global_hierarchy: list = []
        global_state_sequence: list = []
        try:
            gs = self._storage.load("config", "global_settings") or {}
            global_hierarchy = gs.get("task_type_hierarchy") or []
            global_state_sequence = gs.get("state_display_sequence") or []
        except Exception:
            pass

        return [
            DomainProject(
                id=slugify(p.get("name"), prefix="project-"),
                name=p.get("name") or "",
                type=p['type'],
                container_order=container_order[p['type']],
                container_types=list(cfg['container_types']),
                area_path=p.get("area_path"),
                display_states=p.get("display_states") or [],
                state_categories={},
                task_types=p.get("task_types") or [],
                task_type_hierarchy=global_hierarchy,
                state_display_sequence=global_state_sequence,
                iteration_uuid=(str(p.get("iteration_uuid")).strip() if p.get("iteration_uuid") else None),
            )
            for p in project_map
        ]

    # ------------------------------------------------------------------
    # TeamConfigBackend
    # ------------------------------------------------------------------

    def fetch_config_teams(
        self,
        credential: Optional[BackendCredential] = None,
        *,
        include_archived: bool = False,
    ) -> List[DomainTeam]:
        """Read persisted team/group identities directly, never derive IDs from labels."""
        catalogue = TeamCatalogue(self._storage.load('config', 'teams'))
        entries = catalogue.definitions() if include_archived else catalogue.allocation_choices()
        return [cast(DomainTeam, entry) for entry in entries]

    # ------------------------------------------------------------------
    # IterationConfigBackend
    # ------------------------------------------------------------------

    def fetch_iterations_config(
        self,
        credential: Optional[BackendCredential] = None,
    ) -> dict:
        """Return the raw iterations config dict."""
        if not self._storage.exists("config", "iterations"):
            return {}
        return self._storage.load("config", "iterations") or {}

    # ------------------------------------------------------------------
    # PlanConfigBackend
    # ------------------------------------------------------------------

    def fetch_area_plan_map(
        self,
        credential: Optional[BackendCredential] = None,
    ) -> dict:
        """Return the raw area_plan_map config dict."""
        if not self._storage.exists("config", "area_plan_map"):
            return {}
        return self._storage.load("config", "area_plan_map") or {}

    # ------------------------------------------------------------------
    # AdoConfigBackend
    # ------------------------------------------------------------------

    def fetch_ado_config(self) -> dict:
        """Return the ADO-specific config dict (organization_url + feature flags).

        Returns an empty dict when not yet configured.
        """
        if not self._storage.exists("config", "ado_config"):
            return {}
        return self._storage.load("config", "ado_config") or {}

    def save_ado_config(self, content: dict) -> None:
        """Persist ADO-specific config directly to diskcache."""
        self._storage.save("config", "ado_config", content)

    # ------------------------------------------------------------------
    # EventConfigBackend
    # ------------------------------------------------------------------

    def fetch_event_config(self) -> dict:
        """Return the event-backend config dict.

        Returns an empty dict when not yet configured (defaults to diskcache
        backend — ``event_backend`` is treated as ``"local"`` when absent).
        """
        if not self._storage.exists("config", "event_config"):
            return {}
        return self._storage.load("config", "event_config") or {}

    def save_event_config(self, content: dict) -> None:
        """Persist event-backend config directly to diskcache."""
        self._storage.save("config", "event_config", content)

    # ------------------------------------------------------------------
    # GroupsConfigBackend
    # ------------------------------------------------------------------

    def fetch_groups_config(self) -> dict:
        """Return the groups-backend config dict.

        Returns an empty dict when not yet configured (defaults to local
        diskcache backend — ``groups_backend`` is treated as ``"local"``
        when absent).
        """
        if not self._storage.exists("config", "groups_config"):
            return {}
        return self._storage.load("config", "groups_config") or {}

    def save_groups_config(self, content: dict) -> None:
        """Persist groups-backend config directly to diskcache."""
        self._storage.save("config", "groups_config", content)

    # ------------------------------------------------------------------
    # Admin write helpers
    # ------------------------------------------------------------------

    def save_config(self, key: str, content: Any) -> None:
        """Persist *content* under *key* in the config namespace.

        This is the primary write path for the admin layer.  diskcache is the
        authoritative store — no TTL is applied and no backup is created here;
        backup responsibility belongs to ConfigManager.
        """
        self._storage.save("config", key, content)

    def save_config_raw(self, key: str, content: Any) -> None:
        """Alias for save_config — retained for API symmetry with ConfigManager."""
        self._storage.save("config", key, content)

    # ------------------------------------------------------------------
    # Cache management (no-op — diskcache is the authoritative store)
    # ------------------------------------------------------------------

    def invalidate_cache(self) -> Dict[str, Any]:
        """No-op — ConfigBackend writes directly to diskcache; reads are always
        consistent.  There is no separate TTL cache layer to flush."""
        return {"ok": True, "invalidated": [], "errors": []}


class WorkforceConfigBackend(ConfigBackend):
    """Canonical configuration port selected at the coordinated workforce cutover."""

    def fetch_projects(
        self, credential: Optional[BackendCredential] = None,
    ) -> List[DomainProject]:
        """Expose validated level defaults and plan overrides without inventing availability."""
        with self._storage.transaction():
            config = self._storage.load('config', 'projects')
            catalogue = TeamCatalogue(self._storage.load('config', 'teams'))
            validate_project_availability(config, catalogue.definitions())
            defaults = config['allocation_defaults']
            projects = super().fetch_projects(credential)
            for project, definition in zip(projects, config['project_map'], strict=True):
                project['allocation_defaults'] = {level: list(ids) for level, ids in defaults.items()}
                if 'allocatable_ids' in definition:
                    project['allocatable_ids'] = list(definition['allocatable_ids'])
            return projects

