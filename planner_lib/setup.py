"""Server setup helper for PlannerTool.

Provides CLI parsing for initial setup and helpers to create a server
configuration template. The module intentionally contains only CLI and
I/O logic; storage interaction is delegated to callers.
"""
from __future__ import annotations
import argparse
import sys
from typing import Iterable, Optional
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Dict, List, Any
import yaml

from planner_lib.storage.base import StorageBackend
from getpass import getpass


DEFAULT_AREA_PATH = '/'
DEFAULT_AZURE_ORG = "YOUR_ORG_HERE"

# Module-level place to hold the loaded BackendConfig instance after setup
_loaded_config: list[BackendConfig] = []

def get_loaded_config() -> Optional[BackendConfig]:
    """Return the loaded BackendConfig if available, otherwise None."""
    return _loaded_config[0] if _loaded_config else None

def has_feature_flag(flag: str) -> bool:
    """Return True if the loaded config has the given feature flag enabled."""
    cfg = get_loaded_config()
    if cfg and cfg.feature_flags:
        return bool(cfg.feature_flags.get(flag, False))
    return False

def get_property(prop: str) -> Any:
    """Return the value of a property from the loaded config, or None."""
    cfg = get_loaded_config()
    if cfg and hasattr(cfg, prop):
        return getattr(cfg, prop)
    return None

def get_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(add_help=False)
    # Basic control: allow explicit setup or printing template
    p.add_argument("--setup", action="store_true", help="Run initial setup interactively")
    p.add_argument("--print-template", action="store_true", help="Print the default YAML template to stdout and exit")
    p.add_argument("--help", action="store_true", help="Show setup help")
    return p


def parse_args(argv: Optional[Iterable[str]] = None) -> argparse.Namespace:
    """Parse setup-related args from argv.

    Returns a Namespace with attributes: setup, print_template, help
    """
    parser = get_parser()
    if argv is not None:
        argv = list(argv)
    args, _ = parser.parse_known_args(argv)
    return args

def create_template(store, namespace, key) -> tuple[bool, str]:
    # Default non-interactive template
    tpl_cfg = BackendConfig(
        azure_devops_organization=DEFAULT_AZURE_ORG,
        area_paths=[],
        project_map=[],
        team_map=[],
        feature_flags={},
        data_dir='data',
    )
    store.save(key, tpl_cfg)
    return True, f"Wrote template server config storage {namespace}/{key}"

def interactive_setup(store, namespace, key) -> tuple[bool, str]:
    try:
        print("Server configuration not found. Starting interactive setup.")
        # Ask for a PAT so we can query area paths
        pat = getpass("Azure DevOps Personal Access Token (input hidden): ")
        organization = input(f"Azure DevOps Organization [{DEFAULT_AZURE_ORG}]: ") or DEFAULT_AZURE_ORG
        try:
            from planner_lib.azure import get_client
            client = get_client(organization, pat)
        except Exception as e:
            return False, f"Azure client init failed: {e}"

        # Allow the admin to select a project if multiple
        projects = client.get_projects()
        if not projects:
            return False, "No projects found in Azure DevOps for the provided organization/PAT"
        print("Available projects:")
        for i, p in enumerate(projects, start=1):
            print(f"{i}. {p}")
        sel = input("Select project number to use for area discovery [1]: ")
        try:
            pi = int(sel) if sel.strip() else 1
        except Exception:
            pi = 1
        project = projects[max(0, pi-1)]

        root_path = input(f"Root area path (/ for all paths under this project) [{DEFAULT_AREA_PATH}]: ") or DEFAULT_AREA_PATH

        # Retrieve area paths under the provided root
        paths = client.get_area_paths(project, root_path)

        # Persist the area paths into the config
        tpl_cfg = BackendConfig(
            azure_devops_organization=organization,
            area_paths=paths,
            project_map=[],
            team_map=[],
            feature_flags={},
            data_dir='data',
        )
        # Save configuration template with area paths and reload to add project mappings
        store.save(key, tpl_cfg)
        cfg = store.load(key)
        proj_map = list(cfg.project_map)

        # Present numbered list and allow mapping paths to projects
        while True:
            print(f'\nDiscovered area paths under {project}\\{root_path}:')
            for idx, pth in enumerate(paths, start=1):
                print(f"{idx}. {pth.replace(f"{project}\\{root_path}\\", '')}")
            choice = input("Select path number to configure (0 to finish): ")
            try:
                ci = int(choice)
            except Exception:
                print("Invalid choice")
                continue
            if ci == 0:
                break
            if ci < 1 or ci > len(paths):
                print("Out of range")
                continue
            sel_path = paths[ci-1]

            name = input(f"Name for the project/team backlog [{sel_path.split('\\')[-1]}]: ") or sel_path.split('\\')[-1]
            entry = {"name": name, "area_path": sel_path, "type": "project"}

            # Save project mapping into config as well
            proj_map.append(entry)

        # Save configuration template with area paths and reload to add team mappings
        store.save(key, tpl_cfg)
        cfg = store.load(key)
        team_map = list(cfg.team_map)

        # Add team mappings
        while True:
            name = input(f"Name for the Team (empty to finish): ") or ""
            if not name:
                break
            short_name = input(f"Short Name for the Team [{name[:3].upper()}]: ") or name[:3].upper()
            entry = {"name": name, "short_name": short_name}
            team_map.append(entry)

        # Write back
        new_cfg = BackendConfig(
            azure_devops_organization=cfg.azure_devops_organization,
            area_paths=cfg.area_paths,
            project_map=proj_map,
            team_map=team_map,
            feature_flags=cfg.feature_flags,
            data_dir=cfg.data_dir,
        )
        store.save(key, new_cfg)
        return True, f"Wrote template server config with {len(paths)} area paths to storage {namespace}/{key}"
    except Exception as e:
        return False, str(e)

