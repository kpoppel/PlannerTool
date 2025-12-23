from __future__ import annotations
from typing import List, Optional
from abc import ABC, abstractmethod

# Base Azure client class
class AzureClient(ABC):
    def __init__(self, organization_url: str, pat: str):
        pass

    @abstractmethod
    def get_work_items(self, area_path: str) -> List[dict]:
        return []

    @abstractmethod
    def get_projects(self) -> List[str]:
        return []

    @abstractmethod
    def get_area_paths(self, project: str, root_path: str = '/') -> List[str]:
        return []