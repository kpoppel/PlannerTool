"""Work item operations for Azure DevOps.

This module contains operations related to fetching and updating work items.
"""
from __future__ import annotations
from typing import List, Optional, Any
import logging
from planner_lib.azure.catalogue import imported_type_index, resolve_plan_process, seed_in_window
from planner_lib.backend.errors import AreaNotReadableError, BackendAuthError, classify_ado_exception

logger = logging.getLogger(__name__)

# Sentinel that distinguishes "caller did not supply this argument" from
# "caller explicitly passed None (meaning: clear the field in ADO)".
_UNSET = object()


def _wiql_literal(value: str) -> str:
    escaped = value.replace("'", "''").replace('\\', '\\\\')
    return f"'{escaped}'"


def _read_items(wit, ids, **kwargs):
    try:
        return wit.get_work_items(ids, **kwargs)
    except Exception as exc:
        if isinstance(classify_ado_exception(exc), BackendAuthError):
            raise AreaNotReadableError('work item ' + str(ids[0])) from exc
        raise


def _omitted_ids(wit, ids, items):
    absent = set(ids) - {int(item.id) for item in items}
    if absent:
        try:
            deleted = wit.get_deleted_work_items(ids=sorted(absent))
        except Exception as exc:
            if isinstance(classify_ado_exception(exc), BackendAuthError):
                raise AreaNotReadableError('work item ' + str(min(absent))) from exc
            raise
        unreadable = absent - {int(item.id) for item in deleted}
        if unreadable:
            raise AreaNotReadableError('work item ' + str(min(unreadable)))
    return absent


