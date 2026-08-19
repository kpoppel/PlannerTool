export function getScenarioItems(state) {
  return state.scenarios.items;
}

export function getActiveScenarioId(state) {
  return state.scenarios.activeId;
}

export function getActiveScenario(state) {
  const activeId = getActiveScenarioId(state);
  const activeScenario = getScenarioItems(state).find((scenario) => scenario.id === activeId);
  if (activeScenario === undefined) return null;
  return activeScenario;
}

export function isMutableScenario(scenario) {
  return scenario.readonly !== true;
}

export function withActiveScenario(state, updater, options = { allowBaseline: true }) {
  const activeId = getActiveScenarioId(state);
  const allowBaseline = options.allowBaseline;
  if (!allowBaseline && activeId === 'baseline') return null;

  let changed = false;
  const nextItems = getScenarioItems(state).map((scenario) => {
    if (scenario.id !== activeId) return scenario;
    if (!isMutableScenario(scenario)) return scenario;
    const nextScenario = updater(scenario);
    if (nextScenario === scenario) return scenario;
    changed = true;
    return nextScenario;
  });

  if (!changed) return null;
  return {
    activeId,
    items: nextItems,
  };
}
