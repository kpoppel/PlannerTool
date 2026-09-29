/** @typedef {import('../types.js').StoreApi} StoreApi */
import { createScopeSelectors } from './scopeSelectors.js';

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
  const scopeSelectors = createScopeSelectors(store);
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

    getFocusedPlanId() {
      return store.getState().view.options.focusedPlanId;
    },

    getAvailableGraphTypes() {
      const state = store.getState();
      const scopedPlanIds = new Set(scopeSelectors.getContextFeatures()
        .map((feature) => String(feature.project)));
      const types = new Map();
      for (const project of state.baseline.projects) {
        if (scopedPlanIds.has(String(project.id))) types.set(project.type, project.container_order);
      }
      return [...types.entries()].sort((first, second) => first[1] - second[1])
        .map(([type]) => type);
    },

    getEffectiveCapacityViewMode() {
      const state = store.getState();
      const available = selectors.getAvailableGraphTypes();
      if (available.length === 0) return null;
      const preferred = state.view.options.capacityViewMode;
      if (available.includes(preferred)) return preferred;
      const preferredPlan = state.baseline.projects.find((project) => project.type === preferred);
      if (!preferredPlan) return available[0];
      const byType = new Map(state.baseline.projects.map((project) =>
        [project.type, project.container_order]));
      return [...available].sort((first, second) =>
        Math.abs(byType.get(first) - preferredPlan.container_order) -
        Math.abs(byType.get(second) - preferredPlan.container_order) ||
        byType.get(second) - byType.get(first))[0];
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

    getTaskViewMode() {
      return store.getState().view.options.taskViewMode;
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
