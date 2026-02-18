import { bus } from '../core/EventBus.js';
import { dataService } from './dataService.js';
import { featureFlags } from '../config.js';
import { FilterManager } from './FilterManager.js';
import { CapacityCalculator } from './CapacityCalculator.js';
import { BaselineStore } from './BaselineStore.js';
import { ScenarioManager } from './ScenarioManager.js';
import { FeatureService } from './FeatureService.js';
import { ViewService } from './ViewService.js';
import { ColorService } from './ColorService.js';
import { ConfigService } from './ConfigService.js';
import { StateFilterService } from './StateFilterService.js';
import { ProjectTeamService } from './ProjectTeamService.js';
import { DataInitService } from './DataInitService.js';
import { ScenarioEventService } from './ScenarioEventService.js';
import { ViewManagementService } from './ViewManagementService.js';
import { SidebarPersistenceService } from './SidebarPersistenceService.js';
// Re-export color constants for backward compatibility
export { PALETTE, DEFAULT_STATE_COLOR_MAP } from './ColorService.js';
import {
  FeatureEvents,
  ScenarioEvents,
  ProjectEvents,
  TeamEvents,
  FilterEvents,
  CapacityEvents,
  DataEvents,
  TimelineEvents,
  ConfigEvents,
  StateFilterEvents,
  ViewEvents
} from '../core/EventRegistry.js';

class State {
  constructor() {
    // Immutable baseline data
    this.baselineProjects = [];
    this.baselineTeams = [];
    this.baselineFeatures = [];
    
    // FilterManager - lazy init after data loads
    this._filterManager = null;
    
    // ScenarioManager - lazy init
    this._scenarioManager = null;
    
    // FeatureService - lazy init after scenario manager
    this._featureService = null;
    
    // ========== Service Layer ==========
    // Core services
    this._baselineStore = new BaselineStore();
    this._capacityCalculator = new CapacityCalculator(bus);
    
    // View and configuration services
    this._viewService = new ViewService(bus);
    this._colorService = new ColorService(dataService);
    this._configService = new ConfigService(bus, dataService);
    this._stateFilterService = new StateFilterService(bus);
    
    // Project/team management service
    this._projectTeamService = new ProjectTeamService(bus);
    
    // Data initialization service
    this._dataInitService = new DataInitService(
      bus,
      dataService,
      this._baselineStore,
      this._projectTeamService,
      this._stateFilterService,
      this._colorService
    );
    
    // Initialize ScenarioManager early for ScenarioEventService
    this._initScenarioManager();
    
    // Scenario event service
    this._scenarioEventService = new ScenarioEventService(
      bus,
      this._scenarioManager,
      this._viewService
    );
    
    // View management service
    this._sidebarPersistenceService = new SidebarPersistenceService(dataService);
    this._viewManagementService = new ViewManagementService(
      bus,
      this,
      this._viewService,
      this._sidebarPersistenceService
    );
    
    // Capacity metrics
    this.capacityDates = [];
    this.teamDailyCapacity = [];
    this.teamDailyCapacityMap = [];
    this.projectDailyCapacityRaw = [];
    this.projectDailyCapacityMap = [];
    this.projectDailyCapacity = [];
    this.totalOrgDailyCapacity = [];
    this.totalOrgDailyPerTeamAvg = [];
    
    // ConfigService handles autosave initialization and configuration changes
    // Register the autosave callback - ConfigService will handle timer management
    this._configService.setupAutosave(
      this._configService.autosaveIntervalMin,
      () => this._performAutosave(),
      true // silent = true on initial setup to avoid emitting event
    );
  }
  
  // ========== Backward Compatibility Property Accessors ==========
  // Delegate to services for backward compatibility with existing code
  
  // ViewService properties
  get timelineScale() { return this._viewService.timelineScale; }
  get showEpics() { return this._viewService.showEpics; }
  get showFeatures() { return this._viewService.showFeatures; }
  get showDependencies() { return this._viewService.showDependencies; }
  get condensedCards() { return this._viewService.condensedCards; }
  get capacityViewMode() { return this._viewService.capacityViewMode; }
  get featureSortMode() { return this._viewService.featureSortMode; }
  
