import {
  applyGroupOverrides,
  deriveEffectiveGroupsForPlan,
  derivePendingGroupChanges,
} from '../shared/groupProjection.js';

function getScenarioItems(state) {
  return state.scenarios.items;
}

function getActiveScenario(state) {
  const activeId = state.scenarios.activeId ?? 'baseline';
  return getScenarioItems(state).find((scenario) => scenario.id === activeId) || null;
}

function getBaselineGroupsForPlan(state, planId) {
  const byPlanId = state.groups.byPlanId;
  const key = String(planId);
  return Array.isArray(byPlanId[key]) ? byPlanId[key] : [];
}

export function createGroupSelectors(store) {
  return {
    getEffectiveGroups(planId) {
      const state = store.getState();
      const baselineGroups = getBaselineGroupsForPlan(state, planId);
      const scenario = getActiveScenario(state);
      if (!scenario) return baselineGroups;
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
      if (!scenario) return null;

      const overrides = scenario.groupOverrides && typeof scenario.groupOverrides === 'object'
        ? scenario.groupOverrides
        : {};
      const byPlanId = state?.groups?.byPlanId ?? {};
      for (const groups of Object.values(byPlanId)) {
        if (!Array.isArray(groups)) continue;
        const found = groups.find((group) => String(group.id) === key);
        if (!found) continue;
        const override = overrides[key];
        if (override?._deleted) return null;
        if (!override) return found;
        return applyGroupOverrides([found], overrides)[0] || null;
      }
      return (Array.isArray(scenario.scenarioGroups) ? scenario.scenarioGroups : []).find((group) => String(group.id) === key) || null;
    },

    hasPlanLoaded(planId) {
      const byPlanId = store.getState()?.groups?.byPlanId ?? {};
      return Object.prototype.hasOwnProperty.call(byPlanId, String(planId));
    },
  };
}