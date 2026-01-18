from __future__ import annotations
from typing import List, Optional
from abc import ABC, abstractmethod

# Base Azure client class
class AzureClient(ABC):
    def __init__(self, organization_url: str, pat: str):
        # Store credentials; concrete classes should defer creating network
        # connections to `connect()` so callers can control lifecycle.
        self.organization_url = organization_url
        self.pat = pat
        self._connected = False
        self.conn = None

    @abstractmethod
    def get_work_items(self, area_path: str) -> List[dict]:
        return []

    @abstractmethod
    def get_projects(self) -> List[str]:
        return []

    @abstractmethod
    def get_area_paths(self, project: str, root_path: str = '/') -> List[str]:
        return []
    
    @abstractmethod
    def invalidate_work_items(self, work_item_ids: List[int]) -> None:
        """Invalidate cache for specific work items (no-op for non-caching clients)."""
        pass
    
    @abstractmethod
    def update_work_item_dates(self, work_item_id: int, start: Optional[str] = None, end: Optional[str] = None) -> None:
        pass
    
    @abstractmethod
    def update_work_item_description(self, work_item_id: int, description: str) -> None:
        pass

    # Lifecycle control to allow connect/disconnect outside __init__
    @abstractmethod
    def connect(self) -> None:
        """Establish any network connections or SDK clients required."""

    @abstractmethod
    def close(self) -> None:
        """Tear down connections and free resources."""