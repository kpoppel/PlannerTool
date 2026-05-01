"""ConfigBackend: diskcache-backed configuration data for all local config domains.

Implements the focused config protocols; reads and writes go directly to the
injected diskcache StorageBackend.  ConfigBackend is a peer of UserDataBackend:
both operate directly on diskcache with no separate TTL-caching layer.

People config (people.yml) is stored in diskcache after migration 0022.  The
``config::people`` key holds a dict ``{database: {people: [...]}}``.

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
from typing import Any, Dict, List, Optional

from planner_lib.backend.port import (
    AdoConfigBackend,
    BackendCredential,
    EventConfigBackend,
    PeopleBackend,
    ProjectConfigBackend,
    TeamConfigBackend,
    IterationConfigBackend,
    PlanConfigBackend,
)
from planner_lib.domain.people import DomainPerson
from planner_lib.domain.projects import DomainProject
from planner_lib.domain.teams import DomainTeam
from planner_lib.storage.base import StorageBackend
from planner_lib.util import slugify

logger = logging.getLogger(__name__)


class ConfigBackend(
    AdoConfigBackend,
    EventConfigBackend,
    PeopleBackend,
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
        config domains (people, projects, teams, cost_config, iterations,
        area_plan_map, global_settings, ado_config).  Run migration 0022
        to populate ``config::people`` before starting the server.
    """

    def __init__(
        self,
        storage: StorageBackend,
    ) -> None:
        self._storage = storage
        logger.info("ConfigBackend: initialised (diskcache storage)")

    # ------------------------------------------------------------------
    # PeopleBackend  (diskcache-backed after migration 0022)
    # ------------------------------------------------------------------

    def fetch_people(
        self,
        credential: Optional[BackendCredential] = None,
    ) -> List[DomainPerson]:
        """Return all people records from diskcache (populated by migration 0022)."""
        if not self._storage.exists("config", "people"):
            logger.warning(
                "ConfigBackend: config::people not in diskcache — "
                "run migration 0022 to populate it from people.yml"
            )
            return []
        cfg = self._storage.load("config", "people") or {}
        return (cfg.get("database") or {}).get("people") or []

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

        global_hierarchy: list = []
        try:
            gs = self._storage.load("config", "global_settings") or {}
            global_hierarchy = gs.get("task_type_hierarchy") or []
        except Exception:
            pass

        return [
            DomainProject(
                id=slugify(p.get("name"), prefix="project-"),
                name=p.get("name") or "",
                type=p.get("type") if isinstance(p.get("type"), str) else "project",
                area_path=p.get("area_path"),
                display_states=p.get("display_states") or [],
                state_categories={},
                task_types=p.get("task_types") or [],
                task_type_hierarchy=global_hierarchy,
            )
            for p in project_map
        ]

    # ------------------------------------------------------------------
    # TeamConfigBackend
    # ------------------------------------------------------------------

    def fetch_config_teams(
        self,
        credential: Optional[BackendCredential] = None,
    ) -> List[DomainTeam]:
        """Return all active (non-excluded) teams."""
        cfg = self._storage.load("config", "teams") or {}
        return [
            DomainTeam(
                id=slugify(t.get("name"), prefix="team-"),
                name=t.get("name") or "",
                short_name=t.get("short_name"),
            )
            for t in (cfg.get("teams") or [])
            if not t.get("exclude", False)
        ]

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

