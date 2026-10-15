import { LitElement, html } from '../vendor/lit.js';
import { cmd, sel } from '../application/imports.js';
import { bus } from '../core/EventBus.js';
import { BoardEvents } from '../core/EventRegistry.js';
import { PALETTE } from '../services/ColorService.js';
import { ColorPopoverLit } from './ColorPopover.lit.js';
import { SidebarController } from './sidebar/SidebarController.js';
import { SIDEBAR_STYLES } from './sidebar/Sidebar.styles.lit.js';
import { renderSidebarTeams } from './sidebar/SidebarTeams.lit.js';
import { renderSidebarHierarchy } from './sidebar/SidebarHierarchy.lit.js';
import { renderSidebarTaskFilters } from './sidebar/SidebarTaskFilters.lit.js';

export class SidebarLit extends LitElement {
  static properties = {
    open: { type: Boolean },
    teams: { type: Array },
    foldActive: { type: Boolean },
    foldedCount: { type: Number },
    foldableCount: { type: Number },
    canCollapse: { type: Boolean },
    teamCountsOpen: { state: true },
  };

  static styles = SIDEBAR_STYLES;

  constructor() {
    super();
    this.open = true;
    this.teams = [];
    this.foldActive = false;
    this.foldedCount = 0;
    this.foldableCount = 0;
    this.canCollapse = false;
    this.teamCountsOpen = false;
    this._controller = new SidebarController(this);
  }

  _getTeamDrilldownTeams() {
    const ids = new Set(sel.scope.getContextTeams().map((id) => String(id)));
    return this.teams.filter((team) => ids.has(String(team.id)));
  }

  _toggleTeamDrilldown(teamId) {
    const team = this.teams.find((item) => String(item.id) === String(teamId));
    cmd.selection.setTeamSelected(teamId, !(team !== undefined && team.selected), { displayOnly: true });
  }

  _toggleAllTeamDrilldown() {
    const teams = this._getTeamDrilldownTeams();
    const allSelected = teams.every((team) => team.selected);
    const selections = Object.fromEntries(teams.map((team) => [team.id, !allSelected]));
    cmd.selection.setTeamsSelectedBulk(selections, { displayOnly: true });
  }

  async _openTeamColorPopover(event, teamId) {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const connection = this._controller.connection;
    const popover = await ColorPopoverLit.ensureInstance(PALETTE);
    await popover.updateComplete;
    if (!this.isConnected || connection !== this._controller.connection) return;
    popover.openFor('team', teamId, rect);
  }

  _toggleTaskFilter(dimension, option) {
    cmd.filter.setTaskFilter(dimension, option, !sel.filter.getTaskFilters()[dimension][option]);
  }

  _toggleState(name) {
    cmd.filter.toggleStateSelected(name);
  }

  _toggleTaskType(name) {
    cmd.filter.setTaskTypeSelected(name, !sel.view.isTypeVisible(name));
  }

  setTaskFilterChecked(dimension, option, checked) {
    cmd.filter.setTaskFilter(dimension, option, checked);
  }

  setTaskTypeChecked(name, checked) {
    cmd.filter.setTaskTypeSelected(name, checked);
  }

  _applySavedTaskTypes(names) {
    cmd.filter.setSelectedTaskTypes(names);
  }

  disableSidebarElements(mapping) {
    cmd.filter.setSidebarDisabledElements(mapping);
  }

  clearSidebarDisabledElements() {
    cmd.filter.clearSidebarDisabledElements();
  }

  render() {
    const model = this._controller.getPresentationModel(this._getTeamDrilldownTeams());
    return html`
      <aside class="sidebar ${this.open ? '' : 'closed'}">
        <div class="sidebar-content">
          <section class="sidebar-section">
            <div class="expansion-section">
              <div class="section-title">Team Drill-down</div>
            ${renderSidebarTeams({ model: model.teams, actions: {
              toggleAll: () => this._toggleAllTeamDrilldown(),
              toggleCounts: () => {
                this.teamCountsOpen = !this.teamCountsOpen;
              },
              toggleTeam: (id) => this._toggleTeamDrilldown(id),
              changeColor: (event, id) => this._openTeamColorPopover(event, id),
              setTaskViewMode: (mode) => cmd.view.setTaskViewMode(mode),
            } })}
          ${renderSidebarHierarchy({ model: model.hierarchy, actions: {
            fold: (action) => bus.emit(BoardEvents.FOLD_ACTION, { action }),
          } })}
            </div>
          </section>
          <section class="sidebar-section">
            <div class="expansion-section">
              <div class="section-title">👁️ Task Filters</div>
              <div class="section-description">Filter displayed tasks by attributes</div>
              ${renderSidebarTaskFilters({ model: model.filters, actions: {
                toggleFilter: (dimension, option) => this._toggleTaskFilter(dimension, option),
                toggleState: (name) => this._toggleState(name),
                toggleType: (name) => this._toggleTaskType(name),
              } })}
            </div>
          </section>
        </div>
      </aside>
    `;
  }
}

customElements.define('app-sidebar', SidebarLit);

export async function initSidebar() {
  // Lifecycle guard: element may be absent or not upgraded yet at this phase of render/interaction.
  if (!document.querySelector('app-sidebar')) {
    document.body.appendChild(document.createElement('app-sidebar'));
  }
}