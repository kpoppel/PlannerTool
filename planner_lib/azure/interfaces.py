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

    def update_work_item_dates(self, work_item_id: int, start: Optional[str] = None, end: Optional[str] = None) -> Any:  # pragma: no cover - typing shim
        ...

    def update_work_item_description(self, work_item_id: int, description: str) -> Any:  # pragma: no cover - typing shim
        ...

    def connect(self, pat: str) -> ContextManager["AzureServiceProtocol"]:
        """Return a context manager that yields a connected per-PAT client.

        The composed/stateless client registered at app composition time
        exposes `connect(pat)` which yields a short-lived connected client
        for the duration of the `with` block. Typing this as a
        `ContextManager[AzureServiceProtocol]` lets callers use `with`.
        """
        ...
