import { LitElement, html, css } from '../vendor/lit.js';
import { state, PALETTE } from '../services/State.js';
import { bus } from '../core/EventBus.js';
import { ProjectEvents, TeamEvents, ScenarioEvents, DataEvents, PluginEvents, ViewEvents, ViewManagementEvents, FilterEvents, StateFilterEvents, TimelineEvents, FeatureEvents } from '../core/EventRegistry.js';
import { dataService } from '../services/dataService.js';
import { initViewOptions } from './viewOptions.js';
import { ColorPopoverLit } from '../components/ColorPopover.lit.js';
import { pluginManager } from '../core/PluginManager.js';
import { isEnabled } from '../config.js';
import { SidebarPersistenceService } from '../services/SidebarPersistenceService.js';
import { epicTemplate, featureTemplate } from '../services/IconService.js';

export class SidebarLit extends LitElement {
  static properties = {
    open: { type: Boolean },
    projects: { type: Array },
    teams: { type: Array },
    scenarios: { type: Array },
    activeScenarioId: { type: String },
    views: { type: Array },
    activeViewId: { type: String },
    activeViewData: { type: Object },
    serverStatus: { type: String },
    serverName: { type: String },
  };

  static styles = css`
    :host { display:block; }
    /* Keep component-specific small tweaks; main styles come from www/css/main.css */
    .chip { display:flex; gap:8px; align-items:center; padding:6px; border-radius:6px; cursor:pointer; }
    .chip.active { opacity: 0.95; }
    .color-dot { width:16px; height:16px; border-radius:4px; flex:0 0 auto; }
    .chip-badge { padding:2px 6px; border-radius:10px; font-size:12px; background: rgba(255,255,255,0.06); }
    /* Make the last two columns square so icons can be square boxes */
    .counts-header { display:grid; grid-template-columns: 24px 28px 1fr 32px 32px; align-items:center; gap:8px; margin-bottom:4px; color:#ddd; min-height:32px; }
    .type-icon { display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; box-sizing:border-box; }
    .type-icon svg { width: 100%; height: 100%; display: block; }
    .group-title { font-weight:700; font-size:12px; margin:6px 0 10px; color:#3b3b3b; }
    .plans-group .sidebar-list { margin-top:10px; margin-bottom:12px; }
    .divider { border-top:1px dashed rgba(255,255,255,1); margin:10px 0; border-radius:2px; height:0; }
  `;

  constructor(){
    super();
    this.open = true;
    this.serverStatus = 'loading';
    this.serverName = null;
    this._persistenceService = new SidebarPersistenceService(dataService);
    this._didRestoreSidebarState = false;

    // Reactive properties
    this.projects = [];
    this.teams = [];
    this.scenarios = [];
    this.activeScenarioId = null;
    this.views = [];
    this.activeViewId = null;
    this.activeViewData = null;
  }

  // Render into light DOM so legacy selectors (IDs) can still be used if needed.
  createRenderRoot(){ return this; }

