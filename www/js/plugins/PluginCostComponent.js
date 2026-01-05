/**
 * PluginCostComponent
 * Single-responsibility: render cost and hours tables for features and
 * projects. This LitElement component consumes the JSON produced by the
 * cost service and focuses on presenting per-month internal/external
 * allocations plus totals.
 *
 * Dependencies: `PluginCostCalculator` helpers, `state` service, `dataService`.
 */

/**
 * @typedef {Object} PluginFeature
 * @property {string} id
 * @property {string} name
 * @property {string} state
 * @property {Object<string,number>} values.internal
 * @property {Object<string,number>} values.external
 * @property {Object<string,number>} hours.internal
 * @property {Object<string,number>} hours.external
 * @property {number} total
 * @property {number} totalHours
 */

/**
 * @typedef {Object} PluginProject
 * @property {string|number} id
 * @property {string} name
 * @property {PluginFeature[]} features
 * @property {Object<string,number>} totals.internal
 * @property {Object<string,number>} totals.external
 * @property {Object<string,object>} totals.hours
 * @property {number} total
 * @property {number} totalHours
 */
import { LitElement, html, css } from '../vendor/lit.js';
import { state } from '../services/State.js';
import { dataService } from '../services/dataService.js';
import { UIFeatureFlags } from '../config.js';
import { bus } from '../core/EventBus.js';
import { UIEvents, ScenarioEvents } from '../core/EventRegistry.js';
import { toDate, firstOfMonth, lastOfMonth, addMonths, monthKey, monthLabel, buildMonths, buildProjects } from './PluginCostCalculator.js';
import '../components/SpinnerModal.js';
import '../components/SpinnerModal.js';
/**
 * Convert a hex color (#rrggbb) to an rgba string with supplied alpha.
 * Defensive: returns a sensible fallback when `hex` is falsy.
 * @param {string} hex
 * @param {number} [alpha=0.12]
 * @returns {string}
 */
