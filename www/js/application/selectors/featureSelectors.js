function getScenarioItems(state) {
  return Array.isArray(state?.scenarios?.items) ? state.scenarios.items : [];
}

function getActiveScenario(state) {
  const activeId = state?.scenarios?.activeId ?? 'baseline';
  if (!activeId) return null;
  return getScenarioItems(state).find((scenario) => scenario.id === activeId) || null;
}

function computeDirtyFields(base, override) {
  // TODO: A card is dirty if it is in the overrides list. This looks like a bit overkill.
  const fields = [];
  const normDate = (v) => v || null;
  const normTags = (v) =>
    String(v || '').split(';').map((t) => t.trim().toLowerCase()).filter(Boolean);
  if ('start' in override && normDate(override.start) !== normDate(base.start)) fields.push('start');
  if ('end' in override && normDate(override.end) !== normDate(base.end)) fields.push('end');
  if (override.capacity && JSON.stringify(override.capacity) !== JSON.stringify(base.capacity))
    fields.push('capacity');
  if (override.state && override.state !== (base.state || '')) fields.push('state');
  if (override.iterationPath !== undefined && override.iterationPath !== base.iterationPath)
    fields.push('iterationPath');
  if (
    'tags' in override &&
    JSON.stringify(normTags(override.tags)) !== JSON.stringify(normTags(base.tags))
  )
    fields.push('tags');
  return fields;
}

function applyOverride(baseFeature, override) {
  if (!override) return { ...baseFeature };
  const changedFields = computeDirtyFields(baseFeature, override);
  return {
    ...baseFeature,
    ...override,
    scenarioOverride: true,
    changedFields,
    dirty: changedFields.length > 0,
  };
}

function deriveEffectiveFeatures(state) {
  const baselineFeatures = Array.isArray(state?.baseline?.features) ? state.baseline.features : [];
  const scenario = getActiveScenario(state);
  const overrides = scenario?.overrides || {};

  return baselineFeatures.map((feature) => {
    const key = String(feature?.id ?? '');
    const override = overrides[key];
    return applyOverride(feature, override);
  });
}

function buildBaselineFeatureMap(state) {
  const map = new Map();
  const features = Array.isArray(state?.baseline?.features) ? state.baseline.features : [];
  for (const feature of features) {
    if (!feature?.id) continue;
    map.set(String(feature.id), feature);
  }
  return map;
}

function buildChildrenByParentMap(features) {
  const map = new Map();
  for (const feature of Array.isArray(features) ? features : []) {
    const parentId = feature?.parentId;
    if (!parentId) continue;
    const key = String(parentId);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(String(feature.id));
  }
  return map;
}

function deriveAvailableTaskTypes(features) {
  const types = new Set();
  for (const feature of Array.isArray(features) ? features : []) {
    const type = feature?.type ?? feature?.workItemType ?? feature?.work_item_type;
    if (type) types.add(String(type));
  }
  return Array.from(types).sort();
}

function deriveTaskTypeHierarchy(projects) {
  for (const project of Array.isArray(projects) ? projects : []) {
    if (Array.isArray(project?.task_type_hierarchy) && project.task_type_hierarchy.length > 0) {
      return project.task_type_hierarchy;
    }
  }
  return [];
}

function getTypeLevelFromHierarchy(type, hierarchy) {
  const key = String(type || '').toLowerCase();
  for (let index = 0; index < hierarchy.length; index += 1) {
    const types = (hierarchy[index].types || []).map((item) => String(item).toLowerCase());
    if (types.includes(key)) return index;
  }
  return 9999;
}

function getTypeDisplayNameFromHierarchy(type, hierarchy) {
  const key = String(type || '').toLowerCase();
  for (const level of hierarchy) {
    const canonical = (level.types || []).find((item) => String(item).toLowerCase() === key);
    if (canonical !== undefined) return canonical;
  }
  return type;
}

function getIterationsForProjectFromStore(state, projectId) {
  const idKey = projectId == null ? '' : String(projectId).trim();
  if (!idKey) return [];

  const projects = Array.isArray(state?.baseline?.projects) ? state.baseline.projects : [];
  const project = projects.find((item) => String(item?.id || '').trim() === idKey);
  const iterationSetId = String(project?.iteration_uuid || '').trim();
  if (!iterationSetId) return [];

  const setsById = state?.baseline?.iterationsByProject || {};
  const linkedSet = setsById[iterationSetId];
  if (Array.isArray(linkedSet?.iterations)) return linkedSet.iterations;
  return [];
}

function normalizeIdSet(values) {
  const out = new Set();
  for (const value of values || []) {
    out.add(String(value));
  }
  return out;
}

function buildParentByChildMap(features) {
  const map = new Map();
  for (const feature of Array.isArray(features) ? features : []) {
    if (!feature?.id || !feature?.parentId) continue;
    map.set(String(feature.id), String(feature.parentId));
  }
  return map;
}

