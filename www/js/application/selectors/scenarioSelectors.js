import { isMutableScenario } from '../shared/scenarioMutations.js';

function getScenarioItems(state) {
  return state.scenarios.items;
}

/** @typedef {import('../types.js').StoreApi} StoreApi */

function getScenarioActiveId(state) {
  return state.scenarios.activeId;
}

function getChangedScenarioIds(state) {
  return state.scenarios.changedIds.map(String);
}

/**
 * @param {StoreApi} store
 * @returns {object}
 */
export function createScenarioSelectors(store) {
  const selectors = {
    getScenarios() {
      return getScenarioItems(store.getState());
    },

    getChangedScenarioIds() {
      return getChangedScenarioIds(store.getState());
    },

    getActiveScenarioId() {
      return getScenarioActiveId(store.getState());
    },

    getActiveScenario() {
      const scenarios = selectors.getScenarios();
      const activeId = selectors.getActiveScenarioId();
      return scenarios.find((scenario) => scenario.id === activeId) || null;
    },

    isScenarioUnsaved(scenario) {
      const changedIds = selectors.getChangedScenarioIds();
      return changedIds.includes(String(scenario.id));
    },

    isActiveScenarioUnsaved() {
      const scenario = selectors.getActiveScenario();
      return selectors.isScenarioUnsaved(scenario);
    },

    /** False for the baseline and any read-only scenario — group edits are blocked there. */
    isActiveScenarioMutable() {
      const state = store.getState();
      if (getScenarioActiveId(state) === 'baseline') return false;
      const scenario = selectors.getActiveScenario();
      if (scenario === null) return false;
      return isMutableScenario(scenario);
    },
  };

  return selectors;
}
