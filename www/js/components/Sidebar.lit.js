import { LitElement, html, css } from '../vendor/lit.js';
import { state, PALETTE } from '../services/State.js';
import { bus } from '../core/EventBus.js';
import { ProjectEvents, TeamEvents, ScenarioEvents, DataEvents, PluginEvents } from '../core/EventRegistry.js';
// Legacy modal helper removed; create Lit modal components directly when needed
import { dataService } from '../services/dataService.js';
import { initViewOptions } from './viewOptions.js';
import { ColorPopoverLit } from '../components/ColorPopover.lit.js';
import { pluginManager } from '../core/PluginManager.js';
import { isEnabled } from '../config.js';

export class SidebarLit extends LitElement {
  static properties = {
    open: { type: Boolean }
  };

  static styles = css`
    :host { display:block; }
    /* Keep component-specific small tweaks; main styles come from www/css/main.css */
    .chip { display:flex; gap:8px; align-items:center; padding:6px; border-radius:6px; cursor:pointer; }
    .chip.active { opacity: 0.95; }
    .color-dot { width:16px; height:16px; border-radius:4px; flex:0 0 auto; }
    .chip-badge { padding:2px 6px; border-radius:10px; font-size:12px; background: rgba(255,255,255,0.06); }
    .counts-header { display:grid; grid-template-columns: 24px 28px 1fr 44px 44px; align-items:center; gap:8px; margin-bottom:4px; color:#ddd; }
  `;

  constructor(){
    super();
    this.open = true;
    this.serverStatus = 'loading';
  }

  // Render into light DOM so legacy selectors (IDs) can still be used if needed.
  createRenderRoot(){ return this; }

  connectedCallback(){
    super.connectedCallback();
    const onUpdate = () => this.requestUpdate();
    bus.on(ProjectEvents.CHANGED, onUpdate);
    bus.on(TeamEvents.CHANGED, onUpdate);
    bus.on(ScenarioEvents.LIST, onUpdate);
    bus.on(ScenarioEvents.ACTIVATED, onUpdate);
    bus.on(ScenarioEvents.UPDATED, onUpdate);
    bus.on(DataEvents.SCENARIOS_DATA, onUpdate);
    this._updateHandler = onUpdate;
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
  }

