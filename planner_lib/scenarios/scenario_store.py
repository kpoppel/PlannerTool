"""Scenario storage — delegates to the generic UserDataStore."""
from typing import Any, Dict, List

from planner_lib.storage.base import StorageBackend
from planner_lib.storage.user_store import UserDataStore
from planner_lib.domain.scenarios import scenario_access

SCENARIO_NS = "scenarios"
REGISTER_KEY = "scenario_register"
LOCK_FILE = "scenario_register.lock"


def _normalize_scenario_data(data: Any) -> Any:
    """Ensure a scenario payload matches the canonical contract expected by the app."""
    if not isinstance(data, dict):
        return data

    normalized = dict(data)
    for field, default in {
        'overrides': {},
        'filters': {},
        'view': {},
        'groupOverrides': {},
        'scenarioGroups': [],
        'pluginData': {},
    }.items():
        value = normalized.get(field)
        if field in ('overrides', 'filters', 'view', 'groupOverrides', 'pluginData'):
            if not isinstance(value, dict):
                normalized[field] = {} if default == {} else default
        elif field == 'scenarioGroups':
            if not isinstance(value, list):
                normalized[field] = []

    return normalized


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
    with storage.transaction():
        _assert_writable(storage, user_id, scenario_id)
        normalized = _normalize_scenario_data(data)
        normalized = {key: value for key, value in normalized.items()
                      if key not in {'access', 'user', 'owner_id'}}
        meta = _store(storage).save_item(user_id, scenario_id, normalized, extra_meta={'shared': False})
        return {**meta, 'access': scenario_access(user_id, user_id, meta['id'], bool(normalized.get('readonly')))}


def _assert_writable(storage: StorageBackend, user_id: str, scenario_id: str | None) -> None:
    if scenario_id == 'baseline':
        raise PermissionError('The baseline scenario is read-only')
    if scenario_id is not None and storage.exists(SCENARIO_NS, _scenario_key(user_id, scenario_id)):
        stored = storage.load(SCENARIO_NS, _scenario_key(user_id, scenario_id))
        if stored.get('readonly'):
            raise PermissionError('Scenario is read-only')


def load_user_scenario(storage: StorageBackend, user_id: str, scenario_id: str) -> Any:
    payload = _store(storage).load_item(user_id, scenario_id)
    normalized = _normalize_scenario_data(payload)
    normalized['access'] = scenario_access(user_id, user_id, scenario_id, bool(normalized.get('readonly')))
    return normalized


def delete_user_scenario(storage: StorageBackend, user_id: str, scenario_id: str) -> bool:
    with storage.transaction():
        _assert_writable(storage, user_id, scenario_id)
        return _store(storage).delete_item(user_id, scenario_id)


def list_user_scenarios(storage: StorageBackend, user_id: str) -> List[Dict[str, Any]]:
    return [{**meta, 'access': load_user_scenario(storage, user_id, meta['id'])['access']}
            for meta in _store(storage).list_items_for_user(user_id)]
