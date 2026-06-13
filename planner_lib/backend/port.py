"""Backend protocols and credential types.

Each data domain is defined by its own ``@runtime_checkable`` Protocol.
Backends only implement the protocols for the domains they own — empty stub
methods are never required.

Focused protocols
-----------------
  TaskBackend            — fetch_tasks, write_task, invalidate_cache
  HistoryBackend         — fetch_history
  TeamsBackend           — fetch_teams
  PlansBackend           — fetch_plans, fetch_markers
  IterationsBackend      — fetch_iterations
  PeopleBackend          — fetch_people
  ProjectConfigBackend   — fetch_projects, fetch_project_map
  TeamConfigBackend      — fetch_config_teams
  IterationConfigBackend — fetch_iterations_config
  PlanConfigBackend      — fetch_area_plan_map
  AdoConfigBackend       — fetch_ado_config, save_ado_config
  EventConfigBackend     — fetch_event_config, save_event_config
  ScenarioBackend        — fetch_scenarios, fetch_scenario, save_scenario, delete_scenario
  ViewBackend            — fetch_views, fetch_view, save_view, delete_view
  EventBackend           — fetch_events, fetch_event, create_event, update_event, delete_event
                           (all methods accept an optional credential kwarg; the diskcache
                           UserDataBackend ignores it; AzureWikiEventBackend requires it)

BackendPort (composite)
-----------------------
  Alias for the full remote-data contract (TaskBackend + HistoryBackend +
  TeamsBackend + PlansBackend + IterationsBackend).  Used by ADO-family
  and mock backends.  Does NOT include PeopleBackend — people data lives
  in local config, not in the remote work-item system.

DI keys
-------
  ``backend``           → BackendPort implementation (AzureDevOpsBackend,
                           MockFixtureBackend, StaticBackend, …).
  ``config_backend``    → ConfigBackend backed by diskcache.  Implements
                           PeopleBackend (via optional yaml_storage),
                           ProjectConfigBackend, TeamConfigBackend,
                           IterationConfigBackend, PlanConfigBackend,
                           AdoConfigBackend.
  ``user_data_backend`` → UserDataBackend backed by diskcache.  Implements
                           ScenarioBackend, ViewBackend, EventBackend.

Adding a new domain
-------------------
1. Define a new focused Protocol here (e.g. ``BudgetBackend``).
2. Implement it in the backend(s) that own that data.
3. Add the method to every *other* backend's ``fetch_*`` default — or simply
   don't: ``CachingBackend`` only intercepts methods that the inner backend
   actually has (checked via ``hasattr``), so unknown methods fail fast with
   ``AttributeError`` rather than silently returning empty data.
4. Register a new DI key (e.g. ``budget_backend``) and create a
   ``BudgetRepository`` that depends on it.

Adding a new external-data backend (e.g. Jira)
-----------------------------------------------
1. Create a new backend class implementing BackendPort.
2. Define its config under ``AdoConfigBackend`` by analogy — or add a new
   protocol (e.g. ``JiraConfigBackend``) and implement it in ConfigBackend.
3. Return its config schema from ``config_schema()``.
4. Register in ``BackendRegistry._priority_backends()``.

Credential handling
-------------------
Operations that require a live backend call receive a BackendCredential.
Cache-satisfied reads never need one.  Local-config backends (people, etc.)
never require a credential at all.
"""
from __future__ import annotations

from typing import List, Optional, Dict, Any
from typing_extensions import TypedDict, Protocol, runtime_checkable

from planner_lib.domain.tasks import DomainTask, WriteResult
from planner_lib.domain.history import DomainHistoryEntry
from planner_lib.domain.people import DomainPerson
from planner_lib.domain.projects import DomainProject
from planner_lib.domain.teams import DomainTeam
from planner_lib.domain.scenarios import DomainScenario
from planner_lib.domain.views import DomainView


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
# Focused single-domain protocols
# ---------------------------------------------------------------------------

@runtime_checkable
class TaskBackend(Protocol):
    """Backend that can read and write work items (tasks)."""

    def fetch_tasks(
        self,
        area_path: str,
        task_types: Optional[List[str]] = None,
        include_states: Optional[List[str]] = None,
        credential: Optional[BackendCredential] = None,
    ) -> List[DomainTask]: ...

    def write_task(
        self,
        task_id: int,
        updates: Dict[str, Any],
        credential: BackendCredential,
    ) -> WriteResult: ...

    def invalidate_cache(self) -> Dict[str, Any]: ...


