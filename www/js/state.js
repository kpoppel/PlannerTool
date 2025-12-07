import { bus } from './eventBus.js';
import { dataService } from './dataService.js';
import { PALETTE } from './colorManager.js';

// Epic capacity handling modes:
// 'ignoreIfHasChildren' - Ignore epic teamLoads entirely if the epic has any children
// 'fillGapsIfNoChildCoversDate' - Use epic teamLoads only on days where no child feature covers the date
const EPIC_CAPACITY_MODE = 'ignoreIfHasChildren';

class State {
  /**
   * State class datastructures:
   *
   * baselineProjects: Array<Project>
   *   Project: { id: string, name: string, selected?: boolean, color?: string }
   * baselineTeams: Array<Team>
   *   Team: { id: string, name: string, selected?: boolean, color?: string }
   * baselineFeatures: Array<Feature>
   *   Feature: {
   *     id: string,
   *     type: 'feature' | 'epic',
   *     title: string,
   *     project: string,
   *     start: string, // ISO date
   *     end: string,   // ISO date
   *     teamLoads: Array<{ team: string, load: number }>,
   *     orgLoad: number,
   *     status: string,
   *     assignee: string,
   *     description: string,
   *     azureUrl: string,
   *     parentEpic?: string,
   *     originalRank?: number
   *   }
   * projects: Array<Project> (UI working copy, includes selection/color)
   * teams: Array<Team> (UI working copy, includes selection/color)
   * features: Array<Feature> (legacy mutable copy for compatibility; mirrors baselineFeatures)
   * originalFeatureOrder: Array<string> (feature IDs in original import order)
   * scenarios: Array<Scenario>
   *   Scenario: {
   *     id: string,
   *     name: string,
   *     overrides: { [featureId: string]: { start: string, end: string } },
   *     filters: { projects: Array<string>, teams: Array<string> },
   *     view: { loadViewMode: string, condensedCards: boolean, featureSortMode: string },
   *     ischanged: boolean
   *   }
   * activeScenarioId: string (currently active scenario's id)
   * timelineScale: string ('months' | 'weeks' | 'years')
   * showEpics: boolean (UI filter)
   * showFeatures: boolean (UI filter)
   * condensedCards: boolean (UI view option)
   * loadViewMode: string ('team' | 'project')
   * featureSortMode: string ('date' | 'rank')
   * autosaveTimer: Interval handle for autosave
   * autosaveIntervalMin: number (autosave interval in minutes)
   */
  constructor() {
    // Immutable baseline data (frozen after load)
    this.baselineProjects = [];
    this.baselineTeams = [];
    this.baselineFeatures = [];
    // Convenience current selections (projects/teams with selected/color used directly by UI)
    this.projects = [];
    this.teams = [];
    // Backward compatibility: legacy mutable features array (mirrors baseline; not authoritative)
    this.originalFeatureOrder = [];
    this.timelineScale = 'months';
    this.showEpics = true;
    this.showFeatures = true;
    this.condensedCards = false;
    this.loadViewMode = 'team';
    this.featureSortMode = 'rank';
    this.showDependencies = false;
    this.scenarios = [];
    this.activeScenarioId = null;
    this.autosaveTimer = null;
    this.autosaveIntervalMin = 0;
    // Capacity metrics over time (computed from baseline/scenario)
    // projectDailyCapacityRaw — raw per-project sums (sum of team loads; sums to org total).
    // projectDailyCapacity — normalized per-project values (raw / N_teams), suitable for showing project share without double-counting teams.
    // totalOrgDailyLoad — raw total org spend per day (sum of project raw).
    // totalOrgDailyPerTeamAvg — totalOrgDailyLoad / N_teams.
    this.capacityDates = []; // ISO date strings spanning min(start)..max(end)
    this.teamDailyCapacity = []; // Array of arrays: per day N-tuple of team capacities
    this.projectDailyCapacityRaw = []; // raw sums per project (sum of team loads)
    this.projectDailyCapacity = []; // normalized per-project (divided by number of teams)
    this.totalOrgDailyLoad = []; // Array: per day total org capacity (sum of project raw tuple)
    this.totalOrgDailyPerTeamAvg = []; // totalOrgDailyLoad divided by number of teams
    // Indexes for fast lookup
    this.baselineFeatureById = new Map();
    this.childrenByEpic = new Map();
    // Available work item states discovered after loading baseline
    this.availableStates = [];
    // Currently selected state filter (null means show all)
    this.selectedStateFilter = null;
    // Setup autosave if configured
    dataService.getLocalPref('autosave.interval').then(initialAutosave => {
      if (initialAutosave && initialAutosave > 0) this.setupAutosave(initialAutosave);
    });
    //if (initialAutosave && initialAutosave > 0) this.setupAutosave(initialAutosave);
    bus.on('config:autosave', ({ autosaveInterval }) => {
      this.setupAutosave(autosaveInterval);
    });
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
    const teams = state.teams || [];
    const numTeamsGlobal = teams.length === 0 ? 1 : teams.length;
    let sum = 0;
    for (const tl of feature.teamLoads || []) {
      const t = teams.find(x => x.id === tl.team && x.selected);
      if (!t) continue;
      sum += tl.load;
    }
    return (sum / numTeamsGlobal).toFixed(1) + '%';
  }  

