"""ViewRepository: single authoritative source for user-saved UI views.

Delegates all persistence to LocalConfigBackend (``local_backend`` DI key)
so that view reads are covered by the TTL cache when caching is enabled.
Route handlers never touch views_storage directly.
"""
from __future__ import annotations

import logging
from typing import List, Optional

from planner_lib.domain.views import DomainView

logger = logging.getLogger(__name__)


class ViewRepository:
    """Repository for user-saved UI view configurations.

    Parameters
    ----------
    backend:
        ViewBackend implementation (``LocalConfigBackend``).
    """

    def __init__(self, backend) -> None:
        self._backend = backend
        logger.info("ViewRepository: initialised")

    def list_views(self, user_id: str) -> List[DomainView]:
        """Return all view metadata entries for *user_id*."""
        return self._backend.fetch_views(user_id)

    def get_view(self, user_id: str, view_id: str) -> DomainView:
        """Return a single view (raises KeyError when not found)."""
        return self._backend.fetch_view(user_id, view_id)

    def save_view(
        self,
        user_id: str,
        view_id: Optional[str],
        data: dict,
    ) -> DomainView:
        """Persist a view and return its metadata dict."""
        return self._backend.save_view(user_id, view_id, data)

    def delete_view(self, user_id: str, view_id: str) -> bool:
        """Delete a view. Returns True when found and deleted."""
        return self._backend.delete_view(user_id, view_id)
