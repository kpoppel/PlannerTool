import { PopoverBase } from './PopoverBase.lit.js';
import { html, css } from '../../vendor/lit.js';
import { state, PALETTE } from '../../services/State.js';
import { bus } from '../../core/EventBus.js';
import { TeamEvents } from '../../core/EventRegistry.js';
import { ColorPopoverLit } from '../ColorPopover.lit.js';
import { epicTemplate, featureTemplate } from '../../services/IconService.js';

/**
 * AllocationPopover - Popover component for team allocation selection
 */
export class AllocationPopover extends PopoverBase {
  static properties = {
    ...PopoverBase.properties,
    teams: { type: Array }
  };

  static styles = [
    PopoverBase.styles,
    css`
      .popover-container {
        min-width: 300px;
        max-width: 400px;
        background: #fff;
        color: #222;
        border: 1px solid rgba(0,0,0,0.12);
        box-shadow: 0 6px 18px rgba(0,0,0,0.18);
      }

      .header-section {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 4px;
        padding: 4px 8px;
        background: rgba(0, 0, 0, 0.04);
        border-radius: 4px;
      }

      .header-title {
        font-weight: 600;
        font-size: 13px;
        flex: 1;
        color: #222;
      }

      .toggle-button {
        background: #f7f7f7;
        border: 1px solid rgba(0, 0, 0, 0.12);
        border-radius: 4px;
        padding: 4px 10px;
        color: #222;
        cursor: pointer;
        font-size: 12px;
        transition: background 0.2s;
      }

      .toggle-button:hover {
        background: #ececec;
      }

      .counts-header {
        display: grid;
        grid-template-columns: 16px 1fr 31px 31px;
        align-items: center;
        gap: 8px;
        padding: 4px 8px;
        color: #666;
        font-size: 12px;
        margin-bottom: 2px;
      }

      .team-item {
        display: grid;
        grid-template-columns: 16px 1fr 31px 31px;
        align-items: center;
        padding: 6px 8px;
        cursor: pointer;
        border-radius: 4px;
        transition: background 0.2s;
        gap: 8px;
        margin: 0 4px;
        color: #222;
      }

      .team-item:hover {
        background: #f3f5f7;
      }

      .team-item.active {
        background: #e8f0fe;
        font-weight: 600;
      }

      .color-dot {
        width: 16px;
        height: 16px;
        border-radius: 4px;
        flex: 0 0 auto;
        cursor: pointer;
      }

      .team-name {
        flex: 1;
        font-size: 14px;
        color: #222;
      }

      .team-short {
        font-size: 12px;
        color: #666;
        margin-left: 4px;
      }

      .badge-group {
        display: contents;
      }

      .chip-badge {
        padding: 2px 6px;
        border-radius: 10px;
        font-size: 11px;
        background: rgba(0, 0, 0, 0.08);
        color: #222;
        white-space: nowrap;
        text-align: center;
        min-width: 22px;
      }

      .type-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .type-icon.epic {
        color: #ffcf33;
      }

      .type-icon.feature {
        color: #5cc8ff;
      }

      .type-icon svg {
        width: 14px;
        height: 14px;
        display: block;
      }

      .empty-state {
        padding: 16px;
        text-align: center;
        color: #666;
        font-size: 13px;
      }
    `
  ];

  constructor() {
    super();
    this.teams = [];
    this._onTeamsChanged = this._onTeamsChanged.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    bus.on(TeamEvents.CHANGED, this._onTeamsChanged);
    this._loadTeams();
  }

  disconnectedCallback() {
    bus.off(TeamEvents.CHANGED, this._onTeamsChanged);
    super.disconnectedCallback();
  }

  _onTeamsChanged() {
    this._loadTeams();
  }

  _loadTeams() {
    this.teams = state.teams || [];
    this.requestUpdate();
  }

  _toggleTeam(teamId) {
    const current = this.teams.find(t => t.id === teamId);
    const newVal = !(current && current.selected);
    state.setTeamSelected(teamId, newVal);
  }

  _toggleAll(selectAll) {
    const selections = this.teams.reduce((acc, t) => {
      acc[t.id] = selectAll;
      return acc;
    }, {});
    state.setTeamsSelectedBulk(selections);
  }

  async _openColorPopover(e, teamId) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const cp = await ColorPopoverLit.ensureInstance(PALETTE);
    await cp.updateComplete;
    cp.openFor('team', teamId, rect);
  }

  _renderTeamItem(team) {
    // For teams, only count features with non-zero allocation
    const epicsCount = state.countEpicsForTeam(team.id);
    const featuresCount = state.countFeaturesForTeam(team.id);

    return html`
      <div
        class="team-item ${team.selected ? 'active' : ''}"
        @click=${e => {
          if (!e.target.closest('.color-dot')) {
            this._toggleTeam(team.id);
          }
        }}>
        <span
          class="color-dot"
          style="background: ${team.color}"
          @click=${e => this._openColorPopover(e, team.id)}
          title="Change color"></span>
        <span class="team-name" title="${team.name}">
          ${team.name}
          ${team.short ? html`<span class="team-short">(${team.short})</span>` : ''}
        </span>
        <span class="chip-badge">${epicsCount}</span>
        <span class="chip-badge">${featuresCount}</span>
      </div>
    `;
  }

  renderContent() {
    if (!this.teams || this.teams.length === 0) {
      return html`
        <div class="empty-state">
          No teams available
        </div>
      `;
    }

    const anyUnchecked = this.teams.some(t => !t.selected);

    return html`
      <div class="header-section">
        <span class="header-title">Teams</span>
        <button
          class="toggle-button"
          @click=${() => this._toggleAll(anyUnchecked)}
          title="${anyUnchecked ? 'Select all' : 'Clear all'}">
          ${anyUnchecked ? 'All' : 'None'}
        </button>
      </div>
      <div class="counts-header">
        <span></span>
        <span></span>
        <span class="type-icon epic" title="Epics">${epicTemplate}</span>
        <span class="type-icon feature" title="Features">${featureTemplate}</span>
      </div>
      <div class="teams-list">
        ${this.teams.map(t => this._renderTeamItem(t))}
      </div>
    `;
  }
}

customElements.define('allocation-popover', AllocationPopover);
