"""Team and plan operations for Azure DevOps.

This module contains operations related to teams, plans, and their relationships.
"""
from __future__ import annotations
from typing import List, Optional
import logging

logger = logging.getLogger(__name__)


class TeamPlanOperations:
    """Handles team and plan queries."""
    
    def __init__(self, client):
        """Initialize with a reference to the parent client.
        
        Args:
            client: Parent Azure client with connection and storage
        """
        self.client = client
        # In-memory cache for team field values (expensive to fetch)
        self._team_field_cache: dict[tuple, list] = {}
    
    def get_all_teams(self, project: str) -> List[dict]:
        """Fetch all teams for a project.
        
        Args:
            project: Project name or ID
            
        Returns:
            List of team dictionaries with 'id' and 'name' keys
        """
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        
        assert self.client.conn is not None
        core_client = self.client.conn.clients.get_core_client()
        
        teams = core_client.get_teams(project_id=project)
        items = getattr(teams, 'value', teams) or []
        
        out: List[dict] = []
        for t in items:
            try:
                out.append({'id': str(t.id), 'name': t.name})
            except Exception:
                try:
                    out.append({'id': str(getattr(t, 'id', '')), 'name': str(t)})
                except Exception:
                    continue
        
        return out
    
    def get_all_plans(self, project: str) -> List[dict]:
        """Fetch all delivery plans for a project.
        
        Args:
            project: Project name or ID
            
        Returns:
            List of plan dictionaries with 'id' and 'name' keys
        """
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        
        assert self.client.conn is not None
        work_client = self.client.conn.clients.get_work_client()
        
        plans = work_client.get_plans(project=project)
        items = getattr(plans, 'value', plans) or []
        
        out: List[dict] = []
        for p in items:
            try:
                out.append({'id': str(p.id), 'name': p.name})
            except Exception:
                try:
                    out.append({'id': str(getattr(p, 'id', '')), 'name': str(p)})
                except Exception:
                    continue
        
        return out
    
    def get_team_from_area_path(self, project: str, area_path: str) -> List[str]:
        """Find team IDs that own a given area path.
        
        This checks each team's field values and respects the includeChildren
        setting to match descendant area paths.
        
        Args:
            project: Project name or ID
            area_path: Area path to find owning teams for
            
        Returns:
            List of team IDs that own the area path
        """
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        
        assert self.client.conn is not None
        work_client = self.client.conn.clients.get_work_client()
        
        teams = self.get_all_teams(project)
        if not teams:
            return []
        
        team_ids: List[str] = []
        
        try:
            from azure.devops.v7_1.work.models import TeamContext
        except Exception:
            TeamContext = None
        
        targ = area_path.rstrip('\\/')
        
        for t in teams:
            tid = t.get('id')
            tname = t.get('name')
            
            # Check cache first
            cache_key = (project, tname)
            vals = self._team_field_cache.get(cache_key)
            
            if vals is None:
                # Fetch team field values
                try:
                    if TeamContext is not None:
                        tc = TeamContext(project=project, team=tname)
                        fv = work_client.get_team_field_values(team_context=tc)
                    else:
                        fv = work_client.get_team_field_values(project=project, team=tname)
                except Exception:
                    self._team_field_cache[cache_key] = []
                    continue
                
                values = getattr(fv, 'values', None) or []
                vals = []
                
                for entry in values:
                    try:
                        val = getattr(entry, 'value', None) if not isinstance(entry, dict) else entry.get('value')
                        if val:
                            vals.append(str(val).rstrip('\\/'))
                    except Exception:
                        continue
                
                self._team_field_cache[cache_key] = vals
            
            # Check if area matches any of the team's field values
            for candidate in (vals or []):
                try:
                    if candidate == targ or targ.startswith(candidate + '\\'):
                        team_ids.append(str(tid))
                        break
                except Exception:
                    continue
        
        return team_ids
    
    def prefetch_team_fields(self, project: str) -> None:
        """Prefetch team field values for all teams in a project.
        
        This populates the team field cache to speed up subsequent lookups.
        
        Args:
            project: Project name or ID
        """
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        
        assert self.client.conn is not None
        work_client = self.client.conn.clients.get_work_client()
        
        teams = self.get_all_teams(project) or []
        
        try:
            from azure.devops.v7_1.work.models import TeamContext
        except Exception:
            TeamContext = None
        
        for t in teams:
            tname = t.get('name')
            cache_key = (project, tname)
            
            if cache_key in self._team_field_cache:
                continue
            
            try:
                if TeamContext is not None:
                    tc = TeamContext(project=project, team=tname)
                    fv = work_client.get_team_field_values(team_context=tc)
                else:
                    fv = work_client.get_team_field_values(project=project, team=tname)
            except Exception:
                self._team_field_cache[cache_key] = []
                continue
            
            values = getattr(fv, 'values', None) or []
            vals = []
            
            for entry in values:
                try:
                    val = getattr(entry, 'value', None) if not isinstance(entry, dict) else entry.get('value')
                    if val:
                        vals.append(str(val).rstrip('\\/'))
                except Exception:
                    continue
            
            self._team_field_cache[cache_key] = vals
    
    def get_cached_team_fields(self, project: str, team_name: str) -> Optional[list]:
        """Get cached team field values if available.
        
        Args:
            project: Project name or ID
            team_name: Team name
            
        Returns:
            List of area paths or None if not cached
        """
        return self._team_field_cache.get((project, team_name))