  // ConfigService properties
  get autosaveIntervalMin() { return this._configService.autosaveIntervalMin; }
  get autosaveTimer() { return this._configService._autosaveTimer; }
  
  // ColorService properties (for compatibility)
  get defaultStateColorMap() { return this._colorService.defaultStateColorMap; }
  
  // StateFilterService properties
  get availableFeatureStates() { return this._stateFilterService.availableFeatureStates; }
  get selectedFeatureStateFilter() { return this._stateFilterService.selectedFeatureStateFilter; }
  
  // ProjectTeamService properties
  get projects() { return this._projectTeamService.getProjects(); }
  get teams() { return this._projectTeamService.getTeams(); }
  
  // ScenarioEventService properties
  get scenarios() { return this._scenarioEventService.getScenarios(); }
  get activeScenarioId() { return this._scenarioEventService.getActiveScenarioId(); }
  set activeScenarioId(id) { this._scenarioEventService.setActiveScenarioId(id); }
  
  // ViewManagementService properties
  get viewManagementService() { return this._viewManagementService; }
  get savedViews() { return this._viewManagementService.getViews(); }
  get activeViewId() { return this._viewManagementService.getActiveViewId(); }
  
  // DataInitService properties
  get baselineFeatureById() { return this._dataInitService.baselineFeatureById; }
  get childrenByEpic() { return this._dataInitService.getChildrenByEpicMap(); }
  
  // ========== Autosave Helper ==========
  
  /**
   * Perform autosave of all unsaved scenarios
   * @private
   */
  _performAutosave() {
    // Autosave any non-readonly scenarios with unsaved changes
    for(const s of this.scenarios){
      if(s.readonly) continue; // Skip readonly scenarios
      if(this._scenarioEventService.isScenarioUnsaved(s)) {
        dataService.saveScenario(s).catch(()=>{});
      }
    }
  }

  // Return a hex color for a given state name. Lookup in default map first,
  // then fallback to selecting a color from PALETTE deterministically.
  getFeatureStateColor(stateName) {
    return this._colorService.getFeatureStateColor(stateName);
  }

  // Return a hex color for a given project id. If the project exists in the
  // working `this.projects` array and has a `color` property, return it.
  // Otherwise pick a deterministic color from `PALETTE` based on the id.
  getProjectColor(projectId) {
    return this._colorService.getProjectColor(projectId, this.projects, this.baselineProjects);
  }

  // Return a mapping of state name -> { background, text } colors for all
  // available states. Uses `getFeatureStateColor` for background and picks either
  // black or white for readable text depending on contrast.
  getFeatureStateColors() {
    return this._colorService.getFeatureStateColors(this.availableFeatureStates);
  }

  async initColors() {
    await this._colorService.initColors(this.projects, this.teams);
  }

  // Compute organization load for a feature based on selected teams.
  // Returns a percentage string like '45.0%'.
  computeFeatureOrgLoad(feature) {
    return this._projectTeamService.computeFeatureOrgLoad(feature);
  }  

  async initState() {
    // Delegate to DataInitService
    const result = await this._dataInitService.initState();
    
    // Sync to state properties for backward compatibility
    this.baselineProjects = result.baselineProjects;
    this.baselineTeams = result.baselineTeams;
    this.baselineFeatures = result.baselineFeatures;
    
    // Update FeatureService with new childrenByEpic if it exists
    if (this._featureService) {
      this._featureService.setChildrenByEpic(this.childrenByEpic);
    }
    
    // Initialize default scenario
    this._scenarioEventService.initDefaultScenario(
      () => this._projectTeamService.captureCurrentFilters()
    );
    
    this._scenarioEventService.emitScenarioList();
    this._scenarioEventService.emitScenarioActivated();
    
    // Load saved views
    await this._viewManagementService.loadViews();
    
    // Compute capacity metrics for charts/analytics
    this.recomputeCapacityMetrics();
    bus.emit(CapacityEvents.UPDATED, { dates: this.capacityDates, teamDailyCapacity: this.teamDailyCapacity, projectDailyCapacityRaw: this.projectDailyCapacityRaw, projectDailyCapacity: this.projectDailyCapacity, totalOrgDailyCapacity: this.totalOrgDailyCapacity, totalOrgDailyPerTeamAvg: this.totalOrgDailyPerTeamAvg });
  }

