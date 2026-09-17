/** @typedef {import('../types.js').StoreApi} StoreApi */

function toStringArray(values) {
  return Array.from(values).map((v) => String(v));
}

function getTimelineScaleFromStore(state) {
  return state.view.options.timelineScale;
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

/**
 * @param {StoreApi} store
 * @returns {object}
 */
export function createViewSelectors(store) {
  const selectors = {
    getTimelineScale() {
      return getTimelineScaleFromStore(store.getState());
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

    getContext() {
      const context = store.getState().view.context;
      return {
        parent: Boolean(context.parent),
        child: Boolean(context.child),
        dependency: Boolean(context.dependency),
        otherAllocations: Boolean(context.otherAllocations),
      };
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
