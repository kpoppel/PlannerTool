// Capacity entries follow the backend contract `{ team, capacity }`.
export function getCapacityTeamId(capacityEntry) {
  return capacityEntry.team;
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

/**
 * Organisational load of a feature: every allocation spread evenly across the
 * full organization roster. Team Drill-down only changes presentation.
 * @param {{capacity: {team: string, capacity: number}[]}} feature
 * @param {Set<string>} organizationTeamIds
 * @returns {string} Percentage with one decimal, e.g. '8.0%'
 */
export function computeFeatureOrgLoad(feature, organizationTeamIds) {
  if (organizationTeamIds.size === 0) return '0.0%';
  let sum = 0;
  for (const entry of feature.capacity) {
    sum += entry.capacity;
  }
  return (sum / organizationTeamIds.size).toFixed(1) + '%';
}
