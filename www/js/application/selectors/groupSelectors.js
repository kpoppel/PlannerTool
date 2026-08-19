import {
  applyGroupOverrides,
  deriveEffectiveGroupsForPlan,
  derivePendingGroupChanges,
} from '../shared/groupProjection.js';
import { getActiveScenario } from '../shared/scenarioMutations.js';

function getBaselineGroupsForPlan(state, planId) {
  const byPlanId = state.groups.byPlanId;
  const key = String(planId);
  return byPlanId[key];
}

export function createGroupSelectors(store) {
  return {
    getEffectiveGroups(planId) {
      const state = store.getState();
      const baselineGroups = getBaselineGroupsForPlan(state, planId);
      const scenario = getActiveScenario(state);
      return deriveEffectiveGroupsForPlan(planId, baselineGroups, scenario);
    },

    getPendingGroupChanges() {
      const scenario = getActiveScenario(store.getState());
      return derivePendingGroupChanges(scenario);
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
      const byPlanId = store.getState().groups.byPlanId;
      return Object.prototype.hasOwnProperty.call(byPlanId, String(planId));
    },
  };
}