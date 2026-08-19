import { buildChildrenByParentMap } from './featureProjection.js';
import { hasFeatureTeamAllocation } from './teamAllocation.js';

function normalizeIdSet(values) {
  const out = new Set();
  for (const value of values) {
    out.add(String(value));
  }
  return out;
}

function buildFeatureByIdMap(features) {
  const map = new Map();
  for (const feature of features) {
    if (!feature || feature.id == null) continue;
    map.set(String(feature.id), feature);
  }
  return map;
}

function buildParentByChildMap(features) {
  const map = new Map();
  for (const feature of features) {
    if (!feature || !feature.parentId || feature.id == null) continue;
    map.set(String(feature.id), String(feature.parentId));
  }
  return map;
}

function normalizeRelationType(relation) {
  if (!relation || typeof relation !== 'object') return '';
  if (relation.type !== undefined) return String(relation.type);
  if (relation.relationType !== undefined) return String(relation.relationType);
  return '';
}

function normalizeRelationId(relation) {
  if (!relation || typeof relation !== 'object') return '';
  if (relation.id == null) return '';
  return String(relation.id);
}

export function computeExpandedFeatureSet(features, baseSelectedIds, options = {}) {
  const expandedIds = normalizeIdSet(baseSelectedIds);
  const selectedTeamValues = options.selectedTeamIds === undefined ? [] : options.selectedTeamIds;
  const selectedTeamIds = normalizeIdSet(selectedTeamValues);
  const featureById = buildFeatureByIdMap(features);
  const childrenByParent = buildChildrenByParentMap(features);
  const parentByChild = buildParentByChildMap(features);

  const counts = {
    parentChild: 0,
    relations: 0,
    teamAllocated: 0,
  };

  const baseIds = new Set(expandedIds);

  if (options.expandParentChild) {
    const stack = Array.from(baseIds);
    while (stack.length > 0) {
      const currentId = String(stack.pop());
      const children = childrenByParent.get(currentId);
      if (children instanceof Array) {
        for (const childId of children) {
          const childKey = String(childId);
          if (expandedIds.has(childKey)) continue;
          expandedIds.add(childKey);
          counts.parentChild += 1;
          stack.push(childKey);
        }
      }

      const parentId = parentByChild.get(currentId);
      if (!parentId || expandedIds.has(parentId)) continue;
      expandedIds.add(parentId);
      counts.parentChild += 1;
      stack.push(parentId);
    }
  }

  if (options.expandRelations) {
    const stack = Array.from(baseIds);
    while (stack.length > 0) {
      const currentId = String(stack.pop());
      const feature = featureById.get(currentId);
      if (!feature || !(feature.relations instanceof Array)) continue;

      for (const relation of feature.relations) {
        const relationType = normalizeRelationType(relation);
        if (relationType === 'Parent' || relationType === 'Child') continue;

        const relationId = normalizeRelationId(relation);
        if (!relationId || !featureById.has(relationId)) continue;
        if (baseIds.has(relationId) || expandedIds.has(relationId)) continue;

        expandedIds.add(relationId);
        counts.relations += 1;
        stack.push(relationId);
      }
    }
  }

  if (options.expandTeamAllocated && selectedTeamIds.size > 0) {
    for (const feature of features) {
      if (!feature || feature.id == null) continue;
      const featureId = String(feature.id);
      if (baseIds.has(featureId) || expandedIds.has(featureId)) continue;
      if (!hasFeatureTeamAllocation(feature, selectedTeamIds)) continue;
      expandedIds.add(featureId);
      counts.teamAllocated += 1;
    }
  }

  return {
    expandedIds,
    counts,
  };
}