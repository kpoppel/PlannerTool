#!/usr/bin/env python3
"""One-time maintenance utility for scenario cleanup.

This script operates directly on the authoritative local storage namespace
("scenarios") and can:
1. Remove one specific scenario for a user (including stale register entries).
2. Remove all scenarios for a user.

Examples:
  python scripts/clear_scenarios.py --user kim.poulsen@wsa.com --scenario-id 0c713088f53942a8b30acf6bc5ec217e --yes
  python scripts/clear_scenarios.py --user kim.poulsen@wsa.com --all --yes
"""

from __future__ import annotations

import argparse
import json
from typing import Any

from planner_lib.storage import create_storage
from planner_lib.scenarios.scenario_store import (
    SCENARIO_NS,
    REGISTER_KEY,
    load_scenario_register,
    save_scenario_register,
)


def _scenario_key(user_id: str, scenario_id: str) -> str:
    return f"{user_id}_{scenario_id}"


def _safe_load(storage: Any, namespace: str, key: str) -> Any:
    try:
        return storage.load(namespace, key)
    except Exception:
        return None


def _is_target_payload(payload: Any, target_id: str) -> bool:
    if not isinstance(payload, dict):
        return False
    if str(payload.get("id", "")) == target_id:
        return True
    meta = payload.get("_meta")
    return isinstance(meta, dict) and str(meta.get("id", "")) == target_id


def _list_user_storage_keys(storage: Any, user_id: str) -> list[str]:
    prefix = f"{user_id}_"
    keys = []
    for key in storage.list_keys(SCENARIO_NS):
        if key == REGISTER_KEY:
            continue
        if key.startswith(prefix):
            keys.append(key)
    return keys


def _cleanup_one(storage: Any, user_id: str, scenario_id: str) -> dict[str, Any]:
    register = load_scenario_register(storage)
    expected_key = _scenario_key(user_id, scenario_id)

    keys_to_delete = set()

    # Exact key match in either storage/register.
    if expected_key in register or storage.exists(SCENARIO_NS, expected_key):
        keys_to_delete.add(expected_key)

    # Register entries that claim this scenario id for this user.
    for key, meta in register.items():
        if not key.startswith(f"{user_id}_"):
            continue
        if isinstance(meta, dict) and str(meta.get("id", "")) == scenario_id:
            keys_to_delete.add(key)

    # Storage entries for the user where payload id/_meta.id matches target id.
    for key in _list_user_storage_keys(storage, user_id):
        payload = _safe_load(storage, SCENARIO_NS, key)
        if _is_target_payload(payload, scenario_id):
            keys_to_delete.add(key)

    deleted_storage_keys = []
    for key in sorted(keys_to_delete):
        try:
            storage.delete(SCENARIO_NS, key)
            deleted_storage_keys.append(key)
        except Exception:
            # Already missing is fine for cleanup; register is still corrected.
            pass

    removed_register_keys = []
    for key in list(register.keys()):
        if key in keys_to_delete:
            register.pop(key, None)
            removed_register_keys.append(key)

    if removed_register_keys:
        save_scenario_register(storage, register)

    return {
        "mode": "single",
        "user": user_id,
        "scenarioId": scenario_id,
        "matchedKeys": sorted(keys_to_delete),
        "deletedStorageKeys": deleted_storage_keys,
        "removedRegisterKeys": removed_register_keys,
        "deleted": len(deleted_storage_keys) > 0 or len(removed_register_keys) > 0,
    }


def _cleanup_all_for_user(storage: Any, user_id: str) -> dict[str, Any]:
    register = load_scenario_register(storage)
    prefix = f"{user_id}_"

    register_keys = [key for key in register.keys() if key.startswith(prefix)]
    storage_keys = _list_user_storage_keys(storage, user_id)
    keys_to_delete = sorted(set(register_keys + storage_keys))

    deleted_storage_keys = []
    for key in keys_to_delete:
        try:
            storage.delete(SCENARIO_NS, key)
            deleted_storage_keys.append(key)
        except Exception:
            pass

    removed_register_keys = []
    for key in register_keys:
        if key in register:
            register.pop(key, None)
            removed_register_keys.append(key)

    if removed_register_keys:
        save_scenario_register(storage, register)

    return {
        "mode": "all",
        "user": user_id,
        "matchedKeys": keys_to_delete,
        "deletedStorageKeys": deleted_storage_keys,
        "removedRegisterKeys": removed_register_keys,
        "deleted": len(deleted_storage_keys) > 0 or len(removed_register_keys) > 0,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Clear scenarios from local storage")
    parser.add_argument("--user", required=True, help="User email / user id")
    parser.add_argument(
        "--scenario-id",
        help="Scenario id to remove (required unless --all is provided)",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Delete all scenarios for the user",
    )
    parser.add_argument(
        "--data-dir",
        default="data/cache",
        help="Storage data directory (default: data/cache)",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Required safety flag to perform deletion",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if not args.yes:
        print("Refusing to run without --yes")
        return 2

    if args.all and args.scenario_id:
        print("Use either --all or --scenario-id, not both")
        return 2

    if not args.all and not args.scenario_id:
        print("Provide --scenario-id, or use --all")
        return 2

    storage = create_storage(
        backend="diskcache",
        serializer="raw",
        data_dir=args.data_dir,
    )

    if args.all:
        result = _cleanup_all_for_user(storage, args.user)
    else:
        result = _cleanup_one(storage, args.user, args.scenario_id)

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
