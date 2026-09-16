import { FeatureEvents, FilterEvents, StateFilterEvents } from '../../core/EventRegistry.js';
import { normalizeTaskFilters } from '../shared/taskFilters.js';
import { deriveAvailableFeatureStates } from '../shared/stateDerivations.js';

/** @typedef {import('../types.js').StoreApi} StoreApi */
/** @typedef {import('../types.js').EventBusLike} EventBusLike */

/**
 * @param {StoreApi} store
 * @param {EventBusLike} bus
 * @returns {object}
 */
export function createFilterCommands(store, bus) {

  const commands = {
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
      if (!options.suppressEvents) {
        bus.emit(FilterEvents.CHANGED);
        bus.emit(FeatureEvents.UPDATED);
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
        nextSelection = deriveAvailableFeatureStates(currentState.baseline.features);
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
          const current = new Set(state.selection.featureStateNames);
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
            sidebarDisabled: map,
          },
        }),
        false,
        'filter.setSidebarDisabledElements'
      );
      if (!options.suppressEvents) {
        bus.emit('filter:sidebar-disabled-set', { map });
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
          const currentFilters = normalizeTaskFilters(state.selection.taskFilters);
          const currentDimension = {
            ...currentFilters[dimension],
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
      const current = store.getState().selection.taskFilters[dimension][option];
      const nextSelected = !current;
      commands.setTaskFilter(dimension, option, nextSelected, options);
    },
  };

  return commands;
}
