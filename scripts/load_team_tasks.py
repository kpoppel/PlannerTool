#!/usr/bin/env python3
"""
Load top 10 tasks for each team entry from the teams config (schema v2)
using planner_lib.azure.AzureClient.

Usage:
  - Set env `AZURE_DEVOPS_PAT` and optionally `AZURE_DEVOPS_PROJECT` to avoid prompts
  - Run from repository root:
      python scripts/load_team_tasks.py --organization WSAudiology --project Platform_Development
    python scripts/load_team_tasks.py --organization WSAudiology --project Platform_Development --area-path "Platform_Development\\eSW\\Teams\\Architecture"
"""
from __future__ import annotations
import argparse
import os
import sys
import logging
from pathlib import Path
from typing import List, Sequence
from urllib.parse import urlparse

import yaml
from getpass import getpass

# Allow importing planner_lib without installing the package
sys.path.insert(0, str(Path(__file__).parent.parent))

CONFIG_PATH = Path("data/config/server_config.yml")
DEFAULT_FIELDS = ["System.Id", "System.Title", "System.State", "System.AssignedTo"]
EXAMPLE_USAGE = (
    "Example:\n"
    "python3 scripts/load_team_tasks.py \\\n"
    "  --organization yourOrg \\\n"
    "  --project your_project \\\n"
    "  --area-path \"your/area/path\""
)


def load_config(path: Path):
    if not path.exists():
        raise FileNotFoundError(f"Config file not found: {path}")
    text = path.read_text(encoding="utf-8")
    data = yaml.safe_load(text)
    if not isinstance(data, dict):
        raise ValueError("Config must be a mapping at top-level")
    return data


def extract_workitem_ids(query_result) -> List[int]:
    # The SDK may return attributes with camelCase; be defensive and try multiple shapes.
    candidates = None
    for attr in ("work_items", "workItems", "workItemRelations", "work_item_relations"):
        candidates = getattr(query_result, attr, None)
        if candidates:
            break
    if candidates is None and isinstance(query_result, dict):
        candidates = query_result.get("workItems") or query_result.get("work_items")
    if not candidates:
        return []

    ids = []
    for item in candidates:
        if item is None:
            continue
        # item may be an object with .id or dict-like
        iid = getattr(item, "id", None)
        if iid is None:
            try:
                iid = item.get("id")
            except Exception:
                iid = None
        if iid is not None:
            try:
                ids.append(int(iid))
            except Exception:
                # ignore non-int ids
                pass
    return ids


def fetch_work_items(wit_client, ids: List[int], fields=DEFAULT_FIELDS):
    if not ids:
        return []
    # The SDK method is get_work_items(ids, fields=..., as_of=None, expand=None)
    try:
        items = wit_client.get_work_items(ids, fields=fields)
        return items or []
    except Exception:
        # best-effort: try positional call without fields
        try:
            return wit_client.get_work_items(ids)
        except Exception as e:
            logging.exception("Failed to fetch work items: %s", e)
            return []


def summary_from_item(item) -> str:
    # item may be object with .fields or dict-like
    fields = {}
    if hasattr(item, "fields"):
        try:
            fields = dict(item.fields or {})
        except Exception:
            fields = {}
    elif isinstance(item, dict):
        fields = item.get("fields", {})
    title = fields.get("System.Title", "<no title>")
    state = fields.get("System.State", "<no state>")
    assigned = fields.get("System.AssignedTo", None)
    if isinstance(assigned, dict):
        assigned = assigned.get("displayName") or assigned.get("uniqueName") or str(assigned)
    return f"[{fields.get('System.Id','?')}] {title} (State: {state}) AssignedTo: {assigned}"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Load top team tasks from Azure DevOps WIQL queries")
    parser.add_argument(
        "--organization",
        help="Azure DevOps organization name or full URL",
    )
    parser.add_argument(
        "--project",
        help="Azure DevOps project name (falls back to AZURE_DEVOPS_PROJECT or prompt)",
    )
    parser.add_argument(
        "--config",
        default=str(CONFIG_PATH),
        help=f"Server config path (default: {CONFIG_PATH})",
    )
    parser.add_argument(
        "--area-path",
        action="append",
        dest="area_paths",
        default=[],
        help="Area path to query (repeat flag for multiple values). When provided, legacy teams config is ignored.",
    )
    return parser


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = build_parser()
    return parser.parse_args(argv)


def normalize_organization(value: str | None) -> str:
    org = (value or "").strip()
    if not org:
        return ""
    if org.startswith("http://") or org.startswith("https://"):
        parsed = urlparse(org)
        parts = [p for p in (parsed.path or "").split("/") if p]
        return parts[0] if parts else ""
    return org


