import { computeExpandedFeatureSet } from '../shared/featureExpansion.js';

/** @typedef {import('../types.js').StoreApi} StoreApi */

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
  const expansion = getStoreExpansionState(state);

  const selectedFeatureIds = [];
  for (const feature of features) {
    const featureId = feature.id == null ? '' : String(feature.id);
    if (!featureId) continue;
    if (selectedProjectIds.has(String(feature.project))) {
      selectedFeatureIds.push(featureId);
    }
  }

  return computeExpandedFeatureSet(features, selectedFeatureIds, {
    expandParentChild: expansion.expandParentChild,
    expandRelations: expansion.expandRelations,
    expandTeamAllocated: expansion.expandTeamAllocated,
    selectedTeamIds: state.selection.teamIds,
  });
}

/**
 * @param {StoreApi} store
 * @returns {object}
 */
export function createViewSelectors(store) {
  /** @type {{expandedIds: Set<string>, counts: {parentChild: number, relations: number, teamAllocated: number}}|null} */
  let cachedExpandedFeatureSet = null;
  /** @type {{features: any[], projectIds: Array<string|number>, teamIds: Array<string|number>, expansion: any}|null} */
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

  const selectors = {
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
      return selectors.getExpandedFeatureSet().expandedIds;
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

  return selectors;
}