function buildTaskTypeOrderMap(taskTypes, hierarchy) {
  const order = new Map();
  for (const type of taskTypes) {
    const level = getTypeLevelFromHierarchy(type, hierarchy);
    order.set(String(type).toLowerCase(), level);
  }
  return order;
}

function getFeatureTypeName(feature) {
  return String(feature?.type ?? feature?.workItemType ?? feature?.work_item_type ?? '').trim();
}

function makeCountsMap(features, predicate) {
  const counts = new Map();
  for (const feature of features) {
    if (!predicate(feature)) continue;
    const typeName = getFeatureTypeName(feature).toLowerCase();
    if (!typeName) continue;
    counts.set(typeName, (counts.get(typeName) || 0) + 1);
  }
  return counts;
}

function hasFeatureTeam(feature, teamId) {
  const capacities = Array.isArray(feature?.capacity) ? feature.capacity : [];
  return capacities.some((item) => String(item?.team ?? item?.teamId ?? item?.id) === String(teamId));
}

function computeExpandedFeatureSetFallback(features, selectedFeatureIds, options = {}) {
  const expandedIds = normalizeIdSet(selectedFeatureIds);
  const childrenByParent = buildChildrenByParentMap(features);
  const parentByChild = buildParentByChildMap(features);
  const byId = new Map(features.map((feature) => [String(feature.id), feature]));
  const selectedTeamIds = normalizeIdSet(options.selectedTeamIds || []);

  let parentChildCount = 0;
  let teamAllocatedCount = 0;

  if (options.expandParentChild) {
    const stack = Array.from(expandedIds);
    while (stack.length > 0) {
      const currentId = stack.pop();
      const children = childrenByParent.get(String(currentId)) || [];
      for (const childId of children) {
        if (!expandedIds.has(String(childId))) {
          expandedIds.add(String(childId));
          parentChildCount += 1;
          stack.push(String(childId));
        }
      }
      const parentId = parentByChild.get(String(currentId));
      if (parentId && !expandedIds.has(String(parentId))) {
        expandedIds.add(String(parentId));
        parentChildCount += 1;
        stack.push(String(parentId));
      }
    }
  }

  if (options.expandTeamAllocated && selectedTeamIds.size > 0) {
    for (const feature of features) {
      if (!feature?.id) continue;
      if (expandedIds.has(String(feature.id))) continue;
      const matchesTeam = Array.from(selectedTeamIds).some((teamId) => hasFeatureTeam(feature, teamId));
      if (!matchesTeam) continue;
      expandedIds.add(String(feature.id));
      teamAllocatedCount += 1;
    }
  }

  return {
    expandedIds,
    counts: {
      parentChild: parentChildCount,
      relations: 0,
      teamAllocated: teamAllocatedCount,
    },
  };
}

export function createLegacyFeatureSelectors(state) {
  return {
    getBaselineFeatures() {
      return Array.isArray(state?.baselineFeatures) ? state.baselineFeatures : [];
    },

    getEffectiveFeatures() {
      if (typeof state.getEffectiveFeatures === 'function') {
        return state.getEffectiveFeatures();
      }
      return [];
    },

    getEffectiveFeatureById(id) {
      if (typeof state.getEffectiveFeatureById === 'function') {
        return state.getEffectiveFeatureById(id);
      }
      const features = this.getEffectiveFeatures();
      return features.find((feature) => String(feature?.id) === String(id)) || null;
    },

    getChildrenByParentMap() {
      if (state?.childrenByParent instanceof Map) {
        return state.childrenByParent;
      }
      return buildChildrenByParentMap(this.getEffectiveFeatures());
    },

    getIterationsForProject(projectId) {
      if (typeof state?.getIterationsForProject === 'function') {
        return state.getIterationsForProject(projectId);
      }
      return [];
    },

    getAvailableTaskTypes() {
      if (Array.isArray(state?.availableTaskTypes)) return state.availableTaskTypes;
      return deriveAvailableTaskTypes(this.getEffectiveFeatures());
    },

    getTaskTypeHierarchy() {
      if (Array.isArray(state?.taskTypeHierarchy)) return state.taskTypeHierarchy;
      return deriveTaskTypeHierarchy(state?.baselineProjects || []);
    },

    getTypeLevel(type) {
      if (typeof state?.getTypeLevel === 'function') return state.getTypeLevel(type);
      return getTypeLevelFromHierarchy(type, this.getTaskTypeHierarchy());
    },

    getTypeDisplayName(type) {
      if (typeof state?.getTypeDisplayName === 'function') {
        return state.getTypeDisplayName(type);
      }
      return getTypeDisplayNameFromHierarchy(type, this.getTaskTypeHierarchy());
    },

    getBaselineFeatureById(id) {
      const key = String(id);
      if (state?.baselineFeatureById instanceof Map) {
        return state.baselineFeatureById.get(key) || null;
      }
      const feature = (state?.baselineFeatures || []).find((item) => String(item?.id) === key);
      return feature || null;
    },

    getChildrenByParentId(parentId) {
      const map = this.getChildrenByParentMap();
      const ids = map.get(String(parentId)) || map.get(Number(parentId)) || [];
      return Array.from(ids || []).map((id) => String(id));
    },

    computeExpandedFeatureSet(selectedFeatureIds, options = {}) {
      if (state?.featureService?.computeExpandedFeatureSet) {
        return state.featureService.computeExpandedFeatureSet(selectedFeatureIds, options);
      }
      return computeExpandedFeatureSetFallback(
        this.getEffectiveFeatures(),
        selectedFeatureIds,
        options
      );
    },

    getAvailableTaskTypesOrdered() {
      if (Array.isArray(state?.availableTaskTypesOrdered)) {
        return state.availableTaskTypesOrdered;
      }
      const taskTypes = this.getAvailableTaskTypes();
      const hierarchy = this.getTaskTypeHierarchy();
      return [...taskTypes].sort((a, b) => {
        const levelA = getTypeLevelFromHierarchy(a, hierarchy);
        const levelB = getTypeLevelFromHierarchy(b, hierarchy);
        if (levelA !== levelB) return levelA - levelB;
        return String(a).localeCompare(String(b));
      });
    },

    getCountsForProject(projectId) {
      if (typeof state?.allCountsForProject === 'function') {
        return state.allCountsForProject(projectId);
      }
      return makeCountsMap(
        this.getEffectiveFeatures(),
        (feature) => String(feature?.project) === String(projectId)
      );
    },

    getCountsForTeam(teamId) {
      if (typeof state?.allCountsForTeam === 'function') {
        return state.allCountsForTeam(teamId);
      }
      return makeCountsMap(this.getEffectiveFeatures(), (feature) => hasFeatureTeam(feature, teamId));
    },
  };
}

