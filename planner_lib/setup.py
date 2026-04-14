"""Server setup helper for PlannerTool.

Provides CLI parsing for initial setup and helpers to create a server
configuration template. The module intentionally contains only CLI and
I/O logic; storage interaction is delegated to callers.
"""
from __future__ import annotations
from typing import Iterable, Optional
from dataclasses import dataclass, asdict
from typing import Dict, List, Any
from planner_lib.storage.base import StorageBackend

DEFAULT_AREA_PATH = '/'
DEFAULT_AZURE_ORG = "YOUR_ORG_HERE"

def setup(argv: Optional[Iterable[str]], storage: StorageBackend, namespace: str, key: str) -> int:
    """High-level helper used by the application entrypoint.

    - Parses `--setup` and `--print-template` from `argv`.
    - If the config exists in `storage` it is loaded into module state and returns 0.
    - If the config is missing, runs the interactive setup flow which should
      write the template/config into `storage`. After interactive setup
      completes, `setup` attempts to load the config and return 0 on success.
    - Returns non-zero on error.
    """
    store = storage

    # If the config already exists, return immediately.
    try:
        store.load('config', key)
        return 0
    except Exception:
        # missing or malformed -> proceed to interactive setup
        pass
    print(
        "Server configuration missing. Run: `python3 planner.py --setup` to create the configuration template."
    )
    return 2

@dataclass
class BackendConfig:
    azure_devops_organization: str
    area_paths: List[str]
    project_map: List[Dict[str, str]]
    teams: List[Dict[str, str]]
    feature_flags: Dict[str, Any]
    data_dir: str
