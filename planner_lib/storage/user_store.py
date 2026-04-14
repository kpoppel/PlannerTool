"""Generic user-scoped key/value store with a shared register.

Scenario and view data follow the same pattern: each item belongs to a user,
is stored under ``{user_id}_{item_id}`` in a given namespace, and is tracked
in a shared register dict for metadata queries.

``UserDataStore`` factors out that pattern so ``scenario_store.py`` and
``view_store.py`` delegate to it rather than duplicating the locking,
register, and CRUD code.
"""
from __future__ import annotations

import os
import uuid
from contextlib import contextmanager
from typing import Any, Dict, List, Optional

from planner_lib.storage.base import StorageBackend


class UserDataStore:
    """Generic CRUD store for user-scoped keyed items with a shared register.

    Args:
        namespace:    Storage namespace (e.g. ``"scenarios"``).
        register_key: Key under which the metadata register is persisted.
        lock_file:    Filename for the exclusive process-level lock.
        storage:      Storage backend instance.
    """

    def __init__(
        self,
        namespace: str,
        register_key: str,
        lock_file: str,
        storage: StorageBackend,
    ) -> None:
        self.namespace = namespace
        self.register_key = register_key
        self.lock_file = lock_file
        self._storage = storage

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _item_key(self, user_id: str, item_id: str) -> str:
        return f"{user_id}_{item_id}"

    @contextmanager
    def _register_lock(self):
        base_dir = os.path.join("data", self.namespace)
        os.makedirs(base_dir, exist_ok=True)
        lock_path = os.path.join(base_dir, self.lock_file)
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

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def load_register(self) -> Dict[str, Dict[str, Any]]:
        """Return the metadata register; empty dict when not yet created."""
        try:
            return self._storage.load(self.namespace, self.register_key) or {}
        except KeyError:
            return {}

    def save_register(self, register: Dict[str, Dict[str, Any]]) -> None:
        self._storage.save(self.namespace, self.register_key, register)

    def save_item(
        self,
        user_id: str,
        item_id: Optional[str],
        data: Any,
        extra_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Persist *data* for *user_id* and return the item metadata.

        When *item_id* is ``None`` a new UUID is generated.  *extra_meta* is
        merged into the base ``{id, user}`` meta dict so callers can attach
        namespace-specific fields (e.g. ``shared``, ``name``).
        """
        iid = item_id or uuid.uuid4().hex
        key = self._item_key(user_id, iid)
        self._storage.save(self.namespace, key, data)
        meta: Dict[str, Any] = {"id": iid, "user": user_id}
        if extra_meta:
            meta.update(extra_meta)
        with self._register_lock():
            reg = self.load_register()
            reg[key] = meta
            self.save_register(reg)
        return meta

    def load_item(self, user_id: str, item_id: str) -> Any:
        """Load and return the item data; raises ``KeyError`` if not found."""
        key = self._item_key(user_id, item_id)
        return self._storage.load(self.namespace, key)

    def delete_item(self, user_id: str, item_id: str) -> bool:
        """Delete an item and its register entry.

        Returns ``True`` on success, ``False`` if the item did not exist.
        """
        key = self._item_key(user_id, item_id)
        with self._register_lock():
            try:
                self._storage.delete(self.namespace, key)
            except (KeyError, FileNotFoundError):
                return False
            reg = self.load_register()
            if key in reg:
                del reg[key]
                self.save_register(reg)
        return True

    def list_items_for_user(self, user_id: str) -> List[Dict[str, Any]]:
        """Return all register entries belonging to *user_id*."""
        prefix = f"{user_id}_"
        reg = self.load_register()
        return [meta for key, meta in reg.items() if key.startswith(prefix)]
