import { LitElement, html, css } from '../vendor/lit.js';
import { state, PALETTE } from '../services/State.js';
import { dataService } from '../services/dataService.js';
import { bus } from '../core/EventBus.js';
import { ProjectEvents, TeamEvents, ViewEvents, FilterEvents, StateFilterEvents, TimelineEvents } from '../core/EventRegistry.js';
import { initViewOptions } from './viewOptions.js';
import { ColorPopoverLit } from '../components/ColorPopover.lit.js';
import { SidebarPersistenceService } from '../services/SidebarPersistenceService.js';

export class SidebarLit extends LitElement {
  static properties = {
    open: { type: Boolean },
    projects: { type: Array },
    teams: { type: Array },
    serverStatus: { type: String },
    serverName: { type: String },
  };

  static styles = css`
    :host { display:block; }
    /* Keep component-specific small tweaks; main styles come from www/css/main.css */
    //  .chip { display:flex; gap:8px; align-items:center; padding:6px; border-radius:6px; cursor:pointer; }
    //  .chip.active { opacity: 0.95; }
    //  .color-dot { width:16px; height:16px; border-radius:4px; flex:0 0 auto; }
    //  .chip-badge { padding:2px 6px; border-radius:10px; font-size:12px; background: rgba(255,255,255,0.06); }
    /* Make the last two columns square so icons can be square boxes and match main.css */
    .counts-header { 
       display:grid;
       grid-template-columns: 24px 28px 1fr 58px 31px;
       align-items:center;
       gap:8px;
       //margin-bottom:4px;
       color:#ddd;
       //min-height:32px;
    }
    /* Use a compact 16x16 icon container and center it within the grid cell. */
    .type-icon { display:inline-flex; align-items:center; }
    .type-icon.epic { color: #ffcf33; margin-left:30px; }
    /* Let the svg fill the 16x16 container */
    .type-icon svg { width: 16px; height: 16px; display: block; }
    .group-title { font-weight:700; font-size:12px; margin:6px 0 10px; color:#3b3b3b; }
    .plans-group .sidebar-list { margin-top:4px; margin-bottom:4px; }
    .divider { border-top:1px dashed rgba(255,255,255,1); margin:10px 0; border-radius:2px; height:0; }
    /* Sidebar container styles (migrated from www/css/main.css) */
    .sidebar {
      width: var(--sidebar-width);
      min-width: var(--sidebar-width);
      background: var(--color-sidebar-bg);
      color: var(--color-sidebar-text);
      padding: 16px 12px;
      display: flex;
      flex-direction: column;
      gap: 18px;
      position: relative;
      z-index: var(--z-sidebar);
      font-size: 14px;
      overflow-y: auto;
      padding-bottom: 96px;
      height: 100vh;
    }

    .sidebar-content { overflow: auto; max-height: calc(100vh - 160px); padding-bottom: 12px; }
    .sidebar h2 { margin:0 0 8px; font-size:1.1rem; }
    .sidebar-section { margin-bottom:12px; }
    .sidebar-section h3 { margin:0 0 6px; font-size:0.93rem; }
    .sidebar-list { list-style:none; margin:0; padding:0; }
    .sidebar-list-item { display:flex; align-items:center; }
    .sidebar-section-collapsed { display:none; }
    .sidebar-section-header-collapsible {
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      user-select: none;
      font-weight: 600;
      margin-bottom: 4px;
      font-size: 1rem;
    }
    .sidebar-section-header {
      display: flex;
      align-items: center;
      gap: 8px;
      user-select: none;
      font-weight: 600;
      margin-bottom: 4px;
      font-size: 1rem;
    }
    .sidebar-chevron { font-size: 1.1em; margin-right: 4px; cursor: pointer; transition: transform 0.15s; }
    .sidebar-title { flex: 1; }
    /* Chips, list and control styles (migrated from main.css) */
    .chip-group { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0; }
    .chip-group .group-label { width:100%; font-weight:600; font-size:0.85rem; opacity:0.9; }
    .chip { display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:16px; border:1px solid rgba(255,255,255,0.25); color:var(--color-sidebar-text); background:rgba(255,255,255,0.08); cursor:pointer; font-size:0.8rem; line-height:1; user-select:none; transition: background 120ms ease, color 120ms ease, box-shadow 120ms ease; }
    .chip:hover { background:rgba(255,255,255,0.14); }
    /* Active state: match when class is present or when ARIA attributes indicate pressed/checked */
    .chip.active, .chip[aria-pressed="true"], .chip[aria-checked="true"] {
      background:#fff;
      color:#23344d;
      border-color:#fff;
      box-shadow: 0 0 0 1px rgba(0,0,0,0.06) inset, 0 1px 3px rgba(0,0,0,0.06);
      //font-weight:600;
    }
    /* Make inactive chips slightly muted so active state stands out */
    .chip:not(.active):not([aria-pressed="true"]):not([aria-checked="true"]) { opacity:0.95; }
    .chip-badge { display:inline-flex; align-items:center; justify-content:center; width:30px; height:18px; border-radius:9px; font-size:0.7rem; font-weight:700; background:rgba(0,0,0,0.12); color:#fff; }
    .chip.active .chip-badge { background:#23344d; color:#fff; }
    .chip:focus-visible { outline:2px solid #5cc8ff; outline-offset:2px; }

    /* Sidebar-specific chips and lists */
    .sidebar-chip { padding:0 8px 0 0; border-radius:10px; background:transparent; border:1px solid rgba(0,0,0,0.06); box-sizing:border-box; min-height:25px; overflow:hidden; display:flex; align-items:stretch; }
    .sidebar-chip:hover, .sidebar-chip.chip-hover { background: rgba(255,255,255,0.18); cursor: pointer; }
    .sidebar-chip.active { background: transparent; border-color: transparent; background: rgb(55, 85, 130); }
    .sidebar-chip.active:hover { background: rgba(255,255,255,0.18); }
    .sidebar-list { list-style:none; padding:0; display:flex; flex-direction:column; gap:4px; }
    .sidebar-list-item { display:block; }
    .sidebar-list .color-dot { width:28px; border-radius:6px 0 0 6px; display:inline-block; flex:0 0 28px; align-self:stretch; cursor: pointer; }
    .sidebar-chip .project-name-col, .sidebar-chip .team-name-col { padding-left:8px; font-weight:600; font-size:0.8rem; color:var(--color-sidebar-text); }
    .chip-badge.small { font-size:0.75rem; min-width:20px; padding:0 6px; }
    .sidebar-chip .chip-badge { background: rgba(0,0,0,0.06); color: var(--color-sidebar-text); }

    /* Toggle and list controls */
    .list-toggle { display:flex; align-items:center; justify-content:center; }
    .list-toggle-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 50px;
      height: 16px;
      border: 1px solid #5481e6;
      color: #5cc8ff;
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
      margin-left: 3px;
    }

    /* Sidebar footer/config */
    .sidebar-config { position:fixed; bottom:0; left:0; width: var(--sidebar-width); padding-left: 12px; background: var(--color-sidebar-bg); z-index: 1000; }
    #openConfigBtn { background:#f7f7f7; border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:6px 10px; cursor:pointer; color:#333; }
    #openConfigBtn:hover { background:#eee; }
    #openHelpBtn { background:#f7f7f7; border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:6px 10px; cursor:pointer; color:#333; margin-left:8px; }
    #openHelpBtn:hover { background:#eee; }
    /* View options and segmented control (migrated from main.css -> viewOptions.js) */
    .view-option-section { margin: 12px 0; }
    .group-label { font-weight: 600; font-size: 0.85rem; opacity: 0.9; margin-bottom: 6px; }

    .segmented-control {
      display: flex;
      border-radius: 16px;
      overflow: hidden;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.25);
    }

    .segment {
      flex: 1;
      padding: 0;
      border: none;
      background: transparent;
      color: var(--color-sidebar-text);
      font-size: 0.8rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      border-right: 1px solid rgba(255, 255, 255, 0.15);
      user-select: none;
      line-height: 1;
      padding-top: 6px;
      padding-bottom: 6px;
    }

    .segment:last-child { border-right: none; }
    .segment:hover:not(.active) { background: rgba(255, 255, 255, 0.14); }
    .segment.active { background: white; color: black; }
    .segment.first { border-top-left-radius: 7px; border-bottom-left-radius: 7px; }
    .segment.last { border-top-right-radius: 7px; border-bottom-right-radius: 7px; }
    .segment:focus-visible { outline: 2px solid #5cc8ff; outline-offset: -2px; z-index: 1; }

    /* Accent-enabled chip variant */
    .chip-with-accent.active { background: #fff; color: #23344d; border-left-color: var(--chip-accent); border-right-color: var(--chip-accent); border-left-style: solid; border-right-style: solid; border-left-width: 8px; border-right-width: 8px; }
    .chip-with-accent.active .chip-badge { background: #23344d; color: #fff; }
    .chip-with-accent:focus-visible { outline-offset: 2px; }
    .chip-with-accent::before, .chip-with-accent::after { box-shadow: 0 0 0 1px rgba(0,0,0,0.06) inset; }
    /* Scenario list styling */
    .scenario-item { padding:4px 6px; border-radius:6px; width:100%; display:flex; align-items:center; gap:8px; box-sizing:border-box; position:relative; }
    .scenario-item.active { background:rgba(255,255,255,0.18); }
    .scenario-name { cursor:pointer; flex:1 1 auto; font-weight:600; font-size:0.85rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .scenario-controls { display:inline-flex; gap:4px; align-items:center; position:absolute; right:6px; top:50%; transform:translateY(-50%); }
    .scenario-name { padding-right:56px; }
    .scenario-btn { background:#f7f7f7; border:1px solid var(--color-border); border-radius:4px; padding:2px 6px; cursor:pointer; font-size:0.75rem; line-height:1; }
    .scenario-btn:hover { background:#ececec; }
    .scenario-lock { font-size:0.9rem; margin-right:4px; }
    .scenario-menu-popover { position:absolute; background:#fff; color:#222; border:1px solid var(--color-border); border-radius:6px; box-shadow:0 4px 16px rgba(0,0,0,0.18); padding:6px 0; display:flex; flex-direction:column; min-width:160px; z-index:1200; }
    .scenario-menu-item { padding:6px 12px; font-size:0.8rem; cursor:pointer; display:flex; align-items:center; gap:6px; }
    .scenario-menu-item:hover { background:#f3f5f7; }
    .scenario-menu-item.disabled { color:#999; cursor:default; }
    .scenario-annotate-table { width:100%; border-collapse:collapse; margin-top:8px; }
    .scenario-annotate-table th, .scenario-annotate-table td { border:1px solid var(--color-border); padding:6px 8px; font-size:0.85rem; }
    .scenario-annotate-table th { background:#f7f7f7; text-align:left; }

    /* View list styling - matching scenario styling */
    .view-item { padding:4px 6px; border-radius:6px; width:100%; display:flex; align-items:center; gap:8px; box-sizing:border-box; position:relative; }
    .view-item.active { background:rgba(255,255,255,0.18); }
    .view-name { cursor:pointer; flex:1 1 auto; font-weight:600; font-size:0.85rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding-right:56px; }
    .view-controls { display:inline-flex; gap:4px; align-items:center; position:absolute; right:6px; top:50%; transform:translateY(-50%); }
    .view-btn { background:#f7f7f7; border:1px solid var(--color-border); border-radius:4px; padding:2px 6px; cursor:pointer; font-size:0.75rem; line-height:1; }
    .view-btn:hover { background:#ececec; }
    /* Tools list styling (migrated from www/css/main.css) */
    /* Plugin/tool buttons render as .chip.sidebar-chip inside #toolsList */
    #toolsList { margin-top:6px; display:flex; flex-direction:column; gap:2px; }
    #toolsList .sidebar-list-item { display:block; }
    #toolsList .sidebar-chip { padding:6px 8px; border-radius:8px; background:transparent; border:1px solid rgba(255,255,255,0.14); color:var(--color-sidebar-text); font-weight:600; font-size:0.85rem; }
    #toolsList .sidebar-chip:hover { background: rgba(255,255,255,0.06); cursor:pointer; }
    #toolsList .sidebar-chip:focus-visible { outline:2px solid #5cc8ff; outline-offset:2px; }
    #toolsList .chip-icon { width:18px; height:18px; display:inline-flex; align-items:center; justify-content:center; margin-right:8px; flex:0 0 18px; }
    #toolsList .plugin-meta { color: rgba(255,255,255,0.85); font-size:0.8rem; margin-left:auto; }
    /* Match active style to scenario items for consistency */
    #toolsList .sidebar-chip.active { background: rgba(255,255,255,0.18); color: var(--color-sidebar-text); border-color: transparent; }
  `;

