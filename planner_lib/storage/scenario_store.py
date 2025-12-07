import os
import uuid
import pickle
from contextlib import contextmanager
from typing import Any, Dict, List

from planner_lib.storage.file_backend import FileStorageBackend

SCENARIO_NS = "scenarios"
REGISTER_KEY = "scenario_register"
LOCK_FILE = "scenario_register.lock"


def _scenario_key(user_id: str, scenario_id: str) -> str:
    return f"{user_id}_{scenario_id}"


def load_scenario_register(storage: FileStorageBackend) -> Dict[str, Dict[str, Any]]:
    try:
        return storage.load(SCENARIO_NS, REGISTER_KEY) or {}
    except KeyError:
        return {}


def save_scenario_register(storage: FileStorageBackend, register: Dict[str, Dict[str, Any]]) -> None:
    storage.save(SCENARIO_NS, REGISTER_KEY, register)


@contextmanager
def with_register_lock(storage: FileStorageBackend):
    # Create lock file path under data/scenarios (consistent with FileStorageBackend layout)
    # Avoid touching storage internals; compute path explicitly.
    base_dir = os.path.join("data", SCENARIO_NS)
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


def save_user_scenario(storage: FileStorageBackend, user_id: str, scenario_id: str | None, data: Any) -> Dict[str, Any]:
    sid = scenario_id or uuid.uuid4().hex
    key = _scenario_key(user_id, sid)
    storage.save(SCENARIO_NS, key, data)
    meta = {"id": sid, "user": user_id, "shared": False}
    with with_register_lock(storage):
        reg = load_scenario_register(storage)
        reg[key] = meta
        save_scenario_register(storage, reg)
    return meta


def load_user_scenario(storage: FileStorageBackend, user_id: str, scenario_id: str) -> Any:
    key = _scenario_key(user_id, scenario_id)
    return storage.load(SCENARIO_NS, key)


def delete_user_scenario(storage: FileStorageBackend, user_id: str, scenario_id: str) -> bool:
    key = _scenario_key(user_id, scenario_id)
    with with_register_lock(storage):
        try:
            storage.delete(SCENARIO_NS, key)
        except KeyError:
            return False
        reg = load_scenario_register(storage)
        if key in reg:
            del reg[key]
            save_scenario_register(storage, reg)
    return True


def list_user_scenarios(storage: FileStorageBackend, user_id: str) -> List[Dict[str, Any]]:
    reg = load_scenario_register(storage)
    return [meta for k, meta in reg.items() if meta.get("user") == user_id]
