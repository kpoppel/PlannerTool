function getScenarioItems(state) {
  return state.scenarios.items;
}

function getScenarioActiveId(state) {
  return state.scenarios.activeId;
}

function getChangedScenarioIds(state) {
  return state.scenarios.changedIds.map(String);
}

export function createScenarioSelectors(store) {
  return {
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
      const scenarios = this.getScenarios();
      const activeId = this.getActiveScenarioId();
      return scenarios.find((scenario) => scenario.id === activeId) || null;
    },

    isScenarioUnsaved(scenario) {
      const changedIds = this.getChangedScenarioIds();
      return changedIds.includes(String(scenario.id));
    },

    isActiveScenarioUnsaved() {
      const scenario = this.getActiveScenario();
      return this.isScenarioUnsaved(scenario);
    },
  };
}
