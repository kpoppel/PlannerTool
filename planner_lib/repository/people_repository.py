"""PeopleRepository: single authoritative source for people / team-member data.

Routes all reads through the injected BackendPort (``local_backend`` DI key),
which is typically a ``CachingBackend`` wrapping ``LocalConfigBackend``.
This gives people data the same two-tier (memory + disk) TTL cache as every
other domain model.
"""
from __future__ import annotations

import logging
from typing import List, Optional

from planner_lib.backend.port import PeopleBackend
from planner_lib.domain.people import DomainPerson

logger = logging.getLogger(__name__)


class PeopleRepository:
    """Repository for people / team-member data.

    Parameters
    ----------
    backend:
        A BackendPort implementation that owns ``fetch_people()``.
        In production this is ``CachingBackend(LocalConfigBackend(people_service))``,
        registered under the ``local_backend`` DI key.
    """

    def __init__(self, backend: PeopleBackend) -> None:
        self._backend = backend
        logger.info(
            "PeopleRepository: initialised (backend=%s)", type(backend).__name__
        )

    def list_people(self) -> List[DomainPerson]:
        """Return all people records (cached via the backend's TTL cache)."""
        return self._backend.fetch_people()

    def list_by_team(self, team_name: str) -> List[DomainPerson]:
        """Return people assigned to *team_name* (filter applied after fetch)."""
        return [p for p in self._backend.fetch_people()
                if p.get('team_name') == team_name]

    def reload(self) -> None:
        """Invalidate the backend's cache entry for people data.

        The next call to ``list_people()`` will re-read people.yml.
        """
        try:
            self._backend.invalidate_cache()
        except Exception as exc:
            logger.warning("PeopleRepository.reload: invalidate_cache failed: %s", exc)
