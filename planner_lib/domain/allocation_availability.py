"""Canonical allocation choices, independent of presentation and calculation scope."""
from collections import Counter
from collections.abc import Mapping, Sequence
from math import isfinite
from typing import Any, TypedDict


class ExistingAllocation(TypedDict):
    """Readable allocation with independent identity and new-choice eligibility."""
    team: str
    capacity: float
    known: bool
    archived: bool
    eligible: bool


class AllocationAvailability(TypedDict):
    """Offered new identities plus unchanged retained allocation identities."""
    allowed_ids: list[str]
    existing: list[ExistingAllocation]


def validate_available_ids(ids: Any, catalogue: Mapping[str, Any]) -> list[str]:
    """Reject malformed, duplicate or unresolved configuration identities."""
    if not isinstance(ids, list) or any(not isinstance(item, str) or not item for item in ids):
        raise ValueError('Allocation availability must be a list of nonempty IDs')
    if len(set(ids)) != len(ids):
        raise ValueError('Allocation availability contains duplicate IDs')
    for item in ids:
        if item not in catalogue:
            raise ValueError(f'Unknown allocation availability ID: {item}')
    return list(ids)


def validate_project_availability(
    config: Mapping[str, Any], catalogue: Sequence[Mapping[str, Any]],
) -> None:
    """Validate canonical level defaults and replacement overrides before persistence."""
    if not isinstance(config, Mapping) or not {
        'schema_version', 'container_types', 'allocation_defaults', 'project_map'
    }.issubset(config):
        raise ValueError('Canonical projects require schema, hierarchy, plans and allocation defaults')
    if config['schema_version'] != 4:
        raise ValueError('Canonical projects require schema_version 4')
    levels = config['container_types']
    if (not isinstance(levels, list) or not levels
            or any(not isinstance(level, str) or not level for level in levels)
            or len(set(levels)) != len(levels)):
        raise ValueError('Invalid project container hierarchy')
    defaults = config['allocation_defaults']
    if not isinstance(defaults, Mapping) or set(defaults) != set(levels):
        raise ValueError('Allocation defaults must match configured container types')
    by_id = {record['id']: record for record in catalogue}
    for identities in defaults.values():
        validate_available_ids(identities, by_id)
    if not isinstance(config['project_map'], list):
        raise ValueError('Project mappings must be a list')
    for project in config['project_map']:
        if not isinstance(project, Mapping) or project.get('type') not in levels:
            raise ValueError('Invalid project container hierarchy')
        if 'allocatable_ids' in project:
            validate_available_ids(project['allocatable_ids'], by_id)


def project_allocation_availability(
    feature: Mapping[str, Any], projects: Sequence[Mapping[str, Any]],
    catalogue: Sequence[Mapping[str, Any]], allocation_defaults: Mapping[str, Any],
) -> AllocationAvailability:
    """Resolve explicit owner settings without inferring choices from importing plans."""
    by_id = {item['id']: item for item in catalogue}
    if len(by_id) != len(catalogue):
        raise ValueError('Allocation catalogue contains duplicate IDs')
    for ids in allocation_defaults.values():
        validate_available_ids(ids, by_id)
    for project in projects:
        if 'allocatable_ids' in project:
            validate_available_ids(project['allocatable_ids'], by_id)
        if project['type'] not in allocation_defaults:
            raise ValueError(f"Missing allocation default for container type: {project['type']}")
    owner = next((item for item in projects if item['id'] == feature.get('project')), None)
    ids = [] if owner is None else (
        owner['allocatable_ids'] if 'allocatable_ids' in owner else allocation_defaults[owner['type']]
    )
    allowed = [item for item in ids if not by_id[item]['archived']]
    existing: list[ExistingAllocation] = []
    for allocation in feature['capacity']:
        definition = by_id.get(allocation['team'])
        existing.append(ExistingAllocation(
            team=allocation['team'], capacity=allocation['capacity'],
            known=definition is not None,
            archived=definition['archived'] if definition is not None else False,
            eligible=allocation['team'] in allowed,
        ))
    return AllocationAvailability(allowed_ids=allowed, existing=existing)


def validate_allocation_change(
    availability: AllocationAvailability, capacity: Any,
) -> None:
    """Validate a mutation against this item's retained identities and current choices."""
    if not isinstance(capacity, list):
        raise ValueError('Capacity must be a list of allocations')
    allowed = set(availability['allowed_ids']) | {item['team'] for item in availability['existing']}
    unknown_counts = Counter(item['team'] for item in availability['existing'] if not item['known'])
    retained_duplicates = {
        team: [item['capacity'] for item in availability['existing'] if item['team'] == team]
        for team, count in unknown_counts.items() if count > 1
    }
    seen: set[str] = set()
    for allocation in capacity:
        if not isinstance(allocation, Mapping) or set(allocation) != {'team', 'capacity'}:
            raise ValueError('Allocation requires exactly team and capacity')
        team = allocation['team']
        amount = allocation['capacity']
        if not isinstance(team, str) or not team or team in seen:
            raise ValueError(f'Invalid or duplicate allocation ID: {team}')
        if (isinstance(amount, bool) or not isinstance(amount, (int, float))
                or not isfinite(amount) or not 0 <= amount <= 100):
            raise ValueError(f'Allocation percentage must be finite and between 0 and 100: {team}')
        if team not in allowed:
            raise ValueError(f'Allocation is not offered for this item: {team}')
        if team in retained_duplicates:
            amounts = retained_duplicates[team]
            if amount not in amounts:
                raise ValueError('Unresolved duplicate allocations must remain unchanged')
            amounts.remove(amount)
            continue
        seen.add(team)
    if any(retained_duplicates.values()):
        raise ValueError('Unresolved duplicate allocations must remain unchanged')