"""Read-only deletion evidence and exact canonical availability changes."""
from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from hashlib import sha256
import json
from typing import Any, TYPE_CHECKING

from typing_extensions import NotRequired, TypedDict

from planner_lib.domain.teams import AllocationDefinition, TeamDefinition
from planner_lib.domain.workforce import StaffingDefinition
from planner_lib.storage.base import StorageBackend

if TYPE_CHECKING:
    from planner_lib.admin.workforce_config import WorkforceSnapshot


class ReferenceLocation(TypedDict):
    """One retained reference or proposed availability-list edit, without task contents."""

    namespace: str
    key: str
    path: list[str | int]
    record_id: NotRequired[str]


class DeletionCoverage(TypedDict):
    """Evidence coverage never proves historical ADO references are absent."""

    historically_complete: bool
    retained_task_snapshots: int


class TeamDeletionReview(TypedDict):
    """Confirmation receipt and the known consequences of deleting one team."""

    revision: str
    review_revision: str
    team: TeamDefinition
    group: AllocationDefinition | None
    staffing: list[StaffingDefinition]
    availability: list[ReferenceLocation]
    retained_allocations: list[ReferenceLocation]
    saved_selections: list[ReferenceLocation]
    coverage: DeletionCoverage


def _availability_changes(
    value: Any, path: list[str | int], key: str, team_id: str,
    changes: list[ReferenceLocation],
) -> Any:
    if isinstance(value, Mapping):
        result = {}
        for field, child in value.items():
            if field == 'allocation_defaults':
                if not isinstance(child, Mapping):
                    raise ValueError('allocation_defaults must be an object')
                result[field] = {
                    kind: _remove_available(ids, [*path, field, kind], key, team_id, changes)
                    for kind, ids in child.items()
                }
            elif field == 'allocatable_ids':
                result[field] = _remove_available(child, [*path, field], key, team_id, changes)
            else:
                result[field] = _availability_changes(child, [*path, field], key, team_id, changes)
        return result
    if isinstance(value, list):
        return [_availability_changes(child, [*path, index], key, team_id, changes)
                for index, child in enumerate(value)]
    return value


def _remove_available(
    value: Any, path: list[str | int], key: str, team_id: str,
    changes: list[ReferenceLocation],
) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(identity, str) for identity in value):
        raise ValueError('Allocation availability must contain an explicit list of IDs')
    if team_id in value:
        changes.append(ReferenceLocation(namespace='config', key=key, path=path))
    return [identity for identity in value if identity != team_id]


def _retained_references(
    value: Any, path: list[str | int], namespace: str, key: str, team: TeamDefinition,
    allocations: list[ReferenceLocation], selections: list[ReferenceLocation],
    record_id: str | None = None,
) -> None:
    if isinstance(value, Mapping):
        if 'id' in value:
            record_id = str(value['id'])
        for field, child in value.items():
            if field == 'backendData':
                continue
            child_path = [*path, field]
            if field == 'capacity':
                if not isinstance(child, list):
                    raise ValueError('Retained allocation capacity must be a list')
                for index, entry in enumerate(child):
                    if not isinstance(entry, Mapping) or not isinstance(entry.get('team'), str):
                        raise ValueError('Retained allocation must contain a string team identity')
                    if entry['team'] == team['id'] or (
                        entry['team'].strip().lower() == team['allocation_token'].strip().lower()
                    ):
                        location = ReferenceLocation(
                            namespace=namespace, key=key, path=[*child_path, index, 'team'],
                        )
                        if record_id is not None:
                            location['record_id'] = record_id
                        allocations.append(location)
            elif field in {'teams', 'teamIds', 'team_ids', 'selectedTeams'}:
                if not isinstance(child, list) or any(not isinstance(identity, str) for identity in child):
                    raise ValueError('Saved team selections must contain an explicit list of IDs')
                if team['id'] in child:
                    selections.append(ReferenceLocation(namespace=namespace, key=key, path=child_path))
            elif field == 'overrides':
                if not isinstance(child, Mapping):
                    raise ValueError('Retained scenario overrides must be an object')
                for identity, override in child.items():
                    _retained_references(override, [*child_path, identity], namespace, key, team,
                                         allocations, selections, str(identity))
            else:
                _retained_references(child, child_path, namespace, key, team,
                                     allocations, selections, record_id)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _retained_references(child, [*path, index], namespace, key, team,
                                 allocations, selections, record_id)


def build_deletion_review(
    storage: StorageBackend, task_storage: StorageBackend, snapshot: WorkforceSnapshot, team_id: str,
) -> tuple[TeamDeletionReview, dict[str, Any]]:
    """Inspect only retained data; propose availability edits without mutating any store."""
    teams = {team['id']: team for team in snapshot['teams']['teams']}
    if team_id not in teams:
        raise ValueError(f'Unknown team: {team_id}')
    team = teams[team_id]
    groups = {group['id']: group for group in snapshot['teams']['groups']}
    review = TeamDeletionReview(
        revision=snapshot['revision'], review_revision='', team=deepcopy(team),
        group=deepcopy(groups.get(team['group_id'])),
        staffing=[deepcopy(row) for row in snapshot['workforce']['staffing'] if row['team_id'] == team_id],
        availability=[], retained_allocations=[], saved_selections=[],
        coverage=DeletionCoverage(historically_complete=False, retained_task_snapshots=0),
    )
    config_changes: dict[str, Any] = {}
    config_evidence: dict[str, Any] = {}
    for key in ('projects', 'area_plan_map'):
        if storage.exists('config', key):
            original = storage.load('config', key)
            if not isinstance(original, (Mapping, list)):
                raise ValueError(f'{key} requires structured configuration for deletion review')
            candidate = _availability_changes(original, [], key, team_id, review['availability'])
            config_evidence[key] = original
            if candidate != original:
                config_changes[key] = candidate
    for namespace, register in [('scenarios', 'scenario_register'), ('views', 'view_register')]:
        for key in sorted(storage.list_keys(namespace)):
            if key != register:
                record = storage.load(namespace, key)
                if not isinstance(record, Mapping):
                    raise ValueError(f'{namespace} requires structured records for deletion review')
                _retained_references(record, [], namespace, key, team,
                                     review['retained_allocations'], review['saved_selections'])
    for key in sorted(task_storage.list_keys('backend_domain')):
        if key.startswith(('fetch_tasks__', 'fetch_plan_tasks__', 'fetch_task_context__')):
            records = task_storage.load('backend_domain', key)
            if not isinstance(records, list):
                raise ValueError('Task cache requires a structured task list for deletion review')
            _retained_references(records, [], 'backend_domain', key, team,
                                 review['retained_allocations'], review['saved_selections'])
            review['coverage']['retained_task_snapshots'] += 1
    evidence = json.dumps({'review': review, 'configuration': config_evidence}, sort_keys=True,
                          allow_nan=False, separators=(',', ':')).encode('utf-8')
    review['review_revision'] = sha256(evidence).hexdigest()
    return review, config_changes