from typing import Protocol, List, Optional, Any, runtime_checkable


@runtime_checkable
class ProjectServiceProtocol(Protocol):
    """Protocol for `ProjectService` public surface."""

    def list_projects(self) -> List[dict]: ...

    def get_project_map(self) -> List[dict]: ...


@runtime_checkable
class TeamServiceProtocol(Protocol):
    """Protocol for `TeamService` public surface."""

    def list_teams(self) -> List[dict]: ...

    def name_to_id(self, name: str, cfg: dict) -> Optional[str]: ...

    def id_to_short_name(self, team_id: str, cfg: dict) -> Optional[str]: ...


@runtime_checkable
class CapacityServiceProtocol(Protocol):
    """Protocol for `CapacityService` public surface."""

    def parse(self, description: str) -> List[dict]: ...

    def serialize(self, capacity_list: List[dict], cfg: dict) -> str: ...

    def update_description(self, description: str, capacity_list: List[dict], cfg: dict) -> str: ...


@runtime_checkable
class TaskServiceProtocol(Protocol):
    """Protocol for `TaskService` public surface."""

    def list_tasks(self, pat: str, project_id: Optional[str] = None) -> List[dict]: ...

    def update_tasks(self, updates: List[dict], pat: str) -> dict: ...
