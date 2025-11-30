// On load, check localPref for autosave interval

import { bus } from './eventBus.js';
import { dataService } from './dataService.js';
import { loadColors, getLocalPref } from './dataLocalStorageService.js';

class State {
  constructor() {
    this.projects = [];
    this.teams = [];
    this.features = [];
    this.originalFeatureOrder = [];
    this.timelineScale = 'months';
    this.showEpics = true;
    this.showFeatures = true;
    this.condensedCards = false;
    this.loadViewMode = 'team';
    this.featureSortMode = 'rank';
    this.scenarios = [];
    this.activeScenarioId = null;
    this.autosaveTimer = null;
    this.autosaveIntervalMin = 0;
    // Setup autosave if configured
    const initialAutosave = getLocalPref('autosave.interval');
    if (initialAutosave && initialAutosave > 0) this.setupAutosave(initialAutosave);
    bus.on('config:autosave', ({ autosaveInterval }) => {
      this.setupAutosave(autosaveInterval);
    });
  }

  setupAutosave(intervalMin) {
    if (this.autosaveTimer) { clearInterval(this.autosaveTimer); this.autosaveTimer = null; }
    this.autosaveIntervalMin = intervalMin;
    if (intervalMin > 0) {
      this.autosaveTimer = setInterval(() => {
        const active = this.scenarios.find(s => s.id === this.activeScenarioId);
        if (active && !active.isLive) {
          dataService.saveScenario(active).catch(()=>{});
        }
      }, intervalMin * 60 * 1000);
    }
  }

  async initState() {
    const { projects, teams, features } = await dataService.getAll();
    this.projects = projects;
    this.teams = teams;
    this.features = features;
    this.originalFeatureOrder = features.map(f=>f.id);
    this.features.forEach((f,i)=>{ f.originalRank = i; });
    this.initLiveScenario();
    this.emitScenarioList();
    this.emitScenarioActivated();
    try {
      const { projectColors, teamColors } = loadColors();
      const PALETTE = ['#3498db','#e74c3c','#27ae60','#f1c40f','#9b59b6','#34495e','#ff8c00','#16a085'];
      let pi = 0; let ti = 0;
      this.projects.forEach(p => {
        if(projectColors[p.id]) { p.color = projectColors[p.id]; }
        else { p.color = PALETTE[pi % PALETTE.length]; pi++; }
      });
      this.teams.forEach(t => {
        if(teamColors[t.id]) { t.color = teamColors[t.id]; }
        else { t.color = PALETTE[ti % PALETTE.length]; ti++; }
      });
    } catch{}
    bus.emit('projects:changed', this.projects);
    bus.emit('teams:changed', this.teams);
    bus.emit('feature:updated');
  }

  async refreshBaseline() {
    await dataService.refreshBaseline();
    const { projects, teams, features } = await dataService.getAll();
    this.projects = projects;
    this.teams = teams;
    this.features = features;
    this.originalFeatureOrder = features.map(f=>f.id);
    this.features.forEach((f,i)=>{ f.originalRank = i; });
    try {
      const { projectColors, teamColors } = loadColors();
      const PALETTE = ['#3498db','#e74c3c','#27ae60','#f1c40f','#9b59b6','#34495e','#ff8c00','#16a085'];
      let pi = 0; let ti = 0;
      this.projects.forEach(p => {
        if(projectColors[p.id]) { p.color = projectColors[p.id]; }
        else { p.color = PALETTE[pi % PALETTE.length]; pi++; }
      });
      this.teams.forEach(t => {
        if(teamColors[t.id]) { t.color = teamColors[t.id]; }
        else { t.color = PALETTE[ti % PALETTE.length]; ti++; }
      });
    } catch{}
    this.emitScenarioList();
    this.emitScenarioActivated();
    bus.emit('projects:changed', this.projects);
    bus.emit('teams:changed', this.teams);
    bus.emit('feature:updated');
  }

