"""Allocation precedence among scheduled work over the complete eligible graph."""

from datetime import date


def has_valid_allocation_span(feature):
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


def build_allocation_graph(features):
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


def subtree_teams(features, graph=None):
    by_id, parents, children = build_allocation_graph(features) if graph is None else graph
    remaining = {feature_id: len(child_ids) for feature_id, child_ids in children.items()}
    teams = {feature_id: set() for feature_id in by_id}
    pending = [feature_id for feature_id, count in remaining.items() if count == 0]
    for feature_id in pending:
        feature = by_id[feature_id]
        covered = teams[feature_id].copy()
        if feature.get('stateCategory') != 'Removed' and has_valid_allocation_span(feature):
            covered.update(str(allocation['team']) for allocation in feature.get('capacity', []))
        for parent_id in parents[feature_id]:
            teams[parent_id].update(covered)
            remaining[parent_id] -= 1
            if remaining[parent_id] == 0:
                pending.append(parent_id)
    if len(pending) != len(by_id):
        raise ValueError('Allocation hierarchy contains a cycle')
    return teams


def resolve_effective_allocations(features, graph=None):
    covered = subtree_teams(features, graph)
    return {
        str(feature['id']): [] if (feature.get('stateCategory') == 'Removed'
                     or not has_valid_allocation_span(feature)) else [
            allocation for allocation in feature.get('capacity', [])
            if str(allocation['team']) not in covered[str(feature['id'])]
        ]
        for feature in features
    }