  async initState() {
    const projects = await dataService.getProjects();
    const teams = await dataService.getTeams();
    const features = await dataService.getFeatures();
    // Freeze baseline copies
    this.baselineProjects = projects.map(p=>({ ...p }));
    this.baselineTeams = teams.map(t=>({ ...t }));
    this.baselineFeatures = features.map(f=>({ ...f }));
    Object.freeze(this.baselineProjects);
    Object.freeze(this.baselineTeams);
    Object.freeze(this.baselineFeatures);
    this.originalFeatureOrder = this.baselineFeatures.map(f=>f.id);
    this.baselineFeatures.forEach((f,i)=>{ f.originalRank = i; });
    // Build lookup maps for fast updates
    this.baselineFeatureById = new Map(this.baselineFeatures.map(f=>[f.id, f]));
    this.childrenByEpic = new Map();
    for(const f of this.baselineFeatures){ if(f.parentEpic){ if(!this.childrenByEpic.has(f.parentEpic)) this.childrenByEpic.set(f.parentEpic, []); this.childrenByEpic.get(f.parentEpic).push(f.id); } }
    // Working copies for selection & colors (do not mutate baseline)
    this.projects = this.baselineProjects.map(p=>({ ...p }));
    this.teams = this.baselineTeams.map(t=>({ ...t }));
    // Precompute orgLoad on baseline features based on current team selection
    this.baselineFeatures = this.baselineFeatures.map(f => ({ ...f, orgLoad: this.computeFeatureOrgLoad(f) }));
    // Compute available states from baseline features
    this.availableStates = Array.from(new Set(this.baselineFeatures.map(f => f.status || f.state).filter(x=>!!x)));
    this.initBaselineScenario();
    await this.initColors();
    this.emitScenarioList();
    this.emitScenarioActivated();
    bus.emit('projects:changed', this.projects);
    bus.emit('teams:changed', this.teams);
    bus.emit('states:changed', this.availableStates);
    bus.emit('feature:updated');
    // Compute capacity metrics for charts/analytics
    this.recomputeCapacityMetrics();
    bus.emit('capacity:updated', { dates: this.capacityDates, teamDailyCapacity: this.teamDailyCapacity, projectDailyCapacityRaw: this.projectDailyCapacityRaw, projectDailyCapacity: this.projectDailyCapacity, totalOrgDailyLoad: this.totalOrgDailyLoad, totalOrgDailyPerTeamAvg: this.totalOrgDailyPerTeamAvg });
  }

