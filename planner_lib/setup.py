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

from planner_lib.azure import get_client

DEFAULT_AREA_PATH = "eSW"
DEFAULT_AZURE_URL = "https://dev.azure.com/WSAudiology"

# Module-level place to hold the loaded BackendConfig instance after setup
_loaded_config: list[BackendConfig] = []

def get_loaded_config() -> Optional[BackendConfig]:
    """Return the loaded BackendConfig if available, otherwise None."""
    return _loaded_config[0] if _loaded_config else None


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

def sanitize_area_path(path: str) -> str:
    """Sanitize an area path so it is safe to include in a WIQL query.

    - Remove a leading backslash if present.
    - Remove any occurrences of the substring "Area\\" (and common typo "Aera\\")
        since Azure returns those in some listings but they must not be sent back
        to the Azure endpoint inside the WIQL AreaPath string.
    """
    if not isinstance(path, str):
        return path
    # strip leading backslash
    out = path.lstrip('\\')
    # remove 'Area\\' and common typo 'Aera\\' occurrences
    out = out.replace('Area\\', '')
    return out


def create_template(store, namespace, key) -> tuple[bool, str]:
    # Default non-interactive template
    tpl_cfg = BackendConfig(
        azure_devops_url=DEFAULT_AZURE_URL,
        root_area_path=DEFAULT_AREA_PATH,
        area_paths=[],
        project_map=[],
        team_map=[],
    )
    store.save(key, tpl_cfg)
    return True, f"Wrote template server config storage {namespace}/{key}"

def interactive_setup(store, namespace, key) -> tuple[bool, str]:
    try:
        print("Server configuration not found. Starting interactive setup.")
        url = input(f"Azure DevOps URL [{DEFAULT_AZURE_URL}]: ") or DEFAULT_AZURE_URL
        root = input(f"Root area path [{DEFAULT_AREA_PATH}]: ") or DEFAULT_AREA_PATH
        # Ask for a PAT so we can query area paths
        pat = getpass("Azure DevOps Personal Access Token (input hidden): ")
        try:
            client = get_client(url, pat)
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

        # Retrieve area paths under the provided root
        paths = client.get_area_paths(project, root)

        # Persist the area paths into the config
        tpl_cfg = BackendConfig(
            azure_devops_url=url,
            root_area_path=root,
            area_paths=paths,
            project_map=[],
            team_map=[],
        )
        store.save(key, tpl_cfg)

        # Present numbered list and allow mapping
        while True:
            print('\nDiscovered area paths:')
            for idx, pth in enumerate(paths, start=1):
                print(f"{idx}. {pth}")
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
            # Determine type
            typ = input("Type (Project/Team) [Project]: ") or "Project"
            typ = "Project" if typ.lower().startswith('p') else "Team"
            # Determine Team/Project name
            name = input(f"Name for the {typ} [{sel_path.split('\\')[-1]}]: ") or sel_path.split('\\')[-1]
            # TODO: Remove custom wiql.
            # Generate WIQL template and allow edit
            safe_path = sanitize_area_path(sel_path)
            # default_wiql=f"""
            # SELECT [System.Id], [System.WorkItemType], [System.Title], [System.State], [System.AreaPath], [System.IterationPath], [System.Tags]
            # FROM WorkItems
            # WHERE [System.TeamProject] = 'Platform_Development'
            # AND [System.AreaPath] UNDER '{safe_path}'
            # AND [System.WorkItemType] IN ('Epic','Feature')
            # AND [System.State] <> 'Closed'
            # AND [Microsoft.VSTS.Common.StackRank] <> ''
            # ORDER BY [Microsoft.VSTS.Common.StackRank] ASC
            # """
            default_wiql = ""
            #print("Generated WIQL:\n", default_wiql)
            #edited = input("Edit WIQL (press Enter to accept): ")
            #wiql = edited or default_wiql
            wiql = default_wiql
            # Save mapping into template config
            cfg_after = store.load(key)
            proj_map = list(cfg_after.project_map)
            team_map = list(cfg_after.team_map)
            entry = {"name": name, "area_path": safe_path, "wiql": wiql}
            if typ == "Project":
                proj_map.append(entry)
            else:
                team_map.append(entry)
            # Write back
            new_cfg = BackendConfig(
                azure_devops_url=cfg_after.azure_devops_url,
                root_area_path=cfg_after.root_area_path,
                area_paths=cfg_after.area_paths,
                project_map=proj_map,
                team_map=team_map,
            )
            store.save(key, new_cfg)
            print(f"Saved mapping for {sel_path} as {typ}")

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
    azure_devops_url: str
    root_area_path: str
    area_paths: List[str]
    project_map: List[Dict[str, str]]
    team_map: List[Dict[str, str]]


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
            azure_devops_url=data["azure_devops_url"],
            root_area_path=data["root_area_path"],
            area_paths=list(data.get("area_paths", [])),
            project_map=list(data.get("project_map", [])),
            team_map=list(data.get("team_map", [])),
        )
