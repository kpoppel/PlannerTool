function getLegacyViewService(state) {
  return state?._viewService || null;
}

function toStringArray(values) {
  return Array.from(values || []).map((v) => String(v));
}

function hasTeamAllocation(feature, selectedTeamIds) {
  const capacities = Array.isArray(feature?.capacity) ? feature.capacity : [];
  for (const entry of capacities) {
    const teamId = entry?.team ?? entry?.teamId ?? entry?.id;
    if (teamId && selectedTeamIds.has(String(teamId))) {
      return true;
    }
  }
  return false;
}

function getTimelineScaleFromStore(state) {
  return state?.view?.options?.timelineScale || 'months';
}

function getShowDependenciesFromStore(state) {
  return Boolean(state?.view?.options?.showDependencies);
}

function getCondensedCardsFromStore(state) {
  return Boolean(state?.view?.options?.condensedCards);
}

function getCapacityViewModeFromStore(state) {
  return state?.view?.options?.capacityViewMode || 'team';
}

function getHighlightFeatureRelationModeFromStore(state) {
  return Boolean(state?.view?.options?.highlightFeatureRelationMode);
}

function getFeatureSortModeFromStore(state) {
  return state?.view?.options?.featureSortMode || 'rank';
}

function getPackedModeFromStore(state) {
  return Boolean(state?.view?.options?.packedMode);
}

function getShowUnassignedCardsFromStore(state) {
  return Boolean(state?.view?.options?.showUnassignedCards);
}

function getDisplayModeFromStore(state) {
  return state?.view?.options?.displayMode || 'normal';
}

function getStoreHiddenTypes(state) {
  const hidden = state?.view?.options?.hiddenTypes;
  if (hidden instanceof Set) return new Set(toStringArray(hidden));
  if (Array.isArray(hidden)) return new Set(toStringArray(hidden));
  return new Set();
}

function getStoreExpansionState(state) {
  return {
    expandParentChild: Boolean(state?.view?.expansion?.parentChild),
    expandRelations: Boolean(state?.view?.expansion?.relations),
    expandTeamAllocated: Boolean(state?.view?.expansion?.teamAllocated),
  };
}

function getExpandedFeatureIdsFromStore(state) {
  const features = Array.isArray(state?.baseline?.features) ? state.baseline.features : [];
  const selectedProjectIds = new Set(toStringArray(state?.selection?.projectIds));
  const selectedTeamIds = new Set(toStringArray(state?.selection?.teamIds));
  const expansion = getStoreExpansionState(state);

  const expanded = new Set();
  for (const feature of features) {
    if (!feature?.id) continue;
    if (selectedProjectIds.has(String(feature.project))) {
      expanded.add(feature.id);
      continue;
    }
    if (expansion.expandTeamAllocated && selectedTeamIds.size && hasTeamAllocation(feature, selectedTeamIds)) {
      expanded.add(feature.id);
    }
  }

  return expanded;
}

export function createLegacyViewSelectors(state) {
  return {
    getTimelineScale() {
      const viewService = getLegacyViewService(state);
      return viewService?.timelineScale || state?.timelineScale || 'months';
    },

    getShowDependencies() {
      const viewService = getLegacyViewService(state);
      return Boolean(viewService?.showDependencies ?? state?.showDependencies);
    },

    getCondensedCards() {
      const viewService = getLegacyViewService(state);
      return Boolean(viewService?.condensedCards);
    },

    getCapacityViewMode() {
      const viewService = getLegacyViewService(state);
      return viewService?.capacityViewMode || state?.capacityViewMode || 'team';
    },

    getHighlightFeatureRelationMode() {
      const viewService = getLegacyViewService(state);
      return Boolean(
        viewService?.highlightFeatureRelationMode ?? state?.highlightFeatureRelationMode
      );
    },

    getFeatureSortMode() {
      const viewService = getLegacyViewService(state);
      return viewService?.featureSortMode || state?.featureSortMode || 'rank';
    },

    getPackedMode() {
      const viewService = getLegacyViewService(state);
      return Boolean(viewService?.packedMode);
    },

    getShowUnassignedCards() {
      const viewService = getLegacyViewService(state);
      return Boolean(viewService?.showUnassignedCards);
    },

    getDisplayMode() {
      const viewService = getLegacyViewService(state);
      return viewService?.displayMode || state?.displayMode || 'normal';
    },

    isTypeVisible(type) {
      const viewService = getLegacyViewService(state);
      if (viewService && typeof viewService.isTypeVisible === 'function') {
        return viewService.isTypeVisible(type);
      }
      return true;
    },

    getShowUnplannedWork() {
      const viewService = getLegacyViewService(state);
      return Boolean(viewService?.showUnplannedWork);
    },

    getShowOnlyProjectHierarchy() {
      const viewService = getLegacyViewService(state);
      return Boolean(viewService?.showOnlyProjectHierarchy);
    },

    getExpansionState() {
      return state?.expansionState || {
        expandParentChild: false,
        expandRelations: false,
        expandTeamAllocated: false,
      };
    },

    getExpandedFeatureIds() {
      if (typeof state?.getExpandedFeatureIds === 'function') {
        return state.getExpandedFeatureIds();
      }
      return new Set();
    },

    getHiddenTypes() {
      const viewService = getLegacyViewService(state);
      if (viewService?.hiddenTypes instanceof Set) {
        return new Set(Array.from(viewService.hiddenTypes).map((v) => String(v)));
      }
      return new Set();
    },
  };
}

export function createViewSelectors(store) {
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
      return Boolean(store.getState()?.view?.options?.showUnplannedWork);
    },

    getShowOnlyProjectHierarchy() {
      return Boolean(store.getState()?.view?.options?.showOnlyProjectHierarchy);
    },

    getExpansionState() {
      return getStoreExpansionState(store.getState());
    },

    getExpandedFeatureIds() {
      return getExpandedFeatureIdsFromStore(store.getState());
    },

    getHiddenTypes() {
      return getStoreHiddenTypes(store.getState());
    },
  };
}
