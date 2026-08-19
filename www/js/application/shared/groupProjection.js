function getGroupOverrides(scenario) {
  return scenario.groupOverrides;
}

function getScenarioGroups(scenario) {
  return scenario.scenarioGroups;
}

export function applyGroupOverrides(groups, overrides) {
  return groups
    .filter((group) => {
      const override = overrides[String(group.id)];
      if (!override) return true;
      return !override._deleted;
    })
    .map((group) => {
      const override = overrides[String(group.id)];
      if (!override) return group;

      const { _deleted, memberDeltas, ...fields } = override;
      void _deleted;
      let members = group.members;
      if (memberDeltas && memberDeltas.length > 0) {
        const memberSet = new Set(members.map(String));
        for (const delta of memberDeltas) {
          const taskId = String(delta.taskId);
          if (taskId === '') continue;
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

export function deriveEffectiveGroupsForPlan(planId, baselineGroups, scenario) {
  const key = String(planId);
  const overrides = getGroupOverrides(scenario);
  const scenarioGroups = getScenarioGroups(scenario).filter(
    (group) => String(group.plan_id) === key
  );
  return [...applyGroupOverrides(baselineGroups, overrides), ...scenarioGroups];
}

export function derivePendingGroupChanges(scenario) {
  const scenarioGroups = getScenarioGroups(scenario);
  const groupOverrides = getGroupOverrides(scenario);
  const pending = [];

  for (const group of scenarioGroups) {
    pending.push({ type: 'create', group });
  }

  for (const [groupId, override] of Object.entries(groupOverrides)) {
    if (override._deleted) {
      pending.push({ type: 'delete', groupId });
      continue;
    }

    const { _deleted, memberDeltas, ...fields } = override;
    void _deleted;
    const hasFields = Object.keys(fields).length > 0;
    const hasDeltas = memberDeltas.length > 0;
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
