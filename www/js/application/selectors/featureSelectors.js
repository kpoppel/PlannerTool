import {
  buildChildrenByParentMap,
  buildFeatureMap,
  deriveEffectiveFeatures,
  featureCanPresent,
  featureMatchesPlans,
} from '../shared/featureProjection.js';
import { deriveAvailableTaskTypes } from '../shared/stateDerivations.js';
import { hasFeatureTeamAllocation, hasFeatureTeamId } from '../shared/teamAllocation.js';
import { projectAllocationAvailability } from '../shared/allocationAvailability.js';
import { displayTypes, featureTypeKey, projectDisplay, taskTypeKey } from '../shared/workItemDisplay.js';

/** @typedef {import('../types.js').StoreApi} StoreApi */

function buildBaselineFeatureMap(state) {
  return buildFeatureMap(state.baseline.features);
}

function deriveTaskTypeHierarchy(projects) {
  return projectDisplay(projects).flatMap((process) => process.tiers.map((tier, level) => ({
    process_id: process.process_id, level,
    types: tier.map((type) => taskTypeKey(process.process_id, type.name)),
  })));
}

function getTypeLevelFromHierarchy(type, hierarchy) {
  const key = String(type);
  for (let index = 0; index < hierarchy.length; index += 1) {
    const types = hierarchy[index].types;
    if (types.includes(key)) return index;
  }
  return 9999;
}

function getSchedulePresetsForProjectFromStore(state, projectId) {
  const idKey = String(projectId).trim();
  if (idKey === '') return [];

  const project = state.baseline.projects.find((item) => String(item.id).trim() === idKey);
  if (project === undefined) return [];
  const iterationSetId = String(project.iteration_uuid).trim();
  if (iterationSetId === '') return [];

  const linkedSet = state.baseline.iterationsByProject[iterationSetId];
  if (linkedSet === undefined) return [];
  return linkedSet.presets;
}

function buildTaskTypeOrderMap(hierarchy) {
  const order = new Map();
  for (const level of hierarchy) {
    for (const type of level.types) {
      const key = String(type);
      if (!order.has(key)) order.set(key, order.size);
    }
  }
  return order;
}

function getFeatureTypeName(feature) {
  return String(feature.type).trim();
}

function makeCountsMap(features, predicate) {
  const counts = new Map();
  for (const feature of features) {
    if (!predicate(feature)) continue;
    const typeName = featureTypeKey(feature);
    if (!typeName) continue;
    const current = counts.get(typeName);
    if (current === undefined) {
      counts.set(typeName, 1);
    } else {
      counts.set(typeName, current + 1);
    }
  }
  return counts;
}

/**
 * @param {StoreApi} store
 * @returns {object}
 */
export function createFeatureSelectors(store) {
  // Every FeatureCard reads this per render; deriving it per call made board re-renders O(N²).
  const childrenByParentCache = new WeakMap();
  const selectors = {
    getBaselineFeatures() {
      return store.getState().baseline.features;
    },

    getEffectiveFeatures() {
      return deriveEffectiveFeatures(store.getState());
    },

    getAllocationAvailability(feature) {
      const state = store.getState();
      const projects = state.baseline.projects;
      return projectAllocationAvailability({
        feature, projects, catalogue: state.baseline.teams,
        allocationDefaults: projects.length === 0 ? {} : projects[0].allocation_defaults,
      });
    },

    getEffectiveFeatureById(id) {
      const key = String(id);
      const features = deriveEffectiveFeatures(store.getState());
      const feature = features.find((feature) => String(feature.id) === key);
      if (feature === undefined) return null;
      return feature;
    },

    getChildrenByParentMap() {
      const state = store.getState();
      let map = childrenByParentCache.get(state);
      if (map === undefined) {
        map = buildChildrenByParentMap(deriveEffectiveFeatures(state));
        childrenByParentCache.set(state, map);
      }
      return map;
    },

    getSchedulePresetsForProject(projectId) {
      return getSchedulePresetsForProjectFromStore(store.getState(), projectId);
    },

    getAvailableTaskTypes() {
      const state = store.getState();
      return deriveAvailableTaskTypes(state.baseline.features).sort();
    },

    getTaskTypeHierarchy() {
      return deriveTaskTypeHierarchy(store.getState().baseline.projects);
    },

    getWorkItemDisplay() {
      return projectDisplay(store.getState().baseline.projects);
    },

    getTaskTypeOptions() {
      return displayTypes(selectors.getWorkItemDisplay());
    },

    getTypeLevel(type) {
      return getTypeLevelFromHierarchy(type, selectors.getTaskTypeHierarchy());
    },

    getTypeDisplayName(type) {
      const configured = selectors.getTaskTypeOptions().find((item) => item.key === type);
      return configured.name;
    },

    getBaselineFeatureById(id) {
      const feature = buildBaselineFeatureMap(store.getState()).get(String(id));
      if (feature === undefined) return null;
      return feature;
    },

    getChildrenByParentId(parentId) {
      const ids = selectors.getChildrenByParentMap().get(String(parentId));
      if (ids === undefined) return [];
      return Array.from(ids).map((id) => String(id));
    },

    getAvailableTaskTypesOrdered() {
      const taskTypes = selectors.getAvailableTaskTypes();
      const hierarchy = selectors.getTaskTypeHierarchy();
      const orderMap = buildTaskTypeOrderMap(hierarchy);
      return [...taskTypes].sort((first, second) => {
        const firstPosition = orderMap.get(first);
        const secondPosition = orderMap.get(second);
        const firstOrder = firstPosition === undefined ? orderMap.size : firstPosition;
        const secondOrder = secondPosition === undefined ? orderMap.size : secondPosition;
        if (firstOrder !== secondOrder) return firstOrder - secondOrder;
        return String(first).localeCompare(String(second));
      });
    },

    getCountsForProject(projectId) {
      const projectIds = new Set([String(projectId)]);
      return makeCountsMap(
        selectors.getEffectiveFeatures(),
        (feature) => featureMatchesPlans(feature, projectIds)
          && featureCanPresent(feature, projectIds)
      );
    },

    getCountsForTeam(teamId) {
      return makeCountsMap(selectors.getEffectiveFeatures(), (feature) => hasFeatureTeamId(feature, teamId));
    },

    getSelectedFeatureId() {
      const selectedId = store.getState().featureDisplay.selectedId;
      if (selectedId === undefined) return null;
      return selectedId;
    },

    getSelectedFeature() {
      const id = store.getState().featureDisplay.selectedId;
      return id ? selectors.getEffectiveFeatureById(id) : null;
    },
  };

  return selectors;
}
