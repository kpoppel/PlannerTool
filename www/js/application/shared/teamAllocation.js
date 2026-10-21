export function ceilAllocation(value) {
  const integer = Math.round(value);
  return Math.abs(value - integer) <= Number.EPSILON * Math.abs(value) * 2
    ? integer : Math.ceil(value);
}

// Capacity entries follow the backend contract `{ team, capacity }`.
export function getCapacityTeamId(capacityEntry) {
  return capacityEntry.team;
}

export function expandAllocationFocusIds(selectedTeamIds, catalogue) {
  const expanded = new Set(selectedTeamIds);
  for (const record of catalogue) {
    if (record.kind !== 'team' || record.group_id === null) continue;
    if (selectedTeamIds.has(record.id)) expanded.add(record.group_id);
    if (selectedTeamIds.has(record.group_id)) expanded.add(record.id);
  }
  return expanded;
}

export function hasFeatureTeamAllocation(feature, selectedTeamIds) {
  for (const entry of feature.capacity) {
    const teamId = getCapacityTeamId(entry);
    if (selectedTeamIds.has(String(teamId))) {
      return true;
    }
  }
  return false;
}

export function hasFeatureTeamId(feature, teamId) {
  const selectedTeamIds = new Set([String(teamId)]);
  return hasFeatureTeamAllocation(feature, selectedTeamIds);
}

export function buildDescendantAllocationTeams(features, childrenByParent, catalogue) {
  const featuresById = new Map(features.map((feature) => [String(feature.id), feature]));
  const groups = new Map(catalogue.filter((team) => team.kind === 'team'
    && team.group_id !== null).map((team) => [team.id, team.group_id]));
  const descendants = new Map();
  const visiting = new Set();
  function collect(featureId) {
    if (descendants.has(featureId)) return descendants.get(featureId);
    if (visiting.has(featureId)) throw new Error('Allocation hierarchy contains a cycle');
    visiting.add(featureId);
    const covered = new Set();
    const feature = featuresById.get(featureId);
    const childIds = childrenByParent.get(featureId);
    if (childIds !== undefined && feature.type !== 'Task' && feature.stateCategory !== 'Removed') {
      for (const childId of childIds) {
        const child = featuresById.get(String(childId));
        if (child.type === 'Task' || child.stateCategory === 'Removed') continue;
        for (const teamId of collect(String(childId))) covered.add(teamId);
        if (!child.start || !child.end || child.start > child.end) continue;
        for (const allocation of child.capacity) {
          covered.add(allocation.team);
          if (groups.has(allocation.team)) covered.add(groups.get(allocation.team));
        }
      }
    }
    visiting.delete(featureId);
    descendants.set(featureId, covered);
    return covered;
  }
  for (const feature of features) collect(String(feature.id));
  return descendants;
}

/**
 * Organisational load of a feature: every allocation spread evenly across the
 * full organization roster. Team Drill-down only changes presentation.
 * @param {{capacity: {team: string, capacity: number}[]}} feature
 * @param {Set<string>} organizationTeamIds
 * @returns {string} Ceiling percentage for display, e.g. '8%'
 */
export function computeFeatureOrgLoad(feature, organizationTeamIds, groupMembers = new Map()) {
  if (organizationTeamIds.size === 0) return '0%';
  let sum = 0;
  for (const entry of feature.capacity) {
    if (groupMembers.has(entry.team)) {
      sum += entry.capacity * groupMembers.get(entry.team)
        .filter((id) => organizationTeamIds.has(id)).length;
    } else if (organizationTeamIds.has(entry.team)) {
      sum += entry.capacity;
    }
  }
  return ceilAllocation(sum / organizationTeamIds.size) + '%';
}