def resolve_project(cli_project: str | None) -> str:
    project = (cli_project or "").strip()
    if project:
        return project
    project = (os.environ.get("AZURE_DEVOPS_PROJECT") or "").strip()
    if project:
        return project
    return input("Azure DevOps project name: ").strip()


def query_wiql(wit_client, wiql_query: str, project: str):
    from azure.devops.v7_1.work_item_tracking.models import Wiql

    wiql_obj = Wiql(query=wiql_query)
    # Some SDK/client stubs accept project kwarg, while others do not.
    try:
        return wit_client.query_by_wiql(wiql=wiql_obj, project=project)
    except TypeError:
        return wit_client.query_by_wiql(wiql=wiql_obj)


def build_area_path_wiql(project: str, area_path: str) -> str:
    safe_project = project.replace("'", "''")
    safe_area_path = area_path.replace("'", "''")
    return (
        "SELECT [System.Id], [System.Title], [System.State] "
        "FROM WorkItems "
        f"WHERE [System.TeamProject] = '{safe_project}' "
        "AND [System.WorkItemType] IN ('Epic','Feature') "
        "AND [System.State] <> 'Closed' "
        f"AND [System.AreaPath] UNDER '{safe_area_path}' "
        "ORDER BY [Microsoft.VSTS.Common.StackRank] ASC"
    )


def resolve_query_entries(cfg: dict, project: str, cli_area_paths: Sequence[str]) -> List[dict]:
    normalized_paths = [p.strip() for p in cli_area_paths if p and p.strip()]
    if normalized_paths:
        return [
            {
                "name": f"CLI Area Path: {area_path}",
                "area_path": area_path,
                "wiql": build_area_path_wiql(project, area_path),
            }
            for area_path in normalized_paths
        ]
    return list(cfg.get("teams", []) or [])


def main(argv: Sequence[str] | None = None):
    logging.basicConfig(level=logging.INFO)
    raw_argv = list(argv) if argv is not None else sys.argv[1:]
    parser = build_parser()
    if not raw_argv:
        parser.print_help()
        print()
        print(EXAMPLE_USAGE)
        sys.exit(2)
    args = parser.parse_args(raw_argv)

    try:
        cfg = load_config(Path(args.config))
    except Exception as e:
        print("Error loading config:", e)
        sys.exit(2)

    azure_devops_organization = normalize_organization(args.organization or cfg.get("azure_devops_organization"))
    if not azure_devops_organization:
        print("No organization supplied. Use --organization or set azure_devops_organization in config.")
        sys.exit(2)

    pat = os.environ.get("AZURE_DEVOPS_PAT") or getpass("Azure DevOps PAT (input hidden): ")
    project = resolve_project(args.project)
    if not pat:
        print("No PAT supplied")
        sys.exit(2)
    if not project:
        print("No project supplied")
        sys.exit(2)

    try:
        from planner_lib.azure.AzureClient import AzureClient
        from planner_lib.storage import create_storage
        # Create a small file-backed storage for caching (optional)
        storage = create_storage(backend='file', serializer='raw', data_dir='data')
        client_mgr = AzureClient(azure_devops_organization, storage)
    except Exception as e:
        print("Failed to initialize AzureClient manager:", e)
        sys.exit(3)

    entries = resolve_query_entries(cfg, project, args.area_paths)
    if not entries:
        print("No query entries found. Provide --area-path or configure teams in config.")
        sys.exit(0)

    # Keep all ADO calls inside the connected context.
    with client_mgr.connect(pat) as client:
        wit_client = client.wit_client

        for entry in entries:
            name = entry.get("name") or "<unnamed>"
            wiql = entry.get("wiql")
            print(f"\n=== Team: {name} ===")
            if not wiql:
                print("  No WIQL present for this entry; skipping.")
                continue

            try:
                qres = query_wiql(wit_client, wiql, project)
            except Exception as e:
                print(f"  Query failed for team {name}: {e}")
                continue

            ids = extract_workitem_ids(qres)
            if not ids:
                print("  No work items returned by WIQL.")
                continue

            top_ids = ids[:10]
            items = fetch_work_items(wit_client, top_ids)
            if not items:
                print("  Unable to fetch work item details (SDK returned no items).")
                continue

            for it in items:
                try:
                    print("  -", summary_from_item(it))
                except Exception:
                    print("  - <error formatting item>")

    print("\nDone.")


if __name__ == "__main__":
    main()