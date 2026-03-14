import { LitElement, html, css } from '../vendor/lit.js';
import { state, PALETTE } from '../services/State.js';
import { bus } from '../core/EventBus.js';
import { ProjectEvents, ViewManagementEvents } from '../core/EventRegistry.js';
import { ColorPopoverLit } from './ColorPopover.lit.js';
import { epicTemplate, featureTemplate } from '../services/IconService.js';

/**
 * PlanMenu - Dropdown menu for Plans (Projects)
 * Shows delivery plans and team backlogs with selection toggles
 */
export class PlanMenuLit extends LitElement {
  static properties = {
    projects: { type: Array },
    activeViewId: { type: String },
    activeViewData: { type: Object },
  };

  static styles = css`
    :host {
      display: block;
    }

    .menu-popover {
      background: var(--color-sidebar-bg);
      color: var(--color-sidebar-text);
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 6px;
      box-shadow: 0 6px 18px rgba(0,0,0,0.25);
      min-width: 320px;
      max-width: 400px;
      max-height: 500px;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .counts-header { 
      display:grid;
      grid-template-columns: 24px 28px 1fr 58px 31px;
      align-items:center;
      gap:8px;
      color:#ddd;
    }
    
    .type-icon { display:inline-flex; align-items:center; }
    .type-icon.epic { color: #ffcf33; margin-left:30px; }
    .type-icon svg { width: 16px; height: 16px; display: block; }

    .sidebar-list { 
      list-style:none; 
      padding:0; 
      display:flex; 
      flex-direction:column; 
      gap:4px; 
      margin:0; 
    }
    
    .sidebar-list-item { display:block; }
    
    .sidebar-chip { 
      padding:0 8px 0 0; 
      border-radius:10px; 
      background:transparent; 
      border:1px solid rgba(0,0,0,0.06); 
      box-sizing:border-box; 
      min-height:25px; 
      overflow:hidden; 
      display:flex; 
      align-items:stretch; 
    }
    
    .sidebar-chip:hover { 
      background: rgba(255,255,255,0.18); 
      cursor: pointer; 
    }
    
    .sidebar-chip.active { 
      background: rgb(55, 85, 130); 
      border-color: transparent; 
    }
    
    .sidebar-chip.active:hover { 
      background: rgba(255,255,255,0.18); 
    }
    
    .sidebar-list .color-dot { 
      width:28px; 
      border-radius:6px 0 0 6px; 
      display:inline-block; 
      flex:0 0 28px; 
      align-self:stretch; 
      cursor: pointer; 
    }
    
    .sidebar-chip .project-name-col { 
      padding-left:8px; 
      font-weight:600; 
      font-size:0.8rem; 
      color:var(--color-sidebar-text); 
    }
    
    .chip-badge { 
      display:inline-flex; 
      align-items:center; 
      justify-content:center; 
      width:30px; 
      height:18px; 
      border-radius:9px; 
      font-size:0.7rem; 
      font-weight:700; 
      background:rgba(0,0,0,0.06); 
      color:var(--color-sidebar-text); 
    }
    
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
      background: transparent;
    }

    .divider { 
      border-top:1px dashed rgba(255,255,255,0.32); 
      margin:4px 0; 
      border-radius:2px; 
      height:0; 
    }
    
    .plans-group { 
      display:flex; 
      flex-direction:column; 
      gap:4px; 
    }
  `;

  constructor() {
    super();
    this.projects = [];
    this.activeViewId = null;
    this.activeViewData = null;
  }

