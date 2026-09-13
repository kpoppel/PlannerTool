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
  let current = feature;
  const visited = new Set();
  while (current.parentId) {
    const parentId = String(current.parentId);
    if (visited.has(parentId)) return false;
    visited.add(parentId);
    if (selectedIds.has(parentId)) return true;
    current = selectedFeaturesById.get(parentId);
    if (!current) return false;
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

  function getResolvedFeatures() {
    const state = store.getState();
    const organizationTeamIds = new Set(state.baseline.teams.map((team) => String(team.id)));
    return deriveEffectiveFeatures(state, { selectedTeamIds: organizationTeamIds });
  }

  function getVisibleFeatures() {
    const state = store.getState();
    const resolvedFeatures = getResolvedFeatures();
    const selectedIds = toIdSet(state.selection.projectIds);
    if (selectedIds.size === 0) return [];

    const featuresById = new Map(resolvedFeatures.map((feature) => [String(feature.id), feature]));
    const selectedFeatures = resolvedFeatures.filter((feature) => selectedIds.has(String(feature.project)));
    const context = state.view.context;
    const selectedTeamIds = toIdSet(state.selection.teamIds);
    const selectedFeatureIds = new Set(selectedFeatures.map((feature) => String(feature.id)));

    return resolvedFeatures.filter((feature) => {
      const isSelectedPlan = selectedIds.has(String(feature.project));
      if (!isSelectedPlan) {
        const isParent = context.parent && isAncestorOf(feature, featuresById, selectedFeatureIds);
        const isChild = context.child && isDescendantOf(feature, selectedFeatureIds, featuresById);
        const isDependency = context.dependency && isDependencyLinked(feature, selectedFeatures, featuresById);
        const isOther = context.otherAllocations
          && hasFeatureTeamAllocation(feature, selectedTeamIds)
          && !isLinkedContext(feature, selectedFeatureIds, featuresById, selectedFeatures);
        if (!isParent && !isChild && !isDependency && !isOther) return false;
      }
      if (selectedTeamIds.size > 0 && !hasFeatureTeamAllocation(feature, selectedTeamIds)) return false;
      if (state.selection.taskTypeNames.length > 0
        && !state.selection.taskTypeNames.includes(String(feature.type))) return false;
      return filterSelectors.featurePassesFilters(feature);
    });
  }

  function getVisibleTeams() {
    const teamIds = new Set();
    for (const feature of getVisibleFeatures()) {
      for (const entry of feature.capacity) teamIds.add(String(entry.team));
    }
    return Array.from(teamIds);
  }

  return {
    getResolvedFeatures,
    getVisibleFeatures,
    getVisibleTeams,
    getFunnel() {
      return {
        tasksVisible: getVisibleFeatures().length,
        teamsInView: new Set(getVisibleTeams()).size,
      };
    },
  };
}