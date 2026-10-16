import { FeatureEvents, FilterEvents, StateFilterEvents } from '../../core/EventRegistry.js';
import { DEFAULT_TASK_FILTERS, normalizeTaskFilters } from '../shared/taskFilters.js';
import { deriveAvailableFeatureStates, deriveAvailableTaskTypes } from '../shared/stateDerivations.js';
import { createFilterSelectors } from '../selectors/filterSelectors.js';

/** @typedef {import('../types.js').StoreApi} StoreApi */
/** @typedef {import('../types.js').EventBusLike} EventBusLike */

/**
 * @param {StoreApi} store
 * @param {EventBusLike} bus
 * @returns {object}
 */
export function createFilterCommands(store, bus) {
  const selectors = createFilterSelectors(store);

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
          view: {
            ...state.view,
            options: {
              ...state.view.options,
              hiddenTypes: deriveAvailableTaskTypes(state.baseline.features)
                .filter((type) => !taskTypeNames.includes(type)),
            },
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

    setTaskTypeSelected(type, selected, options = {}) {
      const key = String(type);
      store.setState((state) => {
        const hidden = new Set(state.view.options.hiddenTypes);
        if (selected) hidden.delete(key);
        else hidden.add(key);
        const available = new Set([
          ...deriveAvailableTaskTypes(state.baseline.features), ...state.selection.taskTypeNames, key,
        ]);
        return {
          ...state,
          selection: { ...state.selection,
            taskTypeNames: [...available].filter((name) => !hidden.has(name)),
          },
          view: { ...state.view, options: { ...state.view.options, hiddenTypes: [...hidden] } },
        };
      }, false, 'filter.setTaskTypeSelected');
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
      if (dimension === 'schedule' && option === 'unplanned' && nextSelected &&
        store.getState().view.options.displayMode === 'packed') {
        throw new Error('Unplanned tasks cannot be enabled in packed mode');
      }
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

    cycleTaskFilter(dimension, options = {}) {
      const keys = Object.keys(DEFAULT_TASK_FILTERS[dimension]);
      const current = selectors.getTaskFilters()[dimension];
      const states = [[true, true], [true, false], [false, true]];
      const currentIndex = states.findIndex((values) =>
        keys.every((key, index) => current[key] === values[index]));
      for (let step = 1; step <= states.length; step += 1) {
        const values = states[(currentIndex + step) % states.length];
        if (keys.every((key, index) => current[key] === values[index])) continue;
        if (keys.some((key, index) => current[key] !== values[index] &&
          selectors.isSidebarControlDisabled('taskFilter', dimension, key))) continue;
        const next = Object.fromEntries(keys.map((key, index) => [key, values[index]]));
        store.setState((state) => ({ ...state, selection: { ...state.selection,
          taskFilters: { ...state.selection.taskFilters, [dimension]: next },
        } }), false, 'filter.cycleTaskFilter');
        if (!options.suppressEvents) {
          bus.emit(FilterEvents.CHANGED);
          bus.emit(FeatureEvents.UPDATED);
        }
        return;
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