  async refreshBaseline() {
    await dataService.refreshBaseline();
    const projects = await dataService.getProjects();
    const teams = await dataService.getTeams();
    const features = await dataService.getFeatures();
    this.baselineProjects = projects.map(p=>({ ...p }));
    this.baselineTeams = teams.map(t=>({ ...t }));
    this.baselineFeatures = features.map(f=>({ ...f }));
    Object.freeze(this.baselineProjects);
    Object.freeze(this.baselineTeams);
    Object.freeze(this.baselineFeatures);
    this.originalFeatureOrder = this.baselineFeatures.map(f=>f.id);
    this.baselineFeatures.forEach((f,i)=>{ f.originalRank = i; });
    // Rebuild lookup maps
    this.baselineFeatureById = new Map(this.baselineFeatures.map(f=>[f.id, f]));
    this.childrenByEpic = new Map();
    for(const f of this.baselineFeatures){ if(f.parentEpic){ if(!this.childrenByEpic.has(f.parentEpic)) this.childrenByEpic.set(f.parentEpic, []); this.childrenByEpic.get(f.parentEpic).push(f.id); } }
    // Refresh working copies (preserve selection flags if exist)
    const selectedProjects = new Set(this.projects.filter(p=>p.selected).map(p=>p.id));
    const selectedTeams = new Set(this.teams.filter(t=>t.selected).map(t=>t.id));
    this.projects = this.baselineProjects.map(p=>({ ...p, selected: selectedProjects.has(p.id) }));
    this.teams = this.baselineTeams.map(t=>({ ...t, selected: selectedTeams.has(t.id) }));
    // Precompute orgLoad on refreshed baseline features after restoring selections
    this.initBaselineScenario();
    this.baselineFeatures = this.baselineFeatures.map(f => ({ ...f, orgLoad: this.computeFeatureOrgLoad(f) }));
    // Recompute available states
    this.availableStates = Array.from(new Set(this.baselineFeatures.map(f => f.status || f.state).filter(x=>!!x)));
    console.log('Re-initializing colors after baseline refresh');
    await this.initColors();
    this.emitScenarioList();
    this.emitScenarioActivated();
    bus.emit('projects:changed', this.projects);
    bus.emit('teams:changed', this.teams);
    bus.emit('states:changed', this.availableStates);
    bus.emit('feature:updated');
    // Recompute capacity metrics after refresh
    this.recomputeCapacityMetrics();
    bus.emit('capacity:updated', { dates: this.capacityDates, teamDailyCapacity: this.teamDailyCapacity, projectDailyCapacityRaw: this.projectDailyCapacityRaw, projectDailyCapacity: this.projectDailyCapacity, totalOrgDailyLoad: this.totalOrgDailyLoad, totalOrgDailyPerTeamAvg: this.totalOrgDailyPerTeamAvg });
  }

