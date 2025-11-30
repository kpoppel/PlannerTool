// On load, check localPref for autosave interval
import { bus } from './eventBus.js';
import { dataService } from './dataService.js';
import { loadColors } from './dataLocalStorageService.js';

// --- Autosave logic ---
import { getLocalPref } from './dataLocalStorageService.js';
let autosaveTimer = null;
let autosaveIntervalMin = 0;
const initialAutosave = getLocalPref('autosave.interval');
if (initialAutosave && initialAutosave > 0) setupAutosave(initialAutosave);

function setupAutosave(intervalMin) {
  if (autosaveTimer) { clearInterval(autosaveTimer); autosaveTimer = null; }
  autosaveIntervalMin = intervalMin;
  if (intervalMin > 0) {
    autosaveTimer = setInterval(() => {
      const active = state.scenarios.find(s => s.id === state.activeScenarioId);
      if (active && !active.isLive) {
        dataService.saveScenario(active).catch(()=>{});
      }
    }, intervalMin * 60 * 1000);
  }
}
bus.on('config:autosave', ({ autosaveInterval }) => {
  setupAutosave(autosaveInterval);
});

export const state = {
  projects: [],
  teams: [],
  features: [],
  originalFeatureOrder: [],
  timelineScale: 'months',
  showEpics: true,
  showFeatures: true,
  condensedCards: false,
  loadViewMode: 'team', // 'team' | 'project'
  featureSortMode: 'rank', // 'date' | 'rank'
  // Scenario management
  scenarios: [], // [{id,name,isLive,overrides:{featureId:{start,end}}, filters:{projects,teams}, view:{loadViewMode,condensedCards,featureSortMode}}]
  activeScenarioId: null
};

export async function initState(){
  const { projects, teams, features } = await dataService.getAll();
  state.projects = projects;
  state.teams = teams;
  state.features = features;
  // Preserve original rank ordering for view option
  state.originalFeatureOrder = features.map(f=>f.id);
  state.features.forEach((f,i)=>{ f.originalRank = i; });
  initLiveScenario();
  emitScenarioList();
  emitScenarioActivated();
  // Merge persisted colors from localStorage
  try {
    const { projectColors, teamColors } = loadColors();
    const PALETTE = ['#3498db','#e74c3c','#27ae60','#f1c40f','#9b59b6','#34495e','#ff8c00','#16a085'];
    let pi = 0; let ti = 0;
    state.projects.forEach(p => {
      if(projectColors[p.id]) { p.color = projectColors[p.id]; }
      else { p.color = PALETTE[pi % PALETTE.length]; pi++; }
    });
    state.teams.forEach(t => {
      if(teamColors[t.id]) { t.color = teamColors[t.id]; }
      else { t.color = PALETTE[ti % PALETTE.length]; ti++; }
    });
  } catch{}
  bus.emit('projects:changed', state.projects);
  bus.emit('teams:changed', state.teams);
  bus.emit('feature:updated');
}

// Refresh baseline data from dataService mock and reload state
export async function refreshBaseline(){
  await dataService.refreshBaseline();
  const { projects, teams, features } = await dataService.getAll();
  state.projects = projects;
  state.teams = teams;
  state.features = features;
  state.originalFeatureOrder = features.map(f=>f.id);
  state.features.forEach((f,i)=>{ f.originalRank = i; });
  // Reapply colors from localStorage or default palette
  try {
    const { projectColors, teamColors } = loadColors();
    const PALETTE = ['#3498db','#e74c3c','#27ae60','#f1c40f','#9b59b6','#34495e','#ff8c00','#16a085'];
    let pi = 0; let ti = 0;
    state.projects.forEach(p => {
      if(projectColors[p.id]) { p.color = projectColors[p.id]; }
      else { p.color = PALETTE[pi % PALETTE.length]; pi++; }
    });
    state.teams.forEach(t => {
      if(teamColors[t.id]) { t.color = teamColors[t.id]; }
      else { t.color = PALETTE[ti % PALETTE.length]; ti++; }
    });
  } catch{}
  // Keep scenarios; live remains active or current active keeps effective overrides against new baseline
  emitScenarioList();
  emitScenarioActivated();
  bus.emit('projects:changed', state.projects);
  bus.emit('teams:changed', state.teams);
  bus.emit('feature:updated');
}

