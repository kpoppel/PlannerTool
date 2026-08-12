function getScenarioItems(state) {
  return Array.isArray(state?.scenarios?.items) ? state.scenarios.items : [];
}

function getScenarioActiveId(state) {
  return state?.scenarios?.activeId ?? 'baseline';
}

export function createLegacyScenarioSelectors(state) {
  return {
    getScenarios() {
      return Array.isArray(state?.scenarios) ? state.scenarios : [];
    },

    getActiveScenarioId() {
      return state?.activeScenarioId ?? 'baseline';
    },

    getActiveScenario() {
      if (typeof state?.getActiveScenario === 'function') {
        return state.getActiveScenario();
      }
      return null;
    },

    isScenarioUnsaved(scenario) {
      if (typeof state?.isScenarioUnsaved === 'function') {
        return state.isScenarioUnsaved(scenario);
      }
      return Boolean(scenario.isChanged);
    },

    isActiveScenarioUnsaved() {
      const scenario = this.getActiveScenario();
      return this.isScenarioUnsaved(scenario);
    },
  };
}

export function createScenarioSelectors(store) {
  return {
    getScenarios() {
      return getScenarioItems(store.getState());
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
      return Boolean(scenario.isChanged);
    },

    isActiveScenarioUnsaved() {
      const scenario = this.getActiveScenario();
      return this.isScenarioUnsaved(scenario);
    },
  };
}
