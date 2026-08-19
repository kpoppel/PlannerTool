import {
  buildChildrenByParentMap,
  buildFeatureMap,
  deriveEffectiveFeatures,
} from '../shared/featureProjection.js';
import { deriveAvailableTaskTypes } from '../shared/stateDerivations.js';
import { hasFeatureTeamAllocation, hasFeatureTeamId } from '../shared/teamAllocation.js';

function buildBaselineFeatureMap(state) {
  return buildFeatureMap(state.baseline.features);
}

function deriveTaskTypeHierarchy(projects) {
  for (const project of projects) {
    if (project.task_type_hierarchy.length > 0) {
      return project.task_type_hierarchy;
    }
  }
  return [];
}

function getTypeLevelFromHierarchy(type, hierarchy) {
  const key = String(type).toLowerCase();
  for (let index = 0; index < hierarchy.length; index += 1) {
    const types = hierarchy[index].types.map((item) => String(item).toLowerCase());
    if (types.includes(key)) return index;
  }
  return 9999;
}

function getTypeDisplayNameFromHierarchy(type, hierarchy) {
  const key = String(type).toLowerCase();
  for (const level of hierarchy) {
    const canonical = level.types.find((item) => String(item).toLowerCase() === key);
    if (canonical !== undefined) return canonical;
  }
  return type;
}

function getIterationsForProjectFromStore(state, projectId) {
  const idKey = String(projectId).trim();
  if (idKey === '') return [];

  const project = state.baseline.projects.find((item) => String(item.id).trim() === idKey);
  if (project === undefined) return [];
  const iterationSetId = String(project.iteration_uuid).trim();
  if (iterationSetId === '') return [];

  const linkedSet = state.baseline.iterationsByProject[iterationSetId];
  if (linkedSet === undefined) return [];
  if (linkedSet.iterations === undefined) return [];
  return linkedSet.iterations;
}

function normalizeIdSet(values) {
  const out = new Set();
  for (const value of values) {
    out.add(String(value));
  }
  return out;
}

function buildParentByChildMap(features) {
  const map = new Map();
  for (const feature of features) {
    if (!feature.parentId) continue;
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
  return String(feature.type).trim();
}

function makeCountsMap(features, predicate) {
  const counts = new Map();
  for (const feature of features) {
    if (!predicate(feature)) continue;
    const typeName = getFeatureTypeName(feature).toLowerCase();
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

function computeExpandedFeatureSetFallback(features, selectedFeatureIds, options = {}) {
  const expandedIds = normalizeIdSet(selectedFeatureIds);
  const childrenByParent = buildChildrenByParentMap(features);
  const parentByChild = buildParentByChildMap(features);
  const selectedTeamIds = normalizeIdSet(options.selectedTeamIds);

  let parentChildCount = 0;
  let teamAllocatedCount = 0;

  if (options.expandParentChild) {
    const stack = Array.from(expandedIds);
    while (stack.length > 0) {
      const currentId = stack.pop();
      const children = childrenByParent.get(String(currentId));
      if (children !== undefined) {
        for (const childId of children) {
          if (!expandedIds.has(String(childId))) {
            expandedIds.add(String(childId));
            parentChildCount += 1;
            stack.push(String(childId));
          }
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
      if (!feature.id) continue;
      if (expandedIds.has(String(feature.id))) continue;
      const matchesTeam = hasFeatureTeamAllocation(feature, selectedTeamIds);
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

export function createFeatureSelectors(store) {
  return {
    getBaselineFeatures() {
      return store.getState().baseline.features;
    },

    getEffectiveFeatures() {
      return deriveEffectiveFeatures(store.getState());
    },

    getEffectiveFeatureById(id) {
      const key = String(id);
      const features = deriveEffectiveFeatures(store.getState());
      const feature = features.find((feature) => String(feature.id) === key);
      if (feature === undefined) return null;
      return feature;
    },

    getChildrenByParentMap() {
      return buildChildrenByParentMap(this.getEffectiveFeatures());
    },

    getIterationsForProject(projectId) {
      return getIterationsForProjectFromStore(store.getState(), projectId);
    },

    getAvailableTaskTypes() {
      const state = store.getState();
      return deriveAvailableTaskTypes(state.baseline.features).sort();
    },

    getTaskTypeHierarchy() {
      return deriveTaskTypeHierarchy(store.getState().baseline.projects);
    },

    getTypeLevel(type) {
      return getTypeLevelFromHierarchy(type, this.getTaskTypeHierarchy());
    },

    getTypeDisplayName(type) {
      return getTypeDisplayNameFromHierarchy(type, this.getTaskTypeHierarchy());
    },

    getBaselineFeatureById(id) {
      const feature = buildBaselineFeatureMap(store.getState()).get(String(id));
      if (feature === undefined) return null;
      return feature;
    },

    getChildrenByParentId(parentId) {
      const ids = this.getChildrenByParentMap().get(String(parentId));
      if (ids === undefined) return [];
      return Array.from(ids).map((id) => String(id));
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
        const rawLevelA = orderMap.get(String(a).toLowerCase());
        const rawLevelB = orderMap.get(String(b).toLowerCase());
        const levelA = rawLevelA === undefined ? 9999 : rawLevelA;
        const levelB = rawLevelB === undefined ? 9999 : rawLevelB;
        if (levelA !== levelB) return levelA - levelB;
        return String(a).localeCompare(String(b));
      });
    },

    getCountsForProject(projectId) {
      return makeCountsMap(
        this.getEffectiveFeatures(),
        (feature) => String(feature.project) === String(projectId)
      );
    },

    getCountsForTeam(teamId) {
      return makeCountsMap(this.getEffectiveFeatures(), (feature) => hasFeatureTeamId(feature, teamId));
    },

    getSelectedFeatureId() {
      const selectedId = store.getState().featureDisplay.selectedId;
      if (selectedId === undefined) return null;
      return selectedId;
    },

    getSelectedFeature() {
      const id = store.getState().featureDisplay.selectedId;
      return id ? this.getEffectiveFeatureById(id) : null;
    },
  };
}
