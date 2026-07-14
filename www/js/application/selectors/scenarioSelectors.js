function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Select the active scenario from a scenario list.
 *
 * @param {Array<object>} scenarios
 * @param {string|null|undefined} activeId
 * @returns {object|null}
 */
export function selectActiveScenario(scenarios = [], activeId = null) {
  if (!activeId) return null;
  return asArray(scenarios).find((scenario) => scenario?.id === activeId) || null;
}

/**
 * Select the active writable scenario from a scenario list.
 *
 * @param {Array<object>} scenarios
 * @param {string|null|undefined} activeId
 * @returns {object|null}
 */
export function selectActiveWritableScenario(scenarios = [], activeId = null) {
  return (
    asArray(scenarios).find((scenario) => scenario?.id === activeId && !scenario?.readonly) ||
    null
  );
}

/**
 * Select writable scenarios that currently have unsaved changes.
 *
 * @param {Array<object>} scenarios
 * @param {(scenario: object) => boolean} isScenarioUnsaved
 * @returns {Array<object>}
 */
export function selectUnsavedWritableScenarios(scenarios = [], isScenarioUnsaved = () => false) {
  return asArray(scenarios).filter(
    (scenario) => !scenario?.readonly && Boolean(isScenarioUnsaved(scenario))
  );
}

/**
 * Select a normalized scenario save payload.
 *
 * @param {object|null|undefined} scenario
 * @returns {object|null}
 */
export function selectScenarioSavePayload(scenario) {
  if (!scenario || typeof scenario !== 'object') return null;

  const payload = {
    id: scenario.id,
    name: scenario.name,
    overrides: scenario.overrides,
    filters: scenario.filters,
    view: scenario.view,
  };

  if (asArray(scenario.scenarioGroups).length > 0) {
    payload.scenarioGroups = [...scenario.scenarioGroups];
  }

  if (scenario.groupOverrides && Object.keys(scenario.groupOverrides).length > 0) {
    payload.groupOverrides = { ...scenario.groupOverrides };
  }

  return payload;
}
