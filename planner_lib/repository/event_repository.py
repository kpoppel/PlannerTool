"""EventRepository: single authoritative source for plan-scoped events.

Delegates all persistence to an EventBackend implementation.  The default
implementation is ``UserDataBackend`` (diskcache-backed); an alternative
``AzureWikiEventBackend`` can be configured in ``config::event_config`` to
persist events as a structured ADO wiki page.

When a credential-aware backend is active (ADO wiki), the repository
gets a ``BackendCredential`` from ``credential_provider`` using the
caller-supplied ``user_id`` and forwards it to every backend call.
For the diskcache backend the credential is always ``None`` and is silently
ignored.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from planner_lib.backend.port import BackendCredential

logger = logging.getLogger(__name__)


class EventRepository:
    """Repository for plan-scoped events.

    Parameters
    ----------
    backend:
        EventBackend implementation.
    credential_provider:
        Optional CredentialProvider used when the active backend is
        credential-aware (e.g. AzureWikiEventBackend).  Pass ``None`` for
        the default diskcache-backed backend.
    """

    def __init__(self, backend, credential_provider=None) -> None:
        self._backend = backend
        self._credential_provider = credential_provider
        logger.info(
            "EventRepository: initialised (backend=%s)",
            type(backend).__name__,
        )

    def _get_credential(self, user_id: Optional[str]) -> Optional[BackendCredential]:
        if not self._credential_provider or not user_id:
            return None
        return self._credential_provider.get_credential(user_id)

    def list_events(
        self,
        plan_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Return all events, optionally filtered by *plan_id*."""
        return self._backend.fetch_events(
            plan_id=plan_id,
            credential=self._get_credential(user_id),
        )

    def get_event(
        self,
        event_id: str,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Return a single event (raises KeyError when not found)."""
        return self._backend.fetch_event(
            event_id,
            credential=self._get_credential(user_id),
        )

    def create_event(
        self,
        date: str,
        title: str,
        plan_id: str,
        category: str = '',
        end_date: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a new event and return it (including generated id)."""
        return self._backend.create_event(
            date=date,
            title=title,
            plan_id=plan_id,
            category=category,
            end_date=end_date,
            credential=self._get_credential(user_id),
        )

    def update_event(
        self,
        event_id: str,
        date: Optional[str] = None,
        title: Optional[str] = None,
        plan_id: Optional[str] = None,
        category: Optional[str] = None,
        end_date: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Update fields on an existing event (raises KeyError when not found)."""
        return self._backend.update_event(
            event_id=event_id,
            date=date,
            title=title,
            plan_id=plan_id,
            category=category,
            end_date=end_date,
            credential=self._get_credential(user_id),
        )

    def delete_event(
        self,
        event_id: str,
        user_id: Optional[str] = None,
    ) -> bool:
        """Delete an event. Returns True when found and deleted."""
        return self._backend.delete_event(
            event_id,
            credential=self._get_credential(user_id),
        )

    def list_categories(
        self,
        user_id: Optional[str] = None,
    ) -> list:
        """Return all event categories."""
        return self._backend.fetch_categories(credential=self._get_credential(user_id))

    def create_category(
        self,
        name: str,
        is_special: bool = False,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a new event category and return it."""
        return self._backend.create_category(
            name=name,
            is_special=is_special,
            credential=self._get_credential(user_id),
        )

    def update_category(
        self,
        category_id: str,
        name: Optional[str] = None,
        is_special: Optional[bool] = None,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Update fields on an existing category (raises KeyError when not found)."""
        return self._backend.update_category(
            category_id=category_id,
            name=name,
            is_special=is_special,
            credential=self._get_credential(user_id),
        )

    def delete_category(
        self,
        category_id: str,
        user_id: Optional[str] = None,
    ) -> bool:
        """Delete a category. Returns True when found and deleted."""
        return self._backend.delete_category(
            category_id,
            credential=self._get_credential(user_id),
        )
