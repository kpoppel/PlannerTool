#!/usr/bin/env python3
"""
Azure DevOps sandbox script to try out API functions.

- Set your PAT below (constant for quick experimentation)
- Adjust ORGANIZATION_URL to your Azure DevOps organization
- Run the script and choose a demo from the menu

This script uses azure-devops SDK directly.
"""

import sys
import os
import json
import logging
from typing import Any, List

from azure.devops.connection import Connection
from msrest.authentication import BasicAuthentication

# --- Configure these constants for your environment ---
PAT = os.environ.get("AZURE_DEVOPS_PAT", "YOURPAT")
ORGANIZATION_URL = os.environ.get("AZURE_DEVOPS_ORG_URL", "https://dev.azure.com/WSAudiology")
PROJECT_NAME = os.environ.get("AZURE_DEVOPS_PROJECT", "eSW")

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("azure_sandbox")


def get_connection() -> Connection:
    if not PAT or PAT == "YOURPAT":
        logger.warning("PAT not set. Set AZURE_DEVOPS_PAT or edit PAT constant.")
    credentials = BasicAuthentication("", PAT)
    return Connection(base_url=ORGANIZATION_URL, creds=credentials)


def print_json(obj: Any):
    try:
        print(json.dumps(obj, indent=2, sort_keys=True, default=str))
    except Exception:
        print(obj)


def demo_list_projects(conn: Connection):
    core_client = conn.clients.get_core_client()
    projects = core_client.get_projects()
    print(f"Projects ({len(projects)}):")
    for p in projects:
        print(f"- {p.name} (id={p.id})")


def demo_list_teams(conn: Connection, project: str):
    core_client = conn.clients.get_core_client()
    teams = core_client.get_teams(project_id=project)
    print(f"Teams in '{project}' ({len(teams)}):")
    for t in teams:
        print(f"- {t.name} (id={t.id})")


def demo_run_wiql(conn: Connection, project: str):
    wit_client = conn.clients.get_work_item_tracking_client()
    query = """
    SELECT [System.Id], [System.Title], [System.State]
    FROM WorkItems
    WHERE [System.TeamProject] = @project
      AND [System.WorkItemType] IN ('Epic','Feature')
    ORDER BY [System.ChangedDate] DESC
    """
    from azure.devops.v7_1.work_item_tracking.models import Wiql
    wiql = Wiql(query=query)
    result = wit_client.query_by_wiql(wiql=wiql, project=project)
    ids = [wi.id for wi in (result.work_items or [])]
    print(f"WIQL returned {len(ids)} IDs: {ids[:20]}")
    if ids:
        items = wit_client.get_work_items(ids[:50])
        print(f"Fetched {len(items)} work items. Showing first:")
        first = items[0]
        print_json({
            "id": first.id,
            "title": (first.fields or {}).get("System.Title"),
            "state": (first.fields or {}).get("System.State"),
            "type": (first.fields or {}).get("System.WorkItemType"),
        })


def demo_get_work_item(conn: Connection, work_item_id: int):
    wit_client = conn.clients.get_work_item_tracking_client()
    item = wit_client.get_work_item(work_item_id)
    print_json({
        "id": item.id,
        "title": (item.fields or {}).get("System.Title"),
        "state": (item.fields or {}).get("System.State"),
        "type": (item.fields or {}).get("System.WorkItemType"),
        "relations": [getattr(r, "rel", None) for r in (item.relations or [])],
    })


def demo_list_repositories(conn: Connection, project: str):
    try:
        git_client = conn.clients.get_git_client()
        repos = git_client.get_repositories(project=project)
        print(f"Git repositories in '{project}' ({len(repos)}):")
        for r in repos:
            print(f"- {r.name} (id={r.id})")
    except Exception as e:
        logger.info(f"Git demo skipped: {e}")


def menu():
    print("\nAzure Sandbox Demos:")
    print("1) List projects")
    print("2) List teams in project")
    print("3) Run WIQL (Epics/Features)")
    print("4) Get work item by ID")
    print("5) List Git repositories in project")
    print("q) Quit")