  connectedCallback() {
    super.connectedCallback();
    
    // Listen to project changes for real-time updates
    this._onProjectsChanged = (projects) => {
      this.projects = projects ? [...projects] : [];
      this.requestUpdate();
    };
    
    this._onViewActivated = (payload) => {
      this.activeViewId = payload?.id || null;
      this.activeViewData = payload?.data || null;
      this.requestUpdate();
    };

    bus.on(ProjectEvents.CHANGED, this._onProjectsChanged);
    bus.on(ViewManagementEvents.ACTIVATED, this._onViewActivated);

    // Don't initialize from state - projects are passed as properties from TopMenu
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._onProjectsChanged) bus.off(ProjectEvents.CHANGED, this._onProjectsChanged);
    if (this._onViewActivated) bus.off(ViewManagementEvents.ACTIVATED, this._onViewActivated);
  }

  _getFilteredProjects() {
    if (!this.activeViewId || this.activeViewId === 'default' || !this.activeViewData) {
      return this.projects || [];
    }
    return (this.projects || []).filter(project => 
      this.activeViewData.selectedProjects?.[project.id] === true
    );
  }

  _toggleProject(pid) {
    const current = (this.projects || []).find(p => p.id === pid);
    const newVal = !(current && current.selected);
    state.setProjectSelected(pid, newVal);
  }

  _handleProjectToggle() {
    const projects = this._getFilteredProjects();
    const anyUnchecked = projects.some(p => !p.selected);
    // Use bulk update to avoid O(n) capacity recalculations
    const selections = {};
    projects.forEach(p => selections[p.id] = anyUnchecked);
    state.setProjectsSelectedBulk(selections);
  }

  _anyUncheckedProjects() {
    return this._getFilteredProjects().some(p => !p.selected);
  }

  async _openColorPopover(e, projectId) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const cp = await ColorPopoverLit.ensureInstance(PALETTE);
    await cp.updateComplete;
    cp.openFor('project', projectId, rect);
  }

  _renderProjectsList(projects) {
    return html`${projects.map(project => {
      const epicsCount = state.countEpicsForProject(project.id);
      const featuresCount = state.countFeaturesForProject(project.id);
      
      return html`
        <li class="sidebar-list-item">
          <div class="chip sidebar-chip ${project.selected ? 'active' : ''}" 
               @click=${(e) => { if(!e.target.closest('.color-dot')) this._toggleProject(project.id); }}
               style="display:flex;align-items:stretch;gap:8px;width:100%;">
            <span class="color-dot" 
                  style="background:${project.color}"
                  @click=${(e) => this._openColorPopover(e, project.id)}></span>
            <div class="project-name-col" title="${project.name}" style="align-self:center">
              ${project.name}
            </div>
            <div style="margin-left:auto;display:inline-flex;gap:6px;align-items:center;">
              <span class="chip-badge">${epicsCount}</span>
              <span class="chip-badge">${featuresCount}</span>
            </div>
          </div>
        </li>
      `;
    })}`;
  }

  render() {
    const projects = this._getFilteredProjects();
    const delivery = projects.filter(p => (p.type || 'project') === 'project');
    const teamBacklogs = projects.filter(p => (p.type || 'project') !== 'project');

    return html`
      <div class="menu-popover">
        <div class="counts-header">
          <span></span>
          <button class="list-toggle-btn" 
                  @click=${this._handleProjectToggle}
                  title="Select all / Clear all projects">
            ${this._anyUncheckedProjects() ? 'All' : 'None'}
          </button>
          <span></span>
          <span class="type-icon epic" title="Epics">${epicTemplate}</span>
          <span class="type-icon feature" title="Features">${featureTemplate}</span>
        </div>
        
        <div class="plans-group">
          ${delivery.length ? html`
            <ul class="sidebar-list">
              ${this._renderProjectsList(delivery)}
            </ul>
          ` : ''}
          
          ${delivery.length && teamBacklogs.length ? html`
            <div class="divider"></div>
          ` : ''}
          
          ${teamBacklogs.length ? html`
            <ul class="sidebar-list">
              ${this._renderProjectsList(teamBacklogs)}
            </ul>
          ` : ''}
        </div>
      </div>
    `;
  }
}

customElements.define('plan-menu', PlanMenuLit);
