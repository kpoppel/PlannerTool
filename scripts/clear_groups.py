#!/usr/bin/env python3
"""Clear all persisted groups from the diskcache storage.

Run from the repo root with the venv active:
    python scripts/clear_groups.py
"""
import sys
from pathlib import Path

# Allow importing planner_lib without installing the package
sys.path.insert(0, str(Path(__file__).parent.parent))

from planner_lib.storage import create_storage

CACHE_DIR = Path(__file__).parent.parent / "data" / "cache"
GROUPS_NS = "groups"
REGISTER_KEY = "group_register"

storage = create_storage(backend="diskcache", data_dir=str(CACHE_DIR))
storage.save(GROUPS_NS, REGISTER_KEY, {})
print(f"Groups register cleared (namespace='{GROUPS_NS}', key='{REGISTER_KEY}').")
