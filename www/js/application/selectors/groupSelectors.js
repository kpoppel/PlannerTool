import {
  applyGroupOverrides,
  deriveEffectiveGroupsForPlan,
  deriveDisplayGroupsForSelectedPlans,
  derivePendingGroupChanges,
} from '../shared/groupProjection.js';
import { getActiveScenario } from '../shared/scenarioMutations.js';

/** @typedef {import('../types.js').StoreApi} StoreApi */

function getBaselineGroupsForPlan(state, planId) {
  const byPlanId = state.groups.byPlanId;
  const key = String(planId);
  if (!state.groups.loadedPlanIds.includes(key)) {
    throw new Error(`Baseline groups for plan ${key} are not loaded`);
  }
  return byPlanId[key];
}

function getBaselineGroupById(state, groupId) {
  const key = String(groupId);
  for (const planId of state.groups.loadedPlanIds) {
    const groups = state.groups.byPlanId[planId];
    const found = groups.find((group) => String(group.id) === key);
    if (found) return found;
  }
  return null;
}

/**
 * @param {StoreApi} store
 * @returns {object}
 */
export function createGroupSelectors(store) {
  return {
    getEffectiveGroups(planId) {
      const state = store.getState();
      const baselineGroups = getBaselineGroupsForPlan(state, planId);
      const scenario = getActiveScenario(state);
      return deriveEffectiveGroupsForPlan(planId, baselineGroups, scenario);
    },

    getDisplayGroupsForSelectedPlans(planIds, resolvedFeatures) {
      const state = store.getState();
      return deriveDisplayGroupsForSelectedPlans(
        planIds,
        state.groups.byPlanId,
        getActiveScenario(state),
        resolvedFeatures
      );
    },

    getPendingGroupChanges() {
      const scenario = getActiveScenario(store.getState());
      return derivePendingGroupChanges(scenario);
    },

    getBaselineGroupById(groupId) {
      return getBaselineGroupById(store.getState(), groupId);
    },

    getGroupById(groupId) {
      const key = String(groupId);
      const state = store.getState();
      const scenario = getActiveScenario(state);

      const overrides = scenario.groupOverrides;
      const byPlanId = state.groups.byPlanId;
      for (const groups of Object.values(byPlanId)) {
        const found = groups.find((group) => String(group.id) === key);
        if (!found) continue;
        const override = overrides[key];
        if (override && override._deleted) return null;
        if (!override) return found;
        const nextGroup = applyGroupOverrides([found], overrides)[0];
        if (nextGroup === undefined) return null;
        return nextGroup;
      }
      const scenarioGroup = scenario.scenarioGroups.find((group) => String(group.id) === key);
      if (scenarioGroup === undefined) return null;
      return scenarioGroup;
    },

    hasPlanLoaded(planId) {
      return store.getState().groups.loadedPlanIds.includes(String(planId));
    },
  };
}