function recomputeChangedFields(f){
  const changed = [];
  for(const k of Object.keys(f.original)){
    if(f[k] !== f.original[k]) changed.push(k);
  }
  f.changedFields = changed;
  f.dirty = changed.length > 0;
}

export function updateFeatureDates(id, start, end){
  const f = state.features.find(x=>x.id===id);
  if(!f) return;
  // If epic, inhibit shrinking end before latest child feature end
  if(f.type === 'epic') {
    const children = state.features.filter(ch => ch.parentEpic === f.id);
    if(children.length){
      const maxChildEnd = children.reduce((max, ch) => ch.end > max ? ch.end : max, children[0].end);
      if(end < maxChildEnd){
        end = maxChildEnd; // inhibit shrink
      }
    }
  }
  if(f.start === start && f.end === end) return; // no effective change after inhibition
  f.start = start;
  f.end = end;
  recomputeChangedFields(f);
  // Persist to dataService
  dataService.setFeatureDates(id, start, end);
  // If this is a feature and it extends beyond its parent epic, extend the epic end date.
  if(f.type === 'feature' && f.parentEpic){
    const epic = state.features.find(x=>x.id === f.parentEpic);
    if(epic){
      let epicChanged = false;
      if(end > epic.end){
        epic.end = end;
        epicChanged = true;
      }
      // Also adjust epic start earlier if feature begins before epic
      if(start < epic.start){
        epic.start = start;
        epicChanged = true;
      }
      // (Optional future logic) If start < epic.start we could also pull epic start earlier.
      if(epicChanged){
        recomputeChangedFields(epic);
        bus.emit('feature:updated', epic);
      }
    }
  }
  bus.emit('feature:updated', f);
}

// Generic field update helper (future use)
export function updateFeatureField(id, field, value){
  const f = state.features.find(x=>x.id===id);
  if(!f) return;
  if(f[field] === value) return;
  f[field] = value;
  recomputeChangedFields(f);
  dataService.setFeatureField(id, field, value);
  bus.emit('feature:updated', f);
}

export function revertFeature(id){
  const f = state.features.find(x=>x.id===id);
  if(!f || !f.original) return;
  // Restore all original scalar fields except internal tracking keys
  for(const k of Object.keys(f.original)){
    f[k] = f.original[k];
  }
  recomputeChangedFields(f); // will clear dirty
  // If epic, also revert all children
  if(f.type === 'epic'){
    const children = state.features.filter(ch => ch.parentEpic === f.id && ch.original);
    for(const ch of children){
      for(const k of Object.keys(ch.original)){
        ch[k] = ch.original[k];
      }
      recomputeChangedFields(ch);
      bus.emit('feature:updated', ch);
    }
  }
  bus.emit('feature:updated', f);
  bus.emit('details:show', f); // refresh panel display
}
export function setProjectSelected(id, selected){ const p = state.projects.find(x=>x.id===id); if(p){ p.selected = selected; bus.emit('projects:changed', state.projects); } }
export function setTeamSelected(id, selected){ const t = state.teams.find(x=>x.id===id); if(t){ t.selected = selected; bus.emit('teams:changed', state.teams); } }
export function setTimelineScale(scale){ state.timelineScale = scale; bus.emit('timeline:scale', scale); }
export function setShowEpics(val){ state.showEpics = !!val; bus.emit('filters:changed', { showEpics: state.showEpics, showFeatures: state.showFeatures }); }
export function setShowFeatures(val){ state.showFeatures = !!val; bus.emit('filters:changed', { showEpics: state.showEpics, showFeatures: state.showFeatures }); }

