"""Allocation precedence among scheduled work over the complete eligible graph."""

from datetime import date
from collections.abc import Collection, Mapping, Sequence
from typing import Any

AllocationGraph = tuple[
    dict[str, dict[str, Any]], dict[str, set[str]], dict[str, set[str]],
]


def has_valid_allocation_span(feature: Mapping[str, Any]) -> bool:
    """Return whether both calendar dates form a complete non-reversed span."""
    start = feature.get('start')
    end = feature.get('end')
    if not start or not end:
        return False
    try:
        start_date = date.fromisoformat(start)
        end_date = date.fromisoformat(end)
    except ValueError:
        return False
    return (start_date.isoformat() == start and end_date.isoformat() == end
            and start_date <= end_date)


def build_allocation_graph(features: Sequence[dict[str, Any]]) -> AllocationGraph:
    """Index eligible canonical hierarchy edges independently of presentation filters."""
    by_id = {str(feature['id']): feature for feature in features}
    parents = {feature_id: set() for feature_id in by_id}
    children = {feature_id: set() for feature_id in by_id}
    for feature in features:
        child_id = str(feature['id'])
        if feature.get('type') == 'Task' or feature.get('stateCategory') == 'Removed':
            continue
        parent_ids = {str(relation['id']) for relation in feature.get('relations', [])
                      if relation['type'] == 'Parent'}
        if feature.get('parentId') is not None:
            parent_ids.add(str(feature['parentId']))
        if feature.get('traversalBoundary', False):
            continue
        for parent_id in parent_ids:
            parent = by_id.get(parent_id)
            if parent is None or parent.get('traversalBoundary', False):
                continue
            if parent.get('type') == 'Task' or parent.get('stateCategory') == 'Removed':
                continue
            if child_id in {str(item_id) for item_id in parent.get('excludedChildIds', [])}:
                continue
            parents[child_id].add(parent_id)
            children[parent_id].add(child_id)
    return by_id, parents, children


def subtree_teams(
    features: Sequence[dict[str, Any]], graph: AllocationGraph | None = None,
    memberships: Mapping[str, str] | None = None,
) -> dict[str, set[str]]:
    """Find dated descendant reservations, including each allocated member's group."""
    by_id, parents, children = build_allocation_graph(features) if graph is None else graph
    remaining = {feature_id: len(child_ids) for feature_id, child_ids in children.items()}
    teams = {feature_id: set() for feature_id in by_id}
    pending = [feature_id for feature_id, count in remaining.items() if count == 0]
    for feature_id in pending:
        feature = by_id[feature_id]
        covered = teams[feature_id].copy()
        if feature.get('stateCategory') != 'Removed' and has_valid_allocation_span(feature):
            covered.update(str(allocation['team']) for allocation in feature.get('capacity', []))
        if memberships is not None:
            covered.update(memberships[team] for team in tuple(covered) if team in memberships)
        for parent_id in parents[feature_id]:
            teams[parent_id].update(covered)
            remaining[parent_id] -= 1
            if remaining[parent_id] == 0:
                pending.append(parent_id)
    if len(pending) != len(by_id):
        raise ValueError('Allocation hierarchy contains a cycle')
    return teams


def resolve_effective_allocations(
    features: Sequence[dict[str, Any]], graph: AllocationGraph | None = None,
    memberships: Mapping[str, str] | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """Resolve original team/group reservations before expanding winning group bases."""
    covered = subtree_teams(features, graph, memberships)
    return {
        str(feature['id']): [] if (feature.get('stateCategory') == 'Removed'
                     or not has_valid_allocation_span(feature)) else [
            allocation for allocation in feature.get('capacity', [])
            if str(allocation['team']) not in covered[str(feature['id'])]
        ]
        for feature in features
    }


def expand_group_allocations(
    allocations: Mapping[str, Sequence[dict[str, Any]]],
    memberships: Mapping[str, str],
    group_ids: Collection[str] = (),
) -> dict[str, list[dict[str, Any]]]:
    """Expand already resolved group reservations once onto each member's full basis."""
    members: dict[str, list[str]] = {group_id: [] for group_id in group_ids}
    for team_id, group_id in sorted(memberships.items()):
        members.setdefault(group_id, []).append(team_id)
    return {
        feature_id: [
            dict(allocation, team=team_id)
            for allocation in values
            for team_id in (members[allocation['team']] if allocation['team'] in members
                            else [allocation['team']])
        ]
        for feature_id, values in allocations.items()
    }


def allocation_conflicts(
    features: Sequence[dict[str, Any]], memberships: Mapping[str, str],
) -> list[dict[str, str]]:
    """Report same-item overlaps and eligible dated descendant groups below members."""
    graph = build_allocation_graph(features)
    subtree_teams(features, graph)
    by_id, parents, children = graph
    groups = set(memberships.values())
    conflicts: list[dict[str, str]] = []
    descendants: dict[str, dict[str, set[str]]] = {feature_id: {} for feature_id in by_id}
    remaining = {feature_id: len(child_ids) for feature_id, child_ids in children.items()}
    pending = [feature_id for feature_id, count in remaining.items() if count == 0]
    for feature_id in pending:
        feature = by_id[feature_id]
        allocated = {str(item['team']) for item in feature.get('capacity', [])}
        if feature.get('stateCategory') != 'Removed':
            for team in sorted(allocated & memberships.keys()):
                group = memberships[team]
                if group in allocated:
                    conflicts.append({'kind': 'same-item', 'ancestor': feature_id,
                                      'descendant': feature_id, 'group': group, 'team': team})
        covered = {group: ids.copy() for group, ids in descendants[feature_id].items()}
        if feature.get('stateCategory') != 'Removed' and has_valid_allocation_span(feature):
            for team in sorted(allocated & memberships.keys()):
                group = memberships[team]
                for descendant in sorted(descendants[feature_id].get(group, ())):
                    conflicts.append({'kind': 'descendant-group', 'ancestor': feature_id,
                                      'descendant': descendant, 'group': group, 'team': team})
            for group in allocated & groups:
                covered.setdefault(group, set()).add(feature_id)
        for parent_id in parents[feature_id]:
            for group, ids in covered.items():
                descendants[parent_id].setdefault(group, set()).update(ids)
            remaining[parent_id] -= 1
            if remaining[parent_id] == 0:
                pending.append(parent_id)
    return sorted(conflicts, key=lambda item: (
        item['kind'], item['ancestor'], item['descendant'], item['group'], item['team'],
    ))