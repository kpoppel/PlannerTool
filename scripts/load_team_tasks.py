#!/usr/bin/env python3
"""
Load top 10 tasks for each team entry from the teams config (schema v2)
using planner_lib.azure.AzureClient.

Usage:
  - Set env `AZURE_DEVOPS_PAT` and `AZURE_DEVOPS_PROJECT` to avoid prompts
  - Run from repository root:
      python scripts/load_team_tasks.py
"""
from __future__ import annotations
import os
import sys
import yaml
import logging
from pathlib import Path
from getpass import getpass
from typing import List

try:
    from planner_lib.azure import AzureClient
except Exception as e:
    print("Failed importing planner_lib.azure:", e)
    print("Make sure the repository is on PYTHONPATH and `azure-devops` is installed.")
    raise

CONFIG_PATH = Path("data/config/server_config.yml")
DEFAULT_FIELDS = ["System.Id", "System.Title", "System.State", "System.AssignedTo"]


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


def main():
    logging.basicConfig(level=logging.INFO)
    try:
        cfg = load_config(CONFIG_PATH)
    except Exception as e:
        print("Error loading config:", e)
        sys.exit(2)

    azure_devops_organization = cfg.get("azure_devops_organization")
    if not azure_devops_organization:
        print("Config missing `azure_devops_organization`")
        sys.exit(2)

    pat = "<YOURPAT>"
    project = "Platform_Development"
    #pat = os.environ.get("AZURE_DEVOPS_PAT") or getpass("Azure DevOps PAT (input hidden): ")
    #project = os.environ.get("AZURE_DEVOPS_PROJECT") or input("Azure DevOps project name: ").strip()
    if not pat:
        print("No PAT supplied")
        sys.exit(2)
    if not project:
        print("No project supplied")
        sys.exit(2)

    try:
        from planner_lib.azure import AzureService
        from planner_lib.storage import create_storage
        # Create a small file-backed storage for caching (optional)
        storage = create_storage(backend='file', serializer='pickle', accessor=None, data_dir='data')
        client_mgr = AzureService(azure_devops_organization, storage)
    except Exception as e:
        print("Failed to initialize AzureClient manager:", e)
        sys.exit(3)

    # Use context-managed connection to bind the PAT for the duration of operations
    with client_mgr.connect(pat) as client:
        wit_client = client.conn.clients.get_work_item_tracking_client()

    teams = cfg.get("teams", [])
    if not teams:
        print("No teams entries found in config.")
        sys.exit(0)

    for entry in teams:
        name = entry.get("name") or "<unnamed>"
        wiql = entry.get("wiql")
        area_path = entry.get("area_path")
        print(f"\n=== Team: {name} ===")
        if not wiql:
            print("  No WIQL present for this entry; skipping.")
            continue

        try:
            qres = client.query_by_wiql(project, wiql)
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