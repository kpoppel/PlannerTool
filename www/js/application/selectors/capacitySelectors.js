function toArray(value) {
  return Array.isArray(value) ? value : [];
}

/** @typedef {import('../types.js').StoreApi} StoreApi */

/**
 * @param {StoreApi} store
 * @returns {object}
 */
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

    getPlanDailyCapacityMap() {
      return toArray(store.getState().capacity.planDailyMap);
    },

    getPlanTeamDailyCapacityMap() {
      return toArray(store.getState().capacity.planTeamDailyMap);
    },

    getTotalOrgDailyPerTeamAvg() {
      return toArray(store.getState()?.capacity?.organizationDailyPerTeamAverage);
    },
  };
}