def setup(argv: Optional[Iterable[str]], storage: StorageBackend, namespace: str, key: str) -> int:
    """High-level helper used by the application entrypoint.

    - Parses `--setup` and `--print-template` from `argv`.
    - If the config exists in `storage` it is loaded into module state and returns 0.
    - If the config is missing, runs the interactive setup flow which should
      write the template/config into `storage`. After interactive setup
      completes, `setup` attempts to load the config and return 0 on success.
    - Returns non-zero on error.
    """
    args, _ = get_parser().parse_known_args(list(argv) if argv else [])
    store = YamlConfigStore(storage, namespace=namespace)

    # If the config already exists, load it into module state and return.
    try:
        cfg = store.load(key)
        _loaded_config.clear()
        _loaded_config.append(cfg)
        return 0
    except Exception:
        # missing or malformed -> proceed to interactive setup
        pass

    # Print the template if requested and return (no storage change)
    if args.print_template:
        created, message = create_template(store, namespace, key)
        if created:
            sys.stdout.write(message)
            return 0
        return 1

    # Config missing: run interactive setup only if explicitly requested
    # or if running in an interactive terminal. Otherwise instruct the
    # operator to run the setup command and return a non-zero exit code.
    if args.setup or sys.stdin.isatty():
        created, message = interactive_setup(store, namespace, key)
        if not created:
            print("Setup failed:", message)
            return 1

        # Load the newly created config into module state.
        try:
            cfg = store.load(key)
            _loaded_config.clear()
            _loaded_config.append(cfg)
            return 0
        except Exception as e:
            print("Failed to load config after setup:", e)
            return 1

    # Non-interactive environment and not explicitly requested: instruct
    # the user to run the setup command and abort startup.
    print(
        "Server configuration missing. Run: `python3 planner.py --setup` to create the configuration template."
    )
    return 2

@dataclass
class BackendConfig:
    azure_devops_organization: str
    area_paths: List[str]
    project_map: List[Dict[str, str]]
    team_map: List[Dict[str, str]]
    feature_flags: Dict[str, Any]
    data_dir: str


class YamlConfigStore:
    """Serialize/deserialize BackendConfig to YAML using a StorageBackend.

    The store writes YAML text to the backend using the provided
    namespace/key. The backend is expected to accept a string (or bytes)
    on `save` and return the same on `load`.
    """

    def __init__(self, backend: StorageBackend, namespace: str = "config"):
        self.backend = backend
        self.namespace = namespace

    def save(self, key: str, cfg: BackendConfig) -> None:
        payload = yaml.safe_dump(asdict(cfg), sort_keys=False)
        self.backend.save(self.namespace, key, payload)

    def load(self, key: str) -> BackendConfig:
        raw = self.backend.load(self.namespace, key)
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        try:
            data: Any = yaml.safe_load(raw)
        except Exception as e:
            raise ValueError("invalid config format: parse error") from e
        if not isinstance(data, dict):
            raise ValueError("invalid config format: expected mapping")

        return BackendConfig(
            azure_devops_organization=data["azure_devops_organization"],
            feature_flags=data.get("feature_flags", {}),
            area_paths=list(data.get("area_paths", [])),
            project_map=list(data.get("project_map", [])),
            team_map=list(data.get("team_map", [])),
            data_dir=data.get("data_dir", "data"),
        )
