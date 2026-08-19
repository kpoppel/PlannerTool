import { hasFeatureTeamAllocation } from '../shared/teamAllocation.js';

function toStringArray(values) {
  return Array.from(values).map((v) => String(v));
}

function getTimelineScaleFromStore(state) {
  return state.view.options.timelineScale;
}

function getShowDependenciesFromStore(state) {
  return Boolean(state.view.options.showDependencies);
}

function getCondensedCardsFromStore(state) {
  return Boolean(state.view.options.condensedCards);
}

function getCapacityViewModeFromStore(state) {
  return state.view.options.capacityViewMode;
}

function getHighlightFeatureRelationModeFromStore(state) {
  return Boolean(state.view.options.highlightFeatureRelationMode);
}

function getFeatureSortModeFromStore(state) {
  return state.view.options.featureSortMode;
}

function getPackedModeFromStore(state) {
  return Boolean(state.view.options.packedMode);
}

function getShowUnassignedCardsFromStore(state) {
  return Boolean(state.view.options.showUnassignedCards);
}

function getDisplayModeFromStore(state) {
  return state.view.options.displayMode;
}

function getStoreHiddenTypes(state) {
  return new Set(toStringArray(state.view.options.hiddenTypes));
}

function getStoreExpansionState(state) {
  return {
    expandParentChild: Boolean(state.view.expansion.parentChild),
    expandRelations: Boolean(state.view.expansion.relations),
    expandTeamAllocated: Boolean(state.view.expansion.teamAllocated),
  };
}

function getExpandedFeatureSetFromStore(state) {
  const features = state.baseline.features;
  const selectedProjectIds = new Set(toStringArray(state.selection.projectIds));
  const selectedTeamIds = new Set(toStringArray(state.selection.teamIds));
  const expansion = getStoreExpansionState(state);
  const featureById = new Map(
    features
      .filter((feature) => feature && feature.id != null)
      .map((feature) => [String(feature.id), feature])
  );

  const expanded = new Set();
  for (const feature of features) {
    const featureId = String(feature.id ?? '');
    if (!featureId) continue;
    if (selectedProjectIds.has(String(feature.project))) {
      expanded.add(featureId);
    }
  }

  const counts = {
    parentChild: 0,
    relations: 0,
    teamAllocated: 0,
  };

  const baseIds = new Set(expanded);

  if (expansion.expandParentChild) {
    const phaseAdded = new Set();
    const canExpandDown = new Set(baseIds);
    const toProcess = Array.from(baseIds);

    while (toProcess.length > 0) {
      const currentId = String(toProcess.pop());
      const feature = featureById.get(currentId);
      if (!feature) continue;

      if (feature.parentId && featureById.has(String(feature.parentId))) {
        const parentId = String(feature.parentId);
        if (!baseIds.has(parentId) && !phaseAdded.has(parentId) && !expanded.has(parentId)) {
          expanded.add(parentId);
          phaseAdded.add(parentId);
          toProcess.push(parentId);
        }
      }

      if (canExpandDown.has(currentId)) {
        for (const child of features) {
          if (String(child.parentId) === currentId && child.id != null) {
            const childId = String(child.id);
            if (!baseIds.has(childId) && !phaseAdded.has(childId) && !expanded.has(childId)) {
              expanded.add(childId);
              phaseAdded.add(childId);
              canExpandDown.add(childId);
              toProcess.push(childId);
            }
          }
        }
      }
    }

    counts.parentChild = phaseAdded.size;
  }

  if (expansion.expandRelations) {
    const phaseAdded = new Set();
    const toProcess = Array.from(baseIds);
    while (toProcess.length > 0) {
      const currentId = String(toProcess.pop());
      const feature = featureById.get(currentId);
      if (!feature || !Array.isArray(feature.relations)) continue;

      for (const relation of feature.relations) {
        const relationType = String(relation?.type ?? relation?.relationType ?? '');
        if (relationType === 'Parent' || relationType === 'Child') continue;

        const relationId = String(relation?.id ?? '');
        if (!relationId || !featureById.has(relationId)) continue;
        if (baseIds.has(relationId) || phaseAdded.has(relationId) || expanded.has(relationId)) continue;
        expanded.add(relationId);
        phaseAdded.add(relationId);
        toProcess.push(relationId);
      }
    }

    counts.relations = phaseAdded.size;
  }

  if (expansion.expandTeamAllocated && selectedTeamIds.size > 0) {
    const phaseAdded = new Set();
    for (const feature of features) {
      const featureId = String(feature.id ?? '');
      if (!featureId || baseIds.has(featureId) || phaseAdded.has(featureId) || expanded.has(featureId)) continue;
      if (hasFeatureTeamAllocation(feature, selectedTeamIds)) {
        expanded.add(featureId);
        phaseAdded.add(featureId);
      }
    }
    counts.teamAllocated = phaseAdded.size;
  }

  return {
    expandedIds: expanded,
    counts,
  };
}

