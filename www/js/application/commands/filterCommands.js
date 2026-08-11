export function createLegacyFilterCommands(state) {
  return {
    setSelectedTaskTypes(types, options) {
      return state.setSelectedTaskTypes(types, options);
    },

    setSelectedStates(states, options) {
      return state.setSelectedStates(states, options);
    },

    setAllStatesSelected(selected, options) {
      return state.setAllStatesSelected(selected, options);
    },

    toggleStateSelected(stateName, options) {
      return state.toggleStateSelected(stateName, options);
    },

    setStateFilter(stateName, options) {
      return state.setStateFilter(stateName, options);
    },

    setSidebarDisabledElements(map) {
      return state.setSidebarDisabledElements(map);
    },

    clearSidebarDisabledElements() {
      return state.clearSidebarDisabledElements();
    },

    setTaskFilter(dimension, option, selected) {
      return state.taskFilterService?.setFilter?.(dimension, option, Boolean(selected));
    },

    toggleTaskFilter(dimension, option) {
      return state.taskFilterService?.toggleFilter?.(dimension, option);
    },
  };
}

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

export function createFilterCommands(store, bus, legacyState, recomputeCapacity = null) {
  return {
    setSelectedTaskTypes(types, options = {}) {
      const taskTypeNames = Array.isArray(types) ? Array.from(types) : [];
      legacyState?.setSelectedTaskTypes?.(taskTypeNames, options);
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
        bus?.emit?.('filter:task-types-changed', { taskTypeNames });
      }
    },

    setSelectedStates(states, options = {}) {
      const featureStateNames = Array.isArray(states) ? Array.from(states) : [];
      legacyState?.setSelectedStates?.(featureStateNames, options);
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
      if (recomputeCapacity) recomputeCapacity();
      if (!options?.suppressEvents) {
        bus?.emit?.('filter:states-changed', { featureStateNames });
      }
    },

    setAllStatesSelected(selected, options = {}) {
      legacyState?.setAllStatesSelected?.(Boolean(selected), options);
      if (!selected) {
        store.setState(
          (state) => ({
            ...state,
            selection: {
              ...state.selection,
              featureStateNames: [],
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
        store.setState(
          (state) => ({
            ...state,
            selection: {
              ...state.selection,
              featureStateNames: Array.from(fallback),
            },
          }),
          false,
          'filter.setAllStatesSelected'
        );
      }
      if (recomputeCapacity) recomputeCapacity();
      if (!options?.suppressEvents) {
        bus?.emit?.('filter:all-states-changed', { selected: Boolean(selected) });
      }
    },

    toggleStateSelected(stateName, options = {}) {
      const key = String(stateName);
      legacyState?.toggleStateSelected?.(key, options);
      store.setState(
        (state) => {
          const current = new Set(state.selection?.featureStateNames || []);
          if (current.has(key)) current.delete(key);
          else current.add(key);
          return {
            ...state,
            selection: {
              ...state.selection,
              featureStateNames: Array.from(current),
            },
          };
        },
        false,
        'filter.toggleStateSelected'
      );
      if (recomputeCapacity) recomputeCapacity();
      if (!options?.suppressEvents) {
        bus?.emit?.('filter:state-toggled', { stateName: key });
      }
    },

    setStateFilter(stateName, options = {}) {
      const key = String(stateName);
      legacyState?.setStateFilter?.(key, options);
      store.setState(
        (state) => ({
          ...state,
          selection: {
            ...state.selection,
            featureStateNames: key ? [key] : [],
          },
        }),
        false,
        'filter.setStateFilter'
      );
      if (!options?.suppressEvents) {
        bus?.emit?.('filter:state-filter-set', { stateName: key });
      }
    },

    setSidebarDisabledElements(map, options = {}) {
      legacyState?.setSidebarDisabledElements?.(map || {});
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
      if (!options?.suppressEvents) {
        bus?.emit?.('filter:sidebar-disabled-set', { map: map || {} });
      }
    },

    clearSidebarDisabledElements(options = {}) {
      legacyState?.clearSidebarDisabledElements?.();
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
      if (!options?.suppressEvents) {
        bus?.emit?.('filter:sidebar-disabled-cleared', {});
      }
    },

    setTaskFilter(dimension, option, selected, options = {}) {
      const nextSelected = Boolean(selected);
      legacyState?.taskFilterService?.setFilter?.(dimension, option, nextSelected);
      store.setState(
        (state) => {
          const currentFilters = state.selection?.taskFilters || {};
          const currentDimension = currentFilters?.[dimension] || {};
          return {
            ...state,
            selection: {
              ...state.selection,
              taskFilters: {
                ...currentFilters,
                [dimension]: {
                  ...currentDimension,
                  [option]: nextSelected,
                },
              },
            },
          };
        },
        false,
        'filter.setTaskFilter'
      );
      if (!options?.suppressEvents) {
        bus?.emit?.('filter:task-filter-changed', { dimension, option, selected: nextSelected });
      }
    },

    toggleTaskFilter(dimension, option, options = {}) {
      const current = legacyState?.taskFilterService?.getFilters?.()?.[dimension]?.[option];
      const nextSelected = !Boolean(current);
      this.setTaskFilter(dimension, option, nextSelected, options);
    },
  };
}