  connectedCallback(){
    super.connectedCallback();
    // Wire event handlers to update reactive properties
    this._onProjectsChanged = (projects) => { this.projects = projects ? [...projects] : []; };
    this._onTeamsChanged = (teams) => { this.teams = teams ? [...teams] : []; };
    this._onScenariosList = (payload) => {
      // Use the authoritative scenario objects from `state.scenarios` so
      // the UI has access to `overrides` and `isChanged` flags. The
      // ScenarioEvents.LIST payload contains reduced metadata for lists,
      // which would strip overrides and unsaved markers.
      try {
        const full = state.scenarios || [];
        this.scenarios = Array.isArray(full) ? [...full] : [];
      } catch (e) {
        // Fallback to payload if state is not ready
        const list = payload && payload.scenarios ? payload.scenarios : [];
        this.scenarios = Array.isArray(list) ? [...list] : [];
      }
      // Prefer explicit activeScenarioId from payload if present, otherwise use state
      if (payload && payload.activeScenarioId) this.activeScenarioId = payload.activeScenarioId;
      else this.activeScenarioId = state.activeScenarioId;
    };
    this._onScenarioActivated = (payload) => { this.activeScenarioId = payload && payload.scenarioId ? payload.scenarioId : state.activeScenarioId; };
    this._onScenariosUpdated = () => {
      const sc = state.scenarios || [];
      this.scenarios = [...sc];
      this.activeScenarioId = state.activeScenarioId;
    };
    this._onViewsList = (payload) => {
      console.log('[Sidebar] Received views list event:', payload);
      this.views = payload && payload.views ? [...payload.views] : [];
      this.activeViewId = payload && payload.activeViewId ? payload.activeViewId : null;
      this.activeViewData = payload && payload.activeViewData ? payload.activeViewData : null;
      this.requestUpdate();
    };
    this._onViewActivated = (payload) => {
      console.log('[Sidebar] Received view activated event:', payload);
      this.activeViewId = payload && payload.viewId ? payload.viewId : null;
      this.activeViewData = payload && payload.activeViewData ? payload.activeViewData : null;
      this.requestUpdate();
    };

    bus.on(ProjectEvents.CHANGED, this._onProjectsChanged);
    bus.on(TeamEvents.CHANGED, this._onTeamsChanged);
    bus.on(ScenarioEvents.LIST, this._onScenariosList);
    bus.on(ScenarioEvents.ACTIVATED, this._onScenarioActivated);
    bus.on(ScenarioEvents.UPDATED, this._onScenariosUpdated);
    bus.on(DataEvents.SCENARIOS_DATA, this._onScenariosUpdated);
    bus.on(ViewManagementEvents.LIST, this._onViewsList);
    bus.on(ViewManagementEvents.ACTIVATED, this._onViewActivated);
    // Listen for view option changes to trigger sidebar state save
    const onViewOptionChange = () => this._saveSidebarState();
    bus.on(ViewEvents.CONDENSED, onViewOptionChange);
    bus.on(ViewEvents.DEPENDENCIES, onViewOptionChange);
    bus.on(ViewEvents.CAPACITY_MODE, onViewOptionChange);
    bus.on(ViewEvents.SORT_MODE, onViewOptionChange);
    bus.on(FilterEvents.CHANGED, onViewOptionChange);
    bus.on(StateFilterEvents.CHANGED, onViewOptionChange);
    bus.on(TimelineEvents.SCALE_CHANGED, onViewOptionChange); // Save when timeline zoom changes
    this._viewOptionChangeHandler = onViewOptionChange;
    // Initialize reactive properties from current state in case events were
    // emitted before this element was connected. This ensures the component
    // renders current projects/teams immediately instead of waiting for
    // subsequent change events.
    try {
      this._onProjectsChanged(state.projects);
      this._onTeamsChanged(state.teams);
      this._onScenariosList({ scenarios: state.scenarios, activeScenarioId: state.activeScenarioId });
      console.log('[Sidebar] Initializing views from state:', state.savedViews);
      this._onViewsList({ views: state.savedViews, activeViewId: state.activeViewId });
    } catch (e) {
      // Defensive: ignore if state is not yet ready
      console.warn('[Sidebar] Error initializing from state:', e);
    }
    this.refreshServerStatus();
    this.requestUpdate();
  }

  firstUpdated(){
    const headers = this.querySelectorAll('.sidebar-section-header-collapsible');
    this._collapsibleHandlers = Array.from(headers).flatMap(header => {
      const section = header.parentElement;
      const contentWrapper = section.children[1];
      const chevron = header.querySelector('.sidebar-chevron');
      
      const toggleSection = () => {
        const isCollapsed = contentWrapper.classList.toggle('sidebar-section-collapsed');
        if(chevron) chevron.textContent = isCollapsed ? '▲' : '▼';
        // Save sidebar state when section is toggled
        this._saveSidebarState();
      };

      const onHeaderClick = () => toggleSection();
      header.addEventListener('click', onHeaderClick);
      
      const handlers = [{ el: header, fn: onHeaderClick }];
      if (chevron) {
        const onChevronClick = (e) => { e.stopPropagation(); toggleSection(); };
        chevron.addEventListener('click', onChevronClick);
        handlers.push({ el: chevron, fn: onChevronClick });
      }
      return handlers;
    });

    const container = this.querySelector('#viewOptionsContainer');
    if(container) initViewOptions(container);

    const onPluginsChanged = () => this.requestUpdate();
    this._onPluginsChanged = onPluginsChanged;
    [PluginEvents.REGISTERED, PluginEvents.UNREGISTERED, PluginEvents.ACTIVATED, PluginEvents.DEACTIVATED]
      .forEach(evt => bus.on(evt, onPluginsChanged));

    // Restore sidebar state from localStorage after initial render
    // Defer restore until projects/teams have been initialized. Listen for
    // ProjectEvents.CHANGED / TeamEvents.CHANGED and run restore once when
    // data is available. Also try once immediately in case data is already loaded.
    this._restoreOnDataHandler = async () => {
      if (this._didRestoreSidebarState) return;
      const hasProjects = Array.isArray(this.projects) && this.projects.length > 0;
      const hasTeams = Array.isArray(this.teams) && this.teams.length > 0;
      if (hasProjects || hasTeams) {
        this._didRestoreSidebarState = true;
        await this._restoreSidebarState();
        bus.off(ProjectEvents.CHANGED, this._restoreOnDataHandler);
        bus.off(TeamEvents.CHANGED, this._restoreOnDataHandler);
      }
    };
    bus.on(ProjectEvents.CHANGED, this._restoreOnDataHandler);
    bus.on(TeamEvents.CHANGED, this._restoreOnDataHandler);
    // Try once immediately (microtask) in case projects/teams were loaded earlier
    setTimeout(() => this._restoreOnDataHandler(), 0);
  }

