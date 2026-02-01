"""Markers operations for Azure DevOps delivery plans.

This module contains operations related to fetching markers (milestones/annotations)
from delivery plans.
"""
from __future__ import annotations
from typing import List, Optional, Any
import logging

logger = logging.getLogger(__name__)


class MarkersOperations:
    """Handles markers queries for delivery plans."""
    
    def __init__(self, client, team_plan_ops):
        """Initialize with references to parent client and team/plan operations.
        
        Args:
            client: Parent Azure client with connection and storage
            team_plan_ops: TeamPlanOperations instance for team/plan queries
        """
        self.client = client
        self.team_plan_ops = team_plan_ops
    
    def _model_to_primitive(self, obj: Any) -> Optional[dict]:
        """Convert SDK model object to a primitive dictionary.
        
        This is defensive since model objects vary between SDK versions.
        
        Args:
            obj: SDK model object or value
            
        Returns:
            Dictionary with extracted attributes or None
        """
        if obj is None:
            return None
        if isinstance(obj, dict):
            return obj
        
        # Try common attributes first
        out = {}
        for attr in ('id', 'markerId', 'title', 'name', 'teamId', 'teamName', 
                     'date', 'startDate', 'endDate', 'workItemId'):
            try:
                val = getattr(obj, attr, None)
                if val is not None:
                    out[attr] = val
            except Exception:
                continue
        
        # If we found something useful, return it
        if out:
            return out
        
        # Fallback: build small dict of public non-callable attrs
        try:
            for k in dir(obj):
                if k.startswith('_'):
                    continue
                try:
                    v = getattr(obj, k)
                except Exception:
                    continue
                if callable(v):
                    continue
                # Limit size
                sval = repr(v)
                if len(sval) > 200:
                    sval = sval[:200] + '...'
                out[k] = sval
                if len(out) >= 8:
                    break
        except Exception:
            return {'repr': repr(obj)[:200]}
        
        return out or {'repr': repr(obj)[:200]}
    
    def get_markers_for_plan(self, project: str, plan_id: str) -> List[dict]:
        """Fetch markers for a specific delivery plan.
        
        Args:
            project: Project name or ID
            plan_id: Delivery plan ID
            
        Returns:
            List of marker dictionaries
        """
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        
        assert self.client.conn is not None
        work_client = self.client.conn.clients.get_work_client()
        
        try:
            full_plan = None
            if hasattr(work_client, 'get_plan'):
                try:
                    full_plan = work_client.get_plan(project=project, id=plan_id)
                except TypeError:
                    full_plan = work_client.get_plan(project, plan_id)
            
            props = None
            if full_plan is not None:
                props = getattr(full_plan, 'properties', None) or (
                    full_plan.get('properties') if isinstance(full_plan, dict) else None
                )
            
            markers_prop = None
            if props:
                markers_prop = props.get('markers') if isinstance(props, dict) and 'markers' in props else None
                if markers_prop is None:
                    markers_prop = getattr(props, 'markers', None)
            
            if not markers_prop:
                return []
            
            out = []
            for m in markers_prop:
                out.append(self._model_to_primitive(m))
            
            return out
        except Exception:
            return []
    
    def get_markers(self, area_path: str) -> List[dict]:
        """Fetch markers for delivery plans that reference a given area path.
        
        Used primarily for admin UI plan discovery. Production marker fetching
        uses get_markers_for_plan() directly with plan IDs from area_plan_map.yml.
        
        This finds teams that own the area, then finds delivery plans containing
        those teams, and finally extracts markers from those plans.
        
        Args:
            area_path: Azure DevOps area path
            
        Returns:
            List of marker entries with plan/team context
        """
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(pat):' to obtain a connected client.")
        
        assert self.client.conn is not None
        
        # Derive project and normalize area path
        if not isinstance(area_path, str) or not area_path:
            return []
        
        project = area_path.split('\\')[0] if '\\' in area_path else area_path.split('/')[0]
        targ_area = area_path.rstrip('\\/')
        
        # Find owning teams for the area path
        owner_team_ids = self.team_plan_ops.get_team_from_area_path(project, area_path)
        if not owner_team_ids:
            return []
        
        work_client = self.client.conn.clients.get_work_client()
        markers_out: List[dict] = []
        
        # Find plans that reference these teams
        plans = self.team_plan_ops.get_all_plans(project)
        if not plans:
            return []
        
        for pl in plans:
            plan_id = pl.get('id')
            plan_name = pl.get('name')
            plan_teams = pl.get('teams') or []
            
            # Check if any team in plan_teams matches our owner_team_ids
            matched = False
            matched_team_ids = []
            
            for t in plan_teams:
                tid = t.get('id') if isinstance(t, dict) else str(t)
                if tid in owner_team_ids:
                    matched = True
                    matched_team_ids.append((tid, t.get('name') if isinstance(t, dict) else None))
            
            if not matched:
                continue
            
            # Prefer markers stored directly on the plan properties
            try:
                full_plan = None
                if hasattr(work_client, 'get_plan'):
                    try:
                        full_plan = work_client.get_plan(project=project, id=plan_id)
                    except TypeError:
                        full_plan = work_client.get_plan(project, plan_id)
                
                props = None
                if full_plan is not None:
                    props = getattr(full_plan, 'properties', None) or (
                        full_plan.get('properties') if isinstance(full_plan, dict) else None
                    )
                
                markers_prop = None
                if props:
                    markers_prop = props.get('markers') if isinstance(props, dict) and 'markers' in props else None
                    if markers_prop is None:
                        markers_prop = getattr(props, 'markers', None)
                
                if markers_prop:
                    for m in markers_prop:
                        markers_out.append({
                            'plan_id': plan_id,
                            'plan_name': plan_name,
                            'team_id': matched_team_ids[0][0] if matched_team_ids else None,
                            'team_name': matched_team_ids[0][1] if matched_team_ids and matched_team_ids[0][1] else None,
                            'marker': self._model_to_primitive(m),
                        })
                    # If plan contains explicit markers, prefer those and skip timeline parsing
                    continue
            except Exception:
                # Non-fatal; fall back to timeline parsing
                pass
            
            # Fetch timeline data for the plan
            try:
                timeline = None
                if hasattr(work_client, 'get_delivery_timeline_data'):
                    timeline = work_client.get_delivery_timeline_data(project, plan_id)
                else:
                    timeline = None
            except Exception:
                timeline = None
            
            if timeline is None:
                continue
            
            # Find the team entries in the timeline and extract marker-like attributes
            team_entries = getattr(timeline, 'teams', None) or (
                timeline.get('teams') if isinstance(timeline, dict) else None
            ) or []
            
            for te in team_entries or []:
                # Determine team id
                tid = None
                tname = None
                
                try:
                    tid = getattr(te, 'id', None) or getattr(te, 'teamId', None) or (
                        te.get('id') if isinstance(te, dict) else None
                    )
                except Exception:
                    tid = None
                
                try:
                    tname = getattr(te, 'name', None) or getattr(te, 'teamName', None) or (
                        te.get('name') if isinstance(te, dict) else None
                    )
                except Exception:
                    tname = None
                
                if str(tid) not in owner_team_ids:
                    continue
                
                # Collect marker-like fields from the team entry
                candidate_attrs = [a for a in dir(te) if 'marker' in a.lower()] if not isinstance(te, dict) else [
                    k for k in te.keys() if 'marker' in k.lower()
                ]
                
                found = []
                
                # Try attributes
                for a in candidate_attrs:
                    try:
                        val = getattr(te, a) if not isinstance(te, dict) else te.get(a)
                        if val:
                            found.append(self._model_to_primitive(val))
                    except Exception:
                        continue
                
                # Also inspect nested rows/items for markers
                if not found:
                    rows = getattr(te, 'rows', None) if not isinstance(te, dict) else te.get('rows')
                    if rows:
                        for r in rows:
                            for a in (k for k in dir(r) if 'marker' in k.lower()):
                                try:
                                    val = getattr(r, a)
                                    if val:
                                        found.append(self._model_to_primitive(val))
                                except Exception:
                                    continue
                
                # If we found marker data, append to output with context
                for fm in found:
                    markers_out.append({
                        'plan_id': plan_id,
                        'plan_name': plan_name,
                        'team_id': str(tid),
                        'team_name': tname,
                        'marker': fm,
                    })
        
        return markers_out
