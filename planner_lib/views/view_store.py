"""View storage — delegates to the generic UserDataStore."""
from typing import Any, Dict, List

from planner_lib.storage.base import StorageBackend
from planner_lib.storage.user_store import UserDataStore

VIEW_NS = "views"
REGISTER_KEY = "view_register"
LOCK_FILE = "view_register.lock"


def _store(storage: StorageBackend) -> UserDataStore:
    return UserDataStore(VIEW_NS, REGISTER_KEY, LOCK_FILE, storage)


def load_view_register(storage: StorageBackend) -> Dict[str, Dict[str, Any]]:
    return _store(storage).load_register()


def save_view_register(storage: StorageBackend, register: Dict[str, Dict[str, Any]]) -> None:
    _store(storage).save_register(register)


def save_user_view(storage: StorageBackend, user_id: str, view_id: str | None, data: Any) -> Dict[str, Any]:
    if not isinstance(data, dict):
        raise ValueError('View data must be an object')
    options = dict(data.get('viewOptions', {}))
    filters = dict(options.get('taskFilters', {}))
    schedule = dict(filters.get('schedule', {}))
    if 'packedModeUnplannedPreference' not in options:
        options['packedModeUnplannedPreference'] = schedule.get('unplanned', True)
    if type(options['packedModeUnplannedPreference']) is not bool:
        raise ValueError('packedModeUnplannedPreference must be a boolean')
    if options.get('displayMode') == 'packed':
        options['taskFilters'] = {**filters, 'schedule': {**schedule, 'unplanned': False}}
    data = {**data, 'viewOptions': options}
    name = data.get("name", "Unnamed View") if isinstance(data, dict) else "Unnamed View"
    return _store(storage).save_item(user_id, view_id, data, extra_meta={"name": name})


def load_user_view(storage: StorageBackend, user_id: str, view_id: str) -> Any:
    return _store(storage).load_item(user_id, view_id)


def delete_user_view(storage: StorageBackend, user_id: str, view_id: str) -> bool:
    return _store(storage).delete_item(user_id, view_id)


def list_user_views(storage: StorageBackend, user_id: str) -> List[Dict[str, Any]]:
    return _store(storage).list_items_for_user(user_id)
