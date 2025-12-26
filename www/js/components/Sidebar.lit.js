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
    this._onProjectsChanged = this._onProjectsChanged.bind(this);
    this._onTeamsChanged = this._onTeamsChanged.bind(this);
    this._onScenariosChanged = this._onScenariosChanged.bind(this);
    this._onDataEvents = this._onDataEvents.bind(this);
    this.serverStatus = 'loading';
  }

  // Render into light DOM so legacy selectors (IDs) can still be used if needed.
  createRenderRoot(){ return this; }

  connectedCallback(){
    super.connectedCallback();
    bus.on(ProjectEvents.CHANGED, this._onProjectsChanged);
    bus.on(TeamEvents.CHANGED, this._onTeamsChanged);
    bus.on(ScenarioEvents.LIST, this._onScenariosChanged);
    bus.on(ScenarioEvents.ACTIVATED, this._onScenariosChanged);
    bus.on(ScenarioEvents.UPDATED, this._onScenariosChanged);
    bus.on(DataEvents.SCENARIOS_DATA, this._onDataEvents);
    this.refreshServerStatus();
    // Ensure an initial render picks up any pre-populated `state` used in tests
    this.requestUpdate();
  }

  firstUpdated(){
    this._collapsibleHandlers = [];
    // Wire up collapsible headers similar to legacy sidebar.js
    const headers = Array.from(this.querySelectorAll('.sidebar-section-header-collapsible'));
    headers.forEach(header => {
      const section = header.parentElement;
      const contentWrapper = section.children[1];
      const chevron = header.querySelector('.sidebar-chevron');

      const toggleSection = () => {
        if (!contentWrapper) return;
        if (contentWrapper.classList && contentWrapper.classList.contains('sidebar-section-collapsed')){
          contentWrapper.classList.remove('sidebar-section-collapsed');
          if(chevron) chevron.textContent = '▼';
        } else {
          contentWrapper.classList.add('sidebar-section-collapsed');
          if(chevron) chevron.textContent = '▲';
        }
      };

      const onHeaderClick = (e) => { toggleSection(); };
      header.addEventListener('click', onHeaderClick);
      this._collapsibleHandlers.push({ el: header, fn: onHeaderClick });

      if (chevron) {
        const onChevronClick = (e) => { e.stopPropagation(); toggleSection(); };
        chevron.addEventListener('click', onChevronClick);
        this._collapsibleHandlers.push({ el: chevron, fn: onChevronClick });
      }
    });

    // Initialize the legacy View Options UI into the container
    try{
      const container = this.querySelector('#viewOptionsContainer');
      if(container){ initViewOptions(container); }
    }catch(e){ console.warn('initViewOptions failed', e); }
    // listen for plugin registry changes (typed PluginEvents via EventRegistry)
    try{ this._onPluginsChanged = ()=> this.requestUpdate(); bus.on && bus.on(PluginEvents.REGISTERED, this._onPluginsChanged); bus.on && bus.on(PluginEvents.UNREGISTERED, this._onPluginsChanged); bus.on && bus.on(PluginEvents.ACTIVATED, this._onPluginsChanged); bus.on && bus.on(PluginEvents.DEACTIVATED, this._onPluginsChanged); }catch(e){}
  }

  disconnectedCallback(){
    try{ bus.off(ProjectEvents.CHANGED, this._onProjectsChanged); }catch(e){}
    try{ bus.off(TeamEvents.CHANGED, this._onTeamsChanged); }catch(e){}
    try{ bus.off(ScenarioEvents.LIST, this._onScenariosChanged); }catch(e){}
    try{ bus.off(ScenarioEvents.ACTIVATED, this._onScenariosChanged); }catch(e){}
    try{ bus.off(ScenarioEvents.UPDATED, this._onScenariosChanged); }catch(e){}
    try{ bus.off(DataEvents.SCENARIOS_DATA, this._onDataEvents); }catch(e){}
    // Remove collapsible handlers
    if(this._collapsibleHandlers){
      this._collapsibleHandlers.forEach(h => { try{ h.el.removeEventListener('click', h.fn); }catch(e){} });
      this._collapsibleHandlers = null;
    }
    try{ bus.off && bus.off(PluginEvents.REGISTERED, this._onPluginsChanged); bus.off && bus.off(PluginEvents.UNREGISTERED, this._onPluginsChanged); bus.off && bus.off(PluginEvents.ACTIVATED, this._onPluginsChanged); bus.off && bus.off(PluginEvents.DEACTIVATED, this._onPluginsChanged); }catch(e){}
    super.disconnectedCallback();
  }

  _renderPluginButtons(){
    // Only render Tools section when plugin system enabled
    if(!isEnabled('USE_PLUGIN_SYSTEM')) return html``;
    try{
      const list = pluginManager.list() || [];
      return html`${list.map(md => {
        const active = pluginManager.isActive(md.id);
        return html`<li class="sidebar-list-item">
          <div class="chip sidebar-chip ${active? 'active':''}" style="display:flex;align-items:center;gap:8px;width:100%;padding:0 8px;cursor:pointer;" @click=${()=>this._onPluginClicked(md.id)} role="button" tabindex="0" aria-pressed="${active? 'true':'false'}" @keydown=${(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); this._onPluginClicked(md.id); }}}>
            <div style="font-weight:600;font-size:0.8rem;color:var(--color-sidebar-text);flex:1;" title="${md.title || md.id}">${md.title || md.id}</div>
          </div>
        </li>`;
      })}`;
    }catch(e){ return html``; }
  }

  _onPluginClicked(pluginId){
    try{
      const p = pluginManager.get(pluginId);
      if(!p) return;
      // If plugin is active -> deactivate via manager to ensure events
      if(pluginManager.isActive(pluginId)){
        if(typeof pluginManager.deactivate === 'function') pluginManager.deactivate(pluginId).catch(()=>{});
      } else {
        if(typeof pluginManager.activate === 'function') pluginManager.activate(pluginId).catch(()=>{});
      }
    }catch(e){ console.warn('plugin click failed', e); }
  }

  async _openConfig(){
    try{
      const { openConfigModal } = await import('./modalHelpers.js');
      await openConfigModal();
    }catch(e){ console.warn('Failed to open config modal', e); }
  }

  async _openHelp(){
    try{ const { openHelpModal } = await import('./modalHelpers.js'); await openHelpModal(); }catch(e){ console.warn('Failed to open help modal', e); }
  }

  _onProjectsChanged(){ this.requestUpdate(); }
  _onTeamsChanged(){ this.requestUpdate(); }
  _onScenariosChanged(){ this.requestUpdate(); }
  _onDataEvents(){ this.requestUpdate(); }

  async refreshServerStatus(){
    // Server returns:
    // {"status":"ok","start_time":"2025-12-22T09:38:40.488697+00:00","uptime_seconds":4854}
    try{
      const h = await dataService.checkHealth();
      const status = h.status || (h.ok ? 'ok' : 'error');
      let uptimeStr = '';
      const ups = (h && h.uptime_seconds !== undefined) ? Number(h.uptime_seconds) : NaN;
      if(!Number.isNaN(ups)){
        const totalMinutes = Math.floor(ups / 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        uptimeStr = ` - Uptime: ${hours}h ${minutes}m`;
      }
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

  renderProjects(){
    return html`${state.projects.map(p => {
      const epicsCount = state.baselineFeatures.filter(f => f.project === p.id && f.type === 'epic').length;
      const featuresCount = state.baselineFeatures.filter(f => f.project === p.id && f.type === 'feature').length;
      return html`
        <li class="sidebar-list-item">
          <div class="chip sidebar-chip ${p.selected? 'active':''}" style="display:flex;align-items:stretch;gap:8px;width:100%;" @click=${(e)=>{ if(e && e.target && e.target.closest && e.target.closest('.color-dot')) return; this.toggleProject(p.id); }}>
            <span class="color-dot" data-color-id="${p.id}" style="background:${p.color}" aria-hidden="true" @click=${async (e)=>{ e.stopPropagation(); const rect = (e.currentTarget && e.currentTarget.getBoundingClientRect && e.currentTarget.getBoundingClientRect()) || (e.target && e.target.getBoundingClientRect && e.target.getBoundingClientRect()) || { left: 0, bottom: 0 }; try{ const cp = await ColorPopoverLit.ensureInstance(PALETTE); if(cp && typeof cp.openFor === 'function'){ if(cp.updateComplete) await cp.updateComplete; cp.openFor('project', p.id, rect); } }catch(err){ console.warn('Failed to open color popover', err); } }}></span>
            <div class="project-name-col" title="${p.name}" style="align-self:center">${p.name}</div>
            <div style="margin-left:auto;display:inline-flex;gap:6px;align-items:center;">
              <span class="chip-badge">${epicsCount}</span>
              <span class="chip-badge">${featuresCount}</span>
            </div>
            <input type="checkbox" style="display:none;" data-project="${p.id}" ?checked=${p.selected} />
          </div>
        </li>`;
    })}`;
  }

  renderTeams(){
    return html`${state.teams.map(t => {
      const epicsCount = state.baselineFeatures.filter(f=>f.type==='epic' && f.capacity.some(tl=>tl.team===t.id)).length;
      const featuresCount = state.baselineFeatures.filter(f=>f.type==='feature' && f.capacity.some(tl=>tl.team===t.id)).length;
      return html`
        <li class="sidebar-list-item">
          <div class="chip sidebar-chip ${t.selected? 'active':''}" style="display:flex;align-items:stretch;gap:8px;width:100%;" @click=${(e)=>{ if(e && e.target && e.target.closest && e.target.closest('.color-dot')) return; this.toggleTeam(t.id); }}>
            <span class="color-dot" data-color-id="${t.id}" style="background:${t.color}" aria-hidden="true" @click=${async (e)=>{ e.stopPropagation(); const rect = (e.currentTarget && e.currentTarget.getBoundingClientRect && e.currentTarget.getBoundingClientRect()) || (e.target && e.target.getBoundingClientRect && e.target.getBoundingClientRect()) || { left: 0, bottom: 0 }; try{ const cp = await ColorPopoverLit.ensureInstance(PALETTE); if(cp && typeof cp.openFor === 'function'){ if(cp.updateComplete) await cp.updateComplete; cp.openFor('team', t.id, rect); } }catch(err){ console.warn('Failed to open color popover', err); } }}></span>
            <div class="team-name-col" title="${t.name}" style="align-self:center">${t.name}${t.short? html` <span class="team-short">(${t.short})</span>`: ''}</div>
            <div style="margin-left:auto;display:inline-flex;gap:6px;align-items:center;">
              <span class="chip-badge">${epicsCount}</span>
              <span class="chip-badge">${featuresCount}</span>
            </div>
            <input type="checkbox" style="display:none;" data-team="${t.id}" ?checked=${t.selected} />
          </div>
        </li>`;
    })}`;
  }

  renderScenarios(){
    const sorted = [...state.scenarios].sort((a,b)=>{
      if(a.id==='baseline' && b.id!=='baseline') return -1;
      if(b.id==='baseline' && a.id!=='baseline') return 1;
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
    // Close any existing popovers
    document.querySelectorAll('.scenario-menu-popover').forEach(p=>p.remove());
    const menuBtn = e.currentTarget;
    const pop = document.createElement('div'); pop.className='scenario-menu-popover';
    const addItem = (label, emoji, onClick, disabled=false) => {
      const item = document.createElement('div'); item.className = 'scenario-menu-item';
      if(disabled) item.classList.add('disabled');
      item.innerHTML = `<span>${emoji}</span><span>${label}</span>`;
      if(!disabled) item.addEventListener('click', ev=>{ ev.stopPropagation(); onClick(); pop.remove(); });
      pop.appendChild(item);
    };
    const defaultCloneName = (()=>{
      const now = new Date();
      const mm = String(now.getMonth()+1).padStart(2,'0');
      const dd = String(now.getDate()).padStart(2,'0');
      let maxN=0; const re=/^\d{2}-\d{2} Scenario (\d+)$/i;
      state.scenarios.forEach(sc=>{ const m=re.exec(sc.name); if(m){ const n=parseInt(m[1],10); if(n>maxN) maxN=n; } });
      return `${mm}-${dd} Scenario ${maxN+1}`;
    })();
    addItem('Clone Scenario', '⎘', async ()=>{ try{ const { openScenarioCloneModal } = await import('./modalHelpers.js'); await openScenarioCloneModal({ id: s.id, name: defaultCloneName }); }catch(e){ console.warn('Failed to open clone modal', e); } });
    if(s.id === 'baseline'){
      addItem('Refresh Baseline', '🔄', async ()=>{ await state.refreshBaseline(); });
    } else {
      addItem('Rename', '✏️', async ()=>{ try{ const { openScenarioRenameModal } = await import('./modalHelpers.js'); await openScenarioRenameModal({ id: s.id, name: s.name }); }catch(e){ console.warn('Failed to open rename modal', e); } });
      addItem('Delete', '🗑️', async ()=>{ try{ const { openScenarioDeleteModal } = await import('./modalHelpers.js'); await openScenarioDeleteModal({ id: s.id, name: s.name }); }catch(e){ console.warn('Failed to open delete modal', e); } });
      addItem('Save Scenario', '💾', async ()=>{ await state.saveScenario(s.id); });
      // Save selected overrides back to Azure DevOps (annotate baseline/tasks)
      addItem('Save to Azure DevOps', '💾', async ()=>{
        const overrides = s.overrides || {};
        const overrideEntries = Object.entries(overrides);
        console.log('Preparing to annotate overrides back to Azure DevOps...', overrideEntries);
        if(overrideEntries.length === 0){ console.log('No differing overrides to annotate.'); return; }
        try{ const { openAzureDevopsModal } = await import('./modalHelpers.js'); const selected = await openAzureDevopsModal({ overrides, state }); if(selected && selected.length){ await dataService.publishBaseline(selected); } }catch(e){ console.warn('Failed to open azure modal', e); }
      });
    }
    const rect = menuBtn.getBoundingClientRect();
    pop.style.position = 'absolute';
    pop.style.top = (rect.top + window.scrollY + rect.height + 4) + 'px';
    pop.style.left = (rect.left + window.scrollX - 20) + 'px';
    document.body.appendChild(pop);
    setTimeout(()=> document.addEventListener('click', ()=> pop.remove(), { once:true }), 0);
  }

  _onScenarioClick(e, s){
    if(e.target.closest('.scenario-controls')) return; // let controls handle clicks
    state.activateScenario(s.id);
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
  try{
    // Ensure exactly one `<app-sidebar>` host exists.
    if (!document.querySelector('app-sidebar')){
      const el = document.createElement('app-sidebar');
      document.body.appendChild(el);
    }
  }catch(e){ console.warn('initSidebar failed', e); }
}
