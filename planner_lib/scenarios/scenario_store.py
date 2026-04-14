"""Scenario storage — delegates to the generic UserDataStore."""
from typing import Any, Dict, List

from planner_lib.storage.base import StorageBackend
from planner_lib.storage.user_store import UserDataStore

SCENARIO_NS = "scenarios"
REGISTER_KEY = "scenario_register"
LOCK_FILE = "scenario_register.lock"


def _scenario_key(user_id: str, scenario_id: str) -> str:
    """Return the storage key for a scenario (matches UserDataStore._item_key)."""
    return f'{user_id}_{scenario_id}'


def _store(storage: StorageBackend) -> UserDataStore:
    return UserDataStore(SCENARIO_NS, REGISTER_KEY, LOCK_FILE, storage)


def load_scenario_register(storage: StorageBackend) -> Dict[str, Dict[str, Any]]:
    return _store(storage).load_register()


def save_scenario_register(storage: StorageBackend, register: Dict[str, Dict[str, Any]]) -> None:
    _store(storage).save_register(register)


def save_user_scenario(storage: StorageBackend, user_id: str, scenario_id: str | None, data: Any) -> Dict[str, Any]:
    return _store(storage).save_item(user_id, scenario_id, data, extra_meta={'shared': False})


def load_user_scenario(storage: StorageBackend, user_id: str, scenario_id: str) -> Any:
    return _store(storage).load_item(user_id, scenario_id)


def delete_user_scenario(storage: StorageBackend, user_id: str, scenario_id: str) -> bool:
    return _store(storage).delete_item(user_id, scenario_id)


def list_user_scenarios(storage: StorageBackend, user_id: str) -> List[Dict[str, Any]]:
    return _store(storage).list_items_for_user(user_id)