  disconnectedCallback(){
    const handler = this._updateHandler;
    if(handler){
      bus.off(ProjectEvents.CHANGED, handler);
      bus.off(TeamEvents.CHANGED, handler);
      bus.off(ScenarioEvents.LIST, handler);
      bus.off(ScenarioEvents.ACTIVATED, handler);
      bus.off(ScenarioEvents.UPDATED, handler);
      bus.off(DataEvents.SCENARIOS_DATA, handler);
    }
    
    this._collapsibleHandlers?.forEach(h => h.el.removeEventListener('click', h.fn));
    this._collapsibleHandlers = null;
    
    if(this._onPluginsChanged){
      [PluginEvents.REGISTERED, PluginEvents.UNREGISTERED, PluginEvents.ACTIVATED, PluginEvents.DEACTIVATED]
        .forEach(evt => bus.off(evt, this._onPluginsChanged));
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
      const ups = Number(h.uptime_seconds);
      const uptimeStr = Number.isNaN(ups) ? '' : (() => {
        const totalMinutes = Math.floor(ups / 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return ` - Uptime: ${hours}h ${minutes}m`;
      })();
      this.serverStatus = `Server: ${status}${uptimeStr}`;
    }catch(err){
      this.serverStatus = 'Server: error';
    }
    this.requestUpdate();
  }

  toggleProject(pid){
    const current = state.projects.find(p=>p.id===pid);
    const newVal = !(current && current.selected);
    state.setProjectSelected(pid, newVal);
    this.requestUpdate();
  }

  toggleTeam(tid){
    const current = state.teams.find(t=>t.id===tid);
    const newVal = !(current && current.selected);
    state.setTeamSelected(tid, newVal);
    this.requestUpdate();
  }

  setAllInList(type, checked){
    if(type === 'project'){
      state.projects.forEach(p=> state.setProjectSelected(p.id, checked));
    } else if(type === 'team'){
      state.teams.forEach(t=> state.setTeamSelected(t.id, checked));
    }
    this.requestUpdate();
  }

  _anyUncheckedProjects(){
    return state.projects.some(p => !p.selected);
  }

  _anyUncheckedTeams(){
    return state.teams.some(t => !t.selected);
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
    return html`<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="width:16px;height:16px;display:inline-block;vertical-align:middle"><path fill="currentColor" d="M7 3h10v3c0 2.761-2.239 5-5 5s-5-2.239-5-5V3zm5 10c3.314 0 6-2.686 6-6V2H6v5c0 3.314 2.686 6 6 6zm-3.5 2h7a.5.5 0 01.5.5c0 .828-.672 1.5-1.5 1.5h-5a1.5 1.5 0 01-1.5-1.5.5.5 0 01.5-.5z"/></svg>`;
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
      const epicsCount = state.baselineFeatures.filter(f => 
        f.type === 'epic' && (
          type === 'project' ? f.project === item.id : f.capacity.some(tl => tl.team === item.id)
        )
      ).length;
      const featuresCount = state.baselineFeatures.filter(f => 
        f.type === 'feature' && (
          type === 'project' ? f.project === item.id : f.capacity.some(tl => tl.team === item.id)
        )
      ).length;
      
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
            <input type="checkbox" style="display:none;" data-${type}="${item.id}" ?checked=${item.selected} />
          </div>
        </li>`;
    })}`;
  }

  renderProjects(){
    return this._renderEntityList('project', state.projects, (id) => this.toggleProject(id));
  }

  renderTeams(){
    return this._renderEntityList('team', state.teams, (id) => this.toggleTeam(id));
  }

  renderScenarios(){
    const sorted = [...state.scenarios].sort((a,b)=>{
      // Sort readonly scenarios (like baseline) first
      if(a.readonly && !b.readonly) return -1;
      if(b.readonly && !a.readonly) return 1;
      return (a.name||'').toLowerCase().localeCompare((b.name||'').toLowerCase());
    });
    return html`${sorted.map(s=> html`
      <li class="sidebar-list-item scenario-item sidebar-chip ${s.id===state.activeScenarioId? 'active':''}" @click=${(e)=>this._onScenarioClick(e, s)}>
        <span class="scenario-name" title="${s.name}">${s.name}</span>
        ${state.isScenarioUnsaved && state.isScenarioUnsaved(s) ? html`<span class="scenario-warning" title="Unsaved">⚠️</span>` : ''}
        <span class="scenario-controls">
          <button type="button" class="scenario-btn" title="Scenario actions" @click=${(e)=>this._onScenarioMenuClick(e, s)}>${'⋯'}</button>
        </span>
        <input type="checkbox" style="display:none;" data-scenario="${s.id}" ?checked=${s.id===state.activeScenarioId} />
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
      const maxN = Math.max(0, ...state.scenarios
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

        <section class="sidebar-section" id="projectsSection">
          <div class="sidebar-section-header-collapsible"><span class="sidebar-chevron">▼</span><span class="sidebar-title">Projects</span></div>
          <div>
            <div class="counts-header" aria-hidden="true">
                  <span></span>
                  <button id="projectToggleBtn" class="chip list-toggle-btn" role="button" tabindex="0" title="Select all / Clear all projects" @click=${()=>this._handleProjectToggle()}>
                    ${this._anyUncheckedProjects() ? 'All' : 'None'}
                  </button>
                  <span></span>
                  <span class="type-icon epic" title="Epics">👑</span>
                  <span class="type-icon feature" title="Features">${this._featureIconSvg()}</span>
            </div>
            <ul class="sidebar-list" id="projectList">${this.renderProjects()}</ul>
          </div>
        </section>

        <section class="sidebar-section" id="teamsSection">
          <div class="sidebar-section-header-collapsible"><span class="sidebar-chevron">▼</span><span class="sidebar-title">Teams</span></div>
          <div>
            <div class="counts-header" aria-hidden="true">
              <span></span>
              <button id="teamToggleBtn" class="chip list-toggle-btn" role="button" tabindex="0" title="Select all / Clear all teams" @click=${()=>this._handleTeamToggle()}>
                ${this._anyUncheckedTeams() ? 'All' : 'None'}
              </button>
              <span></span>
              <span class="type-icon epic" title="Epics">👑</span>
              <span class="type-icon feature" title="Features">${this._featureIconSvg()}</span>
            </div>
            <ul class="sidebar-list" id="teamList">${this.renderTeams()}</ul>
          </div>
        </section>

        <section class="sidebar-section" id="scenariosSection">
          <div class="sidebar-section-header-collapsible"><span class="sidebar-chevron">▼</span><span class="sidebar-title">Scenarios</span></div>
          <div>
            <ul class="sidebar-list" id="scenarioList">${this.renderScenarios()}</ul>
          </div>
        </section>

        <section class="sidebar-section" id="toolsSection">
          <div class="sidebar-section-header-collapsible"><span class="sidebar-chevron">▼</span><span class="sidebar-title">Tools</span></div>
          <div>
            <ul class="sidebar-list" id="toolsList">${this._renderPluginButtons()}</ul>
          </div>
        </section>

        </div>
        <section class="sidebar-config">
          <div class="sidebar-section-header"><span class="sidebar-title">Configuration & Help</span></div>
          <div class="config-row" style="display:flex;gap:8px;margin-top:6px;">
            <button id="openConfigBtn" @click=${()=>this._openConfig()}>⚙️</button>
            <button id="openHelpBtn" @click=${()=>this._openHelp()}>❓</button>
          </div>
          <div id="serverStatusLabel" style="font-size:12px; margin-top:8px;">${this.serverStatus}</div>
          <div id="attributionLabel" style="font-size:9px; margin-top:8px;">(c) 2025 Kim Poulsen</div>
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
