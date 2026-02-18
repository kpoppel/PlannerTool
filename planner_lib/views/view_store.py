"""
View storage module for persisting UI configurations.

Views capture the current state of selected projects, teams, and view options
(timeline scale, capacity mode, filters, etc.) allowing users to save and restore
different UI configurations.

Similar to scenarios, views are user-scoped and stored in a namespace with
a register for metadata tracking.
"""
import os
import uuid
from contextlib import contextmanager
from typing import Any, Dict, List

from planner_lib.storage.base import StorageBackend

VIEW_NS = "views"
REGISTER_KEY = "view_register"
LOCK_FILE = "view_register.lock"


def _view_key(user_id: str, view_id: str) -> str:
    """Generate storage key for a user's view"""
    return f"{user_id}_{view_id}"


def load_view_register(storage: StorageBackend) -> Dict[str, Dict[str, Any]]:
    """Load the view register containing metadata for all views"""
    try:
        return storage.load(VIEW_NS, REGISTER_KEY) or {}
    except KeyError:
        return {}


def save_view_register(storage: StorageBackend, register: Dict[str, Dict[str, Any]]) -> None:
    """Save the view register"""
    storage.save(VIEW_NS, REGISTER_KEY, register)


@contextmanager
def with_register_lock(storage: StorageBackend):
    """Context manager for locking the view register during updates"""
    # Create lock file path under data/views
    base_dir = os.path.join("data", VIEW_NS)
    os.makedirs(base_dir, exist_ok=True)
    lock_path = os.path.join(base_dir, LOCK_FILE)
    # Use simple exclusive lock via open + flock where available
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


def save_user_view(storage: StorageBackend, user_id: str, view_id: str | None, data: Any) -> Dict[str, Any]:
    """
    Save a user's view configuration.
    
    Args:
        storage: Storage backend
        user_id: User identifier (email)
        view_id: View ID (generates new UUID if None)
        data: View data including selected projects/teams and view options
        
    Returns:
        View metadata (id, user)
    """
    vid = view_id or uuid.uuid4().hex
    key = _view_key(user_id, vid)
    storage.save(VIEW_NS, key, data)
    meta = {"id": vid, "user": user_id, "name": data.get("name", "Unnamed View") if isinstance(data, dict) else "Unnamed View"}
    with with_register_lock(storage):
        reg = load_view_register(storage)
        reg[key] = meta
        save_view_register(storage, reg)
    return meta


def load_user_view(storage: StorageBackend, user_id: str, view_id: str) -> Any:
    """
    Load a user's view configuration.
    
    Args:
        storage: Storage backend
        user_id: User identifier (email)
        view_id: View ID
        
    Returns:
        View data
        
    Raises:
        KeyError: If view not found
    """
    key = _view_key(user_id, view_id)
    return storage.load(VIEW_NS, key)


def delete_user_view(storage: StorageBackend, user_id: str, view_id: str) -> bool:
    """
    Delete a user's view configuration.
    
    Args:
        storage: Storage backend
        user_id: User identifier (email)
        view_id: View ID
        
    Returns:
        True if deleted, False if not found
    """
    key = _view_key(user_id, view_id)
    with with_register_lock(storage):
        try:
            storage.delete(VIEW_NS, key)
        except KeyError:
            return False
        reg = load_view_register(storage)
        if key in reg:
            del reg[key]
            save_view_register(storage, reg)
    return True


def list_user_views(storage: StorageBackend, user_id: str) -> List[Dict[str, Any]]:
    """
    List all views for a user.
    
    Args:
        storage: Storage backend
        user_id: User identifier (email)
        
    Returns:
        List of view metadata (id, user, name)
    """
    reg = load_view_register(storage)
    prefix = f"{user_id}_"
    return [meta for key, meta in reg.items() if key.startswith(prefix)]
