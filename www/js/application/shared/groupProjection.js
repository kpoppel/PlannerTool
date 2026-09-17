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

function getMotherPlanDistance(feature, motherPlanId, featuresById) {
  const visited = new Set();
  let current = feature;
  let distance = 0;
  while (current && !visited.has(String(current.id))) {
    visited.add(String(current.id));
    if (String(current.project) === String(motherPlanId)) return distance;
    if (!current.parentId) return -1;
    current = featuresById.get(String(current.parentId));
    distance += 1;
  }
  return -1;
}

/**
 * Project groups for the selected base plans onto the resolved feature set.
 * A feature can be a member of groups owned by any selected plan. When group
 * memberships overlap, the group whose mother plan is highest in the feature's
 * ancestor chain owns the rendered card; ties retain selected-plan order.
 */
export function deriveDisplayGroupsForSelectedPlans(
  selectedPlanIds,
  baselineGroupsByPlanId,
  scenario,
  resolvedFeatures
) {
  const selectedIds = selectedPlanIds.map(String);
  const featuresById = new Map(resolvedFeatures.map((feature) => [String(feature.id), feature]));
  const groups = selectedIds.flatMap((planId) =>
    deriveEffectiveGroupsForPlan(
      planId,
      Object.prototype.hasOwnProperty.call(baselineGroupsByPlanId, planId)
        ? baselineGroupsByPlanId[planId]
        : [],
      scenario
    )
  );
  const winningGroupByFeatureId = new Map();

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    for (const memberId of group.members) {
      const featureId = String(memberId);
      const feature = featuresById.get(featureId);
      if (!feature) continue;
      const distance = getMotherPlanDistance(feature, group.plan_id, featuresById);
      const current = winningGroupByFeatureId.get(featureId);
      if (!current || (distance >= 0 && current.distance < 0) || distance > current.distance
        || (distance === current.distance && groupIndex < current.groupIndex)) {
        winningGroupByFeatureId.set(featureId, { groupIndex, distance });
      }
    }
  }

  return groups.map((group, groupIndex) => ({
    ...group,
    members: group.members.filter(
      (memberId) => {
        const winner = winningGroupByFeatureId.get(String(memberId));
        return winner && winner.groupIndex === groupIndex;
      }
    ),
  }));
}

/** Keep the groups owning a lane's visible tasks, including their parents. */
export function deriveDisplayGroupsForFeatures(groups, visibleFeatures, motherPlanId = null) {
  const visibleIds = new Set(visibleFeatures.map((feature) => String(feature.id)));
  const groupsById = new Map(groups.map((group) => [String(group.id), group]));
  const includedIds = new Set();

  for (const group of groups) {
    const hasVisibleMember = group.members.some((memberId) => visibleIds.has(String(memberId)));
    const isMotherPlanGroup = motherPlanId !== null
      && String(group.plan_id) === String(motherPlanId);
    if (!hasVisibleMember && !isMotherPlanGroup) continue;
    let current = group;
    const visited = new Set();
    while (current && !visited.has(String(current.id))) {
      visited.add(String(current.id));
      includedIds.add(String(current.id));
      current = current.parent_id ? groupsById.get(String(current.parent_id)) : null;
    }
  }
  return groups.filter((group) => includedIds.has(String(group.id)));
}

/** Return the selected mother plan that owns each grouped feature for display. */
export function getDisplayGroupOwnerPlanByFeatureId(groups) {
  const ownerPlanByFeatureId = new Map();
  for (const group of groups) {
    for (const memberId of group.members) {
      ownerPlanByFeatureId.set(String(memberId), String(group.plan_id));
    }
  }
  return ownerPlanByFeatureId;
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
