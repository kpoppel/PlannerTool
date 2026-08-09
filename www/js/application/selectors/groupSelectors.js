function getScenarioItems(state) {
  return Array.isArray(state?.scenarios?.items) ? state.scenarios.items : [];
}

function getActiveScenario(state) {
  const activeId = state?.scenarios?.activeId ?? 'baseline';
  if (!activeId || activeId === 'baseline') return null;
  return getScenarioItems(state).find((scenario) => scenario.id === activeId) || null;
}

function getBaselineGroupsForPlan(state, planId) {
  const byPlanId = state?.groups?.byPlanId || {};
  return Array.isArray(byPlanId[String(planId)]) ? byPlanId[String(planId)] : [];
}

function applyOverrides(groups, overrides) {
  return groups
    .filter((group) => !overrides[String(group.id)]?._deleted)
    .map((group) => {
      const override = overrides[String(group.id)];
      if (!override) return group;

      const { _deleted, memberDeltas, ...fields } = override;
      let members = group.members || [];
      if (Array.isArray(memberDeltas) && memberDeltas.length > 0) {
        const memberSet = new Set(members.map(String));
        for (const delta of memberDeltas) {
          const taskId = String(delta?.taskId || '');
          if (!taskId) continue;
          if (delta.op === 'add') memberSet.add(taskId);
          else memberSet.delete(taskId);
        }
        members = [...memberSet];
      }

      return {
        ...group,
        ...fields,
        members,
      };
    });
}

function derivePendingGroupChanges(scenario) {
  const pending = [];

  for (const group of scenario?.scenarioGroups || []) {
    pending.push({ type: 'create', group });
  }

  for (const [groupId, override] of Object.entries(scenario?.groupOverrides || {})) {
    if (override._deleted) {
      pending.push({ type: 'delete', groupId });
      continue;
    }

    const { _deleted, memberDeltas, ...fields } = override;
    const hasFields = Object.keys(fields).length > 0;
    const hasDeltas = Array.isArray(memberDeltas) && memberDeltas.length > 0;
    if (!hasFields && !hasDeltas) continue;

    pending.push({
      type: 'update',
      groupId,
      ...(hasFields ? { fields } : {}),
      ...(hasDeltas ? { memberDeltas } : {}),
    });
  }

  return pending;
}

export function createLegacyGroupSelectors(state, groupService) {
  return {
    getEffectiveGroups(planId) {
      const baselineGroups = groupService.getGroupsForPlan(planId) || [];
      const scenario = state.getActiveScenario?.() || null;
      const overrides = scenario?.groupOverrides || {};
      const scenarioGroups = (scenario?.scenarioGroups || []).filter(
        (group) => String(group.plan_id) === String(planId)
      );
      return [...applyOverrides(baselineGroups, overrides), ...scenarioGroups];
    },

    getPendingGroupChanges() {
      return state.getPendingGroupChanges?.() || [];
    },

    getGroupById(groupId) {
      return groupService.getGroupById(groupId);
    },

    hasPlanLoaded(planId) {
      return groupService.hasPlanLoaded(planId);
    },
  };
}

export function createGroupSelectors(store) {
  return {
    getEffectiveGroups(planId) {
      const state = store.getState();
      const baselineGroups = getBaselineGroupsForPlan(state, planId);
      const scenario = getActiveScenario(state);
      const overrides = scenario?.groupOverrides || {};
      const scenarioGroups = (scenario?.scenarioGroups || []).filter(
        (group) => String(group.plan_id) === String(planId)
      );
      return [...applyOverrides(baselineGroups, overrides), ...scenarioGroups];
    },

    getPendingGroupChanges() {
      const scenario = getActiveScenario(store.getState());
      return derivePendingGroupChanges(scenario);
    },

    getGroupById(groupId) {
      const key = String(groupId);
      const state = store.getState();
      const scenario = getActiveScenario(state);
      const overrides = scenario?.groupOverrides || {};
      const byPlanId = state?.groups?.byPlanId || {};
      for (const groups of Object.values(byPlanId)) {
        const found = (groups || []).find((group) => String(group.id) === key);
        if (!found) continue;
        const override = overrides[key];
        if (override?._deleted) return null;
        if (!override) return found;
        return applyOverrides([found], overrides)[0] || null;
      }
      return (scenario?.scenarioGroups || []).find((group) => String(group.id) === key) || null;
    },

    hasPlanLoaded(planId) {
      const byPlanId = store.getState()?.groups?.byPlanId || {};
      return Object.prototype.hasOwnProperty.call(byPlanId, String(planId));
    },
  };
}