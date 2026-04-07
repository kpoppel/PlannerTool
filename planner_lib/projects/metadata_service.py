"""Azure project metadata service — disk-backed cache for work-item metadata.

Caches work item types, states, states_by_type and state_categories keyed by
the Azure DevOps project name so the data survives server restarts and can be
shared across all admin operations that need type/state/category information.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)

_NAMESPACE = 'azure_project_metadata'


class AzureProjectMetadataService:
    """Persist Azure DevOps project-level work-item metadata using DiskCacheStorage.

    Cached shape per Azure project name:
        {
            "types": ["Bug", "Epic", "Feature", ...],
            "states": ["Active", "Closed", "New", ...],
            "states_by_type": {"Bug": ["Active", "Closed"], ...},
            "state_categories": {"Active": "InProgress", "Closed": "Completed", ...}
        }
    """

    def __init__(self, cache: Any) -> None:
        self._cache = cache

    def get_cached(self, azure_project: str) -> Optional[dict]:
        """Return cached metadata for an Azure project, or None if not present."""
        try:
            return self._cache.load(_NAMESPACE, azure_project)
        except KeyError:
            return None

    def store(self, azure_project: str, metadata: dict) -> None:
        """Persist metadata for an Azure project."""
        self._cache.save(_NAMESPACE, azure_project, metadata)

    def get_or_fetch(
        self,
        azure_project: str,
        area_path: str,
        pat: str,
        azure_svc: Any,
    ) -> dict:
        """Return cached metadata, fetching from Azure via area_path on a cache miss.

        The area path is used for team-aware metadata lookup which returns
        types, states and state_categories for that specific area / team.
        The result is stored under the Azure project name so subsequent
        lookups for any area path in the same project hit the cache.

        Args:
            azure_project: Azure DevOps project name (first segment of area_path).
            area_path:     Full area path used for the team-aware API lookup.
            pat:           Personal Access Token for Azure DevOps.
            azure_svc:     AzureService instance exposing a .connect(pat) context manager.
        """
        cached = self.get_cached(azure_project)
        if cached is not None:
            logger.debug("Metadata cache HIT for Azure project '%s'", azure_project)
            return cached

        logger.info(
            "Metadata cache MISS for Azure project '%s' — fetching from Azure "
            "(area_path='%s')",
            azure_project,
            area_path,
        )
        with azure_svc.connect(pat) as client:
            metadata = client.get_area_path_used_metadata(azure_project, area_path)
        self.store(azure_project, metadata)
        return metadata