  constructor(){
    super();
    this.open = true;
    this.projects = [];
    this.teams = [];
    this.serverStatus = 'loading';
    this.serverName = null;
    this._persistenceService = new SidebarPersistenceService(dataService);
  }

  connectedCallback(){
    super.connectedCallback();
    this._onProjectsChanged = (projects) => { this.projects = projects ? [...projects] : []; };
    this._onTeamsChanged = (teams) => { this.teams = teams ? [...teams] : []; };

    bus.on(ProjectEvents.CHANGED, this._onProjectsChanged);
    bus.on(TeamEvents.CHANGED, this._onTeamsChanged);

    // Save when view options or filters change
    this._viewOptionChangeHandler = () => this._saveSidebarState();
    bus.on(ViewEvents.CONDENSED, this._viewOptionChangeHandler);
    bus.on(ViewEvents.DEPENDENCIES, this._viewOptionChangeHandler);
    bus.on(ViewEvents.CAPACITY_MODE, this._viewOptionChangeHandler);
    bus.on(ViewEvents.SORT_MODE, this._viewOptionChangeHandler);
    bus.on(ViewEvents.PARENT_CHILD_TREE, this._viewOptionChangeHandler);
    bus.on(ViewEvents.DEPENDENCY_LINKS, this._viewOptionChangeHandler);
    bus.on(ViewEvents.UNLINKED_TASKS, this._viewOptionChangeHandler);
    bus.on(ViewEvents.TEAM_ALLOCATIONS, this._viewOptionChangeHandler);
    bus.on(FilterEvents.CHANGED, this._viewOptionChangeHandler);
    bus.on(StateFilterEvents.CHANGED, this._viewOptionChangeHandler);
    bus.on(TimelineEvents.SCALE_CHANGED, this._viewOptionChangeHandler);

    // Initialize from state if available
    try {
      this._onProjectsChanged(state.projects);
      this._onTeamsChanged(state.teams);
    } catch (e) { /* ignore */ }

    // Refresh server status asynchronously
    this.refreshServerStatus();
  }