  recomputeChangedFields(f) {
    const changed = [];
    if (!f.original) return;
    for(const k of Object.keys(f.original)){
      if(f[k] !== f.original[k]) changed.push(k);
    }
    f.changedFields = changed;
    f.dirty = changed.length > 0;
  }

  updateFeatureDates(id, start, end) {
    const f = this.features.find(x=>x.id===id);
    if(!f) return;
    if(f.type === 'epic') {
      const children = this.features.filter(ch => ch.parentEpic === f.id);
      if(children.length){
        const maxChildEnd = children.reduce((max, ch) => ch.end > max ? ch.end : max, children[0].end);
        if(end < maxChildEnd){
          end = maxChildEnd;
        }
      }
    }
    if(f.start === start && f.end === end) return;
    f.start = start;
    f.end = end;
    this.recomputeChangedFields(f);
    dataService.setFeatureDates(id, start, end);
    if(f.type === 'feature' && f.parentEpic){
      const epic = this.features.find(x=>x.id === f.parentEpic);
      if(epic){
        let epicChanged = false;
        if(end > epic.end){
          epic.end = end;
          epicChanged = true;
        }
        if(start < epic.start){
          epic.start = start;
          epicChanged = true;
        }
        if(epicChanged){
          this.recomputeChangedFields(epic);
          bus.emit('feature:updated', epic);
        }
      }
    }
    bus.emit('feature:updated', f);
  }

  updateFeatureField(id, field, value) {
    const f = this.features.find(x=>x.id===id);
    if(!f) return;
    if(f[field] === value) return;
    f[field] = value;
    this.recomputeChangedFields(f);
    dataService.setFeatureField(id, field, value);
    bus.emit('feature:updated', f);
  }

  revertFeature(id) {
    const f = this.features.find(x=>x.id===id);
    if(!f || !f.original) return;
    for(const k of Object.keys(f.original)){
      f[k] = f.original[k];
    }
    this.recomputeChangedFields(f);
    if(f.type === 'epic'){
      const children = this.features.filter(ch => ch.parentEpic === f.id && ch.original);
      for(const ch of children){
        for(const k of Object.keys(ch.original)){
          ch[k] = ch.original[k];
        }
        this.recomputeChangedFields(ch);
        bus.emit('feature:updated', ch);
      }
    }
    bus.emit('feature:updated', f);
    bus.emit('details:show', f);
  }

