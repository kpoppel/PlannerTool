"""Domain types for configured projects."""
from __future__ import annotations

from typing import Dict, List, Optional
from typing_extensions import TypedDict, Literal, NotRequired

# Azure DevOps state-category strings as used in the ADO metadata API.
StateCategory = Literal["Proposed", "InProgress", "Completed", "Resolved", "Removed"]


class DomainProject(TypedDict):
    """A project entry as defined in projects.yml."""
    id: str                                     # canonical UUID
    name: str                                   # display name
    type: str                                   # configured container type
    container_order: int                        # position in plan container hierarchy
    container_types: List[str]                  # full configured hierarchy, including unused levels
    area_path: Optional[str]                    # Azure DevOps area path
    task_types: List[str]                       # configured work item types
    closed_history_days: int
    work_item_display: List[dict]
    iteration_uuid: NotRequired[Optional[str]]  # associated iteration set id
    allocation_defaults: NotRequired[Dict[str, List[str]]]
    allocatable_ids: NotRequired[List[str]]
