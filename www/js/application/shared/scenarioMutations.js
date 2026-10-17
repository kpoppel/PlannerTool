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
  return scenario !== null && scenario !== undefined
    && scenario.id !== 'baseline' && scenario.readonly !== true
    && (!Object.hasOwn(scenario, 'access') || scenario.access.canEdit === true);
}

export function getScenarioAccess(state, scenarioId) {
  const scenario = getScenarioItems(state).find((item) => item.id === scenarioId);
  if (scenario === undefined) return { canEdit: false, reason: 'missing' };
  if (scenario.id === 'baseline') return { canEdit: false, reason: 'baseline' };
  if (Object.hasOwn(scenario, 'access') && !scenario.access.canEdit) return scenario.access;
  if (!isMutableScenario(scenario)) return { canEdit: false, reason: 'read-only' };
  return { canEdit: true, reason: null };
}

export function withActiveScenario(state, updater) {
  const activeId = getActiveScenarioId(state);
  if (!getScenarioAccess(state, activeId).canEdit) return null;

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
