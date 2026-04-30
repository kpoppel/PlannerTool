"""BackendPort protocol and credential types.

BackendPort is the single interface that all backend implementations must
satisfy.  Callers (CachingBackend, TaskRepository, HistoryRepository)
depend only on this protocol — not on any concrete class.

Credential handling
-------------------
Operations that require a live backend call (cache miss, explicit
refresh, writes) receive a BackendCredential.  Read operations that are
satisfied by a cache hit never need a credential.  CredentialProvider
is injected into the repository layer and queried only on the write /
refresh path, keeping raw token strings out of the data model entirely.
"""
from __future__ import annotations

from typing import List, Optional, Dict, Any
from typing_extensions import TypedDict, Protocol, runtime_checkable

from planner_lib.domain.tasks import DomainTask, WriteResult
from planner_lib.domain.history import DomainHistoryEntry


# ---------------------------------------------------------------------------
# Credential types
# ---------------------------------------------------------------------------

class BackendCredential(TypedDict):
    """An opaque credential token scoped to one user session.

    token   — PAT or other backend auth token (never logged)
    user_id — the session / user identifier; used for auditing only
    """
    token: str
    user_id: str


@runtime_checkable
class CredentialProvider(Protocol):
    """Retrieves a BackendCredential for a given user."""

    def get_credential(self, user_id: str) -> Optional[BackendCredential]:
        """Return a credential for *user_id*, or None if no PAT is stored."""
        ...


# ---------------------------------------------------------------------------
# BackendPort
# ---------------------------------------------------------------------------

@runtime_checkable
class BackendPort(Protocol):
    """The single interface every backend must implement.

    Design notes
    ------------
    * ``credential`` is *optional* on read methods: a cache-backed wrapper
      (CachingBackend) can satisfy a read from its hot/disk cache without
      any credential.  If the cache is cold AND no credential is provided
      the implementation MUST raise ``PermissionError``.
    * Write / refresh methods always require a credential; implementations
      should raise ``PermissionError`` when it is absent.
    * All implementations return *enriched* domain dicts (DomainTask).
      Backends that wrap raw ADO APIs apply the AzureAdapter translation
      internally before returning.
    """

    def fetch_tasks(
        self,
        area_path: str,
        task_types: Optional[List[str]] = None,
        include_states: Optional[List[str]] = None,
        credential: Optional[BackendCredential] = None,
    ) -> List[DomainTask]:
        """Return enriched DomainTask list for *area_path*.

        Cache-backed implementations return from cache when available
        (credential not needed).  On a cache miss a credential IS required;
        raise ``PermissionError`` when it is absent.
        """
        ...

    def write_task(
        self,
        task_id: int,
        updates: Dict[str, Any],
        credential: BackendCredential,
    ) -> WriteResult:
        """Persist *updates* for *task_id* to the backend.

        Always requires a credential.  Returns a WriteResult dict with
        ``ok``, ``updated``, and ``errors`` keys.
        """
        ...

    def fetch_history(
        self,
        work_item_id: int,
        credential: Optional[BackendCredential] = None,
    ) -> List[DomainHistoryEntry]:
        """Return field-change history for *work_item_id* as DomainHistoryEntry list.

        Implementations may cache history entries.  A credential is required
        only when a live backend call is needed (cold cache).
        """
        ...

    def fetch_teams(
        self,
        project: str,
        credential: Optional[BackendCredential] = None,
    ) -> List[Dict[str, Any]]:
        """Return teams for *project* as a list of ``{id, name}`` dicts."""
        ...

    def fetch_plans(
        self,
        project: str,
        credential: Optional[BackendCredential] = None,
    ) -> List[Dict[str, Any]]:
        """Return delivery plans for *project* as a list of ``{id, name, teams}`` dicts."""
        ...

    def fetch_markers(
        self,
        area_path: str,
        credential: Optional[BackendCredential] = None,
    ) -> List[Dict[str, Any]]:
        """Return delivery-plan markers for *area_path*."""
        ...

    def fetch_iterations(
        self,
        project: str,
        root_paths: Optional[List[str]] = None,
        credential: Optional[BackendCredential] = None,
    ) -> Dict[str, Any]:
        """Return iteration metadata keyed by normalised iteration path.

        Returns a dict mapping iteration_path → ``{startDate, finishDate, name}``.
        """
        ...

    def invalidate_cache(self) -> Dict[str, Any]:
        """Invalidate all cached data; force fresh fetch on next read.

        Returns a summary dict.  No-op for backends without a cache.
        """
        ...