  async refreshBaseline() {
    // Delegate to DataInitService
    const result = await this._dataInitService.refreshBaseline();
    
    // Sync to state properties
    this.baselineProjects = result.baselineProjects;
    this.baselineTeams = result.baselineTeams;
    this.baselineFeatures = result.baselineFeatures;
    
    // Update FeatureService with new childrenByEpic if it exists
    if (this._featureService) {
      this._featureService.setChildrenByEpic(this.childrenByEpic);
    }
    
    // Reinitialize default scenario
    this._scenarioEventService.initDefaultScenario(
      () => this._projectTeamService.captureCurrentFilters()
    );
    
    this._scenarioEventService.emitScenarioList();
    this._scenarioEventService.emitScenarioActivated();
    
    // Recompute capacity metrics after refresh
    this.recomputeCapacityMetrics();
    bus.emit(CapacityEvents.UPDATED, { dates: this.capacityDates, teamDailyCapacity: this.teamDailyCapacity, projectDailyCapacityRaw: this.projectDailyCapacityRaw, projectDailyCapacity: this.projectDailyCapacity, totalOrgDailyCapacity: this.totalOrgDailyCapacity, totalOrgDailyPerTeamAvg: this.totalOrgDailyPerTeamAvg });
  }

  setStateFilter(stateName){
    this._stateFilterService.setStateFilter(stateName);
    // Recompute capacity metrics when filter changes
    this.recomputeCapacityMetrics();
    bus.emit(CapacityEvents.UPDATED, { 
      dates: this.capacityDates, 
      teamDailyCapacity: this.teamDailyCapacity, 
      projectDailyCapacityRaw: this.projectDailyCapacityRaw, 
      projectDailyCapacity: this.projectDailyCapacity, 
      totalOrgDailyCapacity: this.totalOrgDailyCapacity, 
      totalOrgDailyPerTeamAvg: this.totalOrgDailyPerTeamAvg 
    });
  }

  // Toggle a single state's selection on/off
  toggleStateSelected(stateName){
    this._stateFilterService.toggleStateSelected(stateName);
    // Recompute capacity metrics (graphs) whenever state filter changes
    this.recomputeCapacityMetrics();
    bus.emit(CapacityEvents.UPDATED, { 
      dates: this.capacityDates, 
      teamDailyCapacity: this.teamDailyCapacity, 
      projectDailyCapacityRaw: this.projectDailyCapacityRaw, 
      projectDailyCapacity: this.projectDailyCapacity, 
      totalOrgDailyCapacity: this.totalOrgDailyCapacity, 
      totalOrgDailyPerTeamAvg: this.totalOrgDailyPerTeamAvg 
    });
  }

  // Select or clear all states
  setAllStatesSelected(selectAll){
    this._stateFilterService.setAllStatesSelected(selectAll);
    // Recompute capacity metrics (graphs) when toggling all/none
    this.recomputeCapacityMetrics();
    bus.emit(CapacityEvents.UPDATED, { 
      dates: this.capacityDates, 
      teamDailyCapacity: this.teamDailyCapacity, 
      projectDailyCapacityRaw: this.projectDailyCapacityRaw, 
      projectDailyCapacity: this.projectDailyCapacity, 
      totalOrgDailyCapacity: this.totalOrgDailyCapacity, 
      totalOrgDailyPerTeamAvg: this.totalOrgDailyPerTeamAvg 
    });
  }

