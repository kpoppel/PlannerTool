"""Event storage for PlannerTool.

Events are application-global (not user-scoped) objects with:
  - id:      unique hex identifier (generated on creation)
  - date:    ISO-8601 date string (YYYY-MM-DD)
  - title:   human-readable label
  - plan_id: the PlannerTool plan identifier this event is linked to

All events are persisted in a single register dict under the
``'events'`` namespace so they survive restarts and survive across
sessions.  A process-level file lock guards concurrent writes.
"""
from __future__ import annotations

import os
import uuid
from contextlib import contextmanager
from typing import Any, Dict, List, Optional

from planner_lib.storage.base import StorageBackend

EVENTS_NS = "events"
REGISTER_KEY = "event_register"
LOCK_FILE = "event_register.lock"


@contextmanager
def _register_lock(data_dir: str = "data"):
    base_dir = os.path.join(data_dir, EVENTS_NS)
    os.makedirs(base_dir, exist_ok=True)
    lock_path = os.path.join(base_dir, LOCK_FILE)
    f = open(lock_path, "a+")
    try:
        try:
            import fcntl
            fcntl.flock(f, fcntl.LOCK_EX)
        except Exception:
            pass
        yield
    finally:
        try:
            import fcntl
            fcntl.flock(f, fcntl.LOCK_UN)
        except Exception:
            pass
        f.close()


def _load_register(storage: StorageBackend) -> Dict[str, Any]:
    try:
        return storage.load(EVENTS_NS, REGISTER_KEY) or {}
    except KeyError:
        return {}


def _save_register(storage: StorageBackend, register: Dict[str, Any]) -> None:
    storage.save(EVENTS_NS, REGISTER_KEY, register)


# ---------------------------------------------------------------------------
# Public CRUD API
# ---------------------------------------------------------------------------

def list_events(storage: StorageBackend, plan_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Return all events, optionally filtered by *plan_id*."""
    reg = _load_register(storage)
    events = list(reg.values())
    if plan_id is not None:
        events = [e for e in events if e.get("plan_id") == plan_id]
    return events


def get_event(storage: StorageBackend, event_id: str) -> Dict[str, Any]:
    """Return a single event by *event_id*; raises ``KeyError`` if not found."""
    reg = _load_register(storage)
    if event_id not in reg:
        raise KeyError(event_id)
    return reg[event_id]


def create_event(
    storage: StorageBackend,
    date: str,
    title: str,
    plan_id: str,
) -> Dict[str, Any]:
    """Create a new event and return it (including generated ``id``)."""
    event_id = uuid.uuid4().hex
    event: Dict[str, Any] = {
        "id": event_id,
        "date": date,
        "title": title,
        "plan_id": plan_id,
    }
    with _register_lock():
        reg = _load_register(storage)
        reg[event_id] = event
        _save_register(storage, reg)
    return event


def update_event(
    storage: StorageBackend,
    event_id: str,
    date: Optional[str] = None,
    title: Optional[str] = None,
    plan_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Update fields on an existing event; raises ``KeyError`` if not found."""
    with _register_lock():
        reg = _load_register(storage)
        if event_id not in reg:
            raise KeyError(event_id)
        event = reg[event_id]
        if date is not None:
            event["date"] = date
        if title is not None:
            event["title"] = title
        if plan_id is not None:
            event["plan_id"] = plan_id
        reg[event_id] = event
        _save_register(storage, reg)
    return event


def delete_event(storage: StorageBackend, event_id: str) -> bool:
    """Delete an event; returns ``True`` on success, ``False`` if not found."""
    with _register_lock():
        reg = _load_register(storage)
        if event_id not in reg:
            return False
        del reg[event_id]
        _save_register(storage, reg)
    return True