  disconnectedCallback(){
    if (this._onProjectsChanged) bus.off(ProjectEvents.CHANGED, this._onProjectsChanged);
    if (this._onTeamsChanged) bus.off(TeamEvents.CHANGED, this._onTeamsChanged);
    if (this._viewOptionChangeHandler) {
      bus.off(ViewEvents.CONDENSED, this._viewOptionChangeHandler);
      bus.off(ViewEvents.DEPENDENCIES, this._viewOptionChangeHandler);
      bus.off(ViewEvents.CAPACITY_MODE, this._viewOptionChangeHandler);
      bus.off(ViewEvents.SORT_MODE, this._viewOptionChangeHandler);
      bus.off(ViewEvents.PARENT_CHILD_TREE, this._viewOptionChangeHandler);
      bus.off(ViewEvents.DEPENDENCY_LINKS, this._viewOptionChangeHandler);
      bus.off(ViewEvents.UNLINKED_TASKS, this._viewOptionChangeHandler);
      bus.off(ViewEvents.TEAM_ALLOCATIONS, this._viewOptionChangeHandler);
      bus.off(FilterEvents.CHANGED, this._viewOptionChangeHandler);
      bus.off(StateFilterEvents.CHANGED, this._viewOptionChangeHandler);
      bus.off(TimelineEvents.SCALE_CHANGED, this._viewOptionChangeHandler);
      this._viewOptionChangeHandler = null;
    }
    super.disconnectedCallback();
  }

