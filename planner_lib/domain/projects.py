"""Domain types for configured projects."""
from __future__ import annotations

from typing import Dict, List, Optional
from typing_extensions import TypedDict, Literal

# Azure DevOps state-category strings as used in the ADO metadata API.
StateCategory = Literal["Proposed", "InProgress", "Completed", "Resolved", "Removed"]


class DomainProject(TypedDict):
    """A project entry as defined in projects.yml."""
    id: str                                     # slug e.g. 'project-my-team'
    name: str                                   # display name
    type: str                                   # 'project' or other configured type
    area_path: Optional[str]                    # Azure DevOps area path
    task_types: List[str]                       # configured work item types
    task_type_hierarchy: List[str]              # global hierarchy list
    state_display_sequence: List[str]           # global state ordering list
    display_states: List[str]
    state_categories: Dict[str, StateCategory]  # state name → ADO category