  disconnectedCallback(){
    // Remove reactive property handlers
    if (this._onProjectsChanged) bus.off(ProjectEvents.CHANGED, this._onProjectsChanged);
    if (this._onTeamsChanged) bus.off(TeamEvents.CHANGED, this._onTeamsChanged);
    if (this._onScenariosList) bus.off(ScenarioEvents.LIST, this._onScenariosList);
    if (this._onScenarioActivated) bus.off(ScenarioEvents.ACTIVATED, this._onScenarioActivated);
    if (this._onScenariosUpdated) {
      bus.off(ScenarioEvents.UPDATED, this._onScenariosUpdated);
      bus.off(DataEvents.SCENARIOS_DATA, this._onScenariosUpdated);
    }

    // Clean up view option change listeners
    const viewHandler = this._viewOptionChangeHandler;
    if(viewHandler){
      bus.off(ViewEvents.CONDENSED, viewHandler);
      bus.off(ViewEvents.DEPENDENCIES, viewHandler);
      bus.off(ViewEvents.CAPACITY_MODE, viewHandler);
      bus.off(ViewEvents.SORT_MODE, viewHandler);
      bus.off(FilterEvents.CHANGED, viewHandler);
      bus.off(StateFilterEvents.CHANGED, viewHandler);
      bus.off(TimelineEvents.SCALE_CHANGED, viewHandler);
    }
    // Clean up restore-on-data handler if still registered
    if (this._restoreOnDataHandler) {
      bus.off(ProjectEvents.CHANGED, this._restoreOnDataHandler);
      bus.off(TeamEvents.CHANGED, this._restoreOnDataHandler);
      this._restoreOnDataHandler = null;
    }
    
    this._collapsibleHandlers?.forEach(h => h.el.removeEventListener('click', h.fn));
    this._collapsibleHandlers = null;
    
    if(this._onPluginsChanged){
      [PluginEvents.REGISTERED, PluginEvents.UNREGISTERED, PluginEvents.ACTIVATED, PluginEvents.DEACTIVATED]
        .forEach(evt => bus.off(evt, this._onPluginsChanged));
    }
    
    // Clean up restore-on-data handler if still registered
    if (this._restoreOnDataHandler) {
      bus.off(ProjectEvents.CHANGED, this._restoreOnDataHandler);
      bus.off(TeamEvents.CHANGED, this._restoreOnDataHandler);
      this._restoreOnDataHandler = null;
    }
    super.disconnectedCallback();
  }

