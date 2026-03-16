import { LitElement, html, css } from '../vendor/lit.js';
import { state, PALETTE } from '../services/State.js';
import { bus } from '../core/EventBus.js';
import { TeamEvents, ViewManagementEvents } from '../core/EventRegistry.js';
import { ColorPopoverLit } from './ColorPopover.lit.js';
import { epicTemplate, featureTemplate } from '../services/IconService.js';

/**
 * TeamMenu - Dropdown menu for Teams/Allocations
 * Shows teams with selection toggles
 */
export class TeamMenuLit extends LitElement {
  static properties = {
    teams: { type: Array },
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
    
    .sidebar-chip .team-name-col { 
      padding-left:8px; 
      font-weight:600; 
      font-size:0.8rem; 
      color:var(--color-sidebar-text); 
    }
    
    .team-short {
      font-weight: 400;
      opacity: 0.85;
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
  `;

  constructor() {
    super();
    this.teams = [];
    this.activeViewId = null;
    this.activeViewData = null;
  }

  connectedCallback() {
    super.connectedCallback();
    
    // Listen to team changes for real-time updates
    this._onTeamsChanged = (teams) => {
      this.teams = teams ? [...teams] : [];
      this.requestUpdate();
    };
    
    this._onViewActivated = (payload) => {
      this.activeViewId = payload?.id || null;
      this.activeViewData = payload?.data || null;
      this.requestUpdate();
    };

    bus.on(TeamEvents.CHANGED, this._onTeamsChanged);
    bus.on(ViewManagementEvents.ACTIVATED, this._onViewActivated);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._onTeamsChanged) bus.off(TeamEvents.CHANGED, this._onTeamsChanged);
    if (this._onViewActivated) bus.off(ViewManagementEvents.ACTIVATED, this._onViewActivated);
  }

  _toggleTeam(tid) {
    const current = (this.teams || []).find(t => t.id === tid);
    const newVal = !(current && current.selected);
    state.setTeamSelected(tid, newVal);
  }

  _handleTeamToggle() {
    const teams = this.teams || [];
    const anyUnchecked = teams.some(t => !t.selected);
    // Use bulk update to avoid O(n) capacity recalculations
    const selections = {};
    teams.forEach(t => selections[t.id] = anyUnchecked);
    state.setTeamsSelectedBulk(selections);
  }

  _anyUncheckedTeams() {
    return (this.teams || []).some(t => !t.selected);
  }

  async _openColorPopover(e, teamId) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const cp = await ColorPopoverLit.ensureInstance(PALETTE);
    await cp.updateComplete;
    cp.openFor('team', teamId, rect);
  }

  render() {
    const teams = this.teams || [];

    return html`
      <div class="menu-popover">
        <div class="counts-header">
          <span></span>
          <button class="list-toggle-btn" 
                  @click=${this._handleTeamToggle}
                  title="Select all / Clear all teams">
            ${this._anyUncheckedTeams() ? 'All' : 'None'}
          </button>
          <span></span>
          <span class="type-icon epic" title="Epics">${epicTemplate}</span>
          <span class="type-icon feature" title="Features">${featureTemplate}</span>
        </div>
        
        <ul class="sidebar-list">
          ${teams.map(team => {
            const epicsCount = state.countEpicsForTeam(team.id);
            const featuresCount = state.countFeaturesForTeam(team.id);
            
            return html`
              <li class="sidebar-list-item">
                <div class="chip sidebar-chip ${team.selected ? 'active' : ''}" 
                     @click=${(e) => { if(!e.target.closest('.color-dot')) this._toggleTeam(team.id); }}
                     style="display:flex;align-items:stretch;gap:8px;width:100%;">
                  <span class="color-dot" 
                        style="background:${team.color}"
                        @click=${(e) => this._openColorPopover(e, team.id)}></span>
                  <div class="team-name-col" title="${team.name}" style="align-self:center">
                    ${team.name}${team.short ? html` <span class="team-short">(${team.short})</span>` : ''}
                  </div>
                  <div style="margin-left:auto;display:inline-flex;gap:6px;align-items:center;">
                    <span class="chip-badge">${epicsCount}</span>
                    <span class="chip-badge">${featuresCount}</span>
                  </div>
                </div>
              </li>
            `;
          })}
        </ul>
      </div>
    `;
  }
}

customElements.define('team-menu', TeamMenuLit);