@runtime_checkable
class HistoryBackend(Protocol):
    """Backend that can read work-item revision history."""

    def fetch_history(
        self,
        work_item_id: int,
        credential: Optional[BackendCredential] = None,
    ) -> List[DomainHistoryEntry]: ...


@runtime_checkable
class TeamsBackend(Protocol):
    """Backend that can read team definitions from the remote system."""

    def fetch_teams(
        self,
        project: str,
        credential: Optional[BackendCredential] = None,
    ) -> List[Dict[str, Any]]: ...


@runtime_checkable
class PlansBackend(Protocol):
    """Backend that can read delivery plans and their timeline markers."""

    def fetch_plans(
        self,
        project: str,
        credential: Optional[BackendCredential] = None,
    ) -> List[Dict[str, Any]]: ...

    def fetch_markers(
        self,
        area_path: str,
        plan_id: Optional[str] = None,
        credential: Optional[BackendCredential] = None,
    ) -> List[Dict[str, Any]]: ...


@runtime_checkable
class IterationsBackend(Protocol):
    """Backend that can read sprint / iteration data."""

    def fetch_iterations(
        self,
        project: str,
        root_paths: Optional[List[str]] = None,
        credential: Optional[BackendCredential] = None,
    ) -> Dict[str, Any]: ...


@runtime_checkable
class PeopleBackend(Protocol):
    """Backend that can read people / team-member records.

    Implemented by LocalConfigBackend (reads from people.yml).
    Remote work-item backends (ADO, Jira, mock) do NOT implement this —
    people data is not stored in a remote work-item system.
    """

    def fetch_people(
        self,
        credential: Optional[BackendCredential] = None,
    ) -> List[DomainPerson]: ...


@runtime_checkable
class ProjectConfigBackend(Protocol):
    """Backend that serves locally-configured project definitions."""

    def fetch_projects(
        self,
        credential: Optional[BackendCredential] = None,
    ) -> List[DomainProject]: ...

    def fetch_project_map(
        self,
        credential: Optional[BackendCredential] = None,
    ) -> List[dict]: ...


@runtime_checkable
class TeamConfigBackend(Protocol):
    """Backend that serves locally-configured team definitions."""

    def fetch_config_teams(
        self,
        credential: Optional[BackendCredential] = None,
    ) -> List[DomainTeam]: ...


@runtime_checkable
class IterationConfigBackend(Protocol):
    """Backend that serves the local iterations.yml config dict."""

    def fetch_iterations_config(
        self,
        credential: Optional[BackendCredential] = None,
    ) -> dict: ...


@runtime_checkable
class PlanConfigBackend(Protocol):
    """Backend that serves the local area_plan_map config dict."""

    def fetch_area_plan_map(
        self,
        credential: Optional[BackendCredential] = None,
    ) -> dict: ...


@runtime_checkable
class AdoConfigBackend(Protocol):
    """Backend that stores and retrieves ADO-specific configuration.

    The ADO config (``organization_url`` + ADO-specific feature flags) lives
    in the ``config::ado_config`` diskcache key — separate from
    ``server_config.yml`` which holds generic server settings only.

    This protocol lets the admin layer treat ADO configuration like any other
    config domain, and enables future backends (Jira, etc.) to register their
    own analogous config protocol independently.
    """

    def fetch_ado_config(self) -> dict: ...

    def save_ado_config(self, content: dict) -> None: ...


@runtime_checkable
class ScenarioBackend(Protocol):
    """Backend that persists user-scoped scenarios."""

    def fetch_scenarios(
        self,
        user_id: str,
    ) -> List[DomainScenario]: ...

    def fetch_scenario(
        self,
        user_id: str,
        scenario_id: str,
    ) -> DomainScenario: ...

    def save_scenario(
        self,
        user_id: str,
        scenario_id: Optional[str],
        data: dict,
    ) -> DomainScenario: ...

    def delete_scenario(
        self,
        user_id: str,
        scenario_id: str,
    ) -> bool: ...


