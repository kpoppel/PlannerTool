import { bus } from '../core/EventBus.js';
import { dataService } from './dataService.js';
export const PALETTE = [
  '#3498db','#2980b9','#1abc9c','#16a085',
  '#27ae60','#2ecc71','#f1c40f','#f39c12',
  '#e67e22','#d35400','#e74c3c','#c0392b',
  '#9b59b6','#8e44ad','#34495e','#7f8c8d'
];
// Default mapping from feature status/state to color. Exported for reuse.
export const DEFAULT_STATE_COLOR_MAP = {
  'New': '#3498db',
  'Defined': '#2ecc71',
  'In Progress': '#f1c40f',
  'Completed': '#9b59b6',
  'Done': '#9b59b6',
  'Archived': '#7f8c8d',
  'Blocked': '#e74c3c',
  'On Hold': '#e67e22'
};
import { featureFlags } from '../config.js';
import { FilterManager } from './FilterManager.js';
import { CapacityCalculator } from './CapacityCalculator.js';
import { BaselineStore } from './BaselineStore.js';
import { ScenarioManager } from './ScenarioManager.js';
import { FeatureService } from './FeatureService.js';
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
    // Convenience current selections (projects/teams with selected/color used directly by UI)
    this.projects = [];
    this.teams = [];
    //TODO: delete:: Backward compatibility: legacy mutable features array (mirrors baseline; not authoritative)
    //TODO: delete::this.originalFeatureOrder = [];
    this.timelineScale = 'months';
    this.showEpics = true;
    this.showFeatures = true;
    this.condensedCards = false;
    this.capacityViewMode = 'team';
    this.featureSortMode = 'rank';
    this.showDependencies = false;
    this.scenarios = [];
    this.activeScenarioId = null;
    this.autosaveTimer = null;
    this.autosaveIntervalMin = 0;
    
    // FilterManager - lazy init after data loads
    this._filterManager = null;

    // Default state->color mapping (can be overridden by config later)
    this.defaultStateColorMap = DEFAULT_STATE_COLOR_MAP;
    
    // ScenarioManager - lazy init
    this._scenarioManager = null;
    
    // CapacityCalculator
    this._capacityCalculator = new CapacityCalculator(bus);
    
    // BaselineStore
    this._baselineStore = new BaselineStore();
    
    // FeatureService - lazy init after scenario manager
    this._featureService = null;
    
    // Capacity metrics
    this.capacityDates = [];
    this.teamDailyCapacity = [];
    this.teamDailyCapacityMap = [];
    this.projectDailyCapacityRaw = [];
    this.projectDailyCapacityMap = [];
    this.projectDailyCapacity = [];
    this.totalOrgDailyCapacity = [];
    this.totalOrgDailyPerTeamAvg = [];
    // Feature lookups
    this.baselineFeatureById = new Map();
    this.childrenByEpic = new Map();
    // State filters
    this.availableFeatureStates = [];
    this.selectedFeatureStateFilter = new Set();
    // Setup autosave if configured
    dataService.getLocalPref('autosave.interval').then(initialAutosave => {
      if (initialAutosave && initialAutosave > 0) this.setupAutosave(initialAutosave);
    });
    //if (initialAutosave && initialAutosave > 0) this.setupAutosave(initialAutosave);
    bus.on(ConfigEvents.AUTOSAVE, ({ autosaveInterval }) => {
      this.setupAutosave(autosaveInterval);
    });

    // Load scenarios from backend on startup and keep state in sync
    bus.on(DataEvents.SCENARIOS_CHANGED, async (metas) => {
      // Only update list UI; full data comes via scenarios:data
      this.emitScenarioList();
    });
    bus.on(DataEvents.SCENARIOS_DATA, (scenarios) => {
      // Merge fetched scenarios into state (preserve baseline)
      const baseline = this.scenarios.find(s=>s.id==='baseline');
      this.scenarios = [];
      if(baseline){ this.scenarios.push(baseline); }
      for(const s of (scenarios || [])){
        // Ensure required fields
        const merged = Object.assign({ overrides:{}, filters: this.captureCurrentFilters(), view: this.captureCurrentView(), isChanged: false }, s);
        // Avoid duplicate baseline
        if(merged.id === 'baseline') continue;
        this.scenarios.push(merged);
      }
      // Keep active scenario valid
      if(!this.scenarios.find(x=>x.id===this.activeScenarioId)){
        this.activeScenarioId = 'baseline';
      }
      this.emitScenarioList();
      this.emitScenarioActivated();
      bus.emit(FeatureEvents.UPDATED);
    });
  }

  // Return a hex color for a given state name. Lookup in default map first,
  // then fallback to selecting a color from PALETTE deterministically.
  getFeatureStateColor(stateName) {
    if (!stateName) return PALETTE[0];
    if (this.defaultStateColorMap && this.defaultStateColorMap[stateName]) return this.defaultStateColorMap[stateName];
    // Deterministic fallback: hash the state name to pick a palette color
    let hash = 0; for (let i = 0; i < stateName.length; i++) { hash = ((hash << 5) - hash) + stateName.charCodeAt(i); hash |= 0; }
    const idx = Math.abs(hash) % PALETTE.length;
    return PALETTE[idx];
  }

  // Return a hex color for a given project id. If the project exists in the
  // working `this.projects` array and has a `color` property, return it.
  // Otherwise pick a deterministic color from `PALETTE` based on the id.
  getProjectColor(projectId) {
    if (!projectId) return PALETTE[0];
    // Try to find project in working copy first
    const p = (this.projects || []).find(pr => pr.id === projectId);
    if (p && p.color) return p.color;
    // If no working copy color, try baseline projects
    const bp = (this.baselineProjects || []).find(pr => pr.id === projectId);
    if (bp && bp.color) return bp.color;
    // Deterministic fallback: hash the id string to pick a palette color
    const idStr = String(projectId);
    let hash = 0; for (let i = 0; i < idStr.length; i++) { hash = ((hash << 5) - hash) + idStr.charCodeAt(i); hash |= 0; }
    const idx = Math.abs(hash) % PALETTE.length;
    return PALETTE[idx];
  }

  // Return a mapping of state name -> { background, text } colors for all
  // available states. Uses `getFeatureStateColor` for background and picks either
  // black or white for readable text depending on contrast.
  getFeatureStateColors() {
    const colors = {};
    const states = this.availableFeatureStates || [];
    const pickTextColor = (hex) => {
      if (!hex) return '#000';
      const h = hex.replace('#','');
      const r = parseInt(h.substring(0,2),16);
      const g = parseInt(h.substring(2,4),16);
      const b = parseInt(h.substring(4,6),16);
      // YIQ formula to determine light/dark text
      const yiq = ((r*299)+(g*587)+(b*114))/1000;
      return yiq >= 128 ? '#000' : '#fff';
    };
    for(const s of states){
      const bg = this.getFeatureStateColor(s);
      colors[s] = { background: bg, text: pickTextColor(bg) };
    }
    return colors;
  }

  setupAutosave(intervalMin) {
    if (this.autosaveTimer) { clearInterval(this.autosaveTimer); this.autosaveTimer = null; }
    this.autosaveIntervalMin = intervalMin;
    if (intervalMin > 0) {
      this.autosaveTimer = setInterval(() => {
        // Autosave any non-baseline scenarios with unsaved changes
        for(const s of this.scenarios){
          if(s.id === 'baseline') continue;
          if(this.isScenarioUnsaved(s)) {
            dataService.saveScenario(s).catch(()=>{});
          }
        }
      }, intervalMin * 60 * 1000);
    }
  }

  async initColors() {
    const { projectColors, teamColors } = await dataService.getColorMappings();
    let pi = 0; let ti = 0;
    this.projects.forEach(p => {
      if(projectColors[p.id]) { p.color = projectColors[p.id]; }
      else { p.color = PALETTE[pi % PALETTE.length]; pi++; }
    });
    this.teams.forEach(t => {
      if(teamColors[t.id]) { t.color = teamColors[t.id]; }
      else { t.color = PALETTE[ti % PALETTE.length]; ti++; }
    });
  }

