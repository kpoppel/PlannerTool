/**
 * Legacy Oracle Functions
 * Capture existing behavior from the current system
 * These functions document HOW the system currently works (not how it should work)
 */

/**
 * Capture how scenario creation currently works
 * @param {Object} state - Current state instance
 * @param {string} name - Scenario name
 * @returns {Object} Created scenario
 */
export function captureScenarioCreation(state, name) {
  const beforeSize = state.scenarios.size;
  const scenario = state.createScenario(name);
  const afterSize = state.scenarios.size;
  
  return {
    scenario,
    wasAdded: afterSize > beforeSize,
    hasId: !!scenario.id,
    hasName: scenario.name === name,
    isInMap: state.scenarios.has(scenario.id)
  };
}

/**
 * Capture how scenario activation currently works
 * @param {Object} state - Current state instance
 * @param {string} scenarioId - Scenario ID to activate
 * @returns {Object} Activation result
 */
export function captureScenarioActivation(state, scenarioId) {
  const beforeCurrent = state.currentScenario;
  state.activateScenario(scenarioId);
  const afterCurrent = state.currentScenario;
  
  return {
    beforeId: beforeCurrent?.id,
    afterId: afterCurrent?.id,
    changed: beforeCurrent !== afterCurrent,
    matchesRequested: afterCurrent?.id === scenarioId
  };
}

/**
 * Capture how event emission currently works
 * @param {Object} eventBus - EventBus instance
 * @param {string} eventName - Event to monitor
 * @returns {Object} Event monitor
 */
export function captureEventEmission(eventBus, eventName) {
  const emissions = [];
  
  const unsubscribe = eventBus.on(eventName, (payload) => {
    emissions.push({
      timestamp: Date.now(),
      payload: JSON.parse(JSON.stringify(payload))
    });
  });
  
  return {
    emissions,
    stop: unsubscribe,
    count: () => emissions.length,
    lastPayload: () => emissions[emissions.length - 1]?.payload
  };
}

/**
 * Capture how capacity calculation currently works
 * @param {Object} state - Current state instance
 * @returns {Object} Capacity calculation result
 */
export function captureCapacityCalculation(state) {
  // This will be implemented once we understand the capacity calculation logic
  return {
    totalCapacity: 0,
    allocated: 0,
    available: 0
  };
}

/**
 * Capture how project toggle currently works
 * @param {Object} state - Current state instance
 * @param {string} projectId - Project ID to toggle
 * @returns {Object} Toggle result
 */
export function captureProjectToggle(state, projectId) {
  const project = state.projects.get(projectId);
  if (!project) {
    return { found: false };
  }
  
  const beforeEnabled = project.enabled;
  // Simulate toggle (actual implementation may differ)
  project.enabled = !project.enabled;
  const afterEnabled = project.enabled;
  
  return {
    found: true,
    beforeEnabled,
    afterEnabled,
    toggled: beforeEnabled !== afterEnabled
  };
}
