import { ScenarioEvents, DataEvents, FeatureEvents } from '../core/EventRegistry.js';

/**
 * ScenarioEventService
 * 
 * Manages scenario event emissions and synchronization with backend data.
 * Handles scenario list emissions, activation events, and data synchronization.
 */
export class ScenarioEventService {
  constructor(bus, scenarioManager, viewService) {
    this._bus = bus;
    this._scenarioManager = scenarioManager;
    this._viewService = viewService;
    this._scenarios = []; // Combined scenarios (readonly + managed)
    this._activeScenarioId = null;
    this._captureCurrentFilters = null; // Will be set by initDefaultScenario
    
    // Register data event handlers
    this._registerDataHandlers();
  }

  /**
   * Register handlers for backend scenario data events
   * @private
   */
  _registerDataHandlers() {
    // Load scenarios from backend on startup and keep state in sync
    this._bus.on(DataEvents.SCENARIOS_CHANGED, async (metas) => {
      // Only update list UI; full data comes via scenarios:data
      this.emitScenarioList();
    });
    
    this._bus.on(DataEvents.SCENARIOS_DATA, (scenarios) => {
      this._handleScenariosData(scenarios);
    });
  }

  /**
   * Handle scenarios data from backend
   * @private
   * @param {Array} scenarios - Array of scenario objects from backend
   */
  _handleScenariosData(scenarios) {
    // Merge fetched scenarios into state (preserve readonly scenarios like baseline)
    const readonly = this._scenarios.filter(s => s.readonly);
    this._scenarios = [];
    
    // Re-add readonly scenarios first
    this._scenarios.push(...readonly);
    
    for (const s of (scenarios || [])) {
      // Ensure required fields, preserve readonly flag from server
      const merged = Object.assign({
        overrides: {},
        filters: this._captureCurrentFilters ? this._captureCurrentFilters() : { projects: [], teams: [] },
        view: this._captureCurrentView(),
        isChanged: false,
        readonly: false
      }, s);
      
      // Skip if already added as readonly scenario
      if (this._scenarios.some(existing => existing.id === merged.id)) continue;
      this._scenarios.push(merged);
    }
    
    // Sync scenarios to ScenarioManager (only non-readonly)
    this._scenarioManager.scenarios = this._scenarios.filter(s => !s.readonly);
    
    // Keep active scenario valid - default to first readonly scenario if active is missing
    if (!this._scenarios.find(x => x.id === this._activeScenarioId)) {
      const firstReadonly = this._scenarios.find(s => s.readonly);
      this._activeScenarioId = firstReadonly ? firstReadonly.id : (this._scenarios[0]?.id || 'baseline');
      this._scenarioManager.activeScenarioId = this._activeScenarioId;
    }
    
    this.emitScenarioList();
    this.emitScenarioActivated();
    this._bus.emit(FeatureEvents.UPDATED);
  }

  /**
   * Initialize default readonly scenario (baseline)
   * @param {Function} captureFiltersFn - Function to capture current filters
   */
  initDefaultScenario(captureFiltersFn) {
    this._captureCurrentFilters = captureFiltersFn;
    
    const DEFAULT_ID = 'baseline';
    const existing = this._scenarios.find(s => s.id === DEFAULT_ID);
    
    if (existing) {
      existing.overrides = {};
      existing.isChanged = false;
      existing.readonly = true;
    } else {
      const defaultScenario = {
        id: DEFAULT_ID,
        name: 'Baseline',
        overrides: {},
        filters: this._captureCurrentFilters(),
        view: this._captureCurrentView(),
        isChanged: false,
        readonly: true,
      };
      this._scenarios.push(defaultScenario);
      this._activeScenarioId = defaultScenario.id;
      this._scenarioManager.activeScenarioId = defaultScenario.id;
    }
  }

  /**
   * Capture current view state
   * @private
   */
  _captureCurrentView() {
    return this._viewService.captureCurrentView();
  }

  /**
   * Emit scenario list event
   */
  emitScenarioList() {
    this._bus.emit(ScenarioEvents.LIST, {
      scenarios: this._scenarios.map(s => ({
        id: s.id,
        name: s.name,
        overridesCount: Object.keys(s.overrides || {}).length,
        unsaved: this.isScenarioUnsaved(s),
        readonly: s.readonly === true
      })),
      activeScenarioId: this._activeScenarioId
    });
  }

  /**
   * Emit scenario activated event
   */
  emitScenarioActivated() {
    this._bus.emit(ScenarioEvents.ACTIVATED, { scenarioId: this._activeScenarioId });
  }

  /**
   * Emit scenario updated event
   * @param {string} id - Scenario ID
   * @param {Object} change - Change object describing the update
   */
  emitScenarioUpdated(id, change) {
    this._bus.emit(ScenarioEvents.UPDATED, { scenarioId: id, change });
    this.emitScenarioList();
  }

  /**
   * Check if scenario has unsaved changes
   * @param {Object} scen - Scenario object
   * @returns {boolean}
   */
  isScenarioUnsaved(scen) {
    return scen.isChanged === true;
  }

  /**
   * Synchronize scenarios array with ScenarioManager
   * Should be called after ScenarioManager operations
   */
  syncScenariosFromManager() {
    const readonlyScenarios = this._scenarios.filter(s => s.readonly);
    this._scenarios = [
      ...readonlyScenarios,
      ...this._scenarioManager.getAllScenarios()
    ];
  }

  /**
   * Set active scenario ID
   * @param {string} id - Scenario ID
   */
  setActiveScenarioId(id) {
    this._activeScenarioId = id;
    this._scenarioManager.activeScenarioId = id;
  }

  /**
   * Get scenarios array
   * @returns {Array}
   */
  getScenarios() {
    return this._scenarios;
  }

  /**
   * Get active scenario ID
   * @returns {string}
   */
  getActiveScenarioId() {
    return this._activeScenarioId;
  }

  /**
   * Find scenario by ID
   * @param {string} id - Scenario ID
   * @returns {Object|undefined}
   */
  getScenarioById(id) {
    return this._scenarios.find(s => s.id === id);
  }

  /**
   * Mark scenario as saved
   * @param {string} id - Scenario ID
   */
  markScenarioSaved(id) {
    const scen = this._scenarios.find(s => s.id === id);
    if (scen) {
      scen.isChanged = false;
    }
    this._scenarioManager.markScenarioSaved(id);
  }
}
