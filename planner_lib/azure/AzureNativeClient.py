"""AzureClient implementation with no caching"""
from __future__ import annotations
from typing import List, Optional
import logging

logger = logging.getLogger(__name__)

from planner_lib.azure.AzureClient import AzureClient
from planner_lib.storage.interfaces import StorageProtocol

class AzureNativeClient(AzureClient):
    def __init__(self, organization_url: str, storage: StorageProtocol, *, cache_plans: bool = True):
        logger.info("Using AzureNativeClient (deferred connect)")
        super().__init__(organization_url, storage=storage, cache_plans=cache_plans)
        # simple in-memory runtime caches for plans/teams
        self._plans_cache: dict[str, list] = {}
        self._teams_cache: dict[str, list] = {}

    def get_work_items(self, area_path) -> List[dict]:
        # Fetch all work items IDs in the area path
        if not self._connected:
            raise RuntimeError("AzureNativeClient is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        assert self.conn is not None
        wit_client = self.conn.clients.get_work_item_tracking_client()

        # Sanitize and escape the area path for inclusion in WIQL string literal.
        wiql_area = self._sanitize_area_path(area_path)
        wiql_area_escaped = wiql_area.replace("'", "''").replace('\\', '\\\\')

        wiql_query = f"""
        SELECT [System.Id]
        FROM WorkItems
        WHERE [System.WorkItemType] IN ('Epic','Feature')
        AND [System.AreaPath] = '{wiql_area_escaped}' 
        AND [System.State] NOT IN ('Closed', 'Removed')
        ORDER BY [Microsoft.VSTS.Common.StackRank] ASC
        """
        from azure.devops.v7_1.work_item_tracking.models import Wiql
        wiql_obj = Wiql(query=wiql_query)
        try:
            result = wit_client.query_by_wiql(wiql=wiql_obj)
        except Exception as e:
            # Azure may raise AzureDevOpsServiceError for non-existent area paths
            logger.warning("WIQL query for area '%s' failed: %s", area_path, e)
            return []
        task_ids = [getattr(wi, "id", None) for wi in (getattr(result, "work_items", []) or [])]
        task_ids = [int(t) for t in task_ids if t is not None]
        logger.debug(f"Task IDs in 'eSW/Architects': {task_ids}")

        # Next retrieve the work items by ID
        ret = []
        # Batch fetch up to 200 IDs per request for speed
        def chunks(lst, n):
            for i in range(0, len(lst), n):
                yield lst[i:i+n]
        for batch in chunks(task_ids, 200):
            items = wit_client.get_work_items(batch, expand="relations")
            for item in items or []:
                relations = getattr(item, "relations", []) or []
                relation_map = []
                for r in relations:
                    if r.attributes.get("name") in ("Parent", "Child", "Related", "Predecessor", "Successor"):
                        # A Relation is a dict ("type": Parent|Child|Related|Predecessor|Successor, "id": work item ID, "url:" UI URL)
                        relation_map.append({
                            "type": r.attributes.get("name"),
                            "id": str(r.url.split('/')[-1]),
                            "url": self.api_url_to_ui_link(getattr(r, "url", "")),
                        })

                assigned = item.fields.get("System.AssignedTo")
                assignedTo = assigned.get("displayName") if isinstance(assigned, dict) and "displayName" in assigned else ""
                url = self.api_url_to_ui_link(getattr(item, "url", ""))
                try:
                    ret.append({
                        "id": str(item.id),
                        "type": self._safe_type(item.fields.get("System.WorkItemType")),
                        "title": item.fields.get("System.Title"),
                        "assignee": assignedTo,
                        "state": item.fields.get("System.State"),
                        "tags": item.fields.get("System.Tags"),
                        "description": item.fields.get("System.Description"),
                        "startDate": self._safe_date(item.fields.get("Microsoft.VSTS.Scheduling.StartDate")),
                        "finishDate": self._safe_date(item.fields.get("Microsoft.VSTS.Scheduling.TargetDate")),
                        "areaPath": item.fields.get("System.AreaPath"),
                        "iterationPath": item.fields.get("System.IterationPath"),
                        "relations": relation_map,
                        "url": url,
                    })
                except Exception as e:
                    logger.exception("Error processing item %s: %s", getattr(item, 'id', '?'), e)
        return ret

    def invalidate_work_items(self, work_item_ids: List[int]):
        """No-op for AzureNativeClient as it doesn't use caching."""
        return None

    def get_all_teams(self, project: str) -> List[dict]:
        # honor simple in-memory cache when enabled
        if self.cache_plans and self._teams_cache.get(project):
            return self._teams_cache.get(project, [])
        if not self._connected:
            raise RuntimeError("AzureNativeClient is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        assert self.conn is not None
        core_client = self.conn.clients.get_core_client()
        teams = core_client.get_teams(project_id=project)
        items = getattr(teams, 'value', teams) or []
        out: list = []
        for t in items:
            try:
                out.append({'id': str(t.id), 'name': t.name})
            except Exception:
                try:
                    out.append({'id': str(getattr(t, 'id', '')), 'name': str(t)})
                except Exception:
                    continue
        if self.cache_plans:
            self._teams_cache[project] = out
        return out

    def get_all_plans(self, project: str) -> List[dict]:
        if self.cache_plans and self._plans_cache.get(project):
            return self._plans_cache.get(project, [])
        if not self._connected:
            raise RuntimeError("AzureNativeClient is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        assert self.conn is not None
        work_client = self.conn.clients.get_work_client()
        plans = work_client.get_plans(project=project)
        items = getattr(plans, 'value', plans) or []
        out: list = []
        for p in items:
            try:
                plan_id = str(p.id)
                plan_name = p.name
            except Exception:
                try:
                    plan_id = str(getattr(p, 'id', ''))
                    plan_name = str(p)
                except Exception:
                    continue

            # Try to extract the teams referenced by this delivery plan via the
            # delivery timeline API. This is best-effort: if the SDK/client does
            # not expose the timeline or the call fails we simply return an
            # empty teams list for the plan.
            teams_for_plan: list = []
            try:
                if hasattr(work_client, 'get_delivery_timeline_data'):
                    # API expects (project, id, ...)
                    timeline = work_client.get_delivery_timeline_data(project, plan_id)
                else:
                    timeline = None
            except Exception:
                timeline = None

            # Extract team rows from the timeline in a defensive way. The
            # timeline model may be a dict-like or model object with a
            # `rows` attribute. Each row can contain either a `team` object or
            # explicit `teamId`/`teamName` fields.
            try:
                # The timeline object may expose teams directly (preferred),
                # or it may contain rows where team info is embedded. Try
                # both, preferring `timeline.teams` when present.
                seen_ids = set()
                # Try direct teams list first
                candidate_teams = []
                if timeline is None:
                    candidate_teams = []
                elif hasattr(timeline, 'teams'):
                    candidate_teams = getattr(timeline, 'teams') or []
                elif isinstance(timeline, dict) and 'teams' in timeline:
                    candidate_teams = timeline.get('teams', []) or []
                else:
                    # Fallback to rows
                    rows = getattr(timeline, 'rows', None) or (timeline.get('rows') if isinstance(timeline, dict) else []) or []
                    candidate_teams = rows

                for r in candidate_teams or []:
                    team_id = None
                    team_name = None
                    if isinstance(r, dict):
                        # may be a row or explicit team dict
                        team_id = r.get('teamId') or r.get('id') or (r.get('team') or {}).get('id')
                        team_name = r.get('teamName') or r.get('name') or (r.get('team') or {}).get('name')
                    else:
                        # model object: check common attribute names
                        team_id = getattr(r, 'teamId', None) or getattr(r, 'id', None) or (getattr(getattr(r, 'team', None), 'id', None) if getattr(r, 'team', None) is not None else None)
                        team_name = getattr(r, 'teamName', None) or getattr(r, 'name', None) or (getattr(getattr(r, 'team', None), 'name', None) if getattr(r, 'team', None) is not None else None)

                    if team_id is None and not team_name:
                        continue
                    tid = str(team_id) if team_id is not None else str(team_name)
                    if tid in seen_ids:
                        continue
                    seen_ids.add(tid)
                    teams_for_plan.append({'id': tid, 'name': team_name or ''})
            except Exception:
                # Don't fail the entire plan listing when timeline parsing fails
                teams_for_plan = []

            out.append({'id': plan_id, 'name': plan_name, 'teams': teams_for_plan})
        if self.cache_plans:
            self._plans_cache[project] = out
        return out

    def get_team_from_area_path(self, project: str, area_path: str) -> List[str]:
        # Use base implementation which calls SDK methods; caching of teams is honored
        # by get_all_teams above and underlying SDK calls.
        return super().get_team_from_area_path(project, area_path)


