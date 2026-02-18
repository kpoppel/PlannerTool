from __future__ import annotations

from typing import Protocol, Any, List, Optional, ContextManager, runtime_checkable


@runtime_checkable
class AzureServiceProtocol(Protocol):
    """Protocol for the `AzureService` public surface.

    This protocol mirrors other `*ServiceProtocol` types in the project and
    describes the minimal surface required by consumers (e.g. `TaskService`).
    The composed `AzureService` exposes `connect(pat)` which yields a
    short-lived connected client that implements the same methods.
    """

    def get_work_items(self, area_path: str) -> List[dict]:
        ...

    def get_markers(self, area_path: str) -> List[dict]:
        """Return markers associated with the given Azure area path.

        Each marker entry should be a dict with context including at least
        `plan_id` and a `marker` primitive as returned by the concrete
        client implementations.
        """
        ...

    def get_markers_for_plan(self, project: str, plan_id: str) -> List[dict]:
        """Return markers for the specified delivery plan id in `project`.

        Allows callers to fetch per-plan markers directly when a plan id is
        known (avoids scanning all plans).
        """
        ...

    def get_all_plans(self, project: str) -> List[dict]:
        """Return a list of delivery plans for the given project as lightweight dicts.

        Each plan dict should contain at least `id` and `name` keys.
        """
        ...

    def get_all_teams(self, project: str) -> List[dict]:
        """Return a list of teams for the given project as lightweight dicts.

        Each team dict should contain at least `id` and `name` keys.
        """
        ...

    def get_team_from_area_path(self, project: str, area_path: str) -> List[str]:
        """Return a list of team IDs that are configured to own the given area path.

        This implements the include-children semantics where a team field value
        marked with `include_children` will match descendant area paths.
        """
        ...
    def update_work_item_dates(self, work_item_id: int, start: Optional[str] = None, end: Optional[str] = None) -> Any:  # pragma: no cover - typing shim
        ...

    def update_work_item_description(self, work_item_id: int, description: str) -> Any:  # pragma: no cover - typing shim
        ...
    
    def invalidate_all_caches(self) -> dict:  # pragma: no cover - typing shim
        """Invalidate all cached data and force a complete refresh on next fetch."""
        ...
    
    def cleanup_orphaned_cache_keys(self) -> dict:  # pragma: no cover - typing shim
        """Clean up orphaned index entries for cache files that no longer exist."""
        ...

    def connect(self, pat: str) -> ContextManager["AzureServiceProtocol"]:
        """Return a context manager that yields a connected per-PAT client.

        The composed/stateless client registered at app composition time
        exposes `connect(pat)` which yields a short-lived connected client
        for the duration of the `with` block. Typing this as a
        `ContextManager[AzureServiceProtocol]` lets callers use `with`.
        """
        ...