  // Dirty/changed fields now derived against baseline when creating effective feature objects.
  recomputeDerived(featureBase, override) {
    const changedFields = [];
    if(override){
      if(override.start && override.start !== featureBase.start) changedFields.push('start');
      if(override.end && override.end !== featureBase.end) changedFields.push('end');
      if(override.capacity && JSON.stringify(override.capacity) !== JSON.stringify(featureBase.capacity)) changedFields.push('capacity');
    }
    return { changedFields, dirty: changedFields.length > 0 };
  }

  getFeatureStatuses() {
    return this.availableFeatureStates;
  }

  // Delegation helpers to FeatureService for counts used by UI
  countEpicsForProject(projectId) {
    return this._getFeatureService().countEpicsForProject(projectId);
  }

  countFeaturesForProject(projectId) {
    return this._getFeatureService().countFeaturesForProject(projectId);
  }

  countEpicsForTeam(teamId) {
    return this._getFeatureService().countEpicsForTeam(teamId);
  }

  countFeaturesForTeam(teamId) {
    return this._getFeatureService().countFeaturesForTeam(teamId);
  }

  // Bulk update the state
  updateFeatureDates(updates){
    const capacityCallback = () => {
      const changedIds = (Array.isArray(updates) ? updates.map(u => u.id).filter(Boolean) : []);
      this.recomputeCapacityMetrics(changedIds.length ? changedIds : null);
      bus.emit(CapacityEvents.UPDATED, { 
        dates: this.capacityDates, 
        teamDailyCapacity: this.teamDailyCapacity, 
        teamDailyCapacityMap: this.teamDailyCapacityMap,
        projectDailyCapacityRaw: this.projectDailyCapacityRaw,
        projectDailyCapacity: this.projectDailyCapacity, 
        projectDailyCapacityMap: this.projectDailyCapacityMap,
        totalOrgDailyCapacity: this.totalOrgDailyCapacity,
        totalOrgDailyPerTeamAvg: this.totalOrgDailyPerTeamAvg
      });
    };
    
    const updateCount = this._getFeatureService().updateFeatureDates(updates, capacityCallback);
    
    if (updateCount > 0) {
      const activeId = this._getScenarioManager().activeScenarioId;
      this.emitScenarioUpdated(activeId, { type:'overrideBatch', count: updateCount });
    }
  }

  updateFeatureField(id, field, value) {
    const capacityCallback = () => {
      this.recomputeCapacityMetrics([id]);
      bus.emit(CapacityEvents.UPDATED, { 
        dates: this.capacityDates, 
        teamDailyCapacity: this.teamDailyCapacity, 
        teamDailyCapacityMap: this.teamDailyCapacityMap,
        projectDailyCapacityRaw: this.projectDailyCapacityRaw,
        projectDailyCapacity: this.projectDailyCapacity, 
        projectDailyCapacityMap: this.projectDailyCapacityMap,
        totalOrgDailyCapacity: this.totalOrgDailyCapacity,
        totalOrgDailyPerTeamAvg: this.totalOrgDailyPerTeamAvg
      });
    };
    
    const updated = this._getFeatureService().updateFeatureField(id, field, value, capacityCallback);
    
    if (updated) {
      const activeId = this._getScenarioManager().activeScenarioId;
      this.emitScenarioUpdated(activeId, { type:'overrideField', featureId:id, field });
    }
  }

  revertFeature(id) {
    const capacityCallback = () => {
      this.recomputeCapacityMetrics([id]);
      bus.emit(CapacityEvents.UPDATED, { 
        dates: this.capacityDates, 
        teamDailyCapacity: this.teamDailyCapacity, 
        teamDailyCapacityMap: this.teamDailyCapacityMap,
        projectDailyCapacityRaw: this.projectDailyCapacityRaw,
        projectDailyCapacity: this.projectDailyCapacity, 
        projectDailyCapacityMap: this.projectDailyCapacityMap,
        totalOrgDailyCapacity: this.totalOrgDailyCapacity,
        totalOrgDailyPerTeamAvg: this.totalOrgDailyPerTeamAvg
      });
    };
    
    const reverted = this._getFeatureService().revertFeature(id, capacityCallback);
    
    if (reverted) {
      const activeId = this._getScenarioManager().activeScenarioId;
      this.emitScenarioUpdated(activeId, { type:'revert', featureId:id });
    }
  }