// Compute organization load for a feature based on selected teams.
// Returns a percentage string like '45.0%'.
  computeFeatureOrgLoad(feature) {
    const teams = this.teams || [];
    const numTeamsGlobal = teams.length === 0 ? 1 : teams.length;
    let sum = 0;
    for (const tl of feature.capacity || []) {
      const t = teams.find(x => x.id === tl.team && x.selected);
      if (!t) continue;
      sum += tl.capacity;
    }
    return (sum / numTeamsGlobal).toFixed(1) + '%';
  }  

  async initState() {
    const projects = await dataService.getProjects();
    const teams = await dataService.getTeams();
    const features = await dataService.getFeatures();
    
    // Store baseline data using BaselineStore service
    this._baselineStore.loadBaseline({ projects, teams, features });
    // Sync to state properties for backward compatibility
    this.baselineProjects = this._baselineStore.getProjects();
    this.baselineTeams = this._baselineStore.getTeams();
    this.baselineFeatures = this._baselineStore.getFeatures();
    //TODO: delete:: this.originalFeatureOrder = this._baselineStore.getOriginalOrder();
    
    this.baselineFeatures.forEach((f,i)=>{ f.originalRank = i; });
    // Build lookup maps for fast updates
    this.baselineFeatureById = new Map(this.baselineFeatures.map(f=>[f.id, f]));
    this.childrenByEpic = new Map();
    for(const f of this.baselineFeatures){ if(f.parentEpic){ if(!this.childrenByEpic.has(f.parentEpic)) this.childrenByEpic.set(f.parentEpic, []); this.childrenByEpic.get(f.parentEpic).push(f.id); } }
    
    // Update FeatureService with new childrenByEpic if it exists
    if (this._featureService) {
      this._featureService.setChildrenByEpic(this.childrenByEpic);
    }
    
    // Working copies for selection & colors (do not mutate baseline)
    this.projects = this.baselineProjects.map(p=>({ ...p }));
    this.teams = this.baselineTeams.map(t=>({ ...t }));
    // Precompute orgLoad on baseline features based on current team selection
    this.baselineFeatures = this.baselineFeatures.map(f => ({ ...f, orgLoad: this.computeFeatureOrgLoad(f) }));
    try { this._baselineStore.setFeatures(this.baselineFeatures); } catch (e) { /* noop on failure */ }
    // Compute available states from baseline features
    this.availableFeatureStates = Array.from(new Set(this.baselineFeatures.map(f => f.status || f.state).filter(x=>!!x)));
    // Default selection: select all available states unless user has an explicit selection
    if(!(this.selectedFeatureStateFilter && this.selectedFeatureStateFilter.size > 0)){
      this.selectedFeatureStateFilter = new Set(this.availableFeatureStates);
    }
    this.initBaselineScenario();
    await this.initColors();
    this.emitScenarioList();
    this.emitScenarioActivated();
    bus.emit(ProjectEvents.CHANGED, this.projects);
    bus.emit(TeamEvents.CHANGED, this.teams);
    bus.emit(StateFilterEvents.CHANGED, this.availableFeatureStates);
    bus.emit(FeatureEvents.UPDATED);
    // Compute capacity metrics for charts/analytics
    this.recomputeCapacityMetrics();
    bus.emit(CapacityEvents.UPDATED, { dates: this.capacityDates, teamDailyCapacity: this.teamDailyCapacity, projectDailyCapacityRaw: this.projectDailyCapacityRaw, projectDailyCapacity: this.projectDailyCapacity, totalOrgDailyCapacity: this.totalOrgDailyCapacity, totalOrgDailyPerTeamAvg: this.totalOrgDailyPerTeamAvg });
  }

  async refreshBaseline() {
    // Fetch fresh data from backend
    const projects = await dataService.getProjects();
    const teams = await dataService.getTeams();
    const features = await dataService.getFeatures();
    
    // Build features with originalRank first
    const featuresWithRank = features.map((f, i) => ({ ...f, originalRank: i }));
    this._baselineStore.loadBaseline({ projects, teams, features: featuresWithRank });
    // Sync to state properties
    this.baselineProjects = this._baselineStore.getProjects();
    this.baselineTeams = this._baselineStore.getTeams();
    this.baselineFeatures = this._baselineStore.getFeatures();
    //TODO: delete:: this.originalFeatureOrder = this._baselineStore.getOriginalOrder();
    
    // Refresh working copies FIRST (preserve selection flags if exist) so computeFeatureOrgLoad has correct team selection
    const selectedProjects = new Set(this.projects.filter(p=>p.selected).map(p=>p.id));
    const selectedTeams = new Set(this.teams.filter(t=>t.selected).map(t=>t.id));
    this.projects = this.baselineProjects.map(p=>({ ...p, selected: selectedProjects.has(p.id) }));
    this.teams = this.baselineTeams.map(t=>({ ...t, selected: selectedTeams.has(t.id) }));
    
    // Add orgLoad to features
    this.baselineFeatures = this.baselineFeatures.map(f => ({ ...f, orgLoad: this.computeFeatureOrgLoad(f) }));
    try { this._baselineStore.setFeatures(this.baselineFeatures); } catch (e) { /* noop on failure */ }
    // Rebuild lookup maps
    this.baselineFeatureById = new Map(this.baselineFeatures.map(f=>[f.id, f]));
    this.childrenByEpic = new Map();
    for(const f of this.baselineFeatures){ if(f.parentEpic){ if(!this.childrenByEpic.has(f.parentEpic)) this.childrenByEpic.set(f.parentEpic, []); this.childrenByEpic.get(f.parentEpic).push(f.id); } }
    
    // Update FeatureService with new childrenByEpic if it exists
    if (this._featureService) {
      this._featureService.setChildrenByEpic(this.childrenByEpic);
    }
    
    // Now freeze baseline copies after all modifications are complete
    Object.freeze(this.baselineProjects);
    Object.freeze(this.baselineTeams);
    Object.freeze(this.baselineFeatures);
    this.initBaselineScenario();
    // Recompute available states
    this.availableFeatureStates = Array.from(new Set(this.baselineFeatures.map(f => f.status || f.state).filter(x=>!!x)));
    // If there is no explicit selection, default to selecting all discovered states
    if(!(this.selectedFeatureStateFilter && this.selectedFeatureStateFilter.size > 0)){
      this.selectedFeatureStateFilter = new Set(this.availableFeatureStates);
    }
    console.log('Re-initializing colors after baseline refresh');
    await this.initColors();
    this.emitScenarioList();
    this.emitScenarioActivated();
    bus.emit(ProjectEvents.CHANGED, this.projects);
    bus.emit(TeamEvents.CHANGED, this.teams);
    bus.emit(StateFilterEvents.CHANGED, this.availableFeatureStates);
    bus.emit(FeatureEvents.UPDATED);
    // Recompute capacity metrics after refresh
    this.recomputeCapacityMetrics();
    bus.emit(CapacityEvents.UPDATED, { dates: this.capacityDates, teamDailyCapacity: this.teamDailyCapacity, projectDailyCapacityRaw: this.projectDailyCapacityRaw, projectDailyCapacity: this.projectDailyCapacity, totalOrgDailyCapacity: this.totalOrgDailyCapacity, totalOrgDailyPerTeamAvg: this.totalOrgDailyPerTeamAvg });
  }

  setStateFilter(stateName){
    // Backwards-compatible wrapper: if `null` is passed, select all states;
    // otherwise set single-state selection (legacy behavior).
    if(stateName === null){
      this.selectedFeatureStateFilter = new Set(this.availableFeatureStates || []);
    } else {
      this.selectedFeatureStateFilter = new Set(stateName ? [stateName] : []);
    }
    bus.emit(FilterEvents.CHANGED, { selectedFeatureStateFilter: Array.from(this.selectedFeatureStateFilter) });
    bus.emit(FeatureEvents.UPDATED);
  }

  // Toggle a single state's selection on/off
  toggleStateSelected(stateName){
    if(!stateName) return;
    if(this.selectedFeatureStateFilter.has(stateName)) this.selectedFeatureStateFilter.delete(stateName);
    else this.selectedFeatureStateFilter.add(stateName);
    console.debug('[state] toggleStateSelected ->', Array.from(this.selectedFeatureStateFilter));
    // Recompute capacity metrics (graphs) whenever state filter changes
    this.recomputeCapacityMetrics();
    bus.emit(CapacityEvents.UPDATED, { dates: this.capacityDates, teamDailyCapacity: this.teamDailyCapacity, projectDailyCapacityRaw: this.projectDailyCapacityRaw, projectDailyCapacity: this.projectDailyCapacity, totalOrgDailyCapacity: this.totalOrgDailyCapacity, totalOrgDailyPerTeamAvg: this.totalOrgDailyPerTeamAvg });
    bus.emit(FilterEvents.CHANGED, { selectedFeatureStateFilter: Array.from(this.selectedFeatureStateFilter) });
    bus.emit(FeatureEvents.UPDATED);
  }

  // Select or clear all states
  setAllStatesSelected(selectAll){
    if(selectAll){ this.selectedFeatureStateFilter = new Set(this.availableFeatureStates || []); }
    else { this.selectedFeatureStateFilter = new Set(); }
    // Recompute capacity metrics (graphs) when toggling all/none
    this.recomputeCapacityMetrics();
    bus.emit(CapacityEvents.UPDATED, { dates: this.capacityDates, teamDailyCapacity: this.teamDailyCapacity, projectDailyCapacityRaw: this.projectDailyCapacityRaw, projectDailyCapacity: this.projectDailyCapacity, totalOrgDailyCapacity: this.totalOrgDailyCapacity, totalOrgDailyPerTeamAvg: this.totalOrgDailyPerTeamAvg });
    bus.emit(FilterEvents.CHANGED, { selectedFeatureStateFilter: Array.from(this.selectedFeatureStateFilter) });
    bus.emit(FeatureEvents.UPDATED);
  }

  // Dirty/changed fields now derived against baseline when creating effective feature objects.
  recomputeDerived(featureBase, override) {
    const changedFields = [];
    if(override){
      if(override.start && override.start !== featureBase.start) changedFields.push('start');
      if(override.end && override.end !== featureBase.end) changedFields.push('end');
    }
    return { changedFields, dirty: changedFields.length > 0 };
  }

  getFeatureStatuses() {
    return this.availableFeatureStates;
  }

  // Bulk update the state
  updateFeatureDates(updates){
    const capacityCallback = () => {
      const changedIds = (Array.isArray(updates) ? updates.map(u => u.id).filter(Boolean) : []);
      this.recomputeCapacityMetrics(changedIds.length ? changedIds : null);
      bus.emit(CapacityEvents.UPDATED, { 
        dates: this.capacityDates, 
        teamDailyCapacity: this.teamDailyCapacity, 
        projectDailyCapacity: this.projectDailyCapacity, 
        totalOrgDailyCapacity: this.totalOrgDailyCapacity 
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
        projectDailyCapacity: this.projectDailyCapacity, 
        totalOrgDailyCapacity: this.totalOrgDailyCapacity 
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
        projectDailyCapacity: this.projectDailyCapacity, 
        totalOrgDailyCapacity: this.totalOrgDailyCapacity 
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
    const p = this.projects.find(x => x.id === id);
    if (!p) return;
    p.selected = selected;
    this.recomputeCapacityMetrics();
    bus.emit(CapacityEvents.UPDATED, { dates: this.capacityDates, teamDailyCapacity: this.teamDailyCapacity, projectDailyCapacityRaw: this.projectDailyCapacityRaw, projectDailyCapacity: this.projectDailyCapacity, totalOrgDailyCapacity: this.totalOrgDailyCapacity, totalOrgDailyPerTeamAvg: this.totalOrgDailyPerTeamAvg });
    bus.emit(ProjectEvents.CHANGED, this.projects);
    bus.emit(FeatureEvents.UPDATED);
  }

  setTeamSelected(id, selected) {
    this._ensureFilterManager();
    const t = this.teams.find(x => x.id === id);
    if (!t) return;
    t.selected = selected;
    this.recomputeCapacityMetrics();
    bus.emit(CapacityEvents.UPDATED, { dates: this.capacityDates, teamDailyCapacity: this.teamDailyCapacity, projectDailyCapacityRaw: this.projectDailyCapacityRaw, projectDailyCapacity: this.projectDailyCapacity, totalOrgDailyCapacity: this.totalOrgDailyCapacity, totalOrgDailyPerTeamAvg: this.totalOrgDailyPerTeamAvg });
    bus.emit(TeamEvents.CHANGED, this.teams);
    bus.emit(FeatureEvents.UPDATED);
  }

  setTimelineScale(scale) {
    this.timelineScale = scale;
    bus.emit(TimelineEvents.SCALE_CHANGED, scale);
  }

  setShowEpics(val) {
    this.showEpics = !!val;
    bus.emit(FilterEvents.CHANGED, { showEpics: this.showEpics, showFeatures: this.showFeatures });
    // Notify that features changed so dependent renderers (like dependency lines) refresh
    bus.emit(FeatureEvents.UPDATED);
  }

  setShowFeatures(val) {
    this.showFeatures = !!val;
    bus.emit(FilterEvents.CHANGED, { showEpics: this.showEpics, showFeatures: this.showFeatures });
    // Notify that features changed so dependent renderers (like dependency lines) refresh
    bus.emit(FeatureEvents.UPDATED);
  }

  setCondensedCards(val) {
    this.condensedCards = !!val;
    bus.emit(ViewEvents.CONDENSED, this.condensedCards);
    bus.emit(FeatureEvents.UPDATED);
  }

  setShowDependencies(val){
    this.showDependencies = !!val;
    console.debug('[state] setShowDependencies ->', this.showDependencies);
    bus.emit(ViewEvents.DEPENDENCIES, this.showDependencies);
    bus.emit(FeatureEvents.UPDATED);
  }

  setcapacityViewMode(mode) {
    if(mode !== 'team' && mode !== 'project') return;
    if(this.capacityViewMode === mode) return;
    this.capacityViewMode = mode;
    bus.emit(ViewEvents.CAPACITY_MODE, this.capacityViewMode);
    bus.emit(FeatureEvents.UPDATED);
  }

  setFeatureSortMode(mode) {
    if(mode !== 'date' && mode !== 'rank') return;
    if(this.featureSortMode === mode) return;
    this.featureSortMode = mode;
    bus.emit(ViewEvents.SORT_MODE, this.featureSortMode);
    bus.emit(FeatureEvents.UPDATED);
  }

  // ---------- Scenario State Management ----------
  
  // Get or create scenario manager (lazy initialization)
  _getScenarioManager() {
    if (!this._scenarioManager) {
      // Create state context for ScenarioManager
      const stateContext = {
        captureCurrentFilters: () => this.captureCurrentFilters(),
        captureCurrentView: () => this.captureCurrentView()
      };
      
      this._scenarioManager = new ScenarioManager(bus, this._baselineStore, stateContext);
      
      // Sync existing scenarios (excluding baseline)
      this._scenarioManager.scenarios = this.scenarios.filter(s => s.id !== 'baseline');
      this._scenarioManager.activeScenarioId = this.activeScenarioId;
    }
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
    }
    return this._featureService;
  }
  
  captureCurrentFilters() {
    return {
      projects: this.projects.filter(p=>p.selected).map(p=>p.id),
      teams: this.teams.filter(t=>t.selected).map(t=>t.id)
    };
  }

  captureCurrentView() {
    return {
      capacityViewMode: this.capacityViewMode,
      condensedCards: this.condensedCards,
      featureSortMode: this.featureSortMode
    };
  }

  emitScenarioList() {
    bus.emit(ScenarioEvents.LIST, { scenarios: this.scenarios.map(s => ({
      id: s.id,
      name: s.name,
      overridesCount: Object.keys(s.overrides).length,
      unsaved: this.isScenarioUnsaved(s),
      isBaseline: s.id === 'baseline'
    })), activeScenarioId: this.activeScenarioId });
  }

  emitScenarioActivated() {
    bus.emit(ScenarioEvents.ACTIVATED, { scenarioId: this.activeScenarioId });
  }
  
  emitScenarioUpdated(id, change) {
    bus.emit(ScenarioEvents.UPDATED, { scenarioId: id, change });
    this.emitScenarioList();
  }

  initBaselineScenario() {
    // Initialise or reset the baseline scenario
    const baseline = this.scenarios.find(s => s.id === 'baseline');
    if (baseline) {
      baseline.overrides = {};
      baseline.isChanged = false;
    } else {
      const newbaseline = {
        id: 'baseline',
        name: 'Baseline',
        overrides: {},
        filters: this.captureCurrentFilters(),
        view: this.captureCurrentView(),
        isChanged: false,
      };
      this.scenarios.push(newbaseline);
      this.activeScenarioId = newbaseline.id;
    }
  }

  cloneScenario(sourceId, name) {
    const scenario = this._getScenarioManager().cloneScenario(sourceId, name);
    
    // Keep scenarios array in sync
    this.scenarios = [
      this.scenarios.find(s => s.id === 'baseline'),
      ...this._getScenarioManager().getAllScenarios()
    ];
    
    this.emitScenarioList();
    return scenario;
  }

  activateScenario(id) {
    if (this.activeScenarioId === id) return;
    this._getScenarioManager().activateScenario(id);
    this.activeScenarioId = this._getScenarioManager().activeScenarioId;
    this.emitScenarioActivated();
    // Recompute capacity metrics to reflect active scenario overrides
    this.recomputeCapacityMetrics();
    bus.emit(CapacityEvents.UPDATED, { dates: this.capacityDates, teamDailyCapacity: this.teamDailyCapacity, projectDailyCapacity: this.projectDailyCapacity, totalOrgDailyCapacity: this.totalOrgDailyCapacity });
    bus.emit(FeatureEvents.UPDATED);
  }

  renameScenario(id, newName) {
    this._getScenarioManager().renameScenario(id, newName);
    this.emitScenarioUpdated(id, { type:'rename', name: newName });
  }

  deleteScenario(id) {
    const wasActive = id === this.activeScenarioId;
    this._getScenarioManager().deleteScenario(id);
    this.activeScenarioId = this._getScenarioManager().activeScenarioId;
    
    // Keep scenarios array in sync
    this.scenarios = [
      this.scenarios.find(s => s.id === 'baseline'),
      ...this._getScenarioManager().getAllScenarios()
    ];
    
    this.emitScenarioUpdated(id, { type:'delete' });
    if (wasActive) { this.emitScenarioActivated(); }
    bus.emit(FeatureEvents.UPDATED);
  }

  setScenarioOverride(featureId, start, end) {
    this._getScenarioManager().setScenarioOverride(featureId, start, end);
    const activeId = this._getScenarioManager().activeScenarioId;
    if (activeId !== 'baseline') {
      this.emitScenarioUpdated(activeId, { type:'override', featureId });
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
    return scen.isChanged;
  }

  async saveScenario(id){
    const scen = this.scenarios.find(s=>s.id===id); if(!scen) return;
    // Persist via provider
    await dataService.saveScenario({ id: scen.id, name: scen.name, overrides: scen.overrides, filters: scen.filters, view: scen.view });
    scen.isChanged = false;
    this.emitScenarioUpdated(scen.id, { type:'saved' });
  }

  // -------- Capacity Metrics ---------
  // Build per-day capacity spent per team and per project and totals.
  // Delegates to CapacityCalculator service
  // Optional `changedFeatureIds` (Array) allows incremental recalculation when only
  // a small set of features changed.
  recomputeCapacityMetrics(changedFeatureIds = null){
    const teams = this.baselineTeams || [];
    const projects = this.baselineProjects || [];
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
    this._capacityCalculator.setChildrenByEpic(this.childrenByEpic);
    
    const filters = {
      selectedProjects,
      selectedTeams,
      selectedStates: selectedStateIds
    };
    
    // Get effective features with scenario overrides
    const features = this.getEffectiveFeatures();
    
    // Calculate using service (pass changed ids for incremental update when available)
    const result = this._capacityCalculator.calculate(features, filters, teams, projects, changedFeatureIds);
    
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