@runtime_checkable
class ViewBackend(Protocol):
    """Backend that persists user-scoped UI views."""

    def fetch_views(
        self,
        user_id: str,
    ) -> List[DomainView]: ...

    def fetch_view(
        self,
        user_id: str,
        view_id: str,
    ) -> DomainView: ...

    def save_view(
        self,
        user_id: str,
        view_id: Optional[str],
        data: dict,
    ) -> DomainView: ...

    def delete_view(
        self,
        user_id: str,
        view_id: str,
    ) -> bool: ...


@runtime_checkable
@runtime_checkable
class EventConfigBackend(Protocol):
    """Backend that stores and retrieves event-backend configuration.

    The event config (``backend`` selector + per-backend settings) lives in
    the ``config::event_config`` diskcache key.  It is a peer of
    ``AdoConfigBackend``: both are implemented by ``ConfigBackend``.
    """

    def fetch_event_config(self) -> dict: ...

    def save_event_config(self, content: dict) -> None: ...


@runtime_checkable
class GroupsConfigBackend(Protocol):
    """Backend that stores and retrieves groups-backend configuration.

    The groups config (``groups_backend`` selector + per-backend settings)
    lives in the ``config::groups_config`` diskcache key.  Currently only
    ``groups_backend: "local"`` is supported; a future ``ado_field`` option
    will read group definitions from a custom ADO work-item field.
    """

    def fetch_groups_config(self) -> dict: ...

    def save_groups_config(self, content: dict) -> None: ...


@runtime_checkable
class EventBackend(Protocol):
    """Backend that persists plan-scoped events (application-global, not user-scoped).

    All methods accept an optional *credential* keyword argument.  The
    diskcache implementation (``UserDataBackend``) ignores it; the ADO wiki
    implementation (``AzureWikiEventBackend``) requires a non-None credential
    and raises ``PermissionError`` when it is absent.
    """

    def fetch_events(
        self,
        plan_id: Optional[str] = None,
        credential: Optional[BackendCredential] = None,
    ) -> List[Dict[str, Any]]: ...

    def fetch_event(
        self,
        event_id: str,
        credential: Optional[BackendCredential] = None,
    ) -> Dict[str, Any]: ...

    def create_event(
        self,
        date: str,
        title: str,
        plan_id: str,
        category: str = '',
        end_date: Optional[str] = None,
        credential: Optional[BackendCredential] = None,
    ) -> Dict[str, Any]: ...

    def update_event(
        self,
        event_id: str,
        date: Optional[str] = None,
        title: Optional[str] = None,
        plan_id: Optional[str] = None,
        category: Optional[str] = None,
        end_date: Optional[str] = None,
        credential: Optional[BackendCredential] = None,
    ) -> Dict[str, Any]: ...

    def delete_event(
        self,
        event_id: str,
        credential: Optional[BackendCredential] = None,
    ) -> bool: ...

    def fetch_categories(
        self,
        credential: Optional[BackendCredential] = None,
    ) -> List[Dict[str, Any]]: ...

    def create_category(
        self,
        name: str,
        is_special: bool = False,
        credential: Optional[BackendCredential] = None,
    ) -> Dict[str, Any]: ...

    def update_category(
        self,
        category_id: str,
        name: Optional[str] = None,
        is_special: Optional[bool] = None,
        credential: Optional[BackendCredential] = None,
    ) -> Dict[str, Any]: ...

    def delete_category(
        self,
        category_id: str,
        credential: Optional[BackendCredential] = None,
    ) -> bool: ...


# ---------------------------------------------------------------------------
# BackendPort — composite remote-data contract
# ---------------------------------------------------------------------------

@runtime_checkable
class BackendPort(TaskBackend, HistoryBackend, TeamsBackend, PlansBackend, IterationsBackend, Protocol):
    """Full remote-data backend: owns tasks, history, teams, plans, iterations.

    ADO-family backends (AzureDevOpsBackend, MockFixtureBackend,
    MockGeneratorBackend) and self-contained demo backends (StaticBackend)
    implement this composite protocol.

    LocalConfigBackend does NOT implement BackendPort — it owns only the
    ``PeopleBackend`` domain.  CachingBackend transparently mirrors the
    capability of whichever inner backend it wraps, so:

      isinstance(CachingBackend(AzureDevOpsBackend(…)), BackendPort) → True
      isinstance(CachingBackend(LocalConfigBackend(…)), BackendPort)  → False
      isinstance(CachingBackend(LocalConfigBackend(…)), PeopleBackend) → True
    """
    ...