  // Ensure FilterManager is initialized
  _ensureFilterManager() {
    if (!this._filterManager && this.projects && this.teams) {
      this._filterManager = new FilterManager(bus, this.projects, this.teams);
    }
  }

  setProjectSelected(id, selected) {
    this._ensureFilterManager();
    if (!this._projectTeamService.setProjectSelected(id, selected)) return;
    this.recomputeCapacityMetrics();
    bus.emit(CapacityEvents.UPDATED, { dates: this.capacityDates, teamDailyCapacity: this.teamDailyCapacity, projectDailyCapacityRaw: this.projectDailyCapacityRaw, projectDailyCapacity: this.projectDailyCapacity, totalOrgDailyCapacity: this.totalOrgDailyCapacity, totalOrgDailyPerTeamAvg: this.totalOrgDailyPerTeamAvg });
    bus.emit(FeatureEvents.UPDATED);
  }

  setTeamSelected(id, selected) {
    this._ensureFilterManager();
    if (!this._projectTeamService.setTeamSelected(id, selected)) return;
    this.recomputeCapacityMetrics();
    bus.emit(CapacityEvents.UPDATED, { dates: this.capacityDates, teamDailyCapacity: this.teamDailyCapacity, projectDailyCapacityRaw: this.projectDailyCapacityRaw, projectDailyCapacity: this.projectDailyCapacity, totalOrgDailyCapacity: this.totalOrgDailyCapacity, totalOrgDailyPerTeamAvg: this.totalOrgDailyPerTeamAvg });
    bus.emit(FeatureEvents.UPDATED);
  }

  setTimelineScale(scale) {
    this._viewService.setTimelineScale(scale);
  }

  setShowEpics(val) {
    this._viewService.setShowEpics(val);
  }

  setShowFeatures(val) {
    this._viewService.setShowFeatures(val);
  }

  setCondensedCards(val) {
    this._viewService.setCondensedCards(val);
  }

  setShowDependencies(val){
    this._viewService.setShowDependencies(val);
  }

  setcapacityViewMode(mode) {
    this._viewService.setCapacityViewMode(mode);
  }

  setFeatureSortMode(mode) {
    this._viewService.setFeatureSortMode(mode);
  }

  // ---------- Scenario State Management ----------
  
  // Initialize scenario manager
  _initScenarioManager() {
    if (this._scenarioManager) return;
    
    // Create state context for ScenarioManager
    const stateContext = {
      captureCurrentFilters: () => this.captureCurrentFilters(),
      captureCurrentView: () => this.captureCurrentView()
    };
    
    this._scenarioManager = new ScenarioManager(bus, this._baselineStore, stateContext);
  }
  
  // Get or create scenario manager (lazy initialization)
  _getScenarioManager() {
    this._initScenarioManager();
    return this._scenarioManager;
  }
  