export function setCondensedCards(val){
  state.condensedCards = !!val;
  bus.emit('view:condensed', state.condensedCards);
  bus.emit('feature:updated');
}

export function setLoadViewMode(mode){
  if(mode !== 'team' && mode !== 'project') return;
  if(state.loadViewMode === mode) return;
  state.loadViewMode = mode;
  bus.emit('view:loadMode', state.loadViewMode);
  // Graph and cards depend on this for rendering normalized stacks and org totals.
  bus.emit('feature:updated');
}

export function setFeatureSortMode(mode){
  if(mode !== 'date' && mode !== 'rank') return;
  if(state.featureSortMode === mode) return;
  state.featureSortMode = mode;
  bus.emit('view:sortMode', state.featureSortMode);
  bus.emit('feature:updated');
}

// ---------- Scenario State Management ----------
function initLiveScenario(){
  if(state.scenarios.length > 0) return; // already initialised
  const live = {
    id: 'live',
    name: 'Live Scenario',
    isLive: true,
    overrides: {},
    filters: captureCurrentFilters(),
    view: captureCurrentView()
  };
  state.scenarios.push(live);
  state.activeScenarioId = live.id;
}

function captureCurrentFilters(){
  return {
    projects: state.projects.filter(p=>p.selected).map(p=>p.id),
    teams: state.teams.filter(t=>t.selected).map(t=>t.id)
  };
}
function captureCurrentView(){
  return {
    loadViewMode: state.loadViewMode,
    condensedCards: state.condensedCards,
    featureSortMode: state.featureSortMode
  };
}

function emitScenarioList(){
  bus.emit('scenario:list', { scenarios: state.scenarios.map(s => ({
    id: s.id,
    name: s.name,
    isLive: s.isLive,
    overridesCount: Object.keys(s.overrides).length
  })), activeScenarioId: state.activeScenarioId });
}
function emitScenarioActivated(){
  bus.emit('scenario:activated', { scenarioId: state.activeScenarioId });
}
function emitScenarioUpdated(id, change){
  bus.emit('scenario:updated', { scenarioId: id, change });
  emitScenarioList();
}

export function createScenario(name){
  name = (name||'').trim();
  if(!name) name = 'Scenario';
  const uniqueName = ensureUniqueScenarioName(name);
  const scen = {
    id: 'scen_' + Date.now() + '_' + Math.floor(Math.random()*10000),
    name: uniqueName,
    isLive: false,
    overrides: {},
    filters: captureCurrentFilters(),
    view: captureCurrentView()
  };
  state.scenarios.push(scen);
  // Persist via provider (mock)
  dataService.saveScenario(scen).catch(()=>{});
  emitScenarioUpdated(scen.id, { type: 'create' });
  return scen;
}

export function cloneScenario(sourceId, name){
  const source = state.scenarios.find(s=>s.id===sourceId); if(!source) return null;
  const effective = getEffectiveFeatures(); // based on active scenario, but clone should use source scenario's view
  const baseName = (name || generateScenarioDefaultName()).trim();
  const uniqueName = ensureUniqueScenarioName(baseName);
  const newScen = {
    id: 'scen_' + Date.now() + '_' + Math.floor(Math.random()*10000),
    name: uniqueName,
    isLive: false,
    overrides: {},
    filters: source.filters ? { ...source.filters } : captureCurrentFilters(),
    view: source.view ? { ...source.view } : captureCurrentView()
  };
  // Populate overrides with effective dates from the source scenario perspective:
  // If cloning a non-active scenario, approximate by its own overrides merged on baseline.
  // Simplicity: use current effective features when cloning the active scenario; if cloning a different scenario, temporarily activate it.
  if(source.id !== state.activeScenarioId){
    // Temporarily compute overrides using source scenario data (without changing global active permanently)
    const prev = state.activeScenarioId;
    state.activeScenarioId = source.id;
    const sourceEffective = getEffectiveFeatures();
    for(const f of sourceEffective){ newScen.overrides[f.id] = { start: f.start, end: f.end }; }
    state.activeScenarioId = prev;
  } else {
    for(const f of effective){ newScen.overrides[f.id] = { start: f.start, end: f.end }; }
  }
  state.scenarios.push(newScen);
  // Persist via provider (mock)
  dataService.saveScenario(newScen).catch(()=>{});
  emitScenarioUpdated(newScen.id, { type:'clone', from: sourceId });
  return newScen;
}

