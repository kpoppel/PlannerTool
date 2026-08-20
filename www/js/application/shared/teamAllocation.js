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
