export function createLegacyFilterCommands(state) {
  return {
    setSelectedTaskTypes(types) {
      return state.setSelectedTaskTypes(types);
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

export function createFilterCommands(store, bus) {
  return {
    setSelectedTaskTypes(types, options = {}) {
      const taskTypeNames = Array.isArray(types) ? Array.from(types) : [];
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
      if (!options?.suppressEvents) {
        bus?.emit?.('filter:states-changed', { featureStateNames });
      }
    },

    setAllStatesSelected(selected, options = {}) {
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
      if (!options?.suppressEvents) {
        bus?.emit?.('filter:all-states-changed', { selected: Boolean(selected) });
      }
    },

    toggleStateSelected(stateName, options = {}) {
      const key = String(stateName);
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
      if (!options?.suppressEvents) {
        bus?.emit?.('filter:state-toggled', { stateName: key });
      }
    },

    setStateFilter(stateName, options = {}) {
      const key = String(stateName);
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
  };
}