  async refreshServerStatus(){
    try{
      // best-effort; dataService may not be available in all test contexts
      const { dataService } = await import('../services/dataService.js');
      const h = await dataService.checkHealth();
      const status = h.status || (h.ok ? 'ok' : 'error');
      this.serverName = h.server_name || null;
      this.serverStatus = `Version: ${h.version} | Server: ${status}`;
    }catch(err){
      this.serverStatus = 'Server: unavailable';
    }
    this.requestUpdate();
  }

  toggleProject(pid){
    const current = (this.projects || []).find(p=>p.id===pid);
    const newVal = !(current && current.selected);
    state.setProjectSelected(pid, newVal);
    this._saveSidebarState();
  }

  toggleTeam(tid){
    const current = (this.teams || []).find(t=>t.id===tid);
    const newVal = !(current && current.selected);
    state.setTeamSelected(tid, newVal);
    this._saveSidebarState();
  }

  _renderEntityList(type, items, onToggle){
    return html`${items.map(item => html`
      <li class="sidebar-list-item">
        <div class="chip sidebar-chip ${item.selected? 'active':''}" @click=${(e)=> { if(!e.target.closest('.color-dot')) onToggle(item.id); }}>
          <span class="color-dot" style="background:${item.color}" @click=${(e) => this._openColorPopover(e, type, item.id)}></span>
          <div style="padding-left:8px;font-weight:600">${item.name}</div>
          <div style="margin-left:auto;display:inline-flex;gap:6px;align-items:center;">
            <span class="chip-badge">${type==='project' ? state.countEpicsForProject(item.id) : state.countEpicsForTeam(item.id)}</span>
            <span class="chip-badge">${type==='project' ? state.countFeaturesForProject(item.id) : state.countFeaturesForTeam(item.id)}</span>
          </div>
        </div>
      </li>
    `)}`;
  }

