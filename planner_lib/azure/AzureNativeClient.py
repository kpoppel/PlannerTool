"""AzureClient implementation with no caching"""
from __future__ import annotations
from typing import List, Optional
import logging

logger = logging.getLogger(__name__)

from planner_lib.azure.AzureClient import AzureClient
from planner_lib.storage.interfaces import StorageProtocol

class AzureNativeClient(AzureClient):
    """Azure client without caching.
    
    This client fetches data directly from Azure DevOps APIs on every request.
    Optional in-memory caching for plans/teams can be enabled via cache_plans flag.
    """
    
    def __init__(self, organization_url: str, storage: StorageProtocol, *, cache_plans: bool = True):
        logger.info("Using AzureNativeClient (deferred connect)")
        super().__init__(organization_url, storage=storage, cache_plans=cache_plans)
        # simple in-memory runtime caches for plans/teams when cache_plans is True
        self._plans_cache: dict[str, list] = {}
        self._teams_cache: dict[str, list] = {}

    def get_work_items(self, area_path) -> List[dict]:
        """Fetch work items directly from Azure without caching.
        
        Delegates to WorkItemOperations for the actual fetch.
        """
        return self._work_item_ops.get_work_items(area_path)

    def invalidate_work_items(self, work_item_ids: List[int]):
        """No-op for AzureNativeClient as it doesn't use caching."""
        return None

    def get_all_teams(self, project: str) -> List[dict]:
        """Fetch teams with optional in-memory caching."""
        if self.cache_plans and self._teams_cache.get(project):
            return self._teams_cache.get(project, [])
        
        teams = super().get_all_teams(project)
        
        if self.cache_plans:
            self._teams_cache[project] = teams
        
        return teams

    def get_all_plans(self, project: str) -> List[dict]:
        """Fetch plans with optional in-memory caching.
        
        When cache_plans is enabled, also attempts to fetch team information
        for each plan via the delivery timeline API.
        """
        if self.cache_plans and self._plans_cache.get(project):
            return self._plans_cache.get(project, [])
        
        if not self._connected:
            raise RuntimeError("AzureNativeClient is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        assert self.conn is not None
        work_client = self.conn.clients.get_work_client()
        
        # Fetch basic plan info from base implementation
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

            # Try to extract teams referenced by this delivery plan via timeline API
            teams_for_plan: list = []
            try:
                if hasattr(work_client, 'get_delivery_timeline_data'):
                    timeline = work_client.get_delivery_timeline_data(project, plan_id)
                else:
                    timeline = None
            except Exception:
                timeline = None

            # Extract team information from timeline
            try:
                seen_ids = set()
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
                        team_id = r.get('teamId') or r.get('id') or (r.get('team') or {}).get('id')
                        team_name = r.get('teamName') or r.get('name') or (r.get('team') or {}).get('name')
                    else:
                        team_id = getattr(r, 'teamId', None) or getattr(r, 'id', None) or (
                            getattr(getattr(r, 'team', None), 'id', None) if getattr(r, 'team', None) is not None else None
                        )
                        team_name = getattr(r, 'teamName', None) or getattr(r, 'name', None) or (
                            getattr(getattr(r, 'team', None), 'name', None) if getattr(r, 'team', None) is not None else None
                        )

                    if team_id is None and not team_name:
                        continue
                    
                    tid = str(team_id) if team_id is not None else str(team_name)
                    if tid in seen_ids:
                        continue
                    
                    seen_ids.add(tid)
                    teams_for_plan.append({'id': tid, 'name': team_name or ''})
            except Exception:
                teams_for_plan = []

            out.append({'id': plan_id, 'name': plan_name, 'teams': teams_for_plan})
        
        if self.cache_plans:
            self._plans_cache[project] = out
        
        return out

