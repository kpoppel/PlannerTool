import {
  FeatureEvents,
  FilterEvents,
  TimelineEvents,
  ViewEvents,
} from '../../core/EventRegistry.js';

function mergedExpansion(current, incoming = {}) {
  return {
    parentChild:
      incoming.expandParentChild !== undefined ?
        Boolean(incoming.expandParentChild)
      : Boolean(current?.parentChild),
    relations:
      incoming.expandRelations !== undefined ?
        Boolean(incoming.expandRelations)
      : Boolean(current?.relations),
    teamAllocated:
      incoming.expandTeamAllocated !== undefined ?
        Boolean(incoming.expandTeamAllocated)
      : Boolean(current?.teamAllocated),
  };
}

function toUniqueStringArray(values) {
  if (!Array.isArray(values)) return [];
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const key = String(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function createViewCommands(store, bus) {
  function setViewOptions(updater, actionName) {
    store.setState(
      (state) => ({
        ...state,
        view: {
          ...state.view,
          options: updater(state.view?.options || {}),
        },
      }),
      false,
      actionName
    );
  }

  return {
    setExpansionState(options, runtimeOptions = {}) {
      store.setState(
        (state) => ({
          ...state,
          view: {
            ...state.view,
            expansion: mergedExpansion(state.view?.expansion, options),
          },
        }),
        false,
        'view.setExpansionState'
      );
      if (!runtimeOptions?.suppressEvents) {
        bus.emit(FilterEvents.CHANGED);
        bus.emit(FeatureEvents.UPDATED);
      }
    },

    setTimelineScale(scale, runtimeOptions = {}) {
      setViewOptions(
        (options) => ({
          ...options,
          timelineScale: scale,
        }),
        'view.setTimelineScale'
      );
      if (!runtimeOptions?.suppressEvents) {
        bus.emit(TimelineEvents.SCALE_CHANGED);
      }
    },

    setCondensedCards(condensed, runtimeOptions = {}) {
      const nextMode = condensed ? 'compact' : 'normal';
      setViewOptions(
        (options) => ({
          ...options,
          condensedCards: Boolean(condensed),
          displayMode: nextMode,
          packedMode: false,
        }),
        'view.setCondensedCards'
      );
      if (!runtimeOptions?.suppressEvents) {
        bus.emit(ViewEvents.CONDENSED);
        bus.emit(ViewEvents.DISPLAY_MODE);
        bus.emit(FeatureEvents.UPDATED);
      }
    },

    setFeatureSortMode(mode, runtimeOptions = {}) {
      setViewOptions(
        (options) => ({
          ...options,
          featureSortMode: mode,
        }),
        'view.setFeatureSortMode'
      );
      if (!runtimeOptions?.suppressEvents) {
        bus.emit(ViewEvents.SORT_MODE);
        bus.emit(FeatureEvents.UPDATED);
      }
    },

    setCapacityViewMode(mode, runtimeOptions = {}) {
      setViewOptions(
        (options) => ({
          ...options,
          capacityViewMode: mode,
        }),
        'view.setCapacityViewMode'
      );
      if (!runtimeOptions?.suppressEvents) {
        bus.emit(ViewEvents.CAPACITY_MODE);
        bus.emit(FeatureEvents.UPDATED);
      }
    },

    setDisplayMode(mode, runtimeOptions = {}) {
      const packedMode = mode === 'packed';
      const condensedCards = mode !== 'normal';
      setViewOptions(
        (options) => ({
          ...options,
          displayMode: mode,
          packedMode,
          condensedCards,
        }),
        'view.setDisplayMode'
      );
      if (!runtimeOptions?.suppressEvents) {
        bus.emit(ViewEvents.CONDENSED);
        bus.emit(ViewEvents.DISPLAY_MODE);
        bus.emit(FeatureEvents.UPDATED);
      }
    },

    setShowDependencies(showDependencies, runtimeOptions = {}) {
      const value = Boolean(showDependencies);
      setViewOptions(
        (options) => ({
          ...options,
          showDependencies: value,
        }),
        'view.setShowDependencies'
      );
      if (!runtimeOptions?.suppressEvents) {
        bus.emit(ViewEvents.DEPENDENCIES);
        bus.emit(FeatureEvents.UPDATED);
      }
    },

    setTypeVisibility(typeName, visible, runtimeOptions = {}) {
      const key = String(typeName);
      const shouldShow = Boolean(visible);
      let nextHiddenTypes = [];
      setViewOptions(
        (options) => {
          const currentHidden = toUniqueStringArray(options.hiddenTypes || []);
          const hiddenSet = new Set(currentHidden);
          if (shouldShow) hiddenSet.delete(key);
          else hiddenSet.add(key);
          nextHiddenTypes = Array.from(hiddenSet);
          return {
            ...options,
            hiddenTypes: nextHiddenTypes,
          };
        },
        'view.setTypeVisibility'
      );
      if (!runtimeOptions?.suppressEvents) {
        bus.emit(FilterEvents.CHANGED);
        bus.emit(FeatureEvents.UPDATED);
      }
    },

    setHighlightFeatureRelationMode(enabled, runtimeOptions = {}) {
      const value = Boolean(enabled);
      setViewOptions(
        (options) => ({ ...options, highlightFeatureRelationMode: value }),
        'view.setHighlightFeatureRelationMode'
      );
      if (!runtimeOptions?.suppressEvents) {
        bus.emit(ViewEvents.HIGHLIGHT_RELATIONS);
      }
    },
  };
}