  _getFeatureService() {
    if (!this._featureService) {
      // FeatureService requires BaselineStore and a way to get active scenario
      const getActiveScenarioFn = () => {
        return this.scenarios.find(s => s.id === this.activeScenarioId);
      };
      
      // Allow swapping in an experimental queued implementation via feature flag
      try{
        if(featureFlags && featureFlags.USE_QUEUED_FEATURE_SERVICE){
          // Dynamic import preserves module semantics and avoids circular import issues
          // Note: dynamic import returns a promise; use then() to synchronously assign when available.
          import('./QueuedFeatureService.js').then(mod => {
            try{ this._featureService = new mod.QueuedFeatureService(this._baselineStore, getActiveScenarioFn); }
            catch(e){ this._featureService = new FeatureService(this._baselineStore, getActiveScenarioFn); }
          }).catch(_e => { this._featureService = new FeatureService(this._baselineStore, getActiveScenarioFn); });
        } else {
          this._featureService = new FeatureService(this._baselineStore, getActiveScenarioFn);
        }
      }catch(e){
        // Fallback to default
        this._featureService = new FeatureService(this._baselineStore, getActiveScenarioFn);
      }
      // Provide fallback to baselineFeatures if BaselineStore returns empty
      this._featureService._getBaselineFallback = () => this.baselineFeatures;
      this._featureService.setChildrenByEpic(this.childrenByEpic);
      this._featureService.setProjectTeamService(this._projectTeamService);
    }
    return this._featureService;
  }
  
  captureCurrentFilters() {
    return this._projectTeamService.captureCurrentFilters();
  }

  captureCurrentView() {
    return this._viewService.captureCurrentView();
  }

  emitScenarioList() {
    this._scenarioEventService.emitScenarioList();
  }

  emitScenarioActivated() {
    this._scenarioEventService.emitScenarioActivated();
  }
  
  emitScenarioUpdated(id, change) {
    this._scenarioEventService.emitScenarioUpdated(id, change);
  }

  initDefaultScenario() {
    this._scenarioEventService.initDefaultScenario(
      () => this._projectTeamService.captureCurrentFilters()
    );
  }

  cloneScenario(sourceId, name) {
    const scenario = this._getScenarioManager().cloneScenario(sourceId, name);
    
    // Sync scenarios with ScenarioEventService
    this._scenarioEventService.syncScenariosFromManager();
    
    this._scenarioEventService.emitScenarioList();
    return scenario;
  }

  activateScenario(id) {
    if (this.activeScenarioId === id) return;
    this._getScenarioManager().activateScenario(id);
    this._scenarioEventService.setActiveScenarioId(this._getScenarioManager().activeScenarioId);
    this._scenarioEventService.emitScenarioActivated();
    // Recompute capacity metrics to reflect active scenario overrides
    this.recomputeCapacityMetrics();
    bus.emit(CapacityEvents.UPDATED, { dates: this.capacityDates, teamDailyCapacity: this.teamDailyCapacity, projectDailyCapacity: this.projectDailyCapacity, totalOrgDailyCapacity: this.totalOrgDailyCapacity });
    bus.emit(FeatureEvents.UPDATED);
  }

  renameScenario(id, newName) {
    this._getScenarioManager().renameScenario(id, newName);
    this._scenarioEventService.emitScenarioUpdated(id, { type:'rename', name: newName });
  }

  deleteScenario(id) {
    const wasActive = id === this.activeScenarioId;
    this._getScenarioManager().deleteScenario(id);
    this._scenarioEventService.setActiveScenarioId(this._getScenarioManager().activeScenarioId);
    
    // Sync scenarios with ScenarioEventService
    this._scenarioEventService.syncScenariosFromManager();
    
    this._scenarioEventService.emitScenarioUpdated(id, { type:'delete' });
    if (wasActive) { this._scenarioEventService.emitScenarioActivated(); }
    bus.emit(FeatureEvents.UPDATED);
  }

  setScenarioOverride(featureId, start, end) {
    this._getScenarioManager().setScenarioOverride(featureId, start, end);
    const activeId = this._getScenarioManager().activeScenarioId;
    if (activeId !== 'baseline') {
      this._scenarioEventService.emitScenarioUpdated(activeId, { type:'override', featureId });
    }
    // Recompute capacity metrics after setting override
    this.recomputeCapacityMetrics([featureId]);
    bus.emit(CapacityEvents.UPDATED, { dates: this.capacityDates, teamDailyCapacity: this.teamDailyCapacity, orgDailyLoad: this.orgDailyLoad });
    bus.emit(FeatureEvents.UPDATED);
  }

  getEffectiveFeatures() {
    return this._getFeatureService().getEffectiveFeatures();
  }

