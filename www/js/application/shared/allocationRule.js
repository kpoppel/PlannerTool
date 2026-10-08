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

export function subtreeTeams(features, graph = buildAllocationGraph(features)) {
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

export function resolveEffectiveAllocations(features, graph = buildAllocationGraph(features)) {
  const covered = subtreeTeams(features, graph);
  return new Map(features.map((feature) => {
    // Boundary guard: payload comes from external persistence/API and may be missing fields; normalize here, not downstream.
    const allocations = feature.capacity === undefined ? [] : feature.capacity;
    return [String(feature.id), feature.stateCategory === 'Removed'
      || !hasValidAllocationSpan(feature) ? [] : allocations.filter(
      (allocation) => !covered.get(String(feature.id)).has(String(allocation.team)),
    )];
  }));
}