  setProjectSelected(id, selected) {
    const p = this.projects.find(x=>x.id===id); if(p){ p.selected = selected; bus.emit('projects:changed', this.projects); }
  }
  setTeamSelected(id, selected) {
    const t = this.teams.find(x=>x.id===id); if(t){ t.selected = selected; bus.emit('teams:changed', this.teams); }
  }
  setTimelineScale(scale) { this.timelineScale = scale; bus.emit('timeline:scale', scale); }
  setShowEpics(val) { this.showEpics = !!val; bus.emit('filters:changed', { showEpics: this.showEpics, showFeatures: this.showFeatures }); }
  setShowFeatures(val) { this.showFeatures = !!val; bus.emit('filters:changed', { showEpics: this.showEpics, showFeatures: this.showFeatures }); }
  setCondensedCards(val) {
    this.condensedCards = !!val;
    bus.emit('view:condensed', this.condensedCards);
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
  initLiveScenario() {
    if(this.scenarios.length > 0) return;
    const live = {
      id: 'live',
      name: 'Live Scenario',
      isLive: true,
      overrides: {},
      filters: this.captureCurrentFilters(),
      view: this.captureCurrentView()
    };
    this.scenarios.push(live);
    this.activeScenarioId = live.id;
  }
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
      isLive: s.isLive,
      overridesCount: Object.keys(s.overrides).length
    })), activeScenarioId: this.activeScenarioId });
  }
  emitScenarioActivated() {
    bus.emit('scenario:activated', { scenarioId: this.activeScenarioId });
  }
  emitScenarioUpdated(id, change) {
    bus.emit('scenario:updated', { scenarioId: id, change });
    this.emitScenarioList();
  }

  createScenario(name) {
    name = (name||'').trim();
    if(!name) name = 'Scenario';
    const uniqueName = this.ensureUniqueScenarioName(name);
    const scen = {
      id: 'scen_' + Date.now() + '_' + Math.floor(Math.random()*10000),
      name: uniqueName,
      isLive: false,
      overrides: {},
      filters: this.captureCurrentFilters(),
      view: this.captureCurrentView()
    };
    this.scenarios.push(scen);
    dataService.saveScenario(scen).catch(()=>{});
    this.emitScenarioUpdated(scen.id, { type: 'create' });
    return scen;
  }

  cloneScenario(sourceId, name) {
    const source = this.scenarios.find(s=>s.id===sourceId); if(!source) return null;
    const effective = this.getEffectiveFeatures();
    const baseName = (name || this.generateScenarioDefaultName()).trim();
    const uniqueName = this.ensureUniqueScenarioName(baseName);
    const newScen = {
      id: 'scen_' + Date.now() + '_' + Math.floor(Math.random()*10000),
      name: uniqueName,
      isLive: false,
      overrides: {},
      filters: source.filters ? { ...source.filters } : this.captureCurrentFilters(),
      view: source.view ? { ...source.view } : this.captureCurrentView()
    };
    if(source.id !== this.activeScenarioId){
      const prev = this.activeScenarioId;
      this.activeScenarioId = source.id;
      const sourceEffective = this.getEffectiveFeatures();
      for(const f of sourceEffective){ newScen.overrides[f.id] = { start: f.start, end: f.end }; }
      this.activeScenarioId = prev;
    } else {
      for(const f of effective){ newScen.overrides[f.id] = { start: f.start, end: f.end }; }
    }
    this.scenarios.push(newScen);
    dataService.saveScenario(newScen).catch(()=>{});
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
    bus.emit('feature:updated');
  }

  renameScenario(id, newName) {
    const scen = this.scenarios.find(s=>s.id===id && !s.isLive); if(!scen) return;
    const unique = this.ensureUniqueScenarioName(newName.trim());
    if(scen.name === unique) return;
    scen.name = unique;
    dataService.renameScenario(id, unique).catch(()=>{});
    this.emitScenarioUpdated(id, { type:'rename', name: unique });
  }

  deleteScenario(id) {
    const idx = this.scenarios.findIndex(s=>s.id===id && !s.isLive); if(idx<0) return;
    const wasActive = this.scenarios[idx].id === this.activeScenarioId;
    this.scenarios.splice(idx,1);
    dataService.deleteScenario(id).catch(()=>{});
    this.emitScenarioUpdated(id, { type:'delete' });
    if(wasActive){ this.activeScenarioId = 'live'; this.emitScenarioActivated(); }
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
    if(!active || active.isLive) return;
    const ov = active.overrides[featureId] || {}; ov.start = start; ov.end = end; active.overrides[featureId] = ov;
    const overrides = Object.entries(active.overrides).map(([id,val])=>({ id, start:val.start, end:val.end }));
    // dataService.persistScenarioOverrides(active.id, overrides).catch(()=>{}); // [Offline mode]
    this.emitScenarioUpdated(active.id, { type:'override', featureId });
    bus.emit('feature:updated');
  }

  getEffectiveFeatures() {
    const active = this.scenarios.find(s=>s.id===this.activeScenarioId);
    if(!active || active.isLive) return this.features;
    return this.features.map(f => {
      const ov = active.overrides[f.id];
      if(!ov) return f;
      return { ...f, start: ov.start || f.start, end: ov.end || f.end, scenarioOverride: true };
    });
  }
}

export const state = new State();
export default State;