def test_thing(conn: Connection):
    core_client = conn.clients.get_core_client()
    projects = core_client.get_projects()
    # Item 516412 has a parent link to 516154
    # Item 516154 has 6 links to children
    # Fetch both and see their relations
    wit_client = conn.clients.get_work_item_tracking_client()
    # Fetch all work items in the "eSW/Architects" area path
    wiql_query = """
    SELECT [System.Id]
    FROM WorkItems
    WHERE [System.TeamProject] = 'Platform_Development'
    AND [System.WorkItemType] IN ('Epic','Feature')
    AND [System.State] <> 'Closed'
    AND [System.AreaPath] = 'Platform_Development\eSW\Teams\Architecture'
    ORDER BY [Microsoft.VSTS.Common.StackRank] ASC
    """
#    ORDER BY [System.Id] ASC
    # """SELECT [System.Id], [System.WorkItemType], [System.Title], [System.State], [System.AreaPath], [System.IterationPath], [System.Tags]
    #   FROM WorkItems
    #   WHERE [System.TeamProject] = 'Platform_Development'
    #   AND [System.AreaPath] UNDER 'Platform_Development\eSW\Teams\Architecture'
    #   AND [System.WorkItemType] IN ('Epic','Feature')
    #   AND [Microsoft.VSTS.Common.StackRank] <> ''
    #   AND [System.State] <> 'Closed'
    #   ORDER BY [Microsoft.VSTS.Common.StackRank] ASC"""

    from azure.devops.v7_1.work_item_tracking.models import Wiql
    wiql_obj = Wiql(query=wiql_query)
    result = wit_client.query_by_wiql(wiql=wiql_obj)
    task_ids = [getattr(wi, "id", None) for wi in (getattr(result, "work_items", []) or [])]
    task_ids = [int(t) for t in task_ids if t is not None]
    print(f"Task IDs in 'eSW/Architects': {task_ids}")

    # 682664 as start, end dates
    # 516412 has relations
    item1 = wit_client.get_work_item(682664, as_of="2026-06-01T00:00:00Z", expand="relations")
    item2 = wit_client.get_work_item(516154, expand="relations")

    def rels_info(item):
        infos = []
        for r in (getattr(item, "relations", []) or []):
            rel_type = getattr(r, "rel", None)
            url = getattr(r, "url", "") or ""
            target_id = None
            if isinstance(url, str) and url:
                try:
                    target_id = url.rstrip("/").split("/")[-1]
                except Exception:
                    target_id = None
            infos.append({
                "rel": rel_type,
                "targetId": target_id,
                "attributes": getattr(r, "attributes", None),
            })
        return infos

    print("Item 516412:")
    print ("################")
    print_json(item1)
    print ("################")
    print(item1.__dict__.keys())
    print ("################")
    print(item1.fields.keys())
    print(item1.fields.get("System.AssignedTo")["displayName"])
    print ("################ azure.devops.v7_0.work_item_tracking.models.WorkItemRelation ")
    print(item1.relations[0].__dict__.keys())
    print ("################")
    print(item1.relations[0].attributes["name"])
    print(getattr(item1.relations[0],"rel"))
    print(getattr(item1.relations[0], "url"))
    print ("################")
    # print_json({
    #     "id": item1.id,
    #     "title": (item1.fields or {}).get("System.Title"),
    #     "relations": rels_info(item1),
    # })

    # print("Item 516154:")
    # print_json({
    #     "id": item2.id,
    #     "title": (item2.fields or {}).get("System.Title"),
    #     "relations": rels_info(item2),
    # })

def main(argv: List[str]):
    conn = get_connection()
    test_thing(conn)

    while False:
        menu()
        choice = input("Choose an option: ").strip().lower()
        if choice == "1":
            demo_list_projects(conn)
        elif choice == "2":
            project = input(f"Project name [{PROJECT_NAME}]: ").strip() or PROJECT_NAME
            demo_list_teams(conn, project)
        elif choice == "3":
            project = input(f"Project name [{PROJECT_NAME}]: ").strip() or PROJECT_NAME
            demo_run_wiql(conn, project)
        elif choice == "4":
            raw = input("Work item ID: ").strip()
            try:
                wid = int(raw)
            except Exception:
                print("Please enter a numeric ID.")
                continue
            demo_get_work_item(conn, wid)
        elif choice == "5":
            project = input(f"Project name [{PROJECT_NAME}]: ").strip() or PROJECT_NAME
            demo_list_repositories(conn, project)
        elif choice in ("q", "quit", "exit"):
            print("Bye!")
            break
        else:
            print("Unknown choice.")


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except KeyboardInterrupt:
        print("\nInterrupted.")
