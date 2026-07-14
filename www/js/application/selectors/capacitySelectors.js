function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Normalize capacity snapshot shape from canonical state.
 *
 * @param {object} capacity
 * @returns {object}
 */
export function selectCapacitySnapshot(capacity = {}) {
  return {
    dates: asArray(capacity.dates),
    teamDaily: asArray(capacity.teamDaily),
    teamDailyMap: asArray(capacity.teamDailyMap),
    projectDailyRaw: asArray(capacity.projectDailyRaw),
    projectDaily: asArray(capacity.projectDaily),
    projectDailyMap: asArray(capacity.projectDailyMap),
    organizationDaily: asArray(capacity.organizationDaily),
    organizationDailyPerTeamAverage: asArray(capacity.organizationDailyPerTeamAverage),
  };
}

/**
 * Build the legacy capacity event payload from canonical capacity state.
 *
 * @param {object} capacity
 * @returns {object}
 */
export function selectCapacityEventPayload(capacity = {}) {
  const snapshot = selectCapacitySnapshot(capacity);
  return {
    dates: snapshot.dates,
    teamDailyCapacity: snapshot.teamDaily,
    teamDailyCapacityMap: snapshot.teamDailyMap,
    projectDailyCapacityRaw: snapshot.projectDailyRaw,
    projectDailyCapacity: snapshot.projectDaily,
    projectDailyCapacityMap: snapshot.projectDailyMap,
    totalOrgDailyCapacity: snapshot.organizationDaily,
    totalOrgDailyPerTeamAvg: snapshot.organizationDailyPerTeamAverage,
  };
}