  setStateFilter(stateName){
    this.selectedStateFilter = stateName || null;
    bus.emit('filters:changed', { selectedStateFilter: this.selectedStateFilter });
    bus.emit('feature:updated');
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

  // Bulk update the state
  updateFeatureDates(updates){
    const prof_start = Date.now();
    const active = this.scenarios.find(s=>s.id===this.activeScenarioId);
    if(!active) return;
    if(!Array.isArray(updates) || updates.length===0) return;

    // Work on a copy of overrides to compute effective child ends including these updates
    const newOverrides = Object.assign({}, active.overrides || {});
    for(const u of updates){ if(!u || !u.id) continue; newOverrides[u.id] = { start: u.start, end: u.end }; }

    // Apply each update with epic-child clamping and parent-epic extension handling
    for(const u of updates){
      if(!u || !u.id) continue;
      const id = u.id; const start = u.start; let end = u.end;
      const base = this.baselineFeatureById.get(id);
      if(!base) continue;
      // Epic shrink inhibition
      if(base.type === 'epic'){
        const childIds = this.childrenByEpic.get(base.id) || [];
        if(childIds.length){
          // compute effective ends for children using newOverrides if present
          let maxChildEnd = null;
          for(const cid of childIds){
            const chBase = this.baselineFeatureById.get(cid);
            if(!chBase) continue;
            const ov = newOverrides[cid];
            const effEnd = ov && ov.end ? ov.end : chBase.end;
            if(maxChildEnd === null || effEnd > maxChildEnd) maxChildEnd = effEnd;
          }
          if(maxChildEnd && end < maxChildEnd) end = maxChildEnd;
        }
      }
      // Apply override
      const existing = active.overrides[id] || {};
      if(existing.start === start && existing.end === end) continue;
      active.overrides[id] = { start, end };
      // If feature extends parent epic, adjust epic override in newOverrides and active.overrides
      if(base.type === 'feature' && base.parentEpic){
        const epicId = base.parentEpic;
        const epicBase = this.baselineFeatureById.get(epicId);
        if(epicBase){
          const epicOv = active.overrides[epicId] || { start: epicBase.start, end: epicBase.end };
          let changed = false;
          if(end > (epicOv.end || epicBase.end)){ epicOv.end = end; changed = true; }
          if(start < (epicOv.start || epicBase.start)){ epicOv.start = start; changed = true; }
          if(changed){ active.overrides[epicId] = epicOv; newOverrides[epicId] = epicOv; }
        }
      }
    }

    active.isChanged = true;
    this.emitScenarioUpdated(active.id, { type:'overrideBatch', count: updates.length });
    // Recompute capacity metrics after overrides batch update
    this.recomputeCapacityMetrics();
    bus.emit('capacity:updated', { dates: this.capacityDates, teamDailyCapacity: this.teamDailyCapacity, projectDailyCapacity: this.projectDailyCapacity, totalOrgDailyLoad: this.totalOrgDailyLoad });
    bus.emit('feature:updated');
    console.log('updateFeatureDatesBulk prof time:', Date.now() - prof_start);
  }

  updateFeatureField(id, field, value) {
    const active = this.scenarios.find(s=>s.id===this.activeScenarioId);
    if(!active) return;
    const base = this.baselineFeatures.find(f=>f.id===id);
    if(!base) return;
    // Only supporting date fields for overrides right now; extend if needed
    if(field === 'start' || field === 'end') {
      const ov = active.overrides[id] || { start: base.start, end: base.end };
      ov[field] = value;
      active.overrides[id] = ov;
      active.isChanged = true;
      this.emitScenarioUpdated(active.id, { type:'overrideField', featureId:id, field });
      // Recompute capacity metrics after single-field override change
      this.recomputeCapacityMetrics();
      bus.emit('capacity:updated', { dates: this.capacityDates, teamDailyCapacity: this.teamDailyCapacity, projectDailyCapacity: this.projectDailyCapacity, totalOrgDailyLoad: this.totalOrgDailyLoad });
      bus.emit('feature:updated');
    }
  }

  revertFeature(id) {
    const active = this.scenarios.find(s=>s.id===this.activeScenarioId);
    if(!active) return;
    if(active.overrides[id]){
      delete active.overrides[id];
    }
    active.isChanged = true;
    // TODO: If epic revert: also remove overrides of its children? Keep independent; do not cascade.
    this.emitScenarioUpdated(active.id, { type:'revert', featureId:id });
    // Recompute capacity metrics after revert
    this.recomputeCapacityMetrics();
    bus.emit('capacity:updated', { dates: this.capacityDates, teamDailyCapacity: this.teamDailyCapacity, projectDailyCapacity: this.projectDailyCapacity, totalOrgDailyLoad: this.totalOrgDailyLoad });
    bus.emit('feature:updated');
  }

  setProjectSelected(id, selected) {
    const p = this.projects.find(x=>x.id===id);
    if(p) {
      p.selected = selected;
      bus.emit('projects:changed', this.projects); 
    }
  }

  setTeamSelected(id, selected) {
    const t = this.teams.find(x=>x.id===id);
    if(t) { t.selected = selected;
      bus.emit('teams:changed', this.teams);
    }
  }

  setTimelineScale(scale) {
    this.timelineScale = scale;
    bus.emit('timeline:scale', scale);
  }

  setShowEpics(val) {
    this.showEpics = !!val;
    bus.emit('filters:changed', { showEpics: this.showEpics, showFeatures: this.showFeatures });
  }

  setShowFeatures(val) {
    this.showFeatures = !!val;
    bus.emit('filters:changed', { showEpics: this.showEpics, showFeatures: this.showFeatures });
  }

  setCondensedCards(val) {
    this.condensedCards = !!val;
    bus.emit('view:condensed', this.condensedCards);
    bus.emit('feature:updated');
  }

  setShowDependencies(val){
    this.showDependencies = !!val;
    console.debug('[state] setShowDependencies ->', this.showDependencies);
    bus.emit('view:dependencies', this.showDependencies);
    bus.emit('feature:updated');
  }

  setLoadViewMode(mode) {
    if(mode !== 'team' && mode !== 'project') return;
    if(this.loadViewMode === mode) return;
    this.loadViewMode = mode;
    bus.emit('view:loadMode', this.loadViewMode);
    bus.emit('feature:updated');
  }

  setFeatureSortMode(mode) {
    if(mode !== 'date' && mode !== 'rank') return;
    if(this.featureSortMode === mode) return;
    this.featureSortMode = mode;
    bus.emit('view:sortMode', this.featureSortMode);
    bus.emit('feature:updated');
  }

  // ---------- Scenario State Management ----------
  captureCurrentFilters() {
    return {
      projects: this.projects.filter(p=>p.selected).map(p=>p.id),
      teams: this.teams.filter(t=>t.selected).map(t=>t.id)
    };
  }

  captureCurrentView() {
    return {
      loadViewMode: this.loadViewMode,
      condensedCards: this.condensedCards,
      featureSortMode: this.featureSortMode
    };
  }

  emitScenarioList() {
    bus.emit('scenario:list', { scenarios: this.scenarios.map(s => ({
      id: s.id,
      name: s.name,
      overridesCount: Object.keys(s.overrides).length,
      unsaved: this.isScenarioUnsaved(s),
      isBaseline: s.id === 'baseline'
    })), activeScenarioId: this.activeScenarioId });
  }

  emitScenarioActivated() {
    bus.emit('scenario:activated', { scenarioId: this.activeScenarioId });
  }
  
  emitScenarioUpdated(id, change) {
    bus.emit('scenario:updated', { scenarioId: id, change });
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
    const source = this.scenarios.find(s=>s.id===sourceId); if(!source) return null;
    const baseName = (name || this.generateScenarioDefaultName()).trim();
    const uniqueName = this.ensureUniqueScenarioName(baseName);
    // Generate a scenario ID and add the scenario data structure
    const newScen = {
      id: 'scen_' + Date.now() + '_' + Math.floor(Math.random()*10000),
      name: uniqueName,
      overrides: source.overrides ? { ...source.overrides } : {},
      filters: source.filters ? { ...source.filters } : this.captureCurrentFilters(),
      view: source.view ? { ...source.view } : this.captureCurrentView(),
      isChanged: true
    };
    this.scenarios.push(newScen);
    this.emitScenarioUpdated(newScen.id, { type:'clone', from: sourceId });
    return newScen;
  }

  generateScenarioDefaultName() {
    const now = new Date();
    const mm = String(now.getMonth()+1).padStart(2,'0');
    const dd = String(now.getDate()).padStart(2,'0');
    let maxN = 0;
    const re = /^\d{2}-\d{2} Scenario (\d+)$/i;
    for(const s of this.scenarios){
      const m = re.exec(s.name);
      if(m){ const n = parseInt(m[1],10); if(n>maxN) maxN = n; }
    }
    const next = maxN + 1;
    return `${mm}-${dd} Scenario ${next}`;
  }

  activateScenario(id) {
    if(this.activeScenarioId === id) return;
    const scen = this.scenarios.find(s=>s.id===id);
    if(!scen) return;
    this.activeScenarioId = id;
    this.emitScenarioActivated();
    // Recompute capacity metrics to reflect active scenario overrides
    this.recomputeCapacityMetrics();
    bus.emit('capacity:updated', { dates: this.capacityDates, teamDailyCapacity: this.teamDailyCapacity, projectDailyCapacity: this.projectDailyCapacity, totalOrgDailyLoad: this.totalOrgDailyLoad });
    bus.emit('feature:updated');
  }

  renameScenario(id, newName) {
    const scen = this.scenarios.find(s=>s.id===id); if(!scen || scen.id==='baseline') return; // baseline name fixed
    const unique = this.ensureUniqueScenarioName(newName.trim());
    if(scen.name === unique) return;
    scen.name = unique;
    scen.isChanged = true;
    this.emitScenarioUpdated(id, { type:'rename', name: unique });
  }

  deleteScenario(id) {
    if(id==='baseline') return; // cannot delete baseline
    const idx = this.scenarios.findIndex(s=>s.id===id); if(idx<0) return;
    const wasActive = this.scenarios[idx].id === this.activeScenarioId;
    this.scenarios.splice(idx,1);
    this.emitScenarioUpdated(id, { type:'delete' });
    if(wasActive){ this.activeScenarioId = 'baseline'; this.emitScenarioActivated(); }
    bus.emit('feature:updated');
  }

  ensureUniqueScenarioName(base) {
    let candidate = base; let counter = 2;
    while(this.scenarios.some(s=>s.name.toLowerCase() === candidate.toLowerCase())){
      candidate = base + ' ' + counter;
      counter++;
    }
    return candidate;
  }

  setScenarioOverride(featureId, start, end) {
    const active = this.scenarios.find(s=>s.id===this.activeScenarioId);
    if (!active) return;
    if (!active.overrides) active.overrides = {};
    const ov = active.overrides[featureId] || {};
    ov.start = start;
    ov.end = end;
    active.overrides[featureId] = ov;
    active.isChanged = true;
    this.emitScenarioUpdated(active.id, { type:'override', featureId });
    // Recompute capacity metrics after setting override
    this.recomputeCapacityMetrics();
    bus.emit('capacity:updated', { dates: this.capacityDates, teamDailyCapacity: this.teamDailyCapacity, orgDailyLoad: this.orgDailyLoad });
    bus.emit('feature:updated');
  }

  getEffectiveFeatures() {
    const active = this.scenarios.find(s=>s.id===this.activeScenarioId);
    if(!active) return this.baselineFeatures.map(f=>({ ...f }));
    return this.baselineFeatures.map(base => {
      const ov = active.overrides ? active.overrides[base.id] : undefined;
      const effective = ov ? { ...base, ...ov, scenarioOverride: true } : { ...base };
      const derived = this.recomputeDerived(base, ov);
      effective.changedFields = derived.changedFields;
      effective.dirty = derived.dirty;
      return effective;
    });
  }

  getFeatureTitleById(id) {
    const f = this.baselineFeatures.find(x=>x.id===id);
    return f ? f.title : id;
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
  // Days span earliest feature start to latest feature end across baseline.
  recomputeCapacityMetrics(){
    const teams = this.baselineTeams || [];
    const projects = this.baselineProjects || [];
    // Use effective features based on the active scenario (overrides applied)
    const features = this.getEffectiveFeatures();
    if(!teams.length || !features.length || !projects.length){
      this.capacityDates = [];
      this.teamDailyCapacity = [];
      this.projectDailyCapacity = [];
      this.totalOrgDailyLoad = [];
      return;
    }

    // Determine date range
    let minStart = null; let maxEnd = null;
    for(const f of features){
      if(!f || !f.start || !f.end) continue;
      const s = f.start; const e = f.end;
      if(minStart===null || s < minStart) minStart = s;
      if(maxEnd===null || e > maxEnd) maxEnd = e;
    }
    if(!minStart || !maxEnd){
      this.capacityDates = [];
      this.teamDailyCapacity = [];
      this.projectDailyCapacity = [];
      this.totalOrgDailyLoad = [];
      return;
    }

    // Generate inclusive list of ISO date strings from minStart..maxEnd
    const dates = [];
    const startDate = new Date(minStart);
    const endDate = new Date(maxEnd);
    // Normalize to midnight UTC to avoid TZ drift in iteration
    const cur = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
    const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()));
    while(cur <= end){
      const iso = new Date(cur).toISOString().slice(0,10);
      dates.push(iso);
      cur.setUTCDate(cur.getUTCDate()+1);
    }

    // Pre-map team and project index by id for tuple construction
    const teamIndexById = new Map();
    teams.forEach((t, idx) => { teamIndexById.set(t.id, idx); });
    const projectIndexById = new Map();
    projects.forEach((p, idx) => { projectIndexById.set(p.id, idx); });

    // Build effective feature lookup by id for epic-child checks
    const effectiveById = new Map(features.map(f => [f.id, f]));

    // Initialize arrays
    const teamDaily = new Array(dates.length);
    const projectDaily = new Array(dates.length);
    const totalOrgDaily = new Array(dates.length);

    // For efficient lookup, bucket features by day span
    // Given instruction, capacity for a team on a day is sum of teamLoads.load
    // for all features whose date range covers that day.
    for(let di=0; di<dates.length; di++){
      const dayIso = dates[di];
      const teamTuple = new Array(teams.length).fill(0);
      const projectTuple = new Array(projects.length).fill(0);
      // Sum per team
      for(const f of features){
        if(!f || !f.start || !f.end) continue;
        // day within [start,end]
        if(dayIso < f.start || dayIso > f.end) continue;
        // Epic capacity handling
        if(f.type === 'epic'){
          if(EPIC_CAPACITY_MODE === 'ignoreIfHasChildren'){
            const childIds = this.childrenByEpic.get(f.id) || [];
            if(childIds.length) continue; // ignore epic loads when has children
          } else if(EPIC_CAPACITY_MODE === 'fillGapsIfNoChildCoversDate'){
            const childIds = this.childrenByEpic.get(f.id) || [];
            if(childIds.length){
              // include epic capacity only if no child covers this day
              let childCovers = false;
              for(const cid of childIds){
                const ch = effectiveById.get(cid);
                if(!ch || !ch.start || !ch.end) continue;
                if(dayIso >= ch.start && dayIso <= ch.end){ childCovers = true; break; }
              }
              if(childCovers) continue;
            }
          }
        }
        const tls = f.teamLoads || [];
        for(const tl of tls){
          const ti = teamIndexById.get(tl.team);
          if(ti !== undefined){
            const load = Number(tl.load) || 0;
            teamTuple[ti] += load;
          }
          // Project capacity: add all team loads for the feature to the owning project
          const pi = projectIndexById.get(f.project);
          if(pi !== undefined){
            const load = Number(tl.load) || 0;
            projectTuple[pi] += load;
          }
        }
      }
      teamDaily[di] = teamTuple;
      projectDaily[di] = projectTuple;
      const sumProjects = projectTuple.reduce((a,b)=>a+b,0);
      totalOrgDaily[di] = sumProjects;
    }

    // Normalize project tuples by number of teams so per-project values represent
    // organisation share (prevents double-counting when multiple teams allocate to same project).
    const nTeams = teams.length || 1;
    const projectDailyNormalized = projectDaily.map(tuple => tuple.map(v => v / nTeams));
    const totalOrgDailyPerTeamAvg = totalOrgDaily.map(v => v / nTeams);

    // Assign computed arrays to state
    this.capacityDates = dates;
    this.teamDailyCapacity = teamDaily;
    this.projectDailyCapacityRaw = projectDaily;            // raw sums (sum of team loads)
    this.projectDailyCapacity = projectDailyNormalized;    // normalized per-project (per-team average)
    this.totalOrgDailyLoad = totalOrgDaily;                // raw total org spend (sum of projectDailyCapacityRaw)
    this.totalOrgDailyPerTeamAvg = totalOrgDailyPerTeamAvg; // totalOrgDailyLoad / nTeams

    console.debug('[state] recomputeCapacityMetrics - computed', dates.length, 'days of capacity metrics');
    console.debug('[state] capacityDates:', this.capacityDates);
    console.debug('[state] teamDailyCapacity:', this.teamDailyCapacity);
    console.debug('[state] projectDailyCapacityRaw:', this.projectDailyCapacityRaw);
    console.debug('[state] projectDailyCapacity (normalized):', this.projectDailyCapacity);
    console.debug('[state] totalOrgDailyLoad (raw):', this.totalOrgDailyLoad);
    console.debug('[state] totalOrgDailyPerTeamAvg:', this.totalOrgDailyPerTeamAvg);
  }
}

export const state = new State();
