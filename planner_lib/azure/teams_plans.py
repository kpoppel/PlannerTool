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
            List of plan dictionaries with 'id', 'name', and 'teams' keys.
            The 'teams' field contains a list of team dicts with 'id' and optionally 'name'.
        """
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        
        assert self.client.conn is not None
        work_client = self.client.conn.clients.get_work_client()
        
        plans = work_client.get_plans(project=project)
        items = getattr(plans, 'value', plans) or []
        
        out: List[dict] = []
        for p in items:
            plan_id = str(p.id)
            plan_name = p.name
            teams = []
            
            # Extract teams from delivery timeline API
            try:
                if hasattr(work_client, 'get_delivery_timeline_data'):
                    timeline = work_client.get_delivery_timeline_data(project, plan_id)
                    
                    # Extract team information from timeline
                    seen_ids = set()
                    candidate_teams = []
                    
                    if timeline and hasattr(timeline, 'teams'):
                        candidate_teams = getattr(timeline, 'teams') or []
                    elif timeline and isinstance(timeline, dict) and 'teams' in timeline:
                        candidate_teams = timeline.get('teams', []) or []
                    elif timeline:
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
                        teams.append({'id': tid, 'name': team_name or ''})
            except Exception as e:
                logger.debug(f'Plan {plan_name}: could not fetch timeline data: {e}')
            
            out.append({'id': plan_id, 'name': plan_name, 'teams': teams})
        
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
    
    def get_iterations(self, project: str, root_path: Optional[str] = None, depth: int = 10) -> List[dict]:
        """Fetch iterations for a project, optionally filtered by root path.
        
        Returns a flat list of iteration dictionaries with path, name, startDate, and finishDate.
        If root_path is specified, only returns iterations under that path (including children).
        
        Args:
            project: Project name or ID
            root_path: Optional root iteration path to filter by (e.g., "Project\\Iteration\\eSW")
            depth: Depth to fetch classification nodes (default 10)
            
        Returns:
            List of iteration dicts with keys: path, name, startDate, finishDate
            Sorted by startDate (nulls last)
        """
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        
        assert self.client.conn is not None
        wit_client = self.client.conn.clients.get_work_item_tracking_client()
        
        # Fetch iteration classification nodes
        try:
            if root_path:
                # Strip project prefix and "Iteration\" if present in root_path
                # E.g., "Platform_Development\Iteration\eSW" -> "eSW"
                path_parts = root_path.replace('/', '\\').split('\\')
                if path_parts[0] == project:
                    path_parts = path_parts[1:]
                # Remove "Iteration" part if it's the first element
                if path_parts and path_parts[0].lower() == 'iteration':
                    path_parts = path_parts[1:]
                clean_root = '\\'.join(path_parts) if path_parts else None
                
                if clean_root:
                    node = wit_client.get_classification_node(
                        project=project,
                        structure_group='iterations',
                        path=clean_root,
                        depth=depth
                    )
                else:
                    node = wit_client.get_classification_node(
                        project=project,
                        structure_group='iterations',
                        depth=depth
                    )
            else:
                node = wit_client.get_classification_node(
                    project=project,
                    structure_group='iterations',
                    depth=depth
                )
        except Exception as e:
            logger.warning(f'Failed to fetch iterations for project {project}, root={root_path}: {e}')
            return []
        
        # Recursively extract iteration nodes with dates
        def _extract_iterations(n, parent_path=''):
            out = []
            
            def _walk(node, prefix):
                # Extract path and name
                node_path = getattr(node, 'path', None)
                node_name = getattr(node, 'name', None)
                
                # Prefer path over name for full path
                full_path = node_path if node_path else (f"{prefix}\\{node_name}" if prefix and node_name else node_name)
                
                # Extract attributes (startDate, finishDate)
                attrs = getattr(node, 'attributes', None)
                start = None
                finish = None
                
                if attrs:
                    try:
                        if isinstance(attrs, dict):
                            start = attrs.get('startDate') or attrs.get('StartDate')
                            finish = attrs.get('finishDate') or attrs.get('FinishDate')
                        else:
                            # SDK model object
                            try:
                                start = attrs.get('startDate') if hasattr(attrs, 'get') else getattr(attrs, 'startDate', None) or getattr(attrs, 'StartDate', None)
                            except Exception:
                                start = getattr(attrs, 'startDate', None) or getattr(attrs, 'StartDate', None)
                            try:
                                finish = attrs.get('finishDate') if hasattr(attrs, 'get') else getattr(attrs, 'finishDate', None) or getattr(attrs, 'FinishDate', None)
                            except Exception:
                                finish = getattr(attrs, 'finishDate', None) or getattr(attrs, 'FinishDate', None)
                    except Exception:
                        pass
                
                # Normalize dates to ISO strings
                try:
                    from datetime import datetime
                    if isinstance(start, datetime):
                        start = start.date().isoformat()
                    elif start:
                        start = str(start).split('T')[0] if 'T' in str(start) else str(start)
                    
                    if isinstance(finish, datetime):
                        finish = finish.date().isoformat()
                    elif finish:
                        finish = str(finish).split('T')[0] if 'T' in str(finish) else str(finish)
                except Exception:
                    pass
                
                if full_path:
                    out.append({
                        'path': full_path,
                        'name': node_name or full_path.split('\\')[-1],
                        'startDate': start,
                        'finishDate': finish
                    })
                
                # Recurse into children
                children = getattr(node, 'children', None) or []
                for child in children:
                    _walk(child, full_path or prefix)
            
            _walk(n, parent_path)
            return out
        
        iterations = _extract_iterations(node, parent_path=project)
        
        # Sort by startDate (nulls last), then by path
        def sort_key(item):
            start = item.get('startDate')
            if start:
                return (0, start, item.get('path', ''))
            return (1, '', item.get('path', ''))
        
        iterations.sort(key=sort_key)
        
        return iterations
