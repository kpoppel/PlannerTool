import { createFilterSelectors } from './filterSelectors.js';
import {
  deriveEffectiveFeatures,
  featureCanPresent,
  featureHasEligibleParent,
} from '../shared/featureProjection.js';
import { hasFeatureTeamAllocation } from '../shared/teamAllocation.js';

/** @typedef {import('../types.js').StoreApi} StoreApi */

function toIdSet(values) {
  return new Set(values.map((value) => String(value)));
}

function isBasePlanFeature(feature, selectedPlanIds) {
  return feature.ancestorOnly !== true && selectedPlanIds.has(String(feature.project));
}

function isHierarchicalRelation(relation) {
  if (!relation || typeof relation !== 'object') return false;
  const relationType = relation.type !== undefined ? relation.type : relation.relationType;
  return relationType === 'Parent' || relationType === 'Child';
}

function nonHierarchicalRelationIds(feature) {
  const ids = new Set();
  for (const relation of feature.relations) {
    if (!relation || typeof relation !== 'object' || isHierarchicalRelation(relation)) continue;
    if (relation.id !== undefined && relation.id !== null) ids.add(String(relation.id));
  }
  return ids;
}

function addGraphLink(index, sourceId, targetId) {
  if (!index.has(sourceId)) index.set(sourceId, new Set());
  index.get(sourceId).add(targetId);
}

