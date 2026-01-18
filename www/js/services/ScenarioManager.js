/**
 * ScenarioManager - Manages scenario CRUD and activation
 * Extracted from state.js to improve testability and modularity
 */

import { ScenarioEvents } from '../core/EventRegistry.js';

export class ScenarioManager {
  constructor(eventBus, baselineStore, stateContext) {
    if (!eventBus) throw new Error('EventBus required');
    if (!baselineStore) throw new Error('BaselineStore required');
    if (!stateContext) throw new Error('StateContext required');
    
    this.eventBus = eventBus;
    this.baselineStore = baselineStore;
    this.stateContext = stateContext;
    this.scenarios = [];
    this.activeScenarioId = 'baseline';
  }
  
  /**
   * Clone an existing scenario or create from a readonly scenario (like baseline)
   * @param {string} sourceId - Source scenario ID
   * @param {string} name - Scenario name (optional, generates default if omitted)
   * @returns {Object} Created scenario
   */
  cloneScenario(sourceId, name) {
    const source = this.scenarios.find(s => s.id === sourceId);
    
    // If source not found in our managed array, assume cloning from readonly scenario (use defaults)
    const isFromReadonly = !source;
    
    const baseName = name ? name.trim() : this.generateScenarioDefaultName();
    const uniqueName = this.ensureUniqueScenarioName(baseName);
    
    const id = 'scen_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    
    // Deep-clone mutable parts to avoid shared nested references
    const cloneDeep = (obj) => obj ? JSON.parse(JSON.stringify(obj)) : {};

    const scenario = {
      id,
      name: uniqueName,
      overrides: isFromReadonly ? {} : cloneDeep(source.overrides),
      filters: isFromReadonly 
        ? cloneDeep(this.stateContext.captureCurrentFilters())
        : cloneDeep(source.filters),
      view: isFromReadonly
        ? cloneDeep(this.stateContext.captureCurrentView())
        : cloneDeep(source.view),
      isChanged: true
    };
    
    this.scenarios.push(scenario);
    this.eventBus.emit(ScenarioEvents.UPDATED, { scenarioId: id, change: { type: 'clone', from: sourceId } });
    
    return scenario;
  }
  
  /**
   * Generate default scenario name with date and counter
   * @returns {string}
   */
  generateScenarioDefaultName() {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    let maxN = 0;
    const re = /^\d{2}-\d{2} Scenario (\d+)$/i;
    
    for (const s of this.scenarios) {
      const m = re.exec(s.name);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxN) maxN = n;
      }
    }
    
    const next = maxN + 1;
    return `${mm}-${dd} Scenario ${next}`;
  }
  
  /**
   * Ensure scenario name is unique by appending counter
   * @param {string} base - Base name
   * @returns {string} Unique name
   */
  ensureUniqueScenarioName(base) {
    let candidate = base;
    let counter = 2;
    
    while (this.scenarios.some(s => s.name.toLowerCase() === candidate.toLowerCase())) {
      candidate = base + ' ' + counter;
      counter++;
    }
    
    return candidate;
  }
  
  /**
   * Activate a scenario
   * @param {string} id - Scenario ID to activate
   * @returns {Object|null} Activated scenario or null if readonly scenario
   */
  activateScenario(id) {
    // Early exit if already active
    if (this.activeScenarioId === id) return null;
    
    // Allow activating readonly scenarios (they're not in our managed array)
    const scenario = this.scenarios.find(s => s.id === id);
    if (!scenario) {
      // Scenario not found in managed array - might be readonly scenario
      this.activeScenarioId = id;
      this.eventBus.emit(ScenarioEvents.ACTIVATED, { scenarioId: id });
      return null;
    }
    
    this.activeScenarioId = id;
    this.eventBus.emit(ScenarioEvents.ACTIVATED, { scenarioId: id });
    
    return scenario;
  }
  
  /**
   * Delete a scenario
   * @param {string} id - Scenario ID to delete
   */
  deleteScenario(id) {
    const index = this.scenarios.findIndex(s => s.id === id);
    if (index === -1) return; // Silent fail
    
    const wasActive = this.scenarios[index].id === this.activeScenarioId;
    this.scenarios.splice(index, 1);
    
    this.eventBus.emit(ScenarioEvents.UPDATED, { scenarioId: id, change: { type: 'delete' } });
    
    // If deleted active scenario, switch to first available readonly scenario (baseline)
    if (wasActive) {
      this.activeScenarioId = 'baseline'; // fallback to default readonly scenario
      this.eventBus.emit(ScenarioEvents.ACTIVATED, { scenarioId: 'baseline' });
    }
  }
  
  /**
   * Update scenario override for a feature
   * @param {string} featureId - Feature ID
   * @param {string} start - Start date
   * @param {string} end - End date
   */
  setScenarioOverride(featureId, start, end) {
    const scenario = this.getActiveScenario();
    
    // Silent fail if no active scenario or scenario is readonly
    if (!scenario || scenario.readonly) {
      return;
    }
    
    if (!scenario.overrides) scenario.overrides = {};
    
    const ov = scenario.overrides[featureId] || {};
    ov.start = start;
    ov.end = end;
    scenario.overrides[featureId] = ov;
    scenario.isChanged = true;
    
    this.eventBus.emit(ScenarioEvents.UPDATED, { scenarioId: scenario.id, change: { type: 'override', featureId } });
  }
  
  /**
   * Get the currently active scenario
   * @returns {Object|undefined} Active scenario or undefined if readonly scenario is active
   */
  getActiveScenario() {
    // Readonly scenarios (like baseline) are not in our managed array
    return this.scenarios.find(s => s.id === this.activeScenarioId);
  }
  
  /**
   * Get all scenarios
   * @returns {Array} Copy of scenarios array
   */
  getAllScenarios() {
    return [...this.scenarios];
  }
  
  /**
   * Rename a scenario
   * @param {string} id - Scenario ID
   * @param {string} newName - New name
   */
  renameScenario(id, newName) {
    const scenario = this.scenarios.find(s => s.id === id);
    if (!scenario) return; // Silent fail
    
    const unique = this.ensureUniqueScenarioName(newName.trim());
    
    // No change needed
    if (scenario.name === unique) return;
    
    scenario.name = unique;
    scenario.isChanged = true;
    
    this.eventBus.emit(ScenarioEvents.UPDATED, { scenarioId: id, change: { type: 'rename', name: unique } });
  }
  
  /**
   * Check if a scenario is dirty (has unsaved changes)
   * @param {string} id - Scenario ID
   * @returns {boolean}
   */
  isScenarioDirty(id) {
    const scenario = this.scenarios.find(s => s.id === id);
    return scenario ? scenario.isChanged === true : false;
  }
  
  /**
   * Mark scenario as saved (clear dirty flag)
   * @param {string} id - Scenario ID
   */
  markScenarioSaved(id) {
    const scenario = this.scenarios.find(s => s.id === id);
    if (scenario) {
      scenario.isChanged = false;
    }
  }
}