function hexToRgba(hex, alpha = 0.12){
  if(!hex) return `rgba(0,0,0,${alpha})`;
  // Accept either a hex string or an object with a `background` property
  let val = hex;
  if(typeof hex === 'object' && hex !== null){ val = hex.background || hex; }
  const h = String(val).replace('#','');
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
    expandedEpics: { state: true },
    showBudgetDeviations: { state: true },
    deviationThreshold: { state: true }
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
    this._subscribed = false;
    this.showBudgetDeviations = false;
    this.deviationThreshold = 10; // Default 10%
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
    /* Freeze last two columns (Total + extra) on the right */
    .table th.right, .table td.right{
      position:sticky; right:0; z-index:4; background:#fff !important;
    }
    .table th.right-extra, .table td.right-extra{
      position:sticky; right:0; z-index:4; background:#fff !important;
    }
    .table th.right-total, .table td.right-total{
      position:sticky; right:30px; z-index:4; background:#fff !important;
    }
    /* When deviation mode is off, Total column moves to right edge */
    :host([no-deviation]) .table th.right-total, 
    :host([no-deviation]) .table td.right-total{
      right:0;
    }
    .table thead th.right-total, .table thead th.right-extra{ top:0; z-index:6; }
    .table tfoot td.right-total, .table tfoot td.right-extra{ background: #eaf4ff; }
    /* Ensure opaque backgrounds for sticky cells in different row types */
    .project-row td.right-total, .project-row td.right-extra{ background:#fafafa !important; }
    .epic-row td.right-total, .epic-row td.right-extra{ background:#f6f9ff !important; }
    .feature-row td.right-total, .feature-row td.right-extra{ background:#fff !important; }
    .feature-row:hover td.right-total, .feature-row:hover td.right-extra{ background:#fbfbfe !important; }
    .controls{ display:flex; gap:8px; align-items:center; margin-bottom:8px; }
    .toggle{ display:inline-flex; border:1px solid #ddd; border-radius:6px; overflow:hidden; }
    .toggle button{ background:transparent; border:0; padding:6px 10px; cursor:pointer; font-size:13px; }
    .toggle button.active{ background:#eee; font-weight:600; }
    /* Totals footer styling */
    .table tfoot td{ background: #eaf4ff; color: #0b61c9; font-weight:700; border-top:2px solid #c7e3ff; }
    .table tfoot td.left{ background: linear-gradient(90deg, #eaf4ff 0%, #e6f2ff 60%); }
    .tab-toggle{ display:inline-flex; border:1px solid #ddd; border-radius:6px; overflow:hidden; }
    .tab-toggle button{ background:transparent; border:0; padding:6px 10px; cursor:pointer; font-size:13px; }
    .tab-toggle button.active{ background:var(--accent-color,#dfeffd); color:var(--accent-text,#072b52); font-weight:600; }
    /* Budget deviation controls */
    .deviation-controls{ display:inline-flex; gap:6px; align-items:center; padding:4px 8px; border:1px solid #ddd; border-radius:6px; background:#fff; }
    .deviation-toggle{ display:inline-flex; align-items:center; gap:4px; }
    .deviation-toggle input[type="checkbox"]{ cursor:pointer; }
    .deviation-input{ width:50px; padding:4px 6px; border:1px solid #ddd; border-radius:4px; font-size:13px; text-align:center; }
    .deviation-warning{ display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; background:#fff3cd; border:1px solid #ffc107; border-radius:50%; color:#856404; font-size:14px; font-weight:bold; cursor:help; }
  `;

  connectedCallback(){
    super.connectedCallback();
    // Listen for scenario activation so cost view updates to selected scenario
    // Debounce to coalesce duplicate events emitted by multiple managers
    this._onScenarioActivated = ({ scenarioId }) => {
      if(this._scenarioDebounceTimer) clearTimeout(this._scenarioDebounceTimer);
      this._scenarioDebounceTimer = setTimeout(()=>{ this._scenarioDebounceTimer = null; this.loadCostForScenario(scenarioId); }, 60);
    };
    this._subscribe();
    // Don't load data here - wait until open() is called
  }

  _subscribe(){
    if(this._subscribed) return;
    if(this._onScenarioActivated) {
      bus.on(ScenarioEvents.ACTIVATED, this._onScenarioActivated);
      this._subscribed = true;
    }
  }

  _unsubscribe(){
    if(!this._subscribed) return;
    if(this._onScenarioActivated){
      try{ bus.off(ScenarioEvents.ACTIVATED, this._onScenarioActivated); }catch(e){}
    }
    this._subscribed = false;
  }

  /**
   * Format a numeric cell value as a fixed 2-decimal string.
   * Accepts numeric or string-like input and coerces to number.
   * @param {number|string} v
   * @returns {string}
   */
  //fmtCell(v){ return (typeof v === 'number' ? v : Number(v || 0)).toFixed(2); }
  fmtCell(value, decimals = 1) {
    // If the feature flag is on, render exact zeros as empty to de-emphasize them
    if (UIFeatureFlags.MUTE_ZERO_CELLS && (value === 0)) {
      return '';
    }
    if (value == null || value === '') return '';
    const num = Number(value);
    if (Number.isNaN(num)) return String(value);
    return num.toFixed(decimals);
  }

  /**
   * Compute inline style for the left (frozen) project cell. Uses project
   * color and a subtle gradient to aid visual grouping.
   * @param {string|number} pid
   * @returns {string}
   */
  projectLeftStyle(pid){
    const color = (state.projects || []).find(sp=>String(sp.id)===String(pid))?.color || '#ddd';
    // Use ColorService directly
    const projectColor = state._colorService.getProjectColor(pid, state.projects, state.baselineProjects);
    return `background:#fff; background-image:linear-gradient(90deg, ${hexToRgba(projectColor,0.14)} 0px, ${hexToRgba(projectColor,0.06)} 40%, rgba(255,255,255,0) 100%); box-shadow: inset 6px 0 0 ${color};`;
  }

  /**
   * Compute inline style used for feature/epic rows. Shows a subtle
   * gradient and left accent using the feature state color.
   * @param {string} stateColor
   * @returns {string}
   */
  featureBgStyle(stateColor){
    // Normalize input: accept either a hex string or an object { background, text }
    const c = (stateColor && typeof stateColor === 'object') ? (stateColor.background || '') : (stateColor || '');
    return `background:#fff; background-image:linear-gradient(90deg, ${hexToRgba(c,0.14)} 0px, ${hexToRgba(c,0.06)} 40%, rgba(255,255,255,0) 100%); box-shadow: inset 4px 0 0 ${c}; cursor:pointer;`;
  }

  /**
   * Check if an Epic's original allocated budget deviates from the sum of 
   * its children's totals by more than the configured threshold percentage.
   * 
   * Note: When an Epic has children, the table displays the children's sum,
   * but the Epic's original budget (what planners estimated) is preserved
   * for comparison.
   * 
   * @param {Object} epicBase - The epic feature object (contains originalTotal)
   * @param {Array} children - Array of child feature objects
   * @returns {{hasDeviation: boolean, epicOriginal: number, childrenSum: number, deviationPercent: number}}
   */
  checkBudgetDeviation(epicBase, children){
    if(!this.showBudgetDeviations || !children || children.length === 0){
      return { hasDeviation: false, epicOriginal: 0, childrenSum: 0, deviationPercent: 0 };
    }
    
    // Get Epic's original allocated budget (before it was replaced by children sum)
    const epicOriginal = this.viewMode === 'cost' 
      ? (epicBase.originalTotal ?? 0)  // Use nullish coalescing to handle undefined
      : (epicBase.originalTotalHours ?? 0);
    
    // The children sum is what's currently displayed (epicBase.total after replacement)
    const childrenSum = this.viewMode === 'cost' 
      ? (epicBase.total ?? 0) 
      : (epicBase.totalHours ?? 0);
    
    // If both are zero, no deviation
    if(epicOriginal === 0 && childrenSum === 0){
      return { hasDeviation: false, epicOriginal, childrenSum, deviationPercent: 0 };
    }
    
    // If Epic has no original allocation (0), this means all work is allocated to children
    // This is the correct pattern - no deviation warning needed
    if(epicOriginal === 0){
      return { hasDeviation: false, epicOriginal, childrenSum, deviationPercent: 0 };
    }
    
    // Calculate deviation percentage: |original - actual| / original * 100
    const deviationPercent = Math.abs(epicOriginal - childrenSum) / epicOriginal * 100;
    const hasDeviation = deviationPercent > this.deviationThreshold;
    
    return { hasDeviation, epicOriginal, childrenSum, deviationPercent };
  }

  open(){
    const main = document.querySelector('main');
    // Ensure we are subscribed to scenario events when shown
    this._subscribe();
    if(main && !this._savedMainStyles){
      this._savedMainStyles = [];
      Array.from(main.children).forEach(child => {
        if(child === this) return;
        this._savedMainStyles.push({ el: child, display: child.style.display || '' });
        child.style.display = 'none';
      });
    }
    this.style.display = 'block';
    // Reload cost data for current scenario (capacity may have changed)
    this.loadData();
  }

  close(){
    this.style.display = 'none';
    // When closed (hidden but not removed) unsubscribe to avoid background reloads
    this._unsubscribe();
    const main = document.querySelector('main');
    if(main && this._savedMainStyles){
      this._savedMainStyles.forEach(s => { s.el.style.display = s.display; });
      this._savedMainStyles = null;
    }
  }

  async loadData(){
    // Prevent duplicate loads
    if(this._isLoading) return;
    this._isLoading = true;
    
    // Show spinner using the app-level spinner modal
    const spinner = document.getElementById('appSpinner');
    if(spinner){
      spinner.message = 'Loading cost data...';
      spinner.open = true;
    }
    try{
      // Load cost for the currently active scenario if available, otherwise baseline
      const activeId = (state && state.activeScenarioId) ? state.activeScenarioId : 'baseline';
      await this.loadCostForScenario(activeId || 'baseline');
      // If teams tab is enabled, preload teams data
      try{
        if(UIFeatureFlags.SHOW_COST_TEAMS_TAB){
          this.teamsData = await dataService.getCostTeams();
        }
      }catch(e){ console.error('Failed to load cost teams', e); }
    }finally{
      // Hide spinner
      if(spinner) spinner.open = false;
      this._isLoading = false;
    }
  }

  async loadCostForScenario(scenarioId){
    /**
     * Load cost data for a given scenario id. Supports 3 cases:
     * - baseline (cached GET)
     * - saved scenario (GET by id)
     * - unsaved/transient scenario (POST features payload for on-the-fly calc)
     *
     * @param {string} scenarioId
     */
    // Show spinner using the app-level spinner modal
    const spinner = document.getElementById('appSpinner');
    if(spinner){
      spinner.message = 'Loading cost data...';
      spinner.open = true;
    }
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
      let scenario = state?.scenarios ? state.scenarios.find(s => s.id === scenarioId) : null;
      if(!scenario){
        scenario = await dataService.getScenario(scenarioId);
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
      const featuresPayload = (eff || []).map(f => {
        // Capacity must be a list of {team, capacity} objects, not a float
        let capacity = f.capacity;
        if (!Array.isArray(capacity)) {
          capacity = [];
        }
        return {
          id: f.id,
          project: f.project,
          start: f.start,
          end: f.end,
          capacity: capacity,
          title: f.title || f.name || '',
          type: f.type || f.feature_type || '',
          state: f.state || f.status || ''
        };
      });

      const json = await dataService.getCost({ features: featuresPayload });
      if(!json) throw new Error('no cost data for scenario');
      this.data = json;
      this.buildMonths(json.configuration);
      this.buildProjects(json.projects || []);
      this.requestUpdate();
    }catch(e){
      console.error('PluginCost load error', e);
    }finally{
      // Hide spinner
      const spinner = document.getElementById('appSpinner');
      if(spinner) spinner.open = false;
    }
  }

  disconnectedCallback(){
    // Ensure any subscriptions are cleaned up when element is removed
    this._unsubscribe();
    if(this._scenarioDebounceTimer){ clearTimeout(this._scenarioDebounceTimer); this._scenarioDebounceTimer = null; }
    if(super.disconnectedCallback) super.disconnectedCallback();
  }

  /**
   * Wrapper to build months for the component from configuration.
   * @param {Object} cfg - configuration object with dataset_start/dataset_end
   * @returns {void}
   */
  buildMonths(cfg){
    this.months = buildMonths(cfg);
  }

  /**
   * Build projects using calculator helpers and store footer hour totals.
   * @param {Array} projects
   * @returns {void}
   */
  buildProjects(projects){
    const res = buildProjects(projects, this.months || [], state);
    this.projects = res.projects;
    this._footerHours = res.footerHours;
    this._footerTotalHours = +(res.footerTotalHours.toFixed ? res.footerTotalHours.toFixed(2) : Number(res.footerTotalHours) || 0);
  }

  /**
   * Check if a project has any Epic with budget deviations.
   * @param {Object} project - The project object with features
   * @returns {boolean}
   */
  projectHasDeviations(project){
    if(!this.showBudgetDeviations || !project || !project.features) return false;
    
    // Build epic map to identify which features are epics with children
    const epicMap = new Map();
    for(const f of project.features || []){
      const eff = state.getEffectiveFeatureById ? state.getEffectiveFeatureById(f.id) : null;
      const parent = eff && (eff.parentEpic || eff.parentEpic === 0) ? eff.parentEpic : (f.parentEpic || null);
      if(parent){
        if(!epicMap.has(parent)) epicMap.set(parent, []);
        epicMap.get(parent).push({ base: f, eff });
      } else {
        const children = state.childrenByEpic && state.childrenByEpic.get && state.childrenByEpic.get(f.id);
        if(children && children.length){
          if(!epicMap.has(f.id)) epicMap.set(f.id, []);
        }
      }
    }
    
    // Check each epic for deviations
    for(const f of project.features || []){
      if(epicMap.has(f.id)){
        const epicChildren = epicMap.get(f.id) || [];
        const deviation = this.checkBudgetDeviation(f, epicChildren);
        if(deviation.hasDeviation) return true;
      }
    }
    
    return false;
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

  /**
   * Render the teams tab view showing team-level summaries and members.
   * Accepts several server shapes (array, object with `teams`, or map).
   * @returns {import('lit').TemplateResult}
   */

  render(){
    if(!this.data) return html`<div></div>`;
    const months = this.months || [];
    const monthKeys = months.map(m=>monthKey(m));
    // Use ColorService directly
    const stateColors = state._colorService ? state._colorService.getFeatureStateColors(state.availableFeatureStates) : {};
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
    
    // Filter out months where all rows have zero values
    const nonZeroMonthIndices = [];
    const nonZeroMonths = [];
    const nonZeroMonthKeys = [];
    for(let i = 0; i < monthKeys.length; i++){
      const k = monthKeys[i];
      const hasValue = (this.viewMode === 'cost') 
        ? (footerInternal[k] + footerExternal[k]) > 0
        : (this._footerHours.internal[k] + this._footerHours.external[k]) > 0;
      if(hasValue){
        nonZeroMonthIndices.push(i);
        nonZeroMonths.push(months[i]);
        nonZeroMonthKeys.push(k);
      }
    }
    
    // Use filtered months for rendering
    const displayMonths = nonZeroMonths.length > 0 ? nonZeroMonths : months;
    const displayMonthKeys = nonZeroMonthKeys.length > 0 ? nonZeroMonthKeys : monthKeys;
    
    // Update host attribute to control Total column positioning
    if(!this.showBudgetDeviations){
      this.setAttribute('no-deviation', '');
    } else {
      this.removeAttribute('no-deviation');
    }
    
    return html`
      <div>
        <div class="controls">
          <div style="display:flex; gap:8px; align-items:center;">
            <div class="toggle" role="tablist" aria-label="View mode">
              <button class=${this.viewMode==='cost' ? 'active':''} @click=${()=>{ this.viewMode='cost'; this.requestUpdate(); }}>Cost</button>
              <button class=${this.viewMode==='hours' ? 'active':''} @click=${()=>{ this.viewMode='hours'; this.requestUpdate(); }}>Hours</button>
            </div>
            ${UIFeatureFlags.SHOW_COST_TEAMS_TAB ? html`<div class="tab-toggle"><button class=${this.activeTab==='cost' ? 'active':''} @click=${()=>{ this.activeTab='cost'; this.requestUpdate(); }}>Cost Table</button><button class=${this.activeTab==='teams' ? 'active':''} @click=${async ()=>{ this.activeTab='teams'; if(!this.teamsData){ this.teamsData = await dataService.getCostTeams().catch(e=>{ console.error('Failed to load cost teams', e); return []; }); } this.requestUpdate(); }}>Teams</button></div>` : ''}
            <div class="deviation-controls">
              <div class="deviation-toggle">
                <input type="checkbox" id="deviation-check" 
                       ?checked=${this.showBudgetDeviations}
                       @change=${(e)=>{ this.showBudgetDeviations = e.target.checked; this.requestUpdate(); }}/>
                <label for="deviation-check" style="font-size:13px; cursor:pointer;">Budget Deviations</label>
              </div>
              <input type="number" class="deviation-input" 
                     min="0" max="100" step="1"
                     .value=${this.deviationThreshold}
                     @input=${(e)=>{ this.deviationThreshold = parseInt(e.target.value) || 10; this.requestUpdate(); }}
                     placeholder="%"
                     title="Deviation threshold percentage"/>%
            </div>
          </div>
        </div>
        <div class="legend">
          ${(() => {
            // Use ColorService directly
            const stateColors = state._colorService.getFeatureStateColors(state.availableFeatureStates);
            const keys = Object.keys(stateColors);
            return keys.map(s => {
              const c = stateColors[s].background;
              const text = stateColors[s].text;
              return html`<div class="legend-item"><span class="swatch" style="background:${c}; border:1px solid #eee"></span><span style="color:${text}">${s}</span></div>`;
            });
          })()}
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
                ${displayMonths.map(m=>html`<th colspan="2">${monthLabel(m)}</th>`) }
                <th class="total-head right-total" rowspan="2">Total</th>
                ${this.showBudgetDeviations ? html`<th class="total-extra right-extra" rowspan="2"></th>` : ''}
              </tr>
              <tr>
                ${displayMonths.map(m=>html`<th>Int</th><th>Ext</th>`) }
              </tr>
            </thead>
            <tbody>
              ${this.projects.map(p=>{
                const projectDeviation = this.projectHasDeviations(p);
                const projectDeviationIndicator = projectDeviation ? html`<span class="deviation-warning" title="This project contains Epics with budget deviations">⚠</span>` : '';
                return html`
                <tr class="project-row" @click=${()=>this.toggleProject(p.id)}>
                        <td class="left" style=${this.projectLeftStyle(p.id)}>${p.name}</td>
                  ${displayMonthKeys.map(k=>html`<td>${this.fmtCell(this.viewMode==='cost' ? (p.totals.internal[k]||0) : (p.totals.hours.internal[k]||0))}</td><td>${this.fmtCell(this.viewMode==='cost' ? (p.totals.external[k]||0) : (p.totals.hours.external[k]||0))}</td>`) }
                  <td class="total-cell right-total">${this.fmtCell(this.viewMode==='cost' ? p.total : (p.totalHours||0))}</td>
                  ${this.showBudgetDeviations ? html`<td class="right-extra">${projectDeviationIndicator}</td>` : ''}
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
                        const epicEff = state.getEffectiveFeatureById ? state.getEffectiveFeatureById(epicBase.id) : null;
                        const epicStateName = (epicEff && epicEff.state) ? epicEff.state : (epicBase.state || '');
                        // Use ColorService directly
                        const epicStateColor = state._colorService.getFeatureStateColor(epicStateName);
                        // Check for budget deviation
                        const deviation = this.checkBudgetDeviation(epicBase, epicChildren);
                        const deviationIndicator = deviation.hasDeviation ? html`<span class="deviation-warning" title="Budget deviation: Epic allocated ${this.viewMode==='cost'?'cost':'hours'} (${this.fmtCell(deviation.epicOriginal)}) differs from children sum (${this.fmtCell(deviation.childrenSum)}) by ${deviation.deviationPercent.toFixed(1)}%">⚠</span>` : '';
                        rendered.push(html`<tr class="epic-row" @click=${()=>this.toggleEpic(epicBase.id)}><td class="left" style="${this.featureBgStyle(epicStateColor)}">&nbsp;&nbsp;<span class="feat-icon">📁</span>${epicBase.name}</td>${displayMonthKeys.map(k=>html`<td>${this.fmtCell(this.viewMode==='cost' ? (epicBase.values?.internal?.[k]||0) : (epicBase.hours?.internal?.[k]||0))}</td><td>${this.fmtCell(this.viewMode==='cost' ? (epicBase.values?.external?.[k]||0) : (epicBase.hours?.external?.[k]||0))}</td>`) }<td class="total-cell right-total">${this.fmtCell(this.viewMode==='cost' ? (epicBase.total||0) : (epicBase.totalHours||0))}</td>${this.showBudgetDeviations ? html`<td class="right-extra">${deviationIndicator}</td>` : ''}</tr>`);
                        if(this.expandedEpics.has(f.id)){
                          for(const child of epicChildren){
                            const fb = child.base;
                            const effState = (child.eff && child.eff.state) ? child.eff.state : (state.getEffectiveFeatureById ? (state.getEffectiveFeatureById(fb.id) || {}).state : null);
                            const stateName = effState || fb.state || '';
                            // Use ColorService directly
                            const base = state._colorService.getFeatureStateColor(stateName);
                            const bg = hexToRgba(base, 0.10);
                            rendered.push(html`<tr class="feature-row"><td class="left nested-feature" style="${this.featureBgStyle(base)}" @click=${(ev)=>{ ev.stopPropagation(); const feat = state.getEffectiveFeatureById(fb.id); bus.emit(UIEvents.DETAILS_SHOW, feat); }}>&nbsp;&nbsp;&nbsp;&nbsp;<span class="feat-icon" title="Feature">🔹</span>${fb.name}</td>${displayMonthKeys.map(k=>html`<td style="background:${bg};">${this.fmtCell(this.viewMode==='cost' ? (fb.values.internal[k]||0) : (fb.hours.internal[k]||0))}</td><td style="background:${bg};">${this.fmtCell(this.viewMode==='cost' ? (fb.values.external[k]||0) : (fb.hours.external[k]||0))}</td>`) }<td class="total-cell right-total" style="background:${bg};">${this.fmtCell(this.viewMode==='cost' ? fb.total : (fb.totalHours||0))}</td>${this.showBudgetDeviations ? html`<td class="right-extra" style="background:${bg};"></td>` : ''}</tr>`);
                          }
                        }
                      }
                    }
                    // Render standalone features that are not part of any epic
                    for(const s of standalone){
                      // if this standalone is actually an epic (has children) it was already rendered
                      if(epicMap.has(s.base.id)) continue;
                      const fb = s.base;
                      const effState = (s.eff && s.eff.state) ? s.eff.state : (state.getEffectiveFeatureById ? (state.getEffectiveFeatureById(fb.id) || {}).state : null);
                      const stateName = effState || fb.state || '';
                      // Use ColorService directly
                      const base = state._colorService.getFeatureStateColor(stateName);
                      const bg = hexToRgba(base, 0.10);
                      rendered.push(html`<tr class="feature-row"><td class="left" style="${this.featureBgStyle(base)}" @click=${(ev)=>{ ev.stopPropagation(); const feat = state.getEffectiveFeatureById(fb.id); bus.emit(UIEvents.DETAILS_SHOW, feat); }}>&nbsp;&nbsp;<span class="feat-icon" title="Feature">🔹</span>${fb.name}</td>${displayMonthKeys.map(k=>html`<td style="background:${bg};">${this.fmtCell(this.viewMode==='cost' ? (fb.values.internal[k]||0) : (fb.hours.internal[k]||0))}</td><td style="background:${bg};">${this.fmtCell(this.viewMode==='cost' ? (fb.values.external[k]||0) : (fb.hours.external[k]||0))}</td>`) }<td class="total-cell right-total" style="background:${bg};">${this.fmtCell(this.viewMode==='cost' ? fb.total : (fb.totalHours||0))}</td>${this.showBudgetDeviations ? html`<td class="right-extra" style="background:${bg};"></td>` : ''}</tr>`);
                    }
                    return rendered;
                  })() : ''}
              `;
              })}}
            </tbody>
            <tfoot>
              <tr>
                <td class="left">Totals</td>
                ${displayMonthKeys.map(k=>html`<td>${this.fmtCell(this.viewMode==='cost' ? (footerInternal[k]||0) : (this._footerHours? (this._footerHours.internal[k]||0): 0))}</td><td>${this.fmtCell(this.viewMode==='cost' ? (footerExternal[k]||0) : (this._footerHours? (this._footerHours.external[k]||0): 0))}</td>`)}
                <td class="total-cell right-total">${this.fmtCell(this.viewMode==='cost' ? combinedTotal : (this._footerTotalHours||0))}</td>
                ${this.showBudgetDeviations ? html`<td class="right-extra"></td>` : ''}
              </tr>
            </tfoot>
            </table>
          </div>
        `}
      </div>
    `;
  }

  /**
   * Render a teams-oriented view for cost allocation. Handles multiple
   * shapes returned by the server and renders member rows with budget
   * and hourly totals.
   * @returns {import('lit').TemplateResult}
   */
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