class WorkItemOperations:
    """Handles work item queries and updates."""
    
    def __init__(self, client):
        """Initialize with a reference to the parent client.
        
        Args:
            client: Parent Azure client with connection and storage
        """
        self.client = client
    
    def _sanitize_area_path(self, path: str) -> str:
        """Sanitize an area path for use in WIQL queries.
        
        Args:
            path: Raw area path
            
        Returns:
            Sanitized area path
        """
        if not isinstance(path, str):
            return path
        return path.lstrip('/\\').replace('/', '\\').replace('Area\\', '')
    
    def _safe_date(self, date_value: Any) -> Optional[str]:
        """Convert date value to ISO date string.
        
        Args:
            date_value: Date value from Azure API
            
        Returns:
            ISO date string (YYYY-MM-DD) or None
        """
        if not date_value:
            return None
        return str(date_value)[:10]
    
    def api_url_to_ui_link(self, api_url: str) -> str:
        """Convert Azure API URL to web UI link.
        
        Args:
            api_url: API URL for a work item
            
        Returns:
            Web UI URL
        """
        import re
        m = re.match(r"https://dev\.azure\.com/([^/]+)/([^/]+)/_apis/wit/workItems/(\d+)", api_url)
        if not m:
            raise ValueError("Invalid API URL format")
        org, project, work_item_id = m.groups()
        return f"https://dev.azure.com/{org}/{project}/_workitems/edit/{work_item_id}"
    
    def get_work_items(
        self, 
        area_path: str, 
        task_types: List[str],
        *, catalogue: dict, closed_history_days: int = 0,
    ) -> List[dict]:
        """Fetch work items for a given area path.
        
        This implementation fetches work items based on reviewed types and their
        catalogue state categories. All ADO field values are
        returned — standard fields are exposed as named keys, and any remaining
        fields (custom, extension, or otherwise) are collected under a 'fields'
        dict keyed by ADO field reference name.
        
        Args:
            area_path: Azure DevOps area path
            task_types: Imported work item types for the plan's process.
            catalogue: Server-owned process/type/state metadata.
            closed_history_days: Completed seed history window in days.
            
        Returns:
            List of work item dictionaries
        """
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(credential):' to obtain a connected client.")
        
        assert self.client.conn is not None
        wit_client = self.client.wit_client
        
        process = resolve_plan_process({
            'name': area_path, 'area_path': area_path, 'task_types': task_types,
        }, catalogue)
        selected_names = {name.casefold() for name in task_types}
        selected_types = [item for item in process['types']
                          if item['name'].casefold() in selected_names]
        
        # Sanitize and escape area path for WIQL
        wiql_area = self._sanitize_area_path(area_path)
        wiql_area_literal = _wiql_literal(wiql_area)
        
        # Build work item types clause.
        # Use the type string exactly as stored in config; Azure WIQL is case-insensitive
        # but the names come directly from Azure DevOps metadata so casing is already correct.
        types_list = [_wiql_literal(item['name']) for item in selected_types]
        types_clause = ','.join(types_list)

        active = dict.fromkeys(state['name'] for item in selected_types for state in item['states']
                               if state['category'] in ('Proposed', 'InProgress', 'Resolved'))
        completed = dict.fromkeys(state['name'] for item in selected_types for state in item['states']
                                  if state['category'] == 'Completed')
        clauses = []
        if active:
            clauses.append(f"[System.State] IN ({','.join(_wiql_literal(name) for name in active)})")
        if closed_history_days > 0 and completed:
            clauses.append(
                f"([System.State] IN ({','.join(_wiql_literal(name) for name in completed)}) "
                f"AND [Microsoft.VSTS.Common.StateChangeDate] >= @Today - {closed_history_days})")
        if not clauses:
            return []
        states_clause = 'AND (' + ' OR '.join(clauses) + ')'
        
        wiql_query = f"""
        SELECT [System.Id]
        FROM WorkItems
        WHERE [System.WorkItemType] IN ({types_clause})
        AND [System.AreaPath] = {wiql_area_literal}
        {states_clause}
        ORDER BY [Microsoft.VSTS.Common.StackRank] ASC
        """
        
        from azure.devops.v7_1.work_item_tracking.models import Wiql
        wiql_obj = Wiql(query=wiql_query)

        try:
            result = wit_client.query_by_wiql(wiql=wiql_obj)
        except Exception as exc:
            if isinstance(classify_ado_exception(exc), BackendAuthError):
                raise AreaNotReadableError(area_path) from exc
            raise
        
        # Extract work item IDs
        task_ids = [getattr(wi, "id", None) for wi in (getattr(result, "work_items", []) or [])]
        task_ids = [int(t) for t in task_ids if t is not None]
        logger.debug(f"Found {len(task_ids)} work items for area '{area_path}'")

        ret = []
        selected_by_name = {item['name'].casefold(): item for item in selected_types}
        for offset in range(0, len(task_ids), 200):
            batch = task_ids[offset:offset + 200]
            items = _read_items(wit_client, batch, expand="All")
            _omitted_ids(wit_client, batch, items)
            for item in items:
                normalized = self.normalize_work_item(item)
                name = normalized['type'].casefold()
                if name in selected_by_name and seed_in_window(
                    selected_by_name[name], normalized['state'], normalized['stateChangeDate'],
                    closed_history_days,
                ):
                    ret.append(normalized)
        return ret

    def normalize_work_item(self, item) -> dict:
        """Normalize full seed and explicit-ID payloads through the same path."""
        # Standard fields already promoted to named top-level keys. All remaining
        # fields stay available to plugins without per-project configuration.
        standard_fields = frozenset({
            'System.Id',
            'System.TeamProject',
            'System.Rev',
            'System.WorkItemType',
            'System.Title',
            'System.AssignedTo',
            'System.State',
            'System.Tags',
            'System.Description',
            'Microsoft.VSTS.Common.StateChangeDate',
            'Microsoft.VSTS.Scheduling.StartDate',
            'Microsoft.VSTS.Scheduling.TargetDate',
            'System.AreaPath',
            'System.IterationPath',
        })
        relation_map = []
        for relation in item.relations or []:
            name = relation.attributes.get('name')
            if name in ('Parent', 'Child', 'Related', 'Predecessor', 'Successor'):
                relation_map.append({
                    'type': name,
                    'id': str(relation.url.split('/')[-1]),
                    'url': self.api_url_to_ui_link(relation.url),
                })
        assigned = item.fields.get('System.AssignedTo')
        extra_values = {
            key: value for key, value in item.fields.items()
            if key not in standard_fields and value is not None
        }
        entry = {
            'id': str(item.id),
            'rev': item.fields.get('System.Rev', item.rev if hasattr(item, 'rev') else 0),
            'adoProject': item.fields.get('System.TeamProject'),
            'type': item.fields.get('System.WorkItemType') or '',
            'title': item.fields.get('System.Title'),
            'assignee': assigned.get('displayName', '') if isinstance(assigned, dict) else '',
            'state': item.fields.get('System.State'),
            'stateChangeDate': item.fields.get('Microsoft.VSTS.Common.StateChangeDate'),
            'tags': item.fields.get('System.Tags'),
            'description': item.fields.get('System.Description'),
            'startDate': self._safe_date(item.fields.get('Microsoft.VSTS.Scheduling.StartDate')),
            'finishDate': self._safe_date(item.fields.get('Microsoft.VSTS.Scheduling.TargetDate')),
            'areaPath': item.fields.get('System.AreaPath'),
            'iterationPath': item.fields.get('System.IterationPath'),
            'parentId': next((r['id'] for r in relation_map if r['type'] == 'Parent'), None),
            'relations': relation_map,
            'url': self.api_url_to_ui_link(item.url),
        }
        if extra_values:
            entry['fields'] = extra_values
        return entry

    def get_linked_work_items(self, seeds: List[dict], *, catalogue: dict) -> List[dict]:
        """Expand descendants, then load ancestor paths without sibling branches."""
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(credential):' to obtain a connected client.")
        wit = self.client.wit_client
        eligible = imported_type_index(catalogue)
        excluded = set()
        loaded = {}
        for item in seeds:
            item_id = int(item['id'])
            if (item['adoProject'].casefold(), item['type'].casefold()) not in eligible:
                excluded.add(item_id)
                continue
            if item_id not in loaded or item['rev'] > loaded[item_id]['rev']:
                loaded[item_id] = dict(item)
        missing = set()
        expanded = set()

        frontier = list(loaded)
        while frontier:
            targets = set()
            for item_id in frontier:
                if item_id in expanded:
                    continue
                expanded.add(item_id)
                item = loaded[item_id]
                targets.update(int(r['id']) for r in item['relations'] if r['type'] == 'Child')
            todo = sorted(targets - loaded.keys() - excluded - missing)
            for offset in range(0, len(todo), 200):
                batch = todo[offset:offset + 200]
                classified = _read_items(
                    wit, batch, fields=['System.TeamProject', 'System.WorkItemType'], error_policy='omit')
                missing.update(_omitted_ids(wit, batch, classified))
                identities = {
                    int(item.id): (item.fields['System.TeamProject'], item.fields['System.WorkItemType'])
                    for item in classified
                }
                allowed = []
                for item in classified:
                    if (item.fields['System.TeamProject'].casefold(),
                            item.fields['System.WorkItemType'].casefold()) not in eligible:
                        excluded.add(int(item.id))
                    else:
                        allowed.append(int(item.id))
                if allowed:
                    hydrated = _read_items(wit, allowed, expand='All', error_policy='omit')
                    missing.update(_omitted_ids(wit, allowed, hydrated))
                    for item in hydrated:
                        identity = (item.fields['System.TeamProject'], item.fields['System.WorkItemType'])
                        if identity != identities[int(item.id)]:
                            raise RuntimeError(f'Hierarchy classification changed for work item {item.id}')
                        loaded[int(item.id)] = self.normalize_work_item(item)
            frontier = sorted(targets & loaded.keys() - expanded)

        descendant_ids = set(loaded)
        # Ancestors are a separate pass: their Child links must never widen the forest.
        frontier = list(loaded)
        expanded_parents = set()
        missing_parents = set()
        while frontier:
            targets = set()
            for item_id in frontier:
                if item_id in expanded_parents:
                    continue
                expanded_parents.add(item_id)
                item = loaded[item_id]
                targets.update(int(relation['id']) for relation in item['relations']
                               if relation['type'] == 'Parent')
            todo = sorted(targets - loaded.keys() - missing_parents - excluded)
            for offset in range(0, len(todo), 200):
                batch = todo[offset:offset + 200]
                hydrated = _read_items(wit, batch, expand='All', error_policy='omit')
                missing_parents.update(_omitted_ids(wit, batch, hydrated))
                for item in hydrated:
                    if (item.fields['System.TeamProject'].casefold(),
                            item.fields['System.WorkItemType'].casefold()) in eligible:
                        loaded[int(item.id)] = self.normalize_work_item(item)
                    else:
                        excluded.add(int(item.id))
            frontier = sorted(targets & loaded.keys() - expanded_parents)

        for item in loaded.values():
            children = {int(r['id']) for r in item['relations'] if r['type'] == 'Child'}
            parents = {int(r['id']) for r in item['relations'] if r['type'] == 'Parent'}
            item['ancestorOnly'] = int(item['id']) not in descendant_ids
            item['childrenComplete'] = not item['ancestorOnly']
            item['unresolvedParentIds'] = [str(item_id) for item_id in sorted(parents & missing_parents)]
            item['unresolvedChildIds'] = [str(item_id) for item_id in sorted(children & missing)]
            item['excludedChildIds'] = [str(item_id) for item_id in sorted(
                children & excluded)]
            item['traversalBoundary'] = False
        return list(loaded.values())
    
    def update_work_item_dates(self, work_item_id: int, start=_UNSET, end=_UNSET) -> Any:
        """Update start and/or end dates for a work item.

        Pass a date string (YYYY-MM-DD) to set a field, ``None`` to clear it,
        or omit the argument entirely to leave it unchanged.

        Args:
            work_item_id: Work item ID
            start: Start date string, None to clear, or omitted to leave unchanged.
            end:   End date string,   None to clear, or omitted to leave unchanged.

        Returns:
            Azure SDK response object, or None when nothing changed.
        """
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(credential):' to obtain a connected client.")

        assert self.client.conn is not None
        wit = self.client.wit_client

        ops = []
        clearing_schedule = start is None and end is None
        existing_fields = None
        if start is None or end is None:
            existing_fields = wit.get_work_item(
                id=work_item_id,
                fields=['System.TeamProject', 'Microsoft.VSTS.Scheduling.StartDate',
                        'Microsoft.VSTS.Scheduling.TargetDate'],
            ).fields
        if clearing_schedule:
            ops.append({'op': 'replace', 'path': '/fields/System.IterationPath',
                        'value': existing_fields['System.TeamProject']})
        # Use "remove" to clear a field (None value); "replace" to set a new value.
        # ADO rejects op:replace with a null value, so we must use op:remove to clear.
        if start is not _UNSET:
            if start is None:
                if 'Microsoft.VSTS.Scheduling.StartDate' in existing_fields:
                    ops.append({"op": "remove", "path": "/fields/Microsoft.VSTS.Scheduling.StartDate"})
            else:
                ops.append({"op": "replace", "path": "/fields/Microsoft.VSTS.Scheduling.StartDate", "value": start})
        if end is not _UNSET:
            if end is None:
                if 'Microsoft.VSTS.Scheduling.TargetDate' in existing_fields:
                    ops.append({"op": "remove", "path": "/fields/Microsoft.VSTS.Scheduling.TargetDate"})
            else:
                ops.append({"op": "replace", "path": "/fields/Microsoft.VSTS.Scheduling.TargetDate", "value": end})

        if not ops:
            return None

        try:
            return wit.update_work_item(document=ops, id=work_item_id)
        except Exception as e:
            raise RuntimeError(f"Failed to update work item {work_item_id}: {e}")

    def update_work_item_iteration_path(self, work_item_id: int, iteration_path: Optional[str]) -> Any:
        """Update (or clear) the iteration path for a work item.

        Args:
            work_item_id:   Work item ID
            iteration_path: New ``System.IterationPath`` value, or None to reset
                            to the project root iteration.

        Returns:
            Azure SDK response object.
        """
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(credential):' to obtain a connected client.")

        assert self.client.conn is not None
        wit = self.client.wit_client

        if iteration_path is None:
            # System.IterationPath is required in ADO — reset to the project root
            # (project name only), which is ADO's equivalent of "no sprint assigned".
            work_item = wit.get_work_item(id=work_item_id, fields=["System.TeamProject"])
            iteration_path = work_item.fields.get("System.TeamProject", "")

        ops = [{"op": "replace", "path": "/fields/System.IterationPath", "value": iteration_path}]
        try:
            return wit.update_work_item(document=ops, id=work_item_id)
        except Exception as e:
            raise RuntimeError(f"Failed to update iteration path for work item {work_item_id}: {e}")
    
    def update_work_item_description(self, work_item_id: int, description: str) -> Any:
        """Update the description field for a work item.
        
        Args:
            work_item_id: Work item ID
            description: HTML-formatted description text
            
        Returns:
            Azure SDK response object
        """
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(credential):' to obtain a connected client.")
        
        assert self.client.conn is not None
        wit = self.client.wit_client
        
        ops = [{"op": "add", "path": "/fields/System.Description", "value": description}]
        
        try:
            return wit.update_work_item(document=ops, id=work_item_id)
        except Exception as e:
            raise RuntimeError(f"Failed to update work item {work_item_id} description: {e}")

    def update_work_item_state(self, work_item_id: int, state_value: str) -> Any:
        """Update the System.State field for a work item.

        Args:
            work_item_id: Work item ID
            state_value: New state value (string)

        Returns:
            Azure SDK response object
        """
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(credential):' to obtain a connected client.")

        assert self.client.conn is not None
        wit = self.client.wit_client

        ops = [{"op": "add", "path": "/fields/System.State", "value": state_value}]

        try:
            return wit.update_work_item(document=ops, id=work_item_id)
        except Exception as e:
            raise RuntimeError(f"Failed to update work item {work_item_id} state: {e}")

    def update_work_item_tags(self, work_item_id: int, tags_value: Optional[str]) -> Any:
        """Update the System.Tags field for a work item.

        Args:
            work_item_id: Work item ID
            tags_value: Semicolon-separated tags string. None clears tags.

        Returns:
            Azure SDK response object
        """
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(credential):' to obtain a connected client.")

        assert self.client.conn is not None
        wit = self.client.wit_client

        # ADO accepts empty string to clear System.Tags.
        ops = [{"op": "add", "path": "/fields/System.Tags", "value": tags_value or ""}]

        try:
            return wit.update_work_item(document=ops, id=work_item_id)
        except Exception as e:
            raise RuntimeError(f"Failed to update work item {work_item_id} tags: {e}")

    def update_work_item_relations(self, work_item_id: int, relations_ops: list) -> Any:
        """Update work item relations.

        relations_ops is a list of operations. Supported operations:
          - { op: 'add', type: 'Parent'|'Related'|'Predecessor'|'Successor'|'Child', id: '<id>' }
          - { op: 'remove', type: <type>, id: '<id>' }
          - { op: 'set', type: 'Parent', id: '<id>' }  # remove existing of type then add this

        Returns the Azure SDK response object or raises on failure.
        """
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(credential):' to obtain a connected client.")

        assert self.client.conn is not None
        wit = self.client.wit_client

        # Mapping from semantic type to Azure rel name
        rel_map = {
            'Parent': 'System.LinkTypes.Hierarchy-Reverse',
            'Child': 'System.LinkTypes.Hierarchy-Forward',
            'Predecessor': 'System.LinkTypes.Dependency-Forward',
            'Successor': 'System.LinkTypes.Dependency-Reverse',
            'Related': 'System.LinkTypes.Related'
        }

        # Fetch current relations to support remove operations
        try:
            current = wit.get_work_item(work_item_id, expand='relations')
            current_relations = getattr(current, 'relations', []) or []
        except Exception:
            current_relations = []

        ops = []

        for r in relations_ops or []:
            op = (r.get('op') or '').lower()
            typ = r.get('type') or r.get('relationType') or r.get('relation') or 'Related'
            other_id = str(r.get('id') or '')

            if op == 'set':
                # Remove any existing relations of this type, then add the supplied id
                # Remove in reverse index order to keep indices stable
                remove_indices = []
                for idx, cr in enumerate(current_relations):
                    try:
                        name = cr.attributes.get('name')
                    except Exception:
                        name = None
                    url = getattr(cr, 'url', '') or ''
                    if name == typ and url.endswith('/' + other_id):
                        remove_indices.append(idx)
                for idx in sorted(remove_indices, reverse=True):
                    ops.append({'op': 'remove', 'path': f'/relations/{idx}'})
                # Add new relation
                api_url = f"{self.client.base_url}/_apis/wit/workItems/{other_id}"
                relname = rel_map.get(typ, 'System.LinkTypes.Related')
                ops.append({'op': 'add', 'path': '/relations/-', 'value': {'rel': relname, 'url': api_url, 'attributes': {'name': typ}}})

            elif op == 'remove':
                # remove matching relation(s)
                for idx, cr in enumerate(current_relations):
                    try:
                        name = cr.attributes.get('name')
                    except Exception:
                        name = None
                    url = getattr(cr, 'url', '') or ''
                    if name == typ and (not other_id or url.endswith('/' + other_id)):
                        ops.append({'op': 'remove', 'path': f'/relations/{idx}'})

            elif op == 'add':
                api_url = f"{self.client.base_url}/_apis/wit/workItems/{other_id}"
                relname = rel_map.get(typ, 'System.LinkTypes.Related')
                ops.append({'op': 'add', 'path': '/relations/-', 'value': {'rel': relname, 'url': api_url, 'attributes': {'name': typ}}})
            else:
                # Unsupported op - skip
                continue

        if not ops:
            return None

        try:
            return wit.update_work_item(document=ops, id=work_item_id)
        except Exception as e:
            raise RuntimeError(f"Failed to update work item {work_item_id} relations: {e}")

    def get_work_item_description(self, work_item_id: int) -> str:
        """Fetch the description (HTML) of a single work item.

        Args:
            work_item_id: Work item ID.

        Returns:
            The current System.Description field value as a string (may be empty).
        """
        if not self.client._connected:
            raise RuntimeError(
                "Azure client is not connected. Use 'with client.connect(credential):' to obtain a connected client."
            )
        assert self.client.conn is not None
        wit = self.client.wit_client
        work_item = wit.get_work_item(id=work_item_id, fields=["System.Description"])
        return work_item.fields.get("System.Description", "") or ""
    
    def get_work_item_revision(self, work_item_id: int) -> Optional[int]:
        """Get current revision number for a work item (lightweight API call).
        
        This method fetches only the System.Rev field to minimize data transfer.
        Useful for checking if a work item has changed without fetching full details.
        
        Args:
            work_item_id: Work item ID
            
        Returns:
            Current revision number or None if work item not found
        """
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(credential):' to obtain a connected client.")
        
        assert self.client.conn is not None
        wit = self.client.wit_client
        
        try:
            # Only fetch the System.Rev field for minimal data transfer
            work_item = wit.get_work_item(
                id=work_item_id,
                fields=["System.Rev"]
            )
            return work_item.fields.get("System.Rev")
        except Exception as e:
            logger.warning(f"Failed to get revision for work item {work_item_id}: {e}")
            return None
    
    def get_work_item_revisions_batch(self, work_item_ids: List[int]) -> dict[int, Optional[int]]:
        """Get current revision numbers for multiple work items (batch API call).
        
        This method fetches only the System.Rev field for multiple work items in
        a single API call to minimize network overhead.
        
        Args:
            work_item_ids: List of work item IDs
            
        Returns:
            Dictionary mapping work item ID to revision number (or None if not found)
        """
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(credential):' to obtain a connected client.")
        
        if not work_item_ids:
            return {}
        
        assert self.client.conn is not None
        wit = self.client.wit_client
        
        result = {}
        
        # Batch in chunks of 200 (Azure API limit)
        def chunks(lst, n):
            for i in range(0, len(lst), n):
                yield lst[i:i+n]
        
        try:
            for batch in chunks(work_item_ids, 200):
                # Fetch only System.Rev field for minimal data transfer
                work_items = wit.get_work_items(
                    ids=batch,
                    fields=["System.Rev"]
                )
                
                for work_item in work_items:
                    work_item_id = work_item.id
                    revision = work_item.fields.get("System.Rev")
                    result[work_item_id] = revision
                
                # Mark items not found as None
                for work_item_id in batch:
                    if work_item_id not in result:
                        result[work_item_id] = None
            
            logger.debug(f"Batch fetched revisions for {len(work_item_ids)} work items")
            return result
            
        except Exception as e:
            logger.warning(f"Failed to batch fetch revisions for {len(work_item_ids)} work items: {e}")
            # Return None for all items on error
            return {wid: None for wid in work_item_ids}
    
    def get_work_items_by_ids(self, ids: List[int]) -> List[dict]:
        """Fetch work items by explicit IDs, returning minimal dicts for parent traversal.

        Returns only the fields needed to determine ancestry state and to keep
        walking up the Parent relation chain:  ``id``, ``type``, ``state``,
        and ``relations`` (Parent/Child entries only).

        Used by the closed-task filter to resolve parent items that were not
        returned by the area-path WIQL query.
        """
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(credential):' to obtain a connected client.")
        if not ids:
            return []

        assert self.client.conn is not None
        wit_client = self.client.wit_client

        results: List[dict] = []

        def chunks(lst, n):
            for i in range(0, len(lst), n):
                yield lst[i:i + n]

        try:
            for batch in chunks(ids, 200):
                items = wit_client.get_work_items(batch, expand="relations")
                for item in items or []:
                    try:
                        relations = getattr(item, "relations", []) or []
                        relation_map = []
                        for r in relations:
                            name = (r.attributes.get("name") if hasattr(r, "attributes") else None)
                            if name in ("Parent", "Child"):
                                relation_map.append({
                                    "type": name,
                                    "id": str(r.url.split('/')[-1]),
                                })
                        results.append({
                            "id": str(item.id),
                            "type": item.fields.get("System.WorkItemType") or "",
                            "state": item.fields.get("System.State") or "",
                            "relations": relation_map,
                        })
                    except Exception as e:
                        logger.warning("Error processing fetched item %s: %s", getattr(item, "id", "?"), e)
        except Exception as e:
            logger.warning("get_work_items_by_ids batch failed for ids %s: %s", ids, e)

        return results

    def get_task_revision_history(
        self, 
        work_item_id: int, 
        start_field: str = "Microsoft.VSTS.Scheduling.StartDate",
        end_field: str = "Microsoft.VSTS.Scheduling.TargetDate",
        iteration_field: str = "System.IterationPath"
    ) -> List[dict]:
        """Fetch revision history for a work item focusing on start, end, and iteration changes.
        
        Args:
            work_item_id: Work item ID
            start_field: Field name for start date (project-specific)
            end_field: Field name for end/target date (project-specific)
            iteration_field: Field name for iteration path
            
        Returns:
            List of normalized revision records, each with:
                - changed_at: ISO timestamp string
                - changed_by: User display name
                - changes: List of field changes with field, old_value, new_value
        """
        if not self.client._connected:
            raise RuntimeError("Azure client is not connected. Use 'with client.connect(credential):' to obtain a connected client.")
        
        assert self.client.conn is not None
        wit_client = self.client.wit_client
        
        try:
            # Fetch all revisions for the work item
            revisions = wit_client.get_revisions(id=work_item_id)
            
            tracked_fields = {start_field, end_field, iteration_field}
            result = []
            prev_values = {}
            
            for revision in revisions:
                fields = getattr(revision, 'fields', {})
                if not fields:
                    continue
                
                # Extract metadata
                changed_at = fields.get('System.ChangedDate')
                changed_by_obj = fields.get('System.ChangedBy')
                changed_by = ''
                
                if isinstance(changed_by_obj, dict):
                    changed_by = changed_by_obj.get('displayName', '')
                elif isinstance(changed_by_obj, str):
                    changed_by = changed_by_obj
                
                # Check for changes in tracked fields
                changes = []
                for field_name in tracked_fields:
                    current_value = fields.get(field_name)
                    old_value = prev_values.get(field_name)
                    
                    # Detect change
                    if current_value != old_value or (current_value is not None and field_name not in prev_values):
                        # Determine field label
                        if field_name == start_field:
                            field_label = 'start'
                        elif field_name == end_field:
                            field_label = 'end'
                        elif field_name == iteration_field:
                            field_label = 'iteration'
                        else:
                            continue
                        
                        # Normalize values (dates to ISO date strings)
                        if field_label in ('start', 'end'):
                            new_value = self._safe_date(current_value) if current_value else None
                            old_val = self._safe_date(old_value) if old_value else None
                        else:
                            new_value = current_value
                            old_val = old_value
                        
                        # Only record if there's an actual change in normalized values
                        if new_value != old_val:
                            changes.append({
                                'field': field_label,
                                'old_value': old_val,
                                'new_value': new_value
                            })
                    
                    # Update tracking
                    if current_value is not None:
                        prev_values[field_name] = current_value
                
                # Add record if there were relevant changes
                if changes:
                    # Convert changed_at to ISO string
                    changed_at_str = str(changed_at) if changed_at else ''
                    result.append({
                        'changed_at': changed_at_str,
                        'changed_by': changed_by,
                        'changes': changes
                    })
            
            logger.debug(f"Fetched {len(result)} revision records for work item {work_item_id}")
            return result
            
        except Exception as e:
            logger.warning(f"Failed to fetch revision history for work item {work_item_id}: {e}")
            return []
