function toArray(value) {
  return Array.isArray(value) ? value : [];
}

export function createLegacyCapacitySelectors(state) {
  return {
    getCapacityDates() {
      return toArray(state?.capacityDates);
    },

    getTeamDailyCapacity() {
      return toArray(state?.teamDailyCapacity);
    },

    getTeamDailyCapacityMap() {
      return toArray(state?.teamDailyCapacityMap);
    },

    getProjectDailyCapacity() {
      return toArray(state?.projectDailyCapacity);
    },

    getProjectDailyCapacityMap() {
      return toArray(state?.projectDailyCapacityMap);
    },

    getTotalOrgDailyPerTeamAvg() {
      return toArray(state?.totalOrgDailyPerTeamAvg);
    },
  };
}

export function createCapacitySelectors(store, legacyState = null) {
  return {
    getCapacityDates() {
      if (Array.isArray(legacyState?.capacityDates)) return legacyState.capacityDates;
      return toArray(store.getState()?.capacity?.dates);
    },

    getTeamDailyCapacity() {
      if (Array.isArray(legacyState?.teamDailyCapacity)) return legacyState.teamDailyCapacity;
      return toArray(store.getState()?.capacity?.teamDaily);
    },

    getTeamDailyCapacityMap() {
      if (Array.isArray(legacyState?.teamDailyCapacityMap)) return legacyState.teamDailyCapacityMap;
      return toArray(store.getState()?.capacity?.teamDailyMap);
    },

    getProjectDailyCapacity() {
      if (Array.isArray(legacyState?.projectDailyCapacity)) return legacyState.projectDailyCapacity;
      return toArray(store.getState()?.capacity?.projectDaily);
    },

    getProjectDailyCapacityMap() {
      if (Array.isArray(legacyState?.projectDailyCapacityMap)) {
        return legacyState.projectDailyCapacityMap;
      }
      return toArray(store.getState()?.capacity?.projectDailyMap);
    },

    getTotalOrgDailyPerTeamAvg() {
      if (Array.isArray(legacyState?.totalOrgDailyPerTeamAvg)) {
        return legacyState.totalOrgDailyPerTeamAvg;
      }
      return toArray(store.getState()?.capacity?.organizationDailyPerTeamAverage);
    },
  };
}