export function createFeatureSelectors(store, legacyState = null) {
  return {
    getBaselineFeatures() {
      return Array.isArray(store.getState()?.baseline?.features) ?
          store.getState().baseline.features
        : [];
    },

    getEffectiveFeatures() {
      return deriveEffectiveFeatures(store.getState());
    },

    getEffectiveFeatureById(id) {
      const key = String(id);
      const features = deriveEffectiveFeatures(store.getState());
      return features.find((feature) => String(feature?.id) === key) || null;
    },

    getChildrenByParentMap() {
      return buildChildrenByParentMap(this.getEffectiveFeatures());
    },

    getIterationsForProject(projectId) {
      return getIterationsForProjectFromStore(store.getState(), projectId);
    },

    getAvailableTaskTypes() {
      const state = store.getState();
      const features = Array.isArray(state?.baseline?.features) ? state.baseline.features : [];
      return deriveAvailableTaskTypes(features);
    },

    getTaskTypeHierarchy() {
      const projects = Array.isArray(store.getState()?.baseline?.projects) ?
        store.getState().baseline.projects
      : [];
      return deriveTaskTypeHierarchy(projects);
    },

    getTypeLevel(type) {
      return getTypeLevelFromHierarchy(type, this.getTaskTypeHierarchy());
    },

    getTypeDisplayName(type) {
      return getTypeDisplayNameFromHierarchy(type, this.getTaskTypeHierarchy());
    },

    getBaselineFeatureById(id) {
      return buildBaselineFeatureMap(store.getState()).get(String(id)) || null;
    },

    getChildrenByParentId(parentId) {
      const ids = this.getChildrenByParentMap().get(String(parentId)) || [];
      return Array.from(ids || []).map((id) => String(id));
    },

    computeExpandedFeatureSet(selectedFeatureIds, options = {}) {
      return computeExpandedFeatureSetFallback(
        this.getEffectiveFeatures(),
        selectedFeatureIds,
        options
      );
    },

    getAvailableTaskTypesOrdered() {
      const taskTypes = this.getAvailableTaskTypes();
      const hierarchy = this.getTaskTypeHierarchy();
      const orderMap = buildTaskTypeOrderMap(taskTypes, hierarchy);
      return [...taskTypes].sort((a, b) => {
        const levelA = orderMap.get(String(a).toLowerCase()) ?? 9999;
        const levelB = orderMap.get(String(b).toLowerCase()) ?? 9999;
        if (levelA !== levelB) return levelA - levelB;
        return String(a).localeCompare(String(b));
      });
    },

    getCountsForProject(projectId) {
      return makeCountsMap(
        this.getEffectiveFeatures(),
        (feature) => String(feature?.project) === String(projectId)
      );
    },

    getCountsForTeam(teamId) {
      return makeCountsMap(this.getEffectiveFeatures(), (feature) => hasFeatureTeam(feature, teamId));
    },

    getSelectedFeatureId() {
      return store.getState().featureDisplay?.selectedId ?? null;
    },

    getSelectedFeature() {
      const id = store.getState().featureDisplay?.selectedId;
      return id ? this.getEffectiveFeatureById(id) : null;
    },
  };
}
