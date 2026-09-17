import { createFilterSelectors } from './filterSelectors.js';
import { deriveEffectiveFeatures } from '../shared/featureProjection.js';
import { hasFeatureTeamAllocation } from '../shared/teamAllocation.js';

/** @typedef {import('../types.js').StoreApi} StoreApi */

function toIdSet(values) {
  return new Set(values.map((value) => String(value)));
}

function isHierarchicalRelation(relation) {
  if (!relation || typeof relation !== 'object') return false;
  const relationType = relation.type !== undefined ? relation.type : relation.relationType;
  return relationType === 'Parent' || relationType === 'Child';
}

function nonHierarchicalRelationIds(feature) {
  const ids = new Set();
  for (const relation of feature.relations || []) {
    if (!relation || typeof relation !== 'object' || isHierarchicalRelation(relation)) continue;
    if (relation.id !== undefined && relation.id !== null) ids.add(String(relation.id));
  }
  return ids;
}

function isAncestorOf(feature, selectedFeaturesById, selectedIds) {
  const candidateId = String(feature.id);
  for (const selectedId of selectedIds) {
    let current = selectedFeaturesById.get(selectedId);
    const visited = new Set();
    while (current && current.parentId) {
      const parentId = String(current.parentId);
      if (visited.has(parentId)) break;
      visited.add(parentId);
      if (parentId === candidateId) return true;
      current = selectedFeaturesById.get(parentId);
    }
  }
  return false;
}

function isDescendantOf(feature, selectedIds, featuresById) {
  let parentId = feature.parentId;
  const visited = new Set();
  while (parentId) {
    const key = String(parentId);
    if (visited.has(key)) return false;
    visited.add(key);
    if (selectedIds.has(key)) return true;
    const parent = featuresById.get(key);
    if (!parent) return false;
    parentId = parent.parentId;
  }
  return false;
}

function isDependencyLinked(feature, selectedFeatures) {
  const selectedFeatureIds = new Set(selectedFeatures.map((item) => String(item.id)));
  for (const selectedFeature of selectedFeatures) {
    if (nonHierarchicalRelationIds(selectedFeature).has(String(feature.id))) return true;
  }
  for (const relationId of nonHierarchicalRelationIds(feature)) {
    if (selectedFeatureIds.has(relationId)) return true;
  }
  return false;
}

function isLinkedContext(feature, selectedIds, featuresById, selectedFeatures) {
  return isAncestorOf(feature, featuresById, selectedIds)
    || isDescendantOf(feature, selectedIds, featuresById)
    || isDependencyLinked(feature, selectedFeatures);
}

function isInSelectedProjectHierarchy(feature, featuresById, selectedProjectIds) {
  const visited = new Set();
  let current = feature;
  while (current) {
    const currentId = String(current.id);
    if (visited.has(currentId)) return false;
    visited.add(currentId);
    if (selectedProjectIds.has(String(current.project))) return true;
    if (!current.parentId) return false;
    current = featuresById.get(String(current.parentId));
  }
  return false;
}

/**
 * Derive the resolved and visible task scopes. Resolved features are independent
 * from presentation filters and are the only source used by later calculations.
 * @param {StoreApi} store
 * @returns {object}
 */