  _renderPluginButtons(){
    if(!isEnabled('USE_PLUGIN_SYSTEM')) return html``;
    const list = pluginManager.list().filter(md => md.enabled !== false);
    return html`${list.map(md => {
      const active = pluginManager.isActive(md.id);
      return html`<li class="sidebar-list-item">
        <div class="chip sidebar-chip ${active? 'active':''}" 
             style="display:flex;align-items:center;gap:8px;width:100%;padding:0 8px;cursor:pointer;" 
             @click=${()=>this._onPluginClicked(md.id)} 
             role="button" 
             tabindex="0" 
             aria-pressed="${active}" 
             @keydown=${(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); this._onPluginClicked(md.id); }}}>
          <div style="font-weight:600;font-size:0.8rem;color:var(--color-sidebar-text);flex:1;" title="${md.name}">${md.name}</div>
        </div>
      </li>`;
    })}`;
  }

  // _openSearchTool(){
  //   try{
  //     let st = document.querySelector('search-tool');
  //     if(!st){
  //       import('./SearchTool.lit.js').then(()=>{
  //         st = document.createElement('search-tool');
  //         document.body.appendChild(st);
  //         st.open();
  //       }).catch(console.warn);
  //     } else { st.open(); st.focusInput(); }
  //   }catch(e){ console.warn('openSearchTool failed', e); }
  // }

  _onPluginClicked(pluginId){
    const isActive = pluginManager.isActive(pluginId);
    const method = isActive ? 'deactivate' : 'activate';
    pluginManager[method](pluginId).catch(console.warn);
  }

  async _openConfig(){
    const { openConfigModal } = await import('./modalHelpers.js');
    await openConfigModal();
  }

  async _openHelp(){
    const { openHelpModal } = await import('./modalHelpers.js');
    await openHelpModal();
  }

  _onProjectsChanged(){ this.requestUpdate(); }
  _onTeamsChanged(){ this.requestUpdate(); }
  _onScenariosChanged(){ this.requestUpdate(); }
  _onDataEvents(){ this.requestUpdate(); }

  async refreshServerStatus(){
    try{
      const h = await dataService.checkHealth();
      const status = h.status || (h.ok ? 'ok' : 'error');
      this.serverName = h.server_name || null;
      const ups = Number(h.uptime_seconds);
      const uptimeStr = Number.isNaN(ups) ? '' : (() => {
        const totalMinutes = Math.floor(ups / 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return ` - Uptime: ${hours}h ${minutes}m`;
      })();
      this.serverStatus = `Version: ${h.version} | Server: ${status}${uptimeStr}`;
    }catch(err){
      this.serverStatus = 'Server: error';
    }
    this.requestUpdate();
  }

  toggleProject(pid){
    const current = (this.projects || []).find(p=>p.id===pid);
    const newVal = !(current && current.selected);
    state.setProjectSelected(pid, newVal);
    // persistence will be triggered; state change will update this.projects via bus
    this._saveSidebarState();
  }

  toggleTeam(tid){
    const current = (this.teams || []).find(t=>t.id===tid);
    const newVal = !(current && current.selected);
    state.setTeamSelected(tid, newVal);
    this._saveSidebarState();
  }

  setAllInList(type, checked){
    if(type === 'project'){
      (this.projects || []).forEach(p=> state.setProjectSelected(p.id, checked));
    } else if(type === 'team'){
      (this.teams || []).forEach(t=> state.setTeamSelected(t.id, checked));
    }
    this._saveSidebarState();
  }

  _anyUncheckedProjects(){
    return (this.projects || []).some(p => !p.selected);
  }

  _anyUncheckedTeams(){
    return (this.teams || []).some(t => !t.selected);
  }

  _handleProjectToggle(){
    const anyUnchecked = this._anyUncheckedProjects();
    this.setAllInList('project', anyUnchecked);
  }

  _handleTeamToggle(){
    const anyUnchecked = this._anyUncheckedTeams();
    this.setAllInList('team', anyUnchecked);
  }

  _featureIconSvg(){
    return featureTemplate;
  }

  async _openColorPopover(e, type, id){
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const cp = await ColorPopoverLit.ensureInstance(PALETTE);
    await cp.updateComplete;
    cp.openFor(type, id, rect);
  }

  _renderEntityList(type, items, onToggle){
    return html`${items.map(item => {
      // For teams, only count features with non-zero allocation
      let epicsCount = 0;
      let featuresCount = 0;
      if (type === 'project') {
        epicsCount = state.countEpicsForProject(item.id);
        featuresCount = state.countFeaturesForProject(item.id);
      } else {
        epicsCount = state.countEpicsForTeam(item.id);
        featuresCount = state.countFeaturesForTeam(item.id);
      }
      
      return html`
        <li class="sidebar-list-item">
          <div class="chip sidebar-chip ${item.selected? 'active':''}" 
               style="display:flex;align-items:stretch;gap:8px;width:100%;" 
               @click=${(e)=> { if(!e.target.closest('.color-dot')) onToggle(item.id); }}>
            <span class="color-dot" 
                  data-color-id="${item.id}" 
                  style="background:${item.color}" 
                  aria-hidden="true" 
                  @click=${(e) => this._openColorPopover(e, type, item.id)}></span>
            <div class="${type}-name-col" title="${item.name}" style="align-self:center">
              ${item.name}${type === 'team' && item.short ? html` <span class="team-short">(${item.short})</span>` : ''}
            </div>
            <div style="margin-left:auto;display:inline-flex;gap:6px;align-items:center;">
              <span class="chip-badge">${epicsCount}</span>
              <span class="chip-badge">${featuresCount}</span>
            </div>
          </div>
        </li>`;
    })}`;
  }
  /**
   * Get filtered projects based on active view
   * If a non-default view is active, only show projects that were selected in that view
   */
  _getFilteredProjects() {
    if (!this.activeViewId || this.activeViewId === 'default' || !this.activeViewData) {
      // Default view or no view active - show all
      return this.projects;
    }
    
    // Filter projects based on active view data
    // Only show projects where selectedProjects[id] === true
    return (this.projects || []).filter(project => 
      this.activeViewData.selectedProjects?.[project.id] === true
    );
  }

  /**
   * Get filtered teams based on active view
   * If a non-default view is active, only show teams that were selected in that view
   */
  _getFilteredTeams() {
    if (!this.activeViewId || this.activeViewId === 'default' || !this.activeViewData) {
      // Default view or no view active - show all
      return this.teams;
    }
    
    // Filter teams based on active view data
    // Only show teams where selectedTeams[id] === true
    return (this.teams || []).filter(team => 
      this.activeViewData.selectedTeams?.[team.id] === true
    );
  }
  renderProjects(){
    return this._renderEntityList('project', this._getFilteredProjects() || [], (id) => this.toggleProject(id));
  }

  renderPlansGrouped(){
    const all = this._getFilteredProjects() || [];
    const delivery = all.filter(p => (p.type || 'project') === 'project');
    const teamBacklogs = all.filter(p => (p.type || 'project') !== 'project');
    return html`
      <div class="plans-group">
        ${delivery.length ? html`<!-- <div class="group-title">Delivery Plans</div> -->
          <ul class="sidebar-list" id="projectList">${this._renderEntityList('project', delivery, (id) => this.toggleProject(id))}</ul>` : ''}

        ${delivery.length && teamBacklogs.length ? html`<div style="border-top:1px dashed rgba(255,255,255,0.32); margin:4px 0; border-radius:2px; height:0;" class="divider" role="separator" aria-hidden="true"></div>` : ''}

        ${teamBacklogs.length ? html`<!-- <div class="group-title">Team Backlogs</div> -->
          <ul class="sidebar-list" id="projectListTeam">${this._renderEntityList('project', teamBacklogs, (id) => this.toggleProject(id))}</ul> ` : ''}
      </div>
    `;
  }

  renderTeams(){
    return this._renderEntityList('team', this._getFilteredTeams() || [], (id) => this.toggleTeam(id));
  }

  renderScenarios(){
    const sorted = [...(this.scenarios || [])].sort((a,b)=>{
      // Sort readonly scenarios (like baseline) first
      if(a.readonly && !b.readonly) return -1;
      if(b.readonly && !a.readonly) return 1;
      return (a.name||'').toLowerCase().localeCompare((b.name||'').toLowerCase());
    });
    return html`${sorted.map(s=> html`
      <li class="sidebar-list-item scenario-item sidebar-chip ${s.id===this.activeScenarioId? 'active':''}" @click=${(e)=>this._onScenarioClick(e, s)}>
        <span class="scenario-name" title="${s.name}">${s.name}</span>
        ${state.isScenarioUnsaved(s) ? html`<span class="scenario-warning" title="Unsaved">⚠️</span>` : ''}
        <span class="scenario-controls">
          <button type="button" class="scenario-btn" title="Scenario actions" @click=${(e)=>this._onScenarioMenuClick(e, s)}>${'⋯'}</button>
        </span>
      </li>
    `)}`;
  }

  renderViews(){
    console.log('[Sidebar] renderViews called, views:', this.views);
    const sorted = [...(this.views || [])].sort((a,b)=>{
      // Sort readonly views (like default) first
      if(a.readonly && !b.readonly) return -1;
      if(b.readonly && !a.readonly) return 1;
      return (a.name||'').toLowerCase().localeCompare((b.name||'').toLowerCase());
    });
    return html`${sorted.map(v=> html`
      <li class="sidebar-list-item view-item sidebar-chip ${v.id===this.activeViewId? 'active':''}" @click=${(e)=>this._onViewClick(e, v)}>
        <span class="view-name" title="${v.name}">${v.name}</span>
        <span class="view-controls">
          <button type="button" class="view-btn" title="View actions" @click=${(e)=>this._onViewMenuClick(e, v)}>${'⋯'}</button>
        </span>
      </li>
    `)}`;
  }

  _onScenarioMenuClick(e, s){
    e.stopPropagation();
    document.querySelectorAll('.scenario-menu-popover').forEach(p=>p.remove());
    
    const menuBtn = e.currentTarget;
    const pop = document.createElement('div'); 
    pop.className='scenario-menu-popover';
    
    const addItem = (label, emoji, onClick, disabled=false) => {
      const item = document.createElement('div'); 
      item.className = 'scenario-menu-item';
      if(disabled) item.classList.add('disabled');
      item.innerHTML = `<span>${emoji}</span><span>${label}</span>`;
      if(!disabled) item.addEventListener('click', ev=>{ ev.stopPropagation(); onClick(); pop.remove(); });
      pop.appendChild(item);
    };
    
    const defaultCloneName = (() => {
      const now = new Date();
      const mm = String(now.getMonth()+1).padStart(2,'0');
      const dd = String(now.getDate()).padStart(2,'0');
      const maxN = Math.max(0, ...(this.scenarios || [])
        .map(sc => /^\d{2}-\d{2} Scenario (\d+)$/i.exec(sc.name)?.[1])
        .filter(Boolean)
        .map(n => parseInt(n, 10)));
      return `${mm}-${dd} Scenario ${maxN+1}`;
    })();
    
    addItem('Clone Scenario', '⎘', async ()=>{ 
      const { openScenarioCloneModal } = await import('./modalHelpers.js'); 
      await openScenarioCloneModal({ id: s.id, name: defaultCloneName }); 
    });
    
    if(s.readonly){
      // Readonly scenarios (like baseline) can only be refreshed, not modified
      addItem('Refresh Baseline', '🔄', () => state.refreshBaseline());
    } else {
      addItem('Rename', '✏️', async ()=>{ 
        const { openScenarioRenameModal } = await import('./modalHelpers.js'); 
        await openScenarioRenameModal({ id: s.id, name: s.name }); 
      });
      addItem('Delete', '🗑️', async ()=>{ 
        const { openScenarioDeleteModal } = await import('./modalHelpers.js'); 
        await openScenarioDeleteModal({ id: s.id, name: s.name }); 
      });
      addItem('Save Scenario', '💾', () => state.saveScenario(s.id));
      addItem('Save to Azure DevOps', '💾', async ()=>{
        const overrideEntries = Object.entries(s.overrides || {});
        if(overrideEntries.length === 0) return;
        const { openAzureDevopsModal } = await import('./modalHelpers.js'); 
        const selected = await openAzureDevopsModal({ overrides: s.overrides, state }); 
        if(selected?.length) await dataService.publishBaseline(selected);
      }, (s.overrides && Object.keys(s.overrides).length === 0));
    }
    
    const rect = menuBtn.getBoundingClientRect();
    Object.assign(pop.style, {
      position: 'absolute',
      top: `${rect.top + window.scrollY + rect.height + 4}px`,
      left: `${rect.left + window.scrollX - 20}px`
    });
    document.body.appendChild(pop);
    setTimeout(() => document.addEventListener('click', () => pop.remove(), { once:true }), 0);
  }

  async _onViewClick(e, v){
    e.stopPropagation();
    // Load and apply the view
    try {
      await state.viewManagementService.loadAndApplyView(v.id);
    } catch (err) {
      console.error('Failed to load view:', err);
      // Show error in a simple way without alert
      const status = document.createElement('div');
      status.textContent = `Failed to load view: ${err.message || err}`;
      status.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--error-bg,#fee);padding:1rem;border-radius:4px;z-index:10000;';
      document.body.appendChild(status);
      setTimeout(() => status.remove(), 3000);
    }
  }

  async _saveNewView(){
    const { openViewSaveModal } = await import('./modalHelpers.js');
    const defaultName = (() => {
      const now = new Date();
      const mm = String(now.getMonth()+1).padStart(2,'0');
      const dd = String(now.getDate()).padStart(2,'0');
      const maxN = Math.max(0, ...(this.views || [])
        .filter(v => !v.readonly)
        .map(v => /^\d{2}-\d{2} View (\d+)$/i.exec(v.name)?.[1])
        .filter(Boolean)
        .map(n => parseInt(n, 10)));
      return `${mm}-${dd} View ${maxN+1}`;
    })();
    await openViewSaveModal({ name: defaultName });
  }

  _onViewMenuClick(e, v){
    e.stopPropagation();
    document.querySelectorAll('.view-menu-popover').forEach(p=>p.remove());
    
    const menuBtn = e.currentTarget;
    const pop = document.createElement('div'); 
    pop.className='view-menu-popover scenario-menu-popover'; // Reuse scenario menu styles
    
    const addItem = (label, emoji, onClick, disabled=false) => {
      const item = document.createElement('div'); 
      item.className = 'scenario-menu-item';
      if(disabled) item.classList.add('disabled');
      item.innerHTML = `<span>${emoji}</span><span>${label}</span>`;
      if(!disabled) item.addEventListener('click', ev=>{ ev.stopPropagation(); onClick(); pop.remove(); });
      pop.appendChild(item);
    };
    
    if (v.readonly && v.id === 'default') {
      // Default view menu - only show clone option
      addItem('Clone & Save as New View', '⎘', async ()=>{ 
        const { openViewSaveModal } = await import('./modalHelpers.js');
        const defaultName = (() => {
          const now = new Date();
          const mm = String(now.getMonth()+1).padStart(2,'0');
          const dd = String(now.getDate()).padStart(2,'0');
          const maxN = Math.max(0, ...(this.views || [])
            .filter(vw => !vw.readonly)
            .map(vw => /^\d{2}-\d{2} View (\d+)$/i.exec(vw.name)?.[1])
            .filter(Boolean)
            .map(n => parseInt(n, 10)));
          return `${mm}-${dd} View ${maxN+1}`;
        })();
        await openViewSaveModal({ name: defaultName });
      });
    } else {
      // Custom view menu - show update/rename/delete options
      addItem('Update View', '💾', async ()=>{ 
        // Save current state over existing view
        try {
          await state.viewManagementService.saveCurrentView(v.name, v.id);
        } catch (err) {
          console.error('Failed to update view:', err);
        }
      });
      
      addItem('Rename View', '✏️', async ()=>{ 
        const { openViewRenameModal } = await import('./modalHelpers.js');
        await openViewRenameModal({ id: v.id, name: v.name });
      });
      
      addItem('Delete View', '🗑️', async ()=>{ 
        const { openViewDeleteModal } = await import('./modalHelpers.js');
        await openViewDeleteModal({ id: v.id, name: v.name });
      });
    }
    
    const rect = menuBtn.getBoundingClientRect();
    Object.assign(pop.style, {
      position: 'absolute',
      top: `${rect.top + window.scrollY + rect.height + 4}px`,
      left: `${rect.left + window.scrollX - 20}px`
    });
    document.body.appendChild(pop);
    setTimeout(() => document.addEventListener('click', () => pop.remove(), { once:true }), 0);
  }

  /**
   * Save current sidebar state to localStorage (debounced)
   */
  _saveSidebarState() {
    if (!this._persistenceService) return;
    this._persistenceService.saveSidebarState(state, state._viewService, this);
  }

  /**
   * Restore sidebar state from localStorage
   */
  async _restoreSidebarState() {
    if (!this._persistenceService) return;
    await this._persistenceService.restoreSidebarState(state, state._viewService, this);
  }

  _onScenarioClick(e, s){
    if(!e.target.closest('.scenario-controls')) state.activateScenario(s.id);
  }

  render(){
    return html`
      <aside class="sidebar ${this.open? '' : 'closed'}">
        <h2>Planner Tool</h2>
        <div class="sidebar-content">
        <section class="sidebar-section" id="viewOptionsSection">
          <div class="sidebar-section-header-collapsible"><span class="sidebar-chevron">▲</span><span class="sidebar-title">View Options</span></div>
          <div class="sidebar-section-collapsed"><div id="viewOptionsContainer"></div></div>
        </section>

        <section class="sidebar-section" id="projectsSection" data-tour="planning">
          <div class="sidebar-section-header-collapsible"><span class="sidebar-chevron">▼</span><span class="sidebar-title">Plans</span></div>
          <div>
            <div class="counts-header" aria-hidden="true">
                  <span></span>
                  <button id="projectToggleBtn" class="chip list-toggle-btn" role="button" tabindex="0" title="Select all / Clear all projects" @click=${()=>this._handleProjectToggle()}>
                    ${this._anyUncheckedProjects() ? 'All' : 'None'}
                  </button>
                  <span></span>
                  <span class="type-icon epic" title="Epics">${epicTemplate}</span>
                  <span class="type-icon feature" title="Features">${featureTemplate}</span>
            </div>
            ${this.renderPlansGrouped()}
          </div>
        </section>

        <section class="sidebar-section" id="teamsSection" data-tour="allocations">
          <div class="sidebar-section-header-collapsible"><span class="sidebar-chevron">▼</span><span class="sidebar-title">Allocations</span></div>
          <div>
              <div class="counts-header" aria-hidden="true">
              <span></span>
              <button id="teamToggleBtn" class="chip list-toggle-btn" role="button" tabindex="0" title="Select all / Clear all teams" @click=${()=>this._handleTeamToggle()}>
                ${this._anyUncheckedTeams() ? 'All' : 'None'}
              </button>
              <span></span>
              <span class="type-icon epic" title="Epics">${epicTemplate}</span>
              <span class="type-icon feature" title="Features">${featureTemplate}</span>
            </div>
            <ul class="sidebar-list" id="teamList">${this.renderTeams()}</ul>
          </div>
        </section>

        <section class="sidebar-section" id="scenariosSection" data-tour="scenarios">
          <div class="sidebar-section-header-collapsible"><span class="sidebar-chevron">▼</span><span class="sidebar-title">Scenarios</span></div>
          <div>
            <ul class="sidebar-list" id="scenarioList">${this.renderScenarios()}</ul>
          </div>
        </section>

        <section class="sidebar-section" id="viewsSection" data-tour="views">
          <div class="sidebar-section-header-collapsible"><span class="sidebar-chevron">▼</span><span class="sidebar-title">Views</span></div>
          <div>
            <ul class="sidebar-list" id="viewList">${this.renderViews()}</ul>
          </div>
        </section>

        <section class="sidebar-section" id="toolsSection" data-tour="tools">
          <div class="sidebar-section-header-collapsible"><span class="sidebar-chevron">▼</span><span class="sidebar-title">Tools</span></div>
          <div>
            <ul class="sidebar-list" id="toolsList">
            <!--
              <li class="sidebar-list-item">
                <div class="chip sidebar-chip" style="display:flex;align-items:center;gap:8px;width:100%;padding:0 8px;cursor:pointer;" @click=${()=>this._openSearchTool()} role="button" tabindex="0" @keydown=${(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); this._openSearchTool(); }}}>
                  <div style="font-weight:600;font-size:0.8rem;color:var(--color-sidebar-text);flex:1;">Search</div>
                </div>
              </li>
            -->
              ${this._renderPluginButtons()}
            </ul>
          </div>
        </section>

        </div>
        <section class="sidebar-config">
          <div class="sidebar-section-header"><span class="sidebar-title">Configuration & Help</span></div>
          <div class="config-row" style="display:flex;gap:8px;margin-top:6px;">
            <button id="openConfigBtn" data-tour="gear" @click=${()=>this._openConfig()}>⚙️</button>
            <button id="openHelpBtn" data-tour="help" @click=${()=>this._openHelp()}>❓</button>
          </div>
          <div id="serverStatusLabel" style="font-size:12px; margin-top:8px;">${this.serverStatus}</div>
          <div id="attributionLabel" style="font-size:9px; margin-top:8px;">(c) 2025-2026 Kim Poulsen${this.serverName ? ' — ' + this.serverName : ''}</div>
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
