"""EventRepository: single authoritative source for plan-scoped events.

Delegates all persistence to UserDataBackend (``user_data_backend`` DI key)
so that event reads/writes go through the same diskcache storage layer as
scenarios and views.  Route handlers never touch event storage directly.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class EventRepository:
    """Repository for plan-scoped events.

    Parameters
    ----------
    backend:
        EventBackend implementation (``UserDataBackend``).
    """

    def __init__(self, backend) -> None:
        self._backend = backend
        logger.info("EventRepository: initialised")

    def list_events(self, plan_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Return all events, optionally filtered by *plan_id*."""
        return self._backend.fetch_events(plan_id=plan_id)

    def get_event(self, event_id: str) -> Dict[str, Any]:
        """Return a single event (raises KeyError when not found)."""
        return self._backend.fetch_event(event_id)

    def create_event(self, date: str, title: str, plan_id: str) -> Dict[str, Any]:
        """Create a new event and return it (including generated id)."""
        return self._backend.create_event(date=date, title=title, plan_id=plan_id)

    def update_event(
        self,
        event_id: str,
        date: Optional[str] = None,
        title: Optional[str] = None,
        plan_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Update fields on an existing event (raises KeyError when not found)."""
        return self._backend.update_event(
            event_id=event_id, date=date, title=title, plan_id=plan_id
        )

    def delete_event(self, event_id: str) -> bool:
        """Delete an event. Returns True when found and deleted."""
        return self._backend.delete_event(event_id)