  async _openColorPopover(e, type, id){
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const cp = await ColorPopoverLit.ensureInstance(PALETTE);
    await cp.updateComplete;
    cp.openFor(type, id, rect);
  }

  renderPlansGrouped(){
    const all = this.projects || [];
    const delivery = all.filter(p => (p.type || 'project') === 'project');
    const teamBacklogs = all.filter(p => (p.type || 'project') !== 'project');
    return html`
      <div class="plans-group">
        ${delivery.length ? html`<ul class="sidebar-list">${this._renderEntityList('project', delivery, (id) => this.toggleProject(id))}</ul>` : ''}
        ${teamBacklogs.length ? html`<ul class="sidebar-list">${this._renderEntityList('project', teamBacklogs, (id) => this.toggleProject(id))}</ul>` : ''}
      </div>`;
  }

  renderTeams(){
    return this._renderEntityList('team', this.teams || [], (id) => this.toggleTeam(id));
  }

  renderSelectedItemsLegend(){
    const selectedProjects = (this.projects || []).filter(p => p.selected);
    const selectedTeams = (this.teams || []).filter(t => t.selected);
    if (selectedProjects.length === 0 && selectedTeams.length === 0) {
      return html`<div style="font-size:13px;color:rgba(255,255,255,0.6);padding:8px 0;">No items selected</div>`;
    }
    return html`
      <div class="legend-chips" style="display:flex;flex-wrap:wrap;gap:8px;padding:8px 0;">
        ${selectedProjects.map(p => html`<div style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:12px;background:rgba(255,255,255,0.08);font-size:12px;"><span style="width:12px;height:12px;border-radius:3px;background:${p.color}"></span><span>${p.name}</span></div>`) }
        ${selectedTeams.map(t => html`<div style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:12px;background:rgba(255,255,255,0.08);font-size:12px;"><span style="width:12px;height:12px;border-radius:3px;background:${t.color}"></span><span>${t.name}${t.short ? ` (${t.short})` : ''}</span></div>`) }
      </div>
    `;
  }

  _saveSidebarState() {
    if (!this._persistenceService) return;
    this._persistenceService.saveSidebarState(state, state._viewService, this);
  }

  async _restoreSidebarState() {
    if (!this._persistenceService) return;
    await this._persistenceService.restoreSidebarState(state, state._viewService, this);
  }

  firstUpdated(){
    const container = this.shadowRoot.querySelector('#viewOptionsContainer');
    if(container) initViewOptions(container);
  }

  render(){
    return html`
      <aside class="sidebar ${this.open? '' : 'closed'}">
        <h2>Planner Tool</h2>
        <div class="sidebar-content">
          <section class="sidebar-section" id="viewOptionsSection">
            <div class="sidebar-section-header-collapsible"><span class="sidebar-chevron">▼</span><span class="sidebar-title">View Options</span></div>
            <div><div id="viewOptionsContainer"></div></div>
          </section>

          <section class="sidebar-section" id="selectedItemsSection">
            <div class="sidebar-section-header-collapsible"><span class="sidebar-chevron">▼</span><span class="sidebar-title">Selected Items</span></div>
            <div>${this.renderSelectedItemsLegend()}</div>
          </section>

        </div>
        <section class="sidebar-config">
          <div id="serverStatusLabel" style="font-size:12px; margin-top:8px;">${this.serverStatus}</div>
          <div id="attributionLabel" style="font-size:9px; margin-top:8px;">(c) 2025-2026 Planner Tool${this.serverName ? ' — ' + this.serverName : ''}</div>
        </section>
      </aside>
    `;
  }
}

customElements.define('app-sidebar', SidebarLit);

export async function initSidebar(){
  if (!document.querySelector('app-sidebar')){
    const el = document.createElement('app-sidebar');
    document.body.appendChild(el);
  }
}
