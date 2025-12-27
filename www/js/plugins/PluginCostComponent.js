import { LitElement, html, css } from '../vendor/lit.js';
import { state } from '../services/State.js';
import { dataService } from '../services/dataService.js';
import { UIFeatureFlags } from '../config.js';
import { bus } from '../core/EventBus.js';
import { UIEvents, ScenarioEvents } from '../core/EventRegistry.js';

function toDate(d){ return d ? new Date(d+'T00:00:00Z') : null; }
function firstOfMonth(dt){ return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1)); }
function lastOfMonth(dt){ return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth()+1, 0)); }
function addMonths(dt, n){ return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth()+n, 1)); }
function monthKey(dt){ return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth()+1).padStart(2,'0'); }
function monthLabel(dt){ return dt.toLocaleString(undefined, { month: 'short', year: 'numeric' }); }
function hexToRgba(hex, alpha = 0.12){
  if(!hex) return `rgba(0,0,0,${alpha})`;
  const h = hex.replace('#','');
  const r = parseInt(h.substring(0,2),16);
  const g = parseInt(h.substring(2,4),16);
  const b = parseInt(h.substring(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export class PluginCostComponent extends LitElement {
  static properties = {
    data: { state: true },
    months: { state: true },
    projects: { state: true },
    expandedProjects: { state: true },
    expandedEpics: { state: true }
  };

  constructor(){
    super();
    this.data = null;
    this.months = [];
    this.projects = [];
    this.expandedProjects = new Set();
    this.expandedEpics = new Set();
    this.viewMode = 'cost'; // 'cost' or 'hours'
    this.activeTab = 'cost'; // 'cost' or 'teams'
    this.teamsData = null;
  }

  static styles = css`
    :host{ display:block; padding:12px; box-sizing:border-box; }
    .table-wrapper{ width:100%; height:70vh; overflow:auto; border:1px solid #e6e6e6; }
    .table{ width:100%; border-collapse:collapse; font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial; min-width:900px; }
    .table th,.table td{ border:1px solid #eee; padding:6px 8px; text-align:right; font-size:13px; white-space:nowrap; }
    .table thead th{ position:sticky; top:0; background:#fff; z-index:2; }
    .project-row{ background:#fafafa; cursor:pointer; }
    .feature-row:hover{ background:#fbfbfe; }
    .swatch{ display:inline-block; width:12px; height:12px; border-radius:2px; margin-right:6px; vertical-align:middle; }
    .feat-icon{ display:inline-flex; width:16px; height:16px; align-items:center; justify-content:center; margin-right:6px; vertical-align:middle; }
    .feat-icon svg{ width:14px; height:14px; }
    .epic-row{ background:#f6f9ff; cursor:pointer; }
    .nested-feature{ padding-left:18px; }
    .legend{ margin-top:12px; display:flex; gap:8px; flex-wrap:wrap; }
    .legend-item{ display:flex; align-items:center; gap:6px; padding:4px 6px; border:1px solid #eee; border-radius:4px; font-size:13px; }
    .total-cell{ font-weight:600; }
    /* Freeze first column */
    .table th.left, .table td.left{
      position:sticky; left:0; z-index:4; background:#fff; text-align:left;
      max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    }
    .table thead th.left{ top:0; z-index:6; }
    .controls{ display:flex; gap:8px; align-items:center; margin-bottom:8px; }
    .toggle{ display:inline-flex; border:1px solid #ddd; border-radius:6px; overflow:hidden; }
    .toggle button{ background:transparent; border:0; padding:6px 10px; cursor:pointer; font-size:13px; }
    .toggle button.active{ background:#eee; font-weight:600; }
    .tab-toggle{ display:inline-flex; border:1px solid #ddd; border-radius:6px; overflow:hidden; }
    .tab-toggle button{ background:transparent; border:0; padding:6px 10px; cursor:pointer; font-size:13px; }
    .tab-toggle button.active{ background:var(--accent-color,#dfeffd); color:var(--accent-text,#072b52); font-weight:600; }
  `;

  connectedCallback(){
    super.connectedCallback();
    // Listen for scenario activation so cost view updates to selected scenario
    // Debounce to coalesce duplicate events emitted by multiple managers
    this._onScenarioActivated = ({ scenarioId }) => {
      try{
        if(this._scenarioDebounceTimer) clearTimeout(this._scenarioDebounceTimer);
        this._scenarioDebounceTimer = setTimeout(()=>{ this._scenarioDebounceTimer = null; try{ this.loadCostForScenario(scenarioId); }catch(e){} }, 60);
      }catch(e){}
    };
    try{ bus.on(ScenarioEvents.ACTIVATED, this._onScenarioActivated); }catch(e){}
    this.loadData();
  }

  open(){
    const main = document.querySelector('main');
    if(main && !this._savedMainStyles){
      this._savedMainStyles = [];
      Array.from(main.children).forEach(child => {
        if(child === this) return;
        this._savedMainStyles.push({ el: child, display: child.style.display || '' });
        child.style.display = 'none';
      });
    }
    this.style.display = 'block';
  }

  close(){
    this.style.display = 'none';
    const main = document.querySelector('main');
    if(main && this._savedMainStyles){
      this._savedMainStyles.forEach(s => { s.el.style.display = s.display; });
      this._savedMainStyles = null;
    }
  }

  async loadData(){
    // Load cost for the currently active scenario if available, otherwise baseline
    const activeId = (state && state.activeScenarioId) ? state.activeScenarioId : 'baseline';
    await this.loadCostForScenario(activeId || 'baseline');
    // If teams tab is enabled, preload teams data
    try{
      if(UIFeatureFlags.SHOW_COST_TEAMS_TAB){
        this.teamsData = await dataService.getCostTeams();
      }
    }catch(e){ console.error('Failed to load cost teams', e); }
  }

  async loadCostForScenario(scenarioId){
    try{
      // Baseline: GET cached cost
      if(!scenarioId || scenarioId === 'baseline'){
        const json = await dataService.getCost();
        if(!json) throw new Error('no cost data');
        this.data = json;
        this.buildMonths(json.configuration);
        this.buildProjects(json.projects || []);
        this.requestUpdate();
        return;
      }

      // Try to read scenario from state first, fallback to dataService.getScenario
      let scenario = (state && state.scenarios) ? state.scenarios.find(s => s.id === scenarioId) : null;
      if(!scenario){
        try{ scenario = await dataService.getScenario(scenarioId); }catch(e){}
      }

      // If scenario exists and appears saved (not locally dirty), ask backend to load it by id
      const isUnsaved = scenario && scenario.isChanged;
      if(scenario && !isUnsaved){
        const json = await dataService.getCost({ scenarioId: scenarioId });
        if(!json) throw new Error('no cost data for scenario');
        this.data = json;
        this.buildMonths(json.configuration);
        this.buildProjects(json.projects || []);
        this.requestUpdate();
        return;
      }

      // Unsaved or transient scenario: POST effective features so server can calculate
      // Build features list from state.getEffectiveFeatures() which already merges overrides
      const eff = (state && typeof state.getEffectiveFeatures === 'function') ? state.getEffectiveFeatures() : null;
      const featuresPayload = (eff || []).map(f => ({ id: f.id, project: f.project, start: f.start, end: f.end, capacity: f.capacity || 1.0, title: f.title || f.name || '', type: f.type || f.feature_type || '', state: f.state || f.status || '' }));

      const json = await dataService.getCost({ features: featuresPayload });
      if(!json) throw new Error('no cost data for scenario');
      this.data = json;
      this.buildMonths(json.configuration);
      this.buildProjects(json.projects || []);
      this.requestUpdate();
    }catch(e){
      console.error('PluginCost load error', e);
    }
  }

  disconnectedCallback(){
    try{ if(this._onScenarioActivated) bus.off(ScenarioEvents.ACTIVATED, this._onScenarioActivated); }catch(e){}
    try{ if(this._scenarioDebounceTimer){ clearTimeout(this._scenarioDebounceTimer); this._scenarioDebounceTimer = null; } }catch(e){}
    if(super.disconnectedCallback) super.disconnectedCallback();
  }

  buildMonths(cfg){
    if(!cfg) return;
    const ds = toDate(cfg.dataset_start);
    const de = toDate(cfg.dataset_end);
    if(!ds || !de) return;
    const start = firstOfMonth(ds);
    const end = firstOfMonth(de);
    const months = [];
    let cur = start;
    while(cur <= end){ months.push(new Date(cur)); cur = addMonths(cur,1); }
    this.months = months;
  }

  buildProjects(projects){
    const months = this.months;
    const monthKeys = months.map(m=>monthKey(m));
    const projectsOut = projects.map(p=>{
      const feats = (p.features||[]).map(f=>{
        const start = toDate(f.start || f.start_date || f.starts_at);
        const end = toDate(f.end || f.end_date || f.ends_at);
        const internalTotal = (f.metrics && (f.metrics.internal?.cost || 0)) || 0;
        const externalTotal = (f.metrics && (f.metrics.external?.cost || 0)) || 0;
        const internalHoursTotal = (f.metrics && (f.metrics.internal?.hours || 0)) || 0;
        const externalHoursTotal = (f.metrics && (f.metrics.external?.hours || 0)) || 0;
        const feature_name = f.title || f.name || String(f.id || f.id === 0 ? f.id : '');
        const feature_state = f.state || f.status || '';
        // distribute evenly across full months between start and end inclusive
        const sMonth = firstOfMonth(start || months[0]);
        const eMonth = firstOfMonth(end || months[months.length-1]);
        const monthsCovered = [];
        let cur = new Date(sMonth);
        while(cur <= eMonth){ monthsCovered.push(monthKey(cur)); cur = addMonths(cur,1); }
        const perMonthInternal = monthsCovered.length ? (internalTotal / monthsCovered.length) : 0;
        const perMonthExternal = monthsCovered.length ? (externalTotal / monthsCovered.length) : 0;
        const perMonthInternalHours = monthsCovered.length ? (internalHoursTotal / monthsCovered.length) : 0;
        const perMonthExternalHours = monthsCovered.length ? (externalHoursTotal / monthsCovered.length) : 0;
        const internalValues = Object.fromEntries(monthKeys.map(k=>[k,0]));
        const externalValues = Object.fromEntries(monthKeys.map(k=>[k,0]));
        const internalHoursValues = Object.fromEntries(monthKeys.map(k=>[k,0]));
        const externalHoursValues = Object.fromEntries(monthKeys.map(k=>[k,0]));
        for(const mk of monthsCovered){ if(mk in internalValues) internalValues[mk] = +(perMonthInternal.toFixed(2)); if(mk in externalValues) externalValues[mk] = +(perMonthExternal.toFixed(2)); if(mk in internalHoursValues) internalHoursValues[mk] = +(perMonthInternalHours.toFixed(2)); if(mk in externalHoursValues) externalHoursValues[mk] = +(perMonthExternalHours.toFixed(2)); }
        // adjust rounding differences on last covered month separately
        const sumInt = Object.values(internalValues).reduce((a,b)=>a+b,0);
        if(monthsCovered.length && Math.abs(sumInt - internalTotal) > 0.001){ const last = monthsCovered[monthsCovered.length-1]; internalValues[last] = +(internalValues[last] + (internalTotal - sumInt)).toFixed(2); }
        const sumExt = Object.values(externalValues).reduce((a,b)=>a+b,0);
        if(monthsCovered.length && Math.abs(sumExt - externalTotal) > 0.001){ const last = monthsCovered[monthsCovered.length-1]; externalValues[last] = +(externalValues[last] + (externalTotal - sumExt)).toFixed(2); }
        const sumIntH = Object.values(internalHoursValues).reduce((a,b)=>a+b,0);
        if(monthsCovered.length && Math.abs(sumIntH - internalHoursTotal) > 0.001){ const last = monthsCovered[monthsCovered.length-1]; internalHoursValues[last] = +(internalHoursValues[last] + (internalHoursTotal - sumIntH)).toFixed(2); }
        const sumExtH = Object.values(externalHoursValues).reduce((a,b)=>a+b,0);
        if(monthsCovered.length && Math.abs(sumExtH - externalHoursTotal) > 0.001){ const last = monthsCovered[monthsCovered.length-1]; externalHoursValues[last] = +(externalHoursValues[last] + (externalHoursTotal - sumExtH)).toFixed(2); }
        const total = +(internalTotal + externalTotal).toFixed(2);
        const totalHours = +(internalHoursTotal + externalHoursTotal).toFixed(2);
        return { id: String(f.id), name: feature_name, state: feature_state, values: { internal: internalValues, external: externalValues }, hours: { internal: internalHoursValues, external: externalHoursValues }, internalTotal, externalTotal, total, internalHoursTotal, externalHoursTotal, totalHours, start: f.start, end: f.end, metrics: f.metrics||{}, capacity: f.capacity||[], description: f.description||'', url: f.url||'' };
      });
      const totals = { internal: Object.fromEntries(monthKeys.map(k=>[k,0])), external: Object.fromEntries(monthKeys.map(k=>[k,0])), hours: { internal: Object.fromEntries(monthKeys.map(k=>[k,0])), external: Object.fromEntries(monthKeys.map(k=>[k,0])) } };
      let projectTotal = 0;
      let projectTotalHours = 0;
      for(const f of feats){ for(const k of Object.keys(f.values.internal)){ totals.internal[k] += f.values.internal[k]; } for(const k of Object.keys(f.values.external)){ totals.external[k] += f.values.external[k]; } for(const k of Object.keys(f.hours.internal)){ totals.hours.internal[k] += f.hours.internal[k]; } for(const k of Object.keys(f.hours.external)){ totals.hours.external[k] += f.hours.external[k]; } projectTotal += f.total; projectTotalHours += f.totalHours || 0; }
      return { id: p.id, name: p.name, features: feats, totals, total: +(projectTotal.toFixed(2)), totalHours: +(projectTotalHours.toFixed(2)) };
    });
    this.projects = projectsOut;
    // compute footer hours totals for quick render
    const footerHours = { internal: Object.fromEntries(monthKeys.map(k=>[k,0])), external: Object.fromEntries(monthKeys.map(k=>[k,0])) };
    let footerTotalHours = 0;
    for(const p of this.projects || []){
      if(p.totals && p.totals.hours){
        for(const k of Object.keys(p.totals.hours.internal || {})){ footerHours.internal[k] += p.totals.hours.internal[k] || 0; }
        for(const k of Object.keys(p.totals.hours.external || {})){ footerHours.external[k] += p.totals.hours.external[k] || 0; }
      }
      footerTotalHours += +(p.totalHours || 0);
    }
    this._footerHours = footerHours;
    this._footerTotalHours = +(footerTotalHours.toFixed(2));
  }

  toggleProject(id){
    if(this.expandedProjects.has(id)) this.expandedProjects.delete(id);
    else this.expandedProjects.add(id);
    this.requestUpdate();
  }

  toggleEpic(id){
    if(this.expandedEpics.has(id)) this.expandedEpics.delete(id);
    else this.expandedEpics.add(id);
    this.requestUpdate();
  }

  render(){
    if(!this.data) return html`<div>Loading cost data...</div>`;
    const months = this.months || [];
    const monthKeys = months.map(m=>monthKey(m));
    const stateColors = state.getFeatureStateColors ? state.getFeatureStateColors() : {};
    // compute footer totals
    const footerInternal = Object.fromEntries(monthKeys.map(k=>[k,0]));
    const footerExternal = Object.fromEntries(monthKeys.map(k=>[k,0]));
    let combinedTotal = 0;
    for(const p of this.projects || []){
      for(const k of monthKeys){ footerInternal[k] += +(p.totals.internal[k] || 0); footerExternal[k] += +(p.totals.external[k] || 0); }
      combinedTotal += +(p.total || 0);
    }
    // ensure footer hours exist
    if(!this._footerHours){ this._footerHours = { internal: Object.fromEntries(monthKeys.map(k=>[k,0])), external: Object.fromEntries(monthKeys.map(k=>[k,0])) }; this._footerTotalHours = 0; }
    return html`
      <div>
        <div class="controls">
          <div style="display:flex; gap:8px; align-items:center;">
            <div class="toggle" role="tablist" aria-label="View mode">
              <button class=${this.viewMode==='cost' ? 'active':''} @click=${()=>{ this.viewMode='cost'; this.requestUpdate(); }}>Cost</button>
              <button class=${this.viewMode==='hours' ? 'active':''} @click=${()=>{ this.viewMode='hours'; this.requestUpdate(); }}>Hours</button>
            </div>
            ${UIFeatureFlags.SHOW_COST_TEAMS_TAB ? html`<div class="tab-toggle"><button class=${this.activeTab==='cost' ? 'active':''} @click=${()=>{ this.activeTab='cost'; this.requestUpdate(); }}>Cost Table</button><button class=${this.activeTab==='teams' ? 'active':''} @click=${async ()=>{ this.activeTab='teams'; if(!this.teamsData){ try{ this.teamsData = await dataService.getCostTeams(); }catch(e){ console.error('Failed to load cost teams', e); this.teamsData = []; } } this.requestUpdate(); }}>Teams</button></div>` : ''}
          </div>
        </div>
        <div class="legend">
          ${(state.availableFeatureStates || []).map(s=>{
            const c = state.getFeatureStateColor(s).background;
            const text = state.getFeatureStateColors()[s]?.text;
            return html`<div class="legend-item"><span class="swatch" style="background:${c}; border:1px solid #eee"></span><span style="color:${text}">${s}</span></div>`;
          })}
        </div>
        ${UIFeatureFlags.SHOW_COST_TEAMS_TAB && this.activeTab === 'teams' ? html`
          <div class="table-wrapper">
            ${this.renderTeamsView()}
          </div>
        ` : html`
          <div class="table-wrapper">
            <table class="table">
            <thead>
              <tr>
                <th class="left" rowspan="2">Project / Feature</th>
                ${months.map(m=>html`<th colspan="2">${monthLabel(m)}</th>`) }
                <th class="total-head" rowspan="2">Total</th>
                <th class="total-extra" rowspan="2"></th>
              </tr>
              <tr>
                ${months.map(m=>html`<th>Int</th><th>Ext</th>`) }
              </tr>
            </thead>
            <tbody>
              ${this.projects.map(p=>
                html`
                <tr class="project-row" @click=${()=>this.toggleProject(p.id)}>
                        <td class="left" style=${`background:#fff;
                            background-image:linear-gradient(90deg, ${hexToRgba(state.getProjectColor(p.id),0.14)} 0px, ${hexToRgba(state.getProjectColor(p.id),0.06)} 40%, rgba(255,255,255,0) 100%); box-shadow: inset 6px 0 0 ${((state.projects||[]).find(sp=>String(sp.id)===String(p.id))||{color:'#ddd'}).color};` }>${p.name}</td>
                  ${monthKeys.map(k=>html`<td>${(this.viewMode==='cost' ? (p.totals.internal[k]||0).toFixed(2) : ((p.totals.hours.internal[k]||0).toFixed(2)))}</td><td>${(this.viewMode==='cost' ? (p.totals.external[k]||0).toFixed(2) : ((p.totals.hours.external[k]||0).toFixed(2)))}</td>`) }
                  <td class="total-cell">${(this.viewMode==='cost' ? p.total.toFixed(2) : (p.totalHours||0).toFixed(2))}</td>
                  <td></td>
                </tr>
                ${this.expandedProjects.has(p.id) ? (() => {
                    // Group features under epics if present. We'll build a map of epicId -> [features]
                    const epicMap = new Map();
                    const standalone = [];
                    for(const f of p.features || []){
                      // Try to resolve effective feature to inspect relations (parentEpic may not be present)
                      const eff = state.getEffectiveFeatureById ? state.getEffectiveFeatureById(f.id) : null;
                      const parent = eff && (eff.parentEpic || eff.parentEpic === 0) ? eff.parentEpic : (f.parentEpic || null);
                      if(parent){
                        if(!epicMap.has(parent)) epicMap.set(parent, []);
                        epicMap.get(parent).push({ base: f, eff });
                      } else {
                        // Could be an epic (has children in state) or a standalone feature
                        // Mark epics by presence in state.childrenByEpic
                        const children = state.childrenByEpic && state.childrenByEpic.get && state.childrenByEpic.get(f.id);
                        if(children && children.length){
                          // This is an epic - ensure it exists in map
                          if(!epicMap.has(f.id)) epicMap.set(f.id, []);
                        }
                        standalone.push({ base: f, eff });
                      }
                    }
                    // Render epics first (preserve insertion order from p.features)
                    const rendered = [];
                    const seenEpics = new Set();
                    for(const f of p.features || []){
                      // render epic rows
                      if(epicMap.has(f.id) && !seenEpics.has(f.id)){
                        seenEpics.add(f.id);
                        const epicChildren = epicMap.get(f.id) || [];
                        const epicBase = f;
                        const epicStateColor = state.getFeatureStateColor(epicBase.state);
                        const epicBg = hexToRgba(epicStateColor, 0.08);
                        rendered.push(html`<tr class="epic-row" @click=${()=>this.toggleEpic(epicBase.id)}><td class="left" style="background:#fff; background-image:linear-gradient(90deg, ${hexToRgba(epicStateColor,0.12)} 0px, ${hexToRgba(epicStateColor,0.06)} 40%, rgba(255,255,255,0) 100%); box-shadow: inset 4px 0 0 ${epicStateColor};">&nbsp;&nbsp;<span class="feat-icon">📁</span>${epicBase.name}</td>${monthKeys.map(k=>html`<td>${(this.viewMode==='cost' ? (epicBase.values?.internal?.[k]||0).toFixed(2) : ((epicBase.hours?.internal?.[k]||0).toFixed(2)))}</td><td>${(this.viewMode==='cost' ? (epicBase.values?.external?.[k]||0).toFixed(2) : ((epicBase.hours?.external?.[k]||0).toFixed(2)))}</td>`) }<td class="total-cell">${(this.viewMode==='cost' ? (epicBase.total||0).toFixed(2) : (epicBase.totalHours||0).toFixed(2))}</td><td></td></tr>`);
                        if(this.expandedEpics.has(f.id)){
                          for(const child of epicChildren){
                            const fb = child.base;
                            const base = state.getFeatureStateColor(fb.state);
                            const bg = hexToRgba(base, 0.10);
                            rendered.push(html`<tr class="feature-row"><td class="left nested-feature" style="background:#fff; background-image:linear-gradient(90deg, ${hexToRgba(base,0.14)} 0px, ${hexToRgba(base,0.06)} 40%, rgba(255,255,255,0) 100%); box-shadow: inset 4px 0 0 ${base}; cursor:pointer;" @click=${(ev)=>{ ev.stopPropagation(); const feat = state.getEffectiveFeatureById(fb.id); bus.emit(UIEvents.DETAILS_SHOW, feat); }}>&nbsp;&nbsp;&nbsp;&nbsp;<span class="feat-icon" title="Feature">🔹</span>${fb.name}</td>${monthKeys.map(k=>html`<td style="background:${bg};">${(this.viewMode==='cost' ? (fb.values.internal[k]||0).toFixed(2) : ((fb.hours.internal[k]||0).toFixed(2)))}</td><td style="background:${bg};">${(this.viewMode==='cost' ? (fb.values.external[k]||0).toFixed(2) : ((fb.hours.external[k]||0).toFixed(2)))}</td>`) }<td class="total-cell" style="background:${bg};">${(this.viewMode==='cost' ? fb.total.toFixed(2) : (fb.totalHours||0).toFixed(2))}</td><td style="background:${bg};"></td></tr>`);
                          }
                        }
                      }
                    }
                    // Render standalone features that are not part of any epic
                    for(const s of standalone){
                      // if this standalone is actually an epic (has children) it was already rendered
                      if(epicMap.has(s.base.id)) continue;
                      const fb = s.base;
                      const base = state.getFeatureStateColor(fb.state);
                      const bg = hexToRgba(base, 0.10);
                      rendered.push(html`<tr class="feature-row"><td class="left" style="background:#fff; background-image:linear-gradient(90deg, ${hexToRgba(base,0.14)} 0px, ${hexToRgba(base,0.06)} 40%, rgba(255,255,255,0) 100%); box-shadow: inset 4px 0 0 ${base}; cursor:pointer;" @click=${(ev)=>{ ev.stopPropagation(); const feat = state.getEffectiveFeatureById(fb.id); bus.emit(UIEvents.DETAILS_SHOW, feat); }}>&nbsp;&nbsp;<span class="feat-icon" title="Feature">🔹</span>${fb.name}</td>${monthKeys.map(k=>html`<td style="background:${bg};">${(this.viewMode==='cost' ? (fb.values.internal[k]||0).toFixed(2) : ((fb.hours.internal[k]||0).toFixed(2)))}</td><td style="background:${bg};">${(this.viewMode==='cost' ? (fb.values.external[k]||0).toFixed(2) : ((fb.hours.external[k]||0).toFixed(2)))}</td>`) }<td class="total-cell" style="background:${bg};">${(this.viewMode==='cost' ? fb.total.toFixed(2) : (fb.totalHours||0).toFixed(2))}</td><td style="background:${bg};"></td></tr>`);
                    }
                    return rendered;
                  })() : ''}
              `)}
            </tbody>
            <tfoot>
              <tr>
                <td class="left">Totals</td>
                ${monthKeys.map(k=>html`<td>${(this.viewMode==='cost' ? (footerInternal[k]||0).toFixed(2) : (this._footerHours? (this._footerHours.internal[k]||0).toFixed(2): '0.00'))}</td><td>${(this.viewMode==='cost' ? (footerExternal[k]||0).toFixed(2) : (this._footerHours? (this._footerHours.external[k]||0).toFixed(2): '0.00'))}</td>`)}
                <td class="total-cell" colspan="2">${(this.viewMode==='cost' ? combinedTotal.toFixed(2) : (this._footerTotalHours||0).toFixed(2))}</td>
              </tr>
            </tfoot>
            </table>
          </div>
        `}
      </div>
    `;
  }

  renderTeamsView(){
    let teams = this.teamsData;
    // Accept different shapes: null, array, object with `teams`, or object map
    if(!teams) return html`<div style="padding:12px">No teams data available.</div>`;
    if(!Array.isArray(teams) && typeof teams === 'object'){
      if(Array.isArray(teams.teams)) teams = teams.teams;
      else teams = Object.values(teams || {});
    }
    if(!Array.isArray(teams) || teams.length === 0) return html`<div style="padding:12px">No teams data available.</div>`;

    const fmtCurrency = v => (typeof v === 'number' ? v : (v && v.parsedValue ? v.parsedValue : Number(v) || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    return html`<div style="display:flex; flex-direction:column; gap:12px; padding:8px">
      ${teams.map(team => {
        const totals = team.totals || {};
        const internalCount = totals.internal_count || 0;
        const externalCount = totals.external_count || 0;
        const internalHours = totals.internal_hours_total || 0;
        const externalHours = totals.external_hours_total || 0;
        const internalRateTotal = totals.internal_hourly_rate_total || 0;
        const externalRateTotal = totals.external_hourly_rate_total || 0;
        const members = Array.isArray(team.members) ? team.members : [];
        return html`
          <div style="border:1px solid #e6e6e6; padding:10px; border-radius:6px; background:#fff">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:8px">
              <div style="font-weight:600">${team.name || team.id}</div>
              <div style="display:flex; gap:12px; font-size:13px; color:#333">
                <div>Internal: ${internalCount} members</div>
                <div>External: ${externalCount} members</div>
                <div>Internal hours: ${internalHours}</div>
                <div>External hours: ${externalHours}</div>
                <div>Internal rate total: ${fmtCurrency(internalRateTotal)}</div>
                <div>External rate total: ${fmtCurrency(externalRateTotal)}</div>
              </div>
            </div>
            <div>
              <table class="table" style="min-width:700px; margin-bottom:4px">
                <thead>
                  <tr>
                    <th class="left">Member</th>
                    <th>Site</th>
                    <th>Budget Hourly Rate</th>
                    <th>Budget Hours / mo</th>
                    <th>Budget Monthly Cost</th>
                  </tr>
                </thead>
                <tbody>
                  ${(() => {
                    const externals = members.filter(x => x && x.external).slice().sort((a,b)=>String((a.name||'')).localeCompare(String((b.name||''))));
                    const internals = members.filter(x => !x || !x.external ? true : false).slice().sort((a,b)=>String((a.name||'')).localeCompare(String((b.name||''))));
                    const rows = [];
                    if(internals.length){
                      rows.push(html`<tr><td class="left" colspan="5" style="background:#f6fff6; font-weight:600">Internal Members</td></tr>`);
                      for(const m of internals){
                        const rate = (m && m.hourly_rate && (typeof m.hourly_rate.parsedValue === 'number' ? m.hourly_rate.parsedValue : Number(m.hourly_rate.source || m.hourly_rate) || 0)) || 0;
                        const hours = (m && (m.hours_per_month || m.hours || 0)) || 0;
                        const monthly = +(rate * hours || 0);
                        rows.push(html`<tr>
                          <td class="left">${m && m.name}</td>
                          <td>${m && m.site}</td>
                          <td style="text-align:right">${fmtCurrency(m && m.hourly_rate)}</td>
                          <td style="text-align:right">${hours}</td>
                          <td style="text-align:right">${fmtCurrency(monthly)}</td>
                        </tr>`);
                      }
                    }
                    if(externals.length){
                      rows.push(html`<tr><td class="left" colspan="5" style="background:#f9f9fb; font-weight:600">External Members</td></tr>`);
                      for(const m of externals){
                        const rate = (m && m.hourly_rate && (typeof m.hourly_rate.parsedValue === 'number' ? m.hourly_rate.parsedValue : Number(m.hourly_rate.source || m.hourly_rate) || 0)) || 0;
                        const hours = (m && (m.hours_per_month || m.hours || 0)) || 0;
                        const monthly = +(rate * hours || 0);
                        rows.push(html`<tr>
                          <td class="left">${m && m.name}</td>
                          <td>${m && m.site}</td>
                          <td style="text-align:right">${fmtCurrency(m && m.hourly_rate)}</td>
                          <td style="text-align:right">${hours}</td>
                          <td style="text-align:right">${fmtCurrency(monthly)}</td>
                        </tr>`);
                      }
                    }
                    if(rows.length === 0) rows.push(html`<tr><td class="left" colspan="5">No members</td></tr>`);
                    return rows;
                  })()}
                </tbody>
              </table>
            </div>
          </div>`;
      })}
    </div>`;
  }

}

customElements.define('plugin-cost', PluginCostComponent);
