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

export function createCapacitySelectors(store) {
  return {
    getCapacityDates() {
      return toArray(store.getState()?.capacity?.dates);
    },

    getTeamDailyCapacity() {
      return toArray(store.getState()?.capacity?.teamDaily);
    },

    getTeamDailyCapacityMap() {
      return toArray(store.getState()?.capacity?.teamDailyMap);
    },

    getProjectDailyCapacity() {
      return toArray(store.getState()?.capacity?.projectDaily);
    },

    getProjectDailyCapacityMap() {
      return toArray(store.getState()?.capacity?.projectDailyMap);
    },

    getTotalOrgDailyPerTeamAvg() {
      return toArray(store.getState()?.capacity?.organizationDailyPerTeamAverage);
    },
  };
}
