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
 * Organisational load of a feature: the summed allocation of the selected teams
 * spread evenly across those teams. A deselected team counts towards neither the
 * numerator nor the denominator, matching CapacityCalculator's org-weight model.
 * @param {{capacity: {team: string, capacity: number}[]}} feature
 * @param {Set<string>} selectedTeamIds
 * @returns {string} Percentage with one decimal, e.g. '8.0%'
 */
export function computeFeatureOrgLoad(feature, selectedTeamIds) {
  if (selectedTeamIds.size === 0) return '0.0%';
  let sum = 0;
  for (const entry of feature.capacity) {
    if (!selectedTeamIds.has(String(getCapacityTeamId(entry)))) continue;
    sum += entry.capacity;
  }
  return (sum / selectedTeamIds.size).toFixed(1) + '%';
}
