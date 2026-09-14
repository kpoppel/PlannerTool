import { createFilterSelectors } from './filterSelectors.js';
import { deriveEffectiveFeatures } from '../shared/featureProjection.js';
import { hasFeatureTeamAllocation } from '../shared/teamAllocation.js';

/** @typedef {import('../types.js').StoreApi} StoreApi */

function toIdSet(values) {
  return new Set(values.map((value) => String(value)));
}

function relationIds(feature) {
  return new Set((feature.relations || []).map((relation) => String(relation.id)));
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

function isDependencyLinked(feature, selectedFeatures, featuresById) {
  const selectedFeatureIds = new Set(selectedFeatures.map((item) => String(item.id)));
  for (const selectedFeature of selectedFeatures) {
    if (relationIds(selectedFeature).has(String(feature.id))) return true;
  }
  for (const relationId of relationIds(feature)) {
    if (selectedFeatureIds.has(relationId) || featuresById.has(relationId)) {
      if (selectedFeatureIds.has(relationId)) return true;
    }
  }
  return false;
}

function isLinkedContext(feature, selectedIds, featuresById, selectedFeatures) {
  return isAncestorOf(feature, featuresById, selectedIds)
    || isDescendantOf(feature, selectedIds, featuresById)
    || isDependencyLinked(feature, selectedFeatures, featuresById);
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
    resolvedCache = deriveEffectiveFeatures(state, { selectedTeamIds: organizationTeamIds });
    contextCache = null;
    visibleCache = null;
    return resolvedCache;
  }

  function getVisibleFeatures() {
    const state = store.getState();
    const contextFeatures = getContextFeatures();
    const selectedTeamIds = toIdSet(state.selection.teamIds);
    const key = [contextFeatures, state.selection.teamIds.join(','), state.selection.taskTypeNames.join(','), state.selection.taskFilters, state.view.options];
    if (visibleCache && key.every((value, index) => value === visibleCacheKey[index])) return visibleCache;
    visibleCacheKey = key;
    visibleCache = contextFeatures.filter((feature) => {
      const isSelectedPlan = state.selection.projectIds.some(
        (projectId) => String(projectId) === String(feature.project)
      );
      if (
        selectedTeamIds.size > 0
        && !isSelectedPlan
        && !hasFeatureTeamAllocation(feature, selectedTeamIds)
      ) return false;
      if (state.selection.taskTypeNames.length > 0
        && !state.selection.taskTypeNames.includes(String(feature.type))) return false;
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
    const key = [resolvedFeatures, state.selection.projectIds.join(','), state.selection.teamIds.join(','), context.parent, context.child, context.dependency, context.otherAllocations];
    if (contextCache && key.every((value, index) => value === contextCacheKey[index])) return contextCache;

    const featuresById = new Map(resolvedFeatures.map((feature) => [String(feature.id), feature]));
    const selectedFeatures = resolvedFeatures.filter((feature) => selectedIds.has(String(feature.project)));
    const selectedTeamIds = toIdSet(state.selection.teamIds);
    const selectedFeatureIds = new Set(selectedFeatures.map((feature) => String(feature.id)));

    contextCacheKey = key;
    contextCache = resolvedFeatures.filter((feature) => {
      const isSelectedPlan = selectedIds.has(String(feature.project));
      if (isSelectedPlan) return true;
      const isParent = context.parent && isAncestorOf(feature, featuresById, selectedFeatureIds);
      const isChild = context.child && isDescendantOf(feature, selectedFeatureIds, featuresById);
      const isDependency = context.dependency && isDependencyLinked(feature, selectedFeatures, featuresById);
      const isOther = context.otherAllocations
        && hasFeatureTeamAllocation(feature, selectedTeamIds)
        && !isLinkedContext(feature, selectedFeatureIds, featuresById, selectedFeatures);
      return isParent
        || isChild
        || isDependency
        || isOther;
    });
      visibleCache = null;
      return contextCache;
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

  return {
    getResolvedFeatures,
    getContextFeatures,
    getVisibleFeatures,
    getVisibleTeams,
    getContextTeams,
    getFunnel() {
      const visibleFeatures = getVisibleFeatures();
      const teamsInView = new Set();
      for (const feature of visibleFeatures) {
        for (const entry of feature.capacity) teamsInView.add(String(entry.team));
      }
      return { tasksVisible: visibleFeatures.length, teamsInView: teamsInView.size };
    },
  };
}