export function createScopeSelectors(store) {
  const filterSelectors = createFilterSelectors(store);
  let resolvedCache;
  let resolvedCacheKey;
  let contextCache;
  let contextCacheKey;
  let visibleCache;
  let visibleCacheKey;

  function getResolvedFeatures() {
    const state = store.getState();
    const key = [state.baseline.features, state.baseline.teams, state.scenarios.items, state.scenarios.activeId];
    if (resolvedCache && key.every((value, index) => value === resolvedCacheKey[index])) return resolvedCache;
    const organizationTeamIds = new Set(state.baseline.teams.map((team) => String(team.id)));
    resolvedCacheKey = key;
    resolvedCache = deriveEffectiveFeatures(state, { organizationTeamIds });
    contextCache = null;
    visibleCache = null;
    return resolvedCache;
  }

  function getVisibleFeatures() {
    const state = store.getState();
    const contextFeatures = getContextFeatures();
    const selectedTeamIds = toIdSet(state.selection.teamIds);
    const selectedProjectIds = toIdSet(state.selection.projectIds);
    const selectedFeatureStates = new Set(
      state.selection.featureStateNames.map((stateName) => String(stateName).toLowerCase())
    );
    const selectedTaskTypeNames = new Set(
      state.selection.taskTypeNames.map((type) => String(type).toLowerCase())
    );
    const hiddenTypes = new Set(state.view.options.hiddenTypes.map((type) => String(type)));
    const key = [contextFeatures, state.selection.teamIds.join(','), state.selection.featureStateNames.join(','), state.selection.taskTypeNames.join(','), state.selection.taskFilters, state.view.options];
    if (visibleCache && key.every((value, index) => value === visibleCacheKey[index])) return visibleCache;
    visibleCacheKey = key;
    const featuresById = new Map(
      getResolvedFeatures().map((feature) => [String(feature.id), feature])
    );
    const focusedFeatureIds = new Set(
      contextFeatures
        .filter((feature) => hasFeatureTeamAllocation(feature, selectedTeamIds))
        .map((feature) => String(feature.id))
    );
    for (const feature of contextFeatures) {
      if (selectedProjectIds.has(String(feature.project))) {
        focusedFeatureIds.add(String(feature.id));
      }
    }
    visibleCache = contextFeatures.filter((feature) => {
      const isSelectedPlan = selectedProjectIds.has(String(feature.project));
      const hasSelectedTeam = hasFeatureTeamAllocation(feature, selectedTeamIds);
      const isFocusedAncestor = isAncestorOf(feature, featuresById, focusedFeatureIds);
      if (selectedTeamIds.size === 0 && !isSelectedPlan) return false;
      if (selectedTeamIds.size > 0
        && !hasSelectedTeam
        && !(isSelectedPlan && feature.capacity.length === 0)
        && !isFocusedAncestor) return false;
      if (selectedTaskTypeNames.size > 0
        && !selectedTaskTypeNames.has(String(feature.type).toLowerCase())) return false;
      if (selectedFeatureStates.size === 0
        || !selectedFeatureStates.has(String(feature.state).toLowerCase())) return false;
      if (hiddenTypes.has(String(feature.type))) return false;
      if (!state.view.options.showUnplannedWork && (!feature.start || !feature.end)) return false;
      if (state.view.options.showOnlyProjectHierarchy
        && !isInSelectedProjectHierarchy(feature, featuresById, selectedProjectIds)) return false;
      return filterSelectors.featurePassesFilters(feature);
    });
    return visibleCache;
  }

  function getContextFeatures() {
    const state = store.getState();
    const resolvedFeatures = getResolvedFeatures();
    const selectedIds = toIdSet(state.selection.projectIds);
    if (selectedIds.size === 0) return [];
    const context = state.view.context;
    const key = [resolvedFeatures, state.selection.projectIds.join(','), context.parent, context.child, context.dependency, context.otherAllocations];
    if (contextCache && key.every((value, index) => value === contextCacheKey[index])) return contextCache;

    contextCacheKey = key;
    contextCache = getContextFeaturesFor(context);
    visibleCache = null;
    return contextCache;
  }

    function getContextOptionCounts() {
      const currentContext = stateContext();
      const currentIds = new Set(getContextFeatures().map((feature) => String(feature.id)));
      const counts = {};
      for (const option of ['parent', 'child', 'dependency', 'otherAllocations']) {
        const nextContext = { ...currentContext, [option]: !currentContext[option] };
        const nextIds = new Set(getContextFeaturesFor(nextContext).map((feature) => String(feature.id)));
        let changed = 0;
        for (const id of currentContext[option] ? currentIds : nextIds) {
          if (!(currentContext[option] ? nextIds : currentIds).has(id)) changed += 1;
        }
        counts[option] = changed;
      }
      return counts;
    }

    function stateContext() {
      const context = store.getState().view.context;
      return {
        parent: Boolean(context.parent),
        child: Boolean(context.child),
        dependency: Boolean(context.dependency),
        otherAllocations: Boolean(context.otherAllocations),
      };
    }

    function getContextFeaturesFor(context) {
      const state = store.getState();
      const resolvedFeatures = getResolvedFeatures();
      const selectedIds = toIdSet(state.selection.projectIds);
      if (selectedIds.size === 0) return [];
      const featuresById = new Map(resolvedFeatures.map((feature) => [String(feature.id), feature]));
      const selectedFeatures = resolvedFeatures.filter((feature) => selectedIds.has(String(feature.project)));
      const selectedPlanTeamIds = new Set();
      for (const feature of selectedFeatures) {
        for (const entry of feature.capacity) selectedPlanTeamIds.add(String(entry.team));
      }
      const selectedFeatureIds = new Set(selectedFeatures.map((feature) => String(feature.id)));
      return resolvedFeatures.filter((feature) => {
        if (selectedIds.has(String(feature.project))) return true;
        const isParent = context.parent && isAncestorOf(feature, featuresById, selectedFeatureIds);
        const isChild = context.child && isDescendantOf(feature, selectedFeatureIds, featuresById);
        const isDependency = context.dependency && isDependencyLinked(feature, selectedFeatures);
        const isOther = context.otherAllocations
          && hasFeatureTeamAllocation(feature, selectedPlanTeamIds)
          && !isLinkedContext(feature, selectedFeatureIds, featuresById, selectedFeatures);
        return isParent || isChild || isDependency || isOther;
      });
    }

  function getVisibleTeams() {
    const teamIds = new Set();
    for (const feature of getVisibleFeatures()) {
      for (const entry of feature.capacity) teamIds.add(String(entry.team));
    }
    return Array.from(teamIds);
  }

  function getContextTeams() {
    const teamIds = new Set();
    for (const feature of getContextFeatures()) {
      for (const entry of feature.capacity) teamIds.add(String(entry.team));
    }
    return Array.from(teamIds);
  }

  function getTeamDrilldownIds() {
    return store.getState().selection.teamIds.map((id) => String(id));
  }

  return {
    getResolvedFeatures,
    getContextFeatures,
    getVisibleFeatures,
    getVisibleTeams,
    getContextTeams,
    getTeamDrilldownIds,
    getContextOptionCounts,
    getFunnel() {
      const visibleFeatures = getVisibleFeatures();
      const contextFeatures = getContextFeatures();
      const selectedProjectIds = toIdSet(store.getState().selection.projectIds);
      const baseTasks = contextFeatures.filter(
        (feature) => selectedProjectIds.has(String(feature.project))
      ).length;
      const teamsInScope = new Set();
      for (const feature of contextFeatures) {
        for (const entry of feature.capacity) teamsInScope.add(String(entry.team));
      }
      const teamsInView = new Set();
      for (const feature of visibleFeatures) {
        for (const entry of feature.capacity) teamsInView.add(String(entry.team));
      }
      return {
        baseTasks,
        relatedTasks: contextFeatures.length - baseTasks,
        tasksInScope: contextFeatures.length,
        teamsInScope: teamsInScope.size,
        tasksVisible: visibleFeatures.length,
        teamsInView: teamsInView.size,
      };
    },
  };
}