export function createViewSelectors(store) {
  let cachedExpandedFeatureSet = null;
  let cachedState = null;

  const getExpandedFeatureSetMemoized = () => {
    const state = store.getState();
    const baselineFeatures = state.baseline.features;
    const projectIds = state.selection.projectIds;
    const teamIds = state.selection.teamIds;
    const expansion = state.view.expansion;

    if (
      cachedExpandedFeatureSet && cachedState &&
      cachedState.features === baselineFeatures &&
      cachedState.projectIds === projectIds &&
      cachedState.teamIds === teamIds &&
      cachedState.expansion === expansion
    ) {
      return cachedExpandedFeatureSet;
    }

    const { expandedIds, counts } = getExpandedFeatureSetFromStore(state);
    cachedExpandedFeatureSet = {
      expandedIds: new Set(Array.from(expandedIds).map((id) => String(id))),
      counts: {
        parentChild: Number(counts.parentChild) || 0,
        relations: Number(counts.relations) || 0,
        teamAllocated: Number(counts.teamAllocated) || 0,
      },
    };
    cachedState = {
      features: baselineFeatures,
      projectIds,
      teamIds,
      expansion,
    };
    return cachedExpandedFeatureSet;
  };

  return {
    getTimelineScale() {
      return getTimelineScaleFromStore(store.getState());
    },

    getShowDependencies() {
      return getShowDependenciesFromStore(store.getState());
    },

    getCondensedCards() {
      return getCondensedCardsFromStore(store.getState());
    },

    getCapacityViewMode() {
      return getCapacityViewModeFromStore(store.getState());
    },

    getHighlightFeatureRelationMode() {
      return getHighlightFeatureRelationModeFromStore(store.getState());
    },

    getFeatureSortMode() {
      return getFeatureSortModeFromStore(store.getState());
    },

    getPackedMode() {
      return getPackedModeFromStore(store.getState());
    },

    getShowUnassignedCards() {
      return getShowUnassignedCardsFromStore(store.getState());
    },

    getDisplayMode() {
      return getDisplayModeFromStore(store.getState());
    },

    isTypeVisible(type) {
      return !getStoreHiddenTypes(store.getState()).has(String(type));
    },

    getShowUnplannedWork() {
      return Boolean(store.getState().view.options.showUnplannedWork);
    },

    getShowOnlyProjectHierarchy() {
      return Boolean(store.getState().view.options.showOnlyProjectHierarchy);
    },

    getExpansionState() {
      return getStoreExpansionState(store.getState());
    },

    getExpandedFeatureSet() {
      return getExpandedFeatureSetMemoized();
    },

    getExpandedFeatureIds() {
      return this.getExpandedFeatureSet().expandedIds;
    },

    getHiddenTypes() {
      return getStoreHiddenTypes(store.getState());
    },

    getSavedViews() {
      return store.getState().view.saved;
    },

    getActiveViewId() {
      return store.getState().view.activeId;
    },
  };
}
