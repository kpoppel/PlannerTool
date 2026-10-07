import { createFilterSelectors } from './filterSelectors.js';
import { createFeatureSelectors } from './featureSelectors.js';
import {
  deriveEffectiveFeatures,
  featureCanPresent,
  featureHasEligibleParent,
  featureMatchesPlans,
} from '../shared/featureProjection.js';
import { hasFeatureTeamAllocation } from '../shared/teamAllocation.js';
import { hasTimelinePlacement } from '../shared/featurePresentation.js';

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
  const featureSelectors = createFeatureSelectors(store);
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
    graphCache = { features, featuresById, parents, children, dependencies };
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

  function canPresentInContext(feature, context) {
    const state = store.getState();
    const membership = getScopeMembership();
    const isAncestorContext = feature.ancestorOnly === true
      && context.parent && membership.ancestorIds.has(String(feature.id));
    if (!featureCanPresent(feature) && !isAncestorContext) return false;
    const plan = state.baseline.projects.find((project) => project.id === feature.project);
    // Boundary guard: payload comes from external persistence/API and may be missing fields; normalize here, not downstream.
    return plan === undefined || plan.display_states === undefined
      || plan.display_states.includes(feature.state);
  }

  function getPresentableContextFeatures() {
    const context = store.getState().view.context;
    return getContextFeatures().filter((feature) => canPresentInContext(feature, context));
  }

  function createCardExclusionFilter(context = store.getState().view.context) {
    const state = store.getState();
    const selectedFeatureStates = new Set(
      state.selection.featureStateNames.map((stateName) => String(stateName).toLowerCase())
    );
    const selectedTaskTypeNames = new Set(
      state.selection.taskTypeNames.map((type) => String(type).toLowerCase())
    );
    const hiddenTypes = new Set(state.view.options.hiddenTypes.map((type) => String(type)));
    const membership = getScopeMembership();
    return (feature) => {
      if (!canPresentInContext(feature, context)) return 'presentation';
      const dimension = filterSelectors.getTaskFilterExclusion(feature);
      if (dimension === 'schedule'
        || (!state.view.options.showUnplannedWork && !hasTimelinePlacement(feature))) return 'schedule';
      if (dimension === 'allocation') return 'allocation';
      if (dimension === 'hierarchy'
        || (state.view.options.showOnlyProjectHierarchy
          && !membership.baseIds.has(String(feature.id))
          && !membership.descendantIds.has(String(feature.id)))) return 'hierarchy';
      if (dimension === 'relations') return 'relations';
      if (selectedFeatureStates.size === 0
        || !selectedFeatureStates.has(String(feature.state).toLowerCase())) return 'state';
      if ((selectedTaskTypeNames.size > 0
        && !selectedTaskTypeNames.has(String(feature.type).toLowerCase()))
        || hiddenTypes.has(String(feature.type))) return 'taskTypes';
      return null;
    };
  }

  function getCardEligibleFeatures(contextFeatures, context = store.getState().view.context) {
    const getCardExclusion = createCardExclusionFilter(context);
    return contextFeatures.filter((feature) => getCardExclusion(feature) === null);
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

  function getBoardFeatures(contextFeatures, selectedTeamIds, teamFocus, context = store.getState().view.context) {
    const eligibleFeatures = getCardEligibleFeatures(contextFeatures, context);
    if (!teamFocus) return eligibleFeatures;
    if (selectedTeamIds.size === 0) return [];
    const graph = getGraph();
    const focusedFeatureIds = new Set(
      contextFeatures
        .filter((feature) => hasFeatureTeamAllocation(feature, selectedTeamIds))
        .map((feature) => String(feature.id))
    );
    const focusedAncestorIds = collectReachableIds(focusedFeatureIds, graph.parents);
    const focusedDescendantIds = new Set();
    const expanded = new Set();
    const pending = [...focusedFeatureIds];
    while (pending.length > 0) {
      const id = pending.pop();
      if (expanded.has(id)) continue;
      expanded.add(id);
      const children = graph.children.get(id);
      if (children === undefined) continue;
      for (const childId of children) {
        const child = graph.featuresById.get(childId);
        if (child.capacity.length > 0 && !hasFeatureTeamAllocation(child, selectedTeamIds)) continue;
        focusedDescendantIds.add(childId);
        if (!expanded.has(childId)) pending.push(childId);
      }
    }
    return eligibleFeatures.filter((feature) => {
      const id = String(feature.id);
      return focusedFeatureIds.has(id) || focusedAncestorIds.has(id) || focusedDescendantIds.has(id);
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
        getBoardFeatures(getContextFeatures(), organizationTeamIds, false, currentContext)
          .map((feature) => String(feature.id))
      );
      const counts = {};
      for (const option of ['parent', 'child', 'dependency', 'otherAllocations']) {
        const nextContext = { ...currentContext, [option]: !currentContext[option] };
        const nextIds = new Set(
          getBoardFeatures(getContextFeaturesFor(nextContext), organizationTeamIds, false, nextContext)
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
    getBoardBreakdown() {
      const selectedPlanIds = toIdSet(store.getState().selection.projectIds);
      const contextFeatures = getContextFeatures();
      let selectedPlanTasks = 0;
      for (const planId of selectedPlanIds) {
        for (const count of featureSelectors.getCountsForProject(planId).values()) {
          selectedPlanTasks += count;
        }
      }
      const selectedPlanSets = [...selectedPlanIds].map((planId) => new Set([planId]));
      const planTaskIds = new Set(getResolvedFeatures().filter((feature) =>
        String(feature.type).trim().length > 0 && selectedPlanSets.some((planIds) =>
          featureMatchesPlans(feature, planIds) && featureCanPresent(feature, planIds)
        )
      ).map((feature) => String(feature.id)));
      const displayableIds = new Set(getPresentableContextFeatures().map((feature) => String(feature.id)));
      const filterExclusions = { schedule: 0, allocation: 0, hierarchy: 0, relations: 0, state: 0, taskTypes: 0 };
      const getCardExclusion = createCardExclusionFilter();
      for (const feature of getPresentableContextFeatures()) {
        const exclusion = getCardExclusion(feature);
        if (exclusion !== null) filterExclusions[exclusion] += 1;
      }
      const taskFilterExcludedTasks = Object.values(filterExclusions).reduce((sum, count) => sum + count, 0);
      const filteredTasks = displayableIds.size - taskFilterExcludedTasks;
      const tasksVisible = getVisibleFeatures().length;
      return {
        selectedPlanTasks,
        sharedPlanTasks: selectedPlanTasks - planTaskIds.size,
        scopeAddedTasks: [...displayableIds].filter((id) => !planTaskIds.has(id)).length,
        scopeExcludedTasks: [...planTaskIds].filter((id) => !displayableIds.has(id)).length,
        displayableTasks: displayableIds.size,
        taskFilterExcludedTasks,
        filterExclusions,
        teamExcludedTasks: filteredTasks - tasksVisible,
        tasksVisible,
        teamsInScope: new Set(contextFeatures.flatMap((feature) =>
          feature.capacity.map((entry) => String(entry.team))
        )).size,
      };
    },
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