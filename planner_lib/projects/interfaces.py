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

    def allocation_token_to_id(self, token: str, cfg: dict) -> Optional[str]: ...

    def id_to_allocation_token(self, team_id: str, cfg: dict) -> Optional[str]: ...


@runtime_checkable
class CapacityServiceProtocol(Protocol):
    """Protocol for `CapacityService` public surface."""

    def parse(self, description: str) -> List[dict]: ...

    def serialize(self, capacity_list: List[dict], cfg: dict) -> str: ...

    def update_description(self, description: str, capacity_list: List[dict], cfg: dict) -> str: ...