  getEffectiveFeatureById(id) {
    return this._getFeatureService().getEffectiveFeatureById(id);
  }
  
  getFeatureTitleById(id) {
    return this._getFeatureService().getFeatureTitleById(id);
  }

  isScenarioUnsaved(scen){
    return this._scenarioEventService.isScenarioUnsaved(scen);
  }

  async saveScenario(id){
    const scen = this._scenarioEventService.getScenarioById(id);
    if(!scen) return;
    // Persist via provider
    await dataService.saveScenario({ id: scen.id, name: scen.name, overrides: scen.overrides, filters: scen.filters, view: scen.view });
    this._scenarioEventService.markScenarioSaved(scen.id);
    this._scenarioEventService.emitScenarioUpdated(scen.id, { type:'saved' });
  }

  // -------- Capacity Metrics ---------
  // Build per-day capacity spent per team and per project and totals.
  // Delegates to CapacityCalculator service
  // Optional `changedFeatureIds` (Array) allows incremental recalculation when only
  // a small set of features changed.
  recomputeCapacityMetrics(changedFeatureIds = null){
    const teams = this.baselineTeams || [];
    const projects = this.baselineProjects || [];
    // For project-load calculations only consider project_map entries marked as 'project'.
    // Preserve `projects` (baselineProjects) for listing and other purposes.
    const projectsForCapacity = (projects || []).filter(p => ((p && p.type) ? String(p.type) : 'project') === 'project');
    const selectedProjects = (this.projects || []).filter(p => p.selected).map(p => p.id);
    const selectedTeams = (this.teams || []).filter(t => t.selected).map(t => t.id);
    const selectedStateIds = this.selectedFeatureStateFilter instanceof Set 
      ? Array.from(this.selectedFeatureStateFilter) 
      : (this.selectedFeatureStateFilter || []);
    
    // Check for empty selections
    if ((this.projects && this.projects.length > 0 && selectedProjects.length === 0) ||
        (this.teams && this.teams.length > 0 && selectedTeams.length === 0) ||
        (this.selectedFeatureStateFilter && selectedStateIds.length === 0)) {
      // Clear metrics
      this.capacityDates = [];
      this.teamDailyCapacity = [];
      this.teamDailyCapacityMap = [];
      this.projectDailyCapacityRaw = [];
      this.projectDailyCapacity = [];
      this.projectDailyCapacityMap = [];
      this.totalOrgDailyCapacity = [];
      this.totalOrgDailyPerTeamAvg = [];
      console.debug('[state] recomputeCapacityMetrics - empty selection -> cleared metrics');
      return;
    }
    
    // Ensure childrenByEpic map is set in calculator
    this._capacityCalculator.setChildrenByEpic(this._dataInitService.getChildrenByEpicMap());
    
    const filters = {
      selectedProjects,
      selectedTeams,
      selectedStates: selectedStateIds
    };
    
    // Get effective features with scenario overrides
    const features = this.getEffectiveFeatures();
    
    // Calculate using service (pass changed ids for incremental update when available)
    const result = this._capacityCalculator.calculate(features, filters, teams, projectsForCapacity, changedFeatureIds);
    
    // Assign results to state properties
    this.capacityDates = result.dates;
    this.teamDailyCapacity = result.teamDailyCapacity;
    this.teamDailyCapacityMap = result.teamDailyCapacityMap;
    this.projectDailyCapacityRaw = result.projectDailyCapacityRaw;
    this.projectDailyCapacity = result.projectDailyCapacity;
    this.projectDailyCapacityMap = result.projectDailyCapacityMap;
    this.totalOrgDailyCapacity = result.totalOrgDailyCapacity;
    this.totalOrgDailyPerTeamAvg = result.totalOrgDailyPerTeamAvg;
    
    console.debug('[state] recomputeCapacityMetrics - computed', this.capacityDates.length, 'days of capacity metrics (using CapacityCalculator service)');
  }
}

export const state = new State();
