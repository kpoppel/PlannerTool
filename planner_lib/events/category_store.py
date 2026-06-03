"""Category storage for PlannerTool events.

Categories are application-global objects with:
  - id:         unique hex identifier (generated on creation)
  - name:       human-readable label
  - is_special: bool — exactly one category may carry this flag; those events
                are rendered with a distinguishing border on the timeline.

All categories are persisted under the ``'events'`` namespace (same as events)
with a separate key so no migration is required.
"""
from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from planner_lib.storage.base import StorageBackend

EVENTS_NS = "events"
CATEGORY_REGISTER_KEY = "category_register"


def _load_register(storage: StorageBackend) -> Dict[str, Any]:
    try:
        return storage.load(EVENTS_NS, CATEGORY_REGISTER_KEY) or {}
    except KeyError:
        return {}


def _save_register(storage: StorageBackend, register: Dict[str, Any]) -> None:
    storage.save(EVENTS_NS, CATEGORY_REGISTER_KEY, register)


# ---------------------------------------------------------------------------
# Public CRUD API
# ---------------------------------------------------------------------------

def list_categories(storage: StorageBackend) -> List[Dict[str, Any]]:
    """Return all categories in insertion order."""
    return list(_load_register(storage).values())


def get_category(storage: StorageBackend, category_id: str) -> Dict[str, Any]:
    """Return a single category; raises ``KeyError`` if not found."""
    reg = _load_register(storage)
    if category_id not in reg:
        raise KeyError(category_id)
    return reg[category_id]


def create_category(
    storage: StorageBackend,
    name: str,
    is_special: bool = False,
) -> Dict[str, Any]:
    """Create a new category and return it (including generated ``id``).

    When *is_special* is ``True`` the flag is cleared on all existing categories
    first so that at most one is ever special.
    """
    reg = _load_register(storage)
    if is_special:
        for cat in reg.values():
            cat["is_special"] = False
    category_id = uuid.uuid4().hex
    category: Dict[str, Any] = {
        "id": category_id,
        "name": name,
        "is_special": is_special,
    }
    reg[category_id] = category
    _save_register(storage, reg)
    return category


def update_category(
    storage: StorageBackend,
    category_id: str,
    name: Optional[str] = None,
    is_special: Optional[bool] = None,
) -> Dict[str, Any]:
    """Update fields on an existing category; raises ``KeyError`` if not found.

    Setting *is_special* to ``True`` clears the flag on all other categories.
    """
    reg = _load_register(storage)
    if category_id not in reg:
        raise KeyError(category_id)
    if is_special is True:
        for cat in reg.values():
            cat["is_special"] = False
    category = reg[category_id]
    if name is not None:
        category["name"] = name
    if is_special is not None:
        category["is_special"] = is_special
    reg[category_id] = category
    _save_register(storage, reg)
    return category


def delete_category(storage: StorageBackend, category_id: str) -> bool:
    """Delete a category; returns ``True`` on success, ``False`` if not found."""
    reg = _load_register(storage)
    if category_id not in reg:
        return False
    del reg[category_id]
    _save_register(storage, reg)
    return True