function collectReachableIds(startIds, links) {
  const reached = new Set();
  const expanded = new Set();
  const pending = [...startIds];
  while (pending.length > 0) {
    const id = pending.pop();
    if (expanded.has(id)) continue;
    expanded.add(id);
    const neighbors = links.get(id);
    if (neighbors === undefined) continue;
    for (const neighborId of neighbors) {
      reached.add(neighborId);
      if (!expanded.has(neighborId)) pending.push(neighborId);
    }
  }
  return reached;
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
  let graphCache;
  let membershipCache;
  let membershipCacheKey;
  let optionCountsCache;
  let optionCountsCacheKey;

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

  function getGraph() {
    const features = getResolvedFeatures();
    if (graphCache && graphCache.features === features) return graphCache;
    const featuresById = new Map(features.map((feature) => [String(feature.id), feature]));
    const parents = new Map();
    const children = new Map();
    const dependencies = new Map();
    for (const feature of features) {
      const id = String(feature.id);
      if (feature.parentId) {
        const parentId = String(feature.parentId);
        if (featureHasEligibleParent(feature, featuresById.get(parentId))) {
          addGraphLink(parents, id, parentId);
          addGraphLink(children, parentId, id);
        }
      }
      for (const relationId of nonHierarchicalRelationIds(feature)) {
        addGraphLink(dependencies, id, relationId);
        addGraphLink(dependencies, relationId, id);
      }
    }
    graphCache = { features, parents, children, dependencies };
    return graphCache;
  }

  function getScopeMembership() {
    const graph = getGraph();
    const state = store.getState();
    const key = [graph, state.selection.projectIds.join(',')];
    if (membershipCache && key.every((value, index) => value === membershipCacheKey[index])) {
      return membershipCache;
    }
    const selectedIds = toIdSet(state.selection.projectIds);
    const selectedFeatures = graph.features.filter((feature) => isBasePlanFeature(feature, selectedIds));
    const baseIds = new Set(selectedFeatures.map((feature) => String(feature.id)));
    const teamIds = new Set();
    const dependencyIds = new Set();
    for (const feature of selectedFeatures) {
      for (const entry of feature.capacity) teamIds.add(String(entry.team));
      const linkedIds = graph.dependencies.get(String(feature.id));
      if (linkedIds !== undefined) {
        for (const id of linkedIds) dependencyIds.add(id);
      }
    }
    membershipCacheKey = key;
    membershipCache = {
      baseIds, teamIds, dependencyIds,
      ancestorIds: collectReachableIds(baseIds, graph.parents),
      descendantIds: collectReachableIds(baseIds, graph.children),
    };
    return membershipCache;
  }

  function canPresentInContext(feature) {
    const state = store.getState();
    const membership = getScopeMembership();
    const isAncestorContext = feature.ancestorOnly === true
      && state.view.context.parent && membership.ancestorIds.has(String(feature.id));
    if (!featureCanPresent(feature) && !isAncestorContext) return false;
    const plan = state.baseline.projects.find((project) => project.id === feature.project);
    // Boundary guard: payload comes from external persistence/API and may be missing fields; normalize here, not downstream.
    return plan === undefined || plan.display_states === undefined
      || plan.display_states.includes(feature.state);
  }

  function getPresentableContextFeatures() {
    return getContextFeatures().filter(canPresentInContext);
  }

  function getCardEligibleFeatures(contextFeatures) {
    const state = store.getState();
    const selectedFeatureStates = new Set(
      state.selection.featureStateNames.map((stateName) => String(stateName).toLowerCase())
    );
    const selectedTaskTypeNames = new Set(
      state.selection.taskTypeNames.map((type) => String(type).toLowerCase())
    );
    const hiddenTypes = new Set(state.view.options.hiddenTypes.map((type) => String(type)));
    const membership = getScopeMembership();
    return contextFeatures.filter((feature) => {
      if (!canPresentInContext(feature)) return false;
      if (selectedTaskTypeNames.size > 0
        && !selectedTaskTypeNames.has(String(feature.type).toLowerCase())) return false;
      if (selectedFeatureStates.size === 0
        || !selectedFeatureStates.has(String(feature.state).toLowerCase())) return false;
      if (hiddenTypes.has(String(feature.type))) return false;
      if (!state.view.options.showUnplannedWork && (!feature.start || !feature.end)) return false;
      if (state.view.options.showOnlyProjectHierarchy
        && !membership.baseIds.has(String(feature.id))
        && !membership.descendantIds.has(String(feature.id))) return false;
      return filterSelectors.featurePassesFilters(feature);
    });
  }

  function getVisibleFeatures() {
    const state = store.getState();
    const contextFeatures = getContextFeatures();
    const key = [contextFeatures, state.baseline.projects, state.selection.teamIds.join(','), state.selection.featureStateNames.join(','), state.selection.taskTypeNames.join(','), state.selection.taskFilters, state.view.options];
    if (visibleCache && key.every((value, index) => value === visibleCacheKey[index])) return visibleCache;
    visibleCacheKey = key;
    visibleCache = getBoardFeatures(
      contextFeatures, toIdSet(state.selection.teamIds), state.view.options.taskViewMode === 'team'
    );
    return visibleCache;
  }

  function getBoardFeatures(contextFeatures, selectedTeamIds, teamFocus) {
    const selectedProjectIds = toIdSet(store.getState().selection.projectIds);
    const focusedFeatureIds = new Set(
      contextFeatures
        .filter((feature) => hasFeatureTeamAllocation(feature, selectedTeamIds))
        .map((feature) => String(feature.id))
    );
    if (!teamFocus) {
      for (const feature of contextFeatures) {
        if (isBasePlanFeature(feature, selectedProjectIds)) {
          focusedFeatureIds.add(String(feature.id));
        }
      }
    }
    const focusedAncestorIds = collectReachableIds(focusedFeatureIds, getGraph().parents);
    return getCardEligibleFeatures(contextFeatures).filter((feature) => {
      const isSelectedPlan = isBasePlanFeature(feature, selectedProjectIds);
      const hasSelectedTeam = hasFeatureTeamAllocation(feature, selectedTeamIds);
      const isFocusedAncestor = focusedAncestorIds.has(String(feature.id));
      if (teamFocus && selectedTeamIds.size === 0) return false;
      if (selectedTeamIds.size === 0 && !isSelectedPlan && !isFocusedAncestor) return false;
      if (selectedTeamIds.size > 0
        && !hasSelectedTeam
        && !(isSelectedPlan && feature.capacity.length === 0 && !teamFocus)
        && !isFocusedAncestor) return false;
      return true;
    });
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
      const state = store.getState();
      const currentContext = state.view.context;
      const key = [
        getScopeMembership(), state.baseline.projects, currentContext.parent, currentContext.child,
        currentContext.dependency, currentContext.otherAllocations,
        state.selection.featureStateNames.join(','), state.selection.taskTypeNames.join(','),
        state.selection.taskFilters, state.view.options,
      ];
      if (optionCountsCache && key.every((value, index) => value === optionCountsCacheKey[index])) {
        return optionCountsCache;
      }
      const organizationTeamIds = new Set(state.baseline.teams.map((team) => String(team.id)));
      const currentIds = new Set(
        getBoardFeatures(getContextFeatures(), organizationTeamIds, false)
          .map((feature) => String(feature.id))
      );
      const counts = {};
      for (const option of ['parent', 'child', 'dependency', 'otherAllocations']) {
        const nextContext = { ...currentContext, [option]: !currentContext[option] };
        const nextIds = new Set(
          getBoardFeatures(getContextFeaturesFor(nextContext), organizationTeamIds, false)
            .map((feature) => String(feature.id))
        );
        const includedIds = currentContext[option] ? currentIds : nextIds;
        const excludedIds = currentContext[option] ? nextIds : currentIds;
        counts[option] = [...includedIds].filter((id) => !excludedIds.has(id)).length;
      }
      optionCountsCacheKey = key;
      optionCountsCache = counts;
      return optionCountsCache;
    }

    function getContextFeaturesFor(context) {
      const resolvedFeatures = getResolvedFeatures();
      const membership = getScopeMembership();
      if (membership.baseIds.size === 0) return [];
      return resolvedFeatures.filter((feature) => {
        const id = String(feature.id);
        if (membership.baseIds.has(id)) return true;
        const isParent = context.parent && membership.ancestorIds.has(id);
        const isChild = context.child && membership.descendantIds.has(id);
        const isDependency = context.dependency && membership.dependencyIds.has(id);
        const isOther = context.otherAllocations
          && hasFeatureTeamAllocation(feature, membership.teamIds)
          && !membership.ancestorIds.has(id)
          && !membership.descendantIds.has(id)
          && !membership.dependencyIds.has(id);
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
    getPresentableContextFeatures,
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
        (feature) => isBasePlanFeature(feature, selectedProjectIds)
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