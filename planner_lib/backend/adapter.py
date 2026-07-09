"""AzureAdapter: translates between raw Azure DevOps dicts and DomainTask.

Two directions:
  to_domain()   — raw ADO work-item dict → enriched DomainTask
  to_backend()  — update payload dict    → ADO write kwargs (used by AzureDevOpsBackend.write_task)

The adapter is the single place where ADO field names, team-name/ID
mapping, type capitalisation normalisation, and iteration-date inference
all live.  Extracting this logic from TaskService and TaskUpdateService
into a dedicated class makes each step independently testable.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Any
import logging

from planner_lib.domain.tasks import DomainTask, DomainRelation, DomainCapacity

logger = logging.getLogger(__name__)

# Sentinel: distinguishes "argument not supplied" from "explicitly None"
_UNSET = object()


class AzureAdapter:
    """Translates Azure DevOps API dicts to/from DomainTask.

    The adapter is stateless; all context (project name, team service,
    type canonical map, iteration map) is passed per-call so the adapter
    instance is safe to share.
    """

    # ------------------------------------------------------------------
    # ADO → DomainTask
    # ------------------------------------------------------------------

    def to_domain(
        self,
        raw_wi: Dict[str, Any],
        project_slug: str,
        team_repository,
        type_canonical: Dict[str, str],
        iteration_map: Dict[str, Any],
        capacity_service=None,
    ) -> DomainTask:
        """Convert one raw ADO work-item dict into a DomainTask.

        Parameters
        ----------
        raw_wi:
            Dict as returned by WorkItemOperations.get_work_items() — uses
            planner-normalised field names (``startDate``, ``finishDate``, etc.).
        project_slug:
            The project identifier string (e.g. ``'project-my-team'``).
        team_repository:
            TeamRepository — used to map team display names to IDs.
        type_canonical:
            Dict mapping lowercased type string → canonical casing.
        iteration_map:
            Dict mapping normalised iteration path → ``{startDate, finishDate, name}``.
        capacity_service:
            Optional CapacityService for parsing capacity from description.
        """
        raw_type = raw_wi.get('type') or ''
        canonical_type = type_canonical.get(raw_type.lower(), raw_type)

        # Parse capacity allocation from HTML description field
        filtered_capacity: List[DomainCapacity] = []
        if capacity_service is not None:
            try:
                parsed = capacity_service.parse(raw_wi.get('description'))
                for entry in parsed:
                    mapped = team_repository.name_to_id(entry['team'])
                    if mapped is None:
                        continue
                    filtered_capacity.append(
                        DomainCapacity(team=mapped, capacity=entry.get('capacity', 0))
                    )
            except Exception as exc:
                logger.debug('Capacity parse failed for item %s: %s', raw_wi.get('id'), exc)

        # Date fields — infer from iteration when explicitly missing
        start_date = raw_wi.get('startDate')
        end_date = raw_wi.get('finishDate')
        iteration_path = raw_wi.get('iterationPath')
        inferred_start = False
        inferred_end = False

        if iteration_path and iteration_path in iteration_map:
            iter_data = iteration_map[iteration_path]
            if not start_date and iter_data.get('startDate'):
                start_date = iter_data['startDate']
                inferred_start = True
            if not end_date and iter_data.get('finishDate'):
                end_date = iter_data['finishDate']
                inferred_end = True

        task: DomainTask = {
            'id': str(raw_wi.get('id', '')),
            'title': raw_wi.get('title') or '',
            'type': canonical_type,
            'state': raw_wi.get('state') or '',
            'project': project_slug,
            'start': start_date,
            'end': end_date,
            'iterationPath': iteration_path,
            'parentId': raw_wi.get('parentId'),
            'relations': raw_wi.get('relations') or [],
            'capacity': filtered_capacity,
            'description': raw_wi.get('description'),
            'assignee': raw_wi.get('assignee'),
            'tags': raw_wi.get('tags'),
            'areaPath': raw_wi.get('areaPath'),
            'url': raw_wi.get('url'),
        }
        # Extra ADO field values (e.g. Priority, ProductType) fetched when
        # extra_fields is configured in projects.yml.  Only include when
        # present and non-empty to keep the task dict compact.
        extra = raw_wi.get('fields')
        if extra:
            task['fields'] = extra
        if inferred_start:
            task['_inferred_start'] = True
        if inferred_end:
            task['_inferred_end'] = True

        return task

    # ------------------------------------------------------------------
    # Update payload → ADO write arguments
    # ------------------------------------------------------------------

    def extract_date_kwargs(self, update: Dict[str, Any]) -> Dict[str, Any]:
        """Extract date fields from an update payload as kwargs for write_item_dates.

        Uses key-presence semantics: a key explicitly set to None means
        "clear the field"; an absent key means "leave unchanged".
        """
        kwargs: Dict[str, Any] = {}
        if 'start' in update:
            kwargs['start'] = update['start']
        if 'end' in update:
            kwargs['end'] = update['end']
        return kwargs

    def has_date_update(self, update: Dict[str, Any]) -> bool:
        return 'start' in update or 'end' in update

    def has_capacity_update(self, update: Dict[str, Any]) -> bool:
        cap = update.get('capacity')
        return cap is not None and isinstance(cap, list)

    def has_state_update(self, update: Dict[str, Any]) -> bool:
        return update.get('state') is not None

    def has_iteration_update(self, update: Dict[str, Any]) -> bool:
        return 'iterationPath' in update

    def has_tags_update(self, update: Dict[str, Any]) -> bool:
        return 'tags' in update

    def has_relations_update(self, update: Dict[str, Any]) -> bool:
        return update.get('relations') is not None
