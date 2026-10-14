import { featureHasEligibleParent } from './featureProjection.js';

export function hasValidAllocationSpan(feature) {
  // Boundary guard: payload comes from external persistence/API and may be missing fields; normalize here, not downstream.
  if (!feature.start || !feature.end || feature.end < feature.start) return false;
  const start = new Date(feature.start);
  const end = new Date(feature.end);
  return Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())
    && start.toISOString().slice(0, 10) === feature.start
    && end.toISOString().slice(0, 10) === feature.end;
}

export function buildAllocationGraph(features) {
  const byId = new Map(features.map((feature) => [String(feature.id), feature]));
  const parents = new Map(features.map((feature) => [String(feature.id), new Set()]));
  const children = new Map(features.map((feature) => [String(feature.id), new Set()]));
  // Boundary guard: payload comes from external persistence/API and may be missing fields; normalize here, not downstream.
  for (const feature of features) {
    const childId = String(feature.id);
    if (feature.type === 'Task' || feature.stateCategory === 'Removed') continue;
    const parentIds = new Set();
    if (feature.parentId !== undefined && feature.parentId !== null) {
      parentIds.add(String(feature.parentId));
    }
    if (feature.relations !== undefined) {
      for (const relation of feature.relations) {
        if (relation.type === 'Parent') parentIds.add(String(relation.id));
      }
    }
    for (const parentId of parentIds) {
      const parent = byId.get(parentId);
      if (parent === undefined || parent.type === 'Task' || parent.stateCategory === 'Removed') continue;
      if (!featureHasEligibleParent(feature, parent)) continue;
      parents.get(childId).add(parentId);
      children.get(parentId).add(childId);
    }
  }
  return { byId, parents, children };
}

export function subtreeTeams(features, graph = buildAllocationGraph(features), memberships = new Map()) {
  const remaining = new Map([...graph.children].map(([id, children]) => [id, children.size]));
  const teams = new Map(features.map((feature) => [String(feature.id), new Set()]));
  const pending = [...remaining].filter(([, count]) => count === 0).map(([id]) => id);
  for (let index = 0; index < pending.length; index++) {
    const id = pending[index];
    const covered = new Set(teams.get(id));
    const feature = graph.byId.get(id);
    // Boundary guard: payload comes from external persistence/API and may be missing fields; normalize here, not downstream.
    if (feature.capacity !== undefined && feature.stateCategory !== 'Removed'
      && hasValidAllocationSpan(feature)) {
      for (const allocation of feature.capacity) covered.add(String(allocation.team));
    }
    for (const team of [...covered]) {
      if (memberships.has(team)) covered.add(memberships.get(team));
    }
    for (const parentId of graph.parents.get(id)) {
      for (const team of covered) teams.get(parentId).add(team);
      const count = remaining.get(parentId) - 1;
      remaining.set(parentId, count);
      if (count === 0) pending.push(parentId);
    }
  }
  if (pending.length !== features.length) throw new Error('Allocation hierarchy contains a cycle');
  return teams;
}

export function resolveEffectiveAllocations(features, graph = buildAllocationGraph(features), memberships = new Map()) {
  const covered = subtreeTeams(features, graph, memberships);
  return new Map(features.map((feature) => {
    // Boundary guard: payload comes from external persistence/API and may be missing fields; normalize here, not downstream.
    const allocations = feature.capacity === undefined ? [] : feature.capacity;
    return [String(feature.id), feature.stateCategory === 'Removed'
      || !hasValidAllocationSpan(feature) ? [] : allocations.filter(
      (allocation) => !covered.get(String(feature.id)).has(String(allocation.team)),
    )];
  }));
}

export function expandGroupAllocations(allocations, memberships, groupIds = []) {
  const members = new Map(groupIds.map((id) => [id, []]));
  for (const [teamId, groupId] of [...memberships].sort()) {
    if (!members.has(groupId)) members.set(groupId, []);
    members.get(groupId).push(teamId);
  }
  return new Map([...allocations].map(([id, values]) => [id, values.flatMap((allocation) => (
    members.has(allocation.team)
      ? members.get(allocation.team).map((team) => ({ ...allocation, team }))
      : [{ ...allocation }]
  ))]));
}

export function allocationConflicts(features, memberships) {
  const graph = buildAllocationGraph(features);
  subtreeTeams(features, graph);
  const groups = new Set(memberships.values());
  const conflicts = [];
  const descendants = new Map(features.map((feature) => [String(feature.id), new Map()]));
  const remaining = new Map([...graph.children].map(([id, children]) => [id, children.size]));
  const pending = [...remaining].filter(([, count]) => count === 0).map(([id]) => id);
  for (let index = 0; index < pending.length; index++) {
    const id = pending[index];
    const feature = graph.byId.get(id);
    // Boundary guard: payload comes from external persistence/API and may be missing fields; normalize here, not downstream.
    const allocated = new Set(feature.capacity === undefined ? []
      : feature.capacity.map((allocation) => String(allocation.team)));
    const ownTeams = [...allocated].filter((team) => memberships.has(team)).sort();
    if (feature.stateCategory !== 'Removed') {
      for (const team of ownTeams) {
        const group = memberships.get(team);
        if (allocated.has(group)) {
          conflicts.push({ kind: 'same-item', ancestor: id, descendant: id, group, team });
        }
      }
    }
    const covered = new Map([...descendants.get(id)].map(([group, ids]) => [group, new Set(ids)]));
    if (feature.stateCategory !== 'Removed' && hasValidAllocationSpan(feature)) {
      for (const team of ownTeams) {
        const group = memberships.get(team);
        if (descendants.get(id).has(group)) {
          for (const descendant of [...descendants.get(id).get(group)].sort()) {
            conflicts.push({ kind: 'descendant-group', ancestor: id, descendant, group, team });
          }
        }
      }
      for (const group of allocated) {
        if (groups.has(group)) {
          if (!covered.has(group)) covered.set(group, new Set());
          covered.get(group).add(id);
        }
      }
    }
    for (const parentId of graph.parents.get(id)) {
      for (const [group, ids] of covered) {
        if (!descendants.get(parentId).has(group)) descendants.get(parentId).set(group, new Set());
        for (const descendant of ids) descendants.get(parentId).get(group).add(descendant);
      }
      const count = remaining.get(parentId) - 1;
      remaining.set(parentId, count);
      if (count === 0) pending.push(parentId);
    }
  }
  return conflicts.sort((first, second) => {
    for (const key of ['kind', 'ancestor', 'descendant', 'group', 'team']) {
      if (first[key] < second[key]) return -1;
      if (first[key] > second[key]) return 1;
    }
    return 0;
  });
}