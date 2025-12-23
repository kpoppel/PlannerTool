"""Caching variant for AzureClient.

This module exposes `AzureCachingClient` which currently inherits from
`AzureClient` and is a placeholder for future caching behaviour.
"""
from __future__ import annotations
from typing import List, Optional
from planner_lib.azure.AzureClient import AzureClient

import logging

logger = logging.getLogger(__name__)

class AzureCachingClient(AzureClient):
    """Placeholder caching client subclass.

    Caching behaviour will be implemented here later. For now it simply
    inherits from `AzureClient` so it behaves identically.
    """
    def __init__(self, organization_url: str, pat: str):
        super().__init__(organization_url, pat)
        logger.debug("Initialized AzureCachingClient (no caching behavior implemented yet)")

    def get_work_items(self, area_path: str) -> List[dict]:
        return []

    def get_projects(self) -> List[str]:
        return []

    def get_area_paths(self, project: str, root_path: str = '/') -> List[str]:
        return []        