function generateScenarioDefaultName(){
  const now = new Date();
  const mm = String(now.getMonth()+1).padStart(2,'0');
  const dd = String(now.getDate()).padStart(2,'0');
  let maxN = 0;
  const re = /^\d{2}-\d{2} Scenario (\d+)$/i;
  for(const s of state.scenarios){
    const m = re.exec(s.name);
    if(m){ const n = parseInt(m[1],10); if(n>maxN) maxN = n; }
  }
  const next = maxN + 1;
  return `${mm}-${dd} Scenario ${next}`;
}

export function activateScenario(id){
  if(state.activeScenarioId === id) return;
  const scen = state.scenarios.find(s=>s.id===id);
  if(!scen) return;
  state.activeScenarioId = id;
  emitScenarioActivated();
  bus.emit('feature:updated'); // redraw using effective dates
}

export function renameScenario(id, newName){
  const scen = state.scenarios.find(s=>s.id===id && !s.isLive); if(!scen) return;
  const unique = ensureUniqueScenarioName(newName.trim());
  if(scen.name === unique) return;
  scen.name = unique;
  // Persist via provider
  dataService.renameScenario(id, unique).catch(()=>{});
  emitScenarioUpdated(id, { type:'rename', name: unique });
}

export function deleteScenario(id){
  const idx = state.scenarios.findIndex(s=>s.id===id && !s.isLive); if(idx<0) return;
  const wasActive = state.scenarios[idx].id === state.activeScenarioId;
  state.scenarios.splice(idx,1);
  // Persist via provider
  dataService.deleteScenario(id).catch(()=>{});
  emitScenarioUpdated(id, { type:'delete' });
  if(wasActive){ state.activeScenarioId = 'live'; emitScenarioActivated(); }
  bus.emit('feature:updated');
}

function ensureUniqueScenarioName(base){
  let candidate = base; let counter = 2;
  while(state.scenarios.some(s=>s.name.toLowerCase() === candidate.toLowerCase())){
    candidate = base + ' ' + counter;
    counter++;
  }
  return candidate;
}

export function setScenarioOverride(featureId, start, end){
  const active = state.scenarios.find(s=>s.id===state.activeScenarioId);
  if(!active || active.isLive) return; // live scenario does not store overrides
  const ov = active.overrides[featureId] || {}; ov.start = start; ov.end = end; active.overrides[featureId] = ov;
  // Persist via provider (mock) with full overrides list
  const overrides = Object.entries(active.overrides).map(([id,val])=>({ id, start:val.start, end:val.end }));
  // dataService.persistScenarioOverrides(active.id, overrides).catch(()=>{}); // [Offline mode] See issue #offline-mode.
  emitScenarioUpdated(active.id, { type:'override', featureId });
  bus.emit('feature:updated');
}

// Effective features: baseline features with scenario overrides applied (non-destructive).
export function getEffectiveFeatures(){
  const active = state.scenarios.find(s=>s.id===state.activeScenarioId);
  if(!active || active.isLive) return state.features; // live uses baseline directly
  return state.features.map(f => {
    const ov = active.overrides[f.id];
    if(!ov) return f; // no override
    return { ...f, start: ov.start || f.start, end: ov.end || f.end, scenarioOverride: true };
  });
}
