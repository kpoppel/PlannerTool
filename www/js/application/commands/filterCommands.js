import { FeatureEvents, FilterEvents, StateFilterEvents } from '../../core/EventRegistry.js';

const DEFAULT_TASK_FILTERS = {
  schedule: { planned: true, unplanned: true },
  allocation: { allocated: true, unallocated: true },
  hierarchy: { hasParent: true, noParent: true },
  relations: { hasLinks: true, noLinks: true },
};

function deriveAvailableStatesFromFeatures(features) {
  const out = [];
  const seen = new Set();
  for (const feature of Array.isArray(features) ? features : []) {
    const stateName = feature?.state;
    if (!stateName) continue;
    const key = String(stateName);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function createFilterCommands(store, bus, recomputeCapacity = null) {
  const recompute = recomputeCapacity;

  return {
    setSelectedTaskTypes(types, options = {}) {
      const taskTypeNames = types;
      store.setState(
        (state) => ({
          ...state,
          selection: {
            ...state.selection,
            taskTypeNames,
          },
        }),
        false,
        'filter.setSelectedTaskTypes'
      );
      if (!options?.suppressEvents) {
        bus?.emit?.(FilterEvents.CHANGED);
        bus?.emit?.(FeatureEvents.UPDATED);
      }
    },

    setSelectedStates(states, options = {}) {
      const featureStateNames = states;
      store.setState(
        (state) => ({
          ...state,
          selection: {
            ...state.selection,
            featureStateNames,
          },
        }),
        false,
        'filter.setSelectedStates'
      );

      recompute();
      if (!options.suppressEvents) {
        bus.emit(FilterEvents.CHANGED);
        bus.emit(FeatureEvents.UPDATED);
      }
    },

    setAllStatesSelected(selected, options = {}) {
      let nextSelection = [];
      if (!selected) {
        nextSelection = [];
        store.setState(
          (state) => ({
            ...state,
            selection: {
              ...state.selection,
              featureStateNames: nextSelection,
            },
          }),
          false,
          'filter.setAllStatesSelected'
        );
      } else {
        const currentState = store.getState();
        const available = currentState?.filter?.availableFeatureStates;
        const fallback =
          Array.isArray(available) && available.length > 0 ?
            available
          : deriveAvailableStatesFromFeatures(currentState?.baseline?.features);
        nextSelection = Array.from(fallback);
        store.setState(
          (state) => ({
            ...state,
            selection: {
              ...state.selection,
              featureStateNames: nextSelection,
            },
          }),
          false,
          'filter.setAllStatesSelected'
        );
      }

      recompute();
      if (!options.suppressEvents) {
        bus.emit(FilterEvents.CHANGED);
        bus.emit(StateFilterEvents.CHANGED);
        bus.emit(FeatureEvents.UPDATED);
      }
    },

    toggleStateSelected(stateName, options = {}) {
      const key = String(stateName);
      let nextSelection = [];
      store.setState(
        (state) => {
          const current = new Set(state.selection?.featureStateNames || []);
          if (current.has(key)) current.delete(key);
          else current.add(key);
          nextSelection = Array.from(current);
          return {
            ...state,
            selection: {
              ...state.selection,
              featureStateNames: nextSelection,
            },
          };
        },
        false,
        'filter.toggleStateSelected'
      );

      recompute();
      if (!options.suppressEvents) {
        bus.emit(FilterEvents.CHANGED);
        bus.emit(FeatureEvents.UPDATED);
      }
    },

    setStateFilter(stateName, options = {}) {
      const key = String(stateName);
      const nextSelection = key ? [key] : [];
      store.setState(
        (state) => ({
          ...state,
          selection: {
            ...state.selection,
            featureStateNames: nextSelection,
          },
        }),
        false,
        'filter.setStateFilter'
      );
      if (!options.suppressEvents) {
        bus.emit(FilterEvents.CHANGED);
        bus.emit(FeatureEvents.UPDATED);
      }
    },

    setSidebarDisabledElements(map, options = {}) {
      store.setState(
        (state) => ({
          ...state,
          selection: {
            ...state.selection,
            sidebarDisabled: map || {},
          },
        }),
        false,
        'filter.setSidebarDisabledElements'
      );
      if (!options.suppressEvents) {
        bus.emit('filter:sidebar-disabled-set', { map: map || {} });
      }
    },

    clearSidebarDisabledElements(options = {}) {
      store.setState(
        (state) => ({
          ...state,
          selection: {
            ...state.selection,
            sidebarDisabled: {},
          },
        }),
        false,
        'filter.clearSidebarDisabledElements'
      );
      if (!options.suppressEvents) {
        bus.emit('filter:sidebar-disabled-cleared', {});
      }
    },

    setTaskFilter(dimension, option, selected, options = {}) {
      const nextSelected = Boolean(selected);
      let nextTaskFilters = {};
      store.setState(
        (state) => {
          const currentFilters = {
            ...DEFAULT_TASK_FILTERS,
            ...(state.selection?.taskFilters || {}),
          };
          const currentDimension = {
            ...DEFAULT_TASK_FILTERS[dimension],
            ...(currentFilters?.[dimension] || {}),
          };
          nextTaskFilters = {
            ...currentFilters,
            [dimension]: {
              ...currentDimension,
              [option]: nextSelected,
            },
          };
          return {
            ...state,
            selection: {
              ...state.selection,
              taskFilters: nextTaskFilters,
            },
          };
        },
        false,
        'filter.setTaskFilter'
      );
      if (!options.suppressEvents) {
        bus.emit(FilterEvents.CHANGED);
        bus.emit(FeatureEvents.UPDATED);
      }
    },

    toggleTaskFilter(dimension, option, options = {}) {
      const current = store.getState()?.selection?.taskFilters?.[dimension]?.[option];
      const nextSelected = !current;
      this.setTaskFilter(dimension, option, nextSelected, options);
    },
  };
}
