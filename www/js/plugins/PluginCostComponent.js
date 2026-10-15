/**
 * PluginCostComponent
 * LitElement component providing three-view cost analysis.
 *
 * Views:
 * - Project: Per-project team-month breakdown tables
 * - Task: Hierarchy-aware cost and hours table
 * - Team: Per-team feature allocation tables
 *
 * All views show monthly Int/Ext cost/hours breakdowns with date range
 * and cost/hours toggle controls.
 */
import { LitElement, html, css } from '../vendor/lit.js';
import { cmd, sel } from '../application/imports.js';
import { dataService } from '../services/dataService.js';
import { buildMonths, monthKey, monthLabel } from './PluginCostCalculator.js';

import { renderProjectView } from './PluginCostProjectView.js';
import { renderTaskView } from './PluginCostTaskView.js';
import { renderTeamView } from './PluginCostTeamView.js';
import { renderTeamMembersView } from './PluginCostTeamMembersView.js';
import { bus } from '../core/EventBus.js';
import {
  FeatureEvents,
  ProjectEvents,
  TeamEvents,
  ScenarioEvents,
  FilterEvents,
} from '../core/EventRegistry.js';
import { pluginManager } from '../core/PluginManager.js';

export class PluginCostComponent extends LitElement {
  static properties = {
    activeView: { type: String }, // 'project' | 'task' | 'team'
    viewMode: { type: String }, // 'cost' | 'hours'
    startDate: { type: String },
    endDate: { type: String },
    data: { type: Object },
    costTeams: { state: true },
    loading: { type: Boolean },
    error: { type: String },
    expandedProjects: { type: Object },
    expandedTasks: { type: Object },
    projectViewSelection: { type: Object },
  };

  constructor() {
    super();
    this.activeView = 'project';
    this.viewMode = 'cost';
    this.data = null;
    this.costTeams = null;
    this.loading = false;
    this.error = null;
    this.expandedProjects = new Set();
    this.expandedTasks = new Set();
    this.expandedTeams = new Set();
    this.projectViewSelection = {}; // per-project: 'teams' | 'features'

    // Default date range: current year
    const now = new Date();
    const year = now.getFullYear();
    this._defaultStartDate = `${year}-01-01`;
    this._defaultEndDate = `${year}-12-31`;
    this.startDate = this._defaultStartDate;
    this.endDate = this._defaultEndDate;

    this.months = [];
    this._unsubscribes = [];
    this._reloadTimer = null;
  }

  static styles = css`
    :host {
      display: none;
      flex-direction: column;
      width: 100%;
      height: 100vh;
      background: white;
      overflow: hidden;
      z-index: 300;
    }

    :host([visible]) {
      display: flex;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 12px 16px;
      background: #f5f5f5;
      border-bottom: 1px solid #ddd;
      flex-shrink: 0;
    }

    .toolbar-title {
      font-size: 16px;
      font-weight: 600;
      color: #333;
    }

    .tab-buttons {
      display: flex;
      gap: 4px;
      margin-left: 16px;
    }

    .tab-buttons button {
      padding: 6px 16px;
      background: white;
      border: 1px solid #ddd;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      color: #666;
      transition: all 0.2s;
    }

    .tab-buttons button:hover {
      background: #fafafa;
      border-color: #999;
    }

    .tab-buttons button.active {
      background: #2196f3;
      color: white;
      border-color: #2196f3;
    }

    .view-toggle {
      display: flex;
      gap: 4px;
      margin-left: auto;
    }

    .toolbar-spacer {
      flex: 1 1 auto;
      min-width: 8px;
    }

    .view-toggle button {
      padding: 6px 12px;
      background: white;
      border: 1px solid #ddd;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      color: #666;
    }

    .view-toggle button.active {
      background: #4caf50;
      color: white;
      border-color: #4caf50;
    }

    .date-controls {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .date-controls label {
      font-size: 13px;
      color: #666;
    }

    .date-controls input[type='date'] {
      padding: 4px 8px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 13px;
    }

    .close-btn {
      padding: 6px 12px;
      background: #f44336;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      margin-left: 8px;
    }

    .close-btn:hover {
      background: #d32f2f;
    }

    .content {
      flex: 1;
      overflow: auto;
      padding: 16px;
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      font-size: 14px;
      color: #666;
    }

    .error {
      padding: 16px;
      background: #ffebee;
      border: 1px solid #f44336;
      border-radius: 4px;
      color: #c62828;
      margin: 16px;
    }

    .error-title {
      font-weight: 600;
      margin-bottom: 8px;
    }

    .empty-state {
      padding: 32px;
      text-align: center;
      color: #666;
    }

    .empty-state h3 {
      margin-bottom: 8px;
      font-size: 16px;
      color: #333;
    }

    .empty-state p {
      font-size: 14px;
      margin-bottom: 16px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      margin-bottom: 24px;
    }

    th,
    td {
      padding: 8px;
      text-align: left;
      border: 1px solid #ddd;
    }

    th {
      background: #f5f5f5;
      font-weight: 600;
      color: #333;
    }

    td {
      color: #666;
    }

    tr:hover {
      background: #fafafa;
    }

    .numeric {
      text-align: right;
      font-family: 'Courier New', monospace;
    }

    .context-row {
      background: #f4f6f5;
      color: #535d58;
    }

    .context-label {
      margin-left: 8px;
      font-size: 11px;
      font-weight: 600;
      color: #59655e;
    }

    .estimate-comparison {
      font-size: 12px;
      line-height: 1.5;
    }

    .estimate-deviation {
      color: #9b4b15;
      font-weight: 600;
    }

    .expandable {
      cursor: pointer;
      user-select: none;
    }

    .expandable:hover {
      background: #f0f0f0;
    }

    .expand-icon {
      display: inline-block;
      width: 16px;
      margin-right: 4px;
      transition: transform 0.2s;
    }

    .expand-icon.expanded {
      transform: rotate(90deg);
    }

    .project-header {
      font-weight: 600;
      font-size: 14px;
      color: #1976d2;
    }

    .team-header {
      font-weight: 600;
      font-size: 14px;
      color: #4caf50;
    }

    .totals-row {
      font-weight: 600;
      background: #f9f9f9;
    }
    /* Small toggle buttons used inside project view for compact controls */
    .project-toggle-btn {
      padding: 6px 10px;
      background: #fff;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      color: #444;
      transition: all 0.15s ease;
      box-shadow: none;
    }
    .project-toggle-btn:hover {
      background: #fafafa;
      transform: translateY(-1px);
      border-color: #cfcfcf;
    }
    .project-toggle-btn.active {
      background: linear-gradient(180deg, #1976d2, #1565c0);
      color: white;
      border-color: #1565c0;
      box-shadow: 0 1px 0 rgba(0, 0, 0, 0.04);
    }
    /* Summary table improvements for readability */
    .summary-table {
      border-collapse: separate;
      border-spacing: 0;
      width: 100%;
    }
    .summary-table tbody tr.group-header-row td {
      background: transparent;
      padding-top: 10px;
      padding-bottom: 4px;
      font-weight: 700;
      color: #333;
      border-top: 2px solid #e6e6e6;
    }
    .summary-table tbody tr.group-row td {
      background: white;
    }
    /* Use explicit 'alt' class for consistent banding across paired rows */
    .summary-table tr.alt td {
      background: #efefef;
    }
    .summary-table td.metric {
      width: 280px;
      white-space: nowrap;
    }
    .summary-table td.sum-column,
    .summary-table th.sum-column {
      background: #e8f2ff;
      font-weight: 700;
      border-left: 2px solid #dfe9f6;
      color: #123b5a;
    }
    /* Apply consistent Sum styling across all tables */
    table td.sum-column,
    table th.sum-column {
      background: #e8f2ff;
      font-weight: 700;
      color: #123b5a;
      border-left: 2px solid #dfe9f6;
    }
    /* Ensure Sum column keeps its blue shade even when row cells are white or alt-banded */
    .summary-table tr.site-pair td.sum-column,
    .summary-table tr.group-row td.sum-column,
    .summary-table tr.alt td.sum-column {
      background: #e8f2ff;
      font-weight: 700;
      color: #123b5a;
    }
    /* Slightly different shade for alt-banded pairs to indicate grouping */
    .summary-table tr.site-pair.alt td.sum-column,
    .summary-table tr.group-row.alt td.sum-column {
      background: #d7ebff;
    }
    /* Ensure alt rows don't override the Sum column background */
    .summary-table tr.alt td.sum-column,
    .summary-table tr.site-pair.alt td.sum-column,
    .summary-table tr.group-row.alt td.sum-column {
      background: #e8f2ff;
    }
    /* Per-site paired rows (Hours + Cost) with alternating banding */
    .summary-table tr.site-pair td {
      background: white;
    }
    .summary-table tr.site-pair.alt td {
      background: #efefef;
    }
    .summary-table tr.group-row.alt td {
      background: #efefef;
    }
    .summary-table tr.site-pair td:first-child {
      padding-left: 12px;
    }

    /* Icon sizing for type icons used in lists/tables */
    .type-icon {
      display: inline-flex;
      align-items: center;
      vertical-align: middle;
    }
    .type-icon svg {
      width: 16px;
      height: 16px;
      display: block;
    }
    button.type-icon {
      padding: 2px;
      border: 0;
      background: transparent;
      cursor: pointer;
    }
    button.type-icon:focus-visible {
      outline: 2px solid #3498db;
      outline-offset: 2px;
    }
    /* Clip-window indicators: shown on features whose dates extend outside the selected period */
    .clip-warning {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-left: 4px;
      font-size: 10px;
      color: #e65100;
      cursor: default;
      vertical-align: middle;
      opacity: 0.8;
    }
    /* Team Members summary grid for consistent alignment */
    .team-summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
      cursor: pointer;
    }
    .team-name {
      min-width: 260px;
      flex: 1 1 auto;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .team-metrics {
      display: flex;
      gap: 12px;
      align-items: center;
      color: #333;
      font-size: 13px;
      flex: 0 0 auto;
    }
    .team-metric {
      min-width: 120px;
      text-align: right;
      color: #333;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `;

  open() {
    this.setAttribute('visible', '');
    // Cost view stacks above the details panel, so an open panel must close first.
    const detailsPanel = document.querySelector('details-panel');
    if (detailsPanel && detailsPanel.open) detailsPanel.hide();
    this._persistPluginState();
    this.loadData();
    // Ensure sidebar disabled state is applied when plugin UI opens
    this._applySidebarDisabled();
  }

  close() {
    this.removeAttribute('visible');

    if (this._reloadTimer) {
      clearTimeout(this._reloadTimer);
      this._reloadTimer = null;
    }

    // Restore sidebar controls when the plugin closes.
    cmd.filter.clearSidebarDisabledElements();
  }

  _persistPluginState() {
    const snapshot = {
      startDate: this.startDate,
      endDate: this.endDate,
    };

    cmd.pluginState.update(this._getPluginId(), snapshot, { saveToView: true });
  }

  _getPluginId() {
    return this.pluginId || 'plugin-cost';
  }

  _applyPluginState(pluginState) {
    const nextStartDate = pluginState && pluginState.startDate ?
      pluginState.startDate
    : this._defaultStartDate;
    const nextEndDate = pluginState && pluginState.endDate ?
      pluginState.endDate
    : this._defaultEndDate;
    const changed = this.startDate !== nextStartDate || this.endDate !== nextEndDate;

    if (!changed) return;

    this.startDate = nextStartDate;
    this.endDate = nextEndDate;
    this.requestUpdate();

    if (this.hasAttribute('visible')) {
      this.loadData();
    }
  }

  // Keep sidebar controls available without changing selections.
  _applySidebarDisabled() {
    cmd.filter.setTaskFilter('schedule', 'unplanned', false, { suppressEvents: true });
    const taskFilters = sel.filter.getTaskFilters();
    cmd.filter.setSidebarDisabledElements({
      taskFilters: Object.fromEntries(Object.entries(taskFilters)
        .filter(([dimension]) => dimension !== 'schedule' && dimension !== 'allocation')
        .map(([dimension, options]) => [dimension, Object.keys(options)])),
    });
  }

  connectedCallback() {
    super.connectedCallback();
    // Subscribe to global state events that should trigger a recalculation
    this._unsubscribes.push(bus.on(FeatureEvents.UPDATED, () => this._scheduleReload()));
    this._unsubscribes.push(bus.on(ProjectEvents.CHANGED, () => this._scheduleReload()));
    this._unsubscribes.push(bus.on(TeamEvents.CHANGED, () => this._scheduleReload()));
    this._unsubscribes.push(
      bus.on(ScenarioEvents.ACTIVATED, () => this._scheduleReload())
    );
    this._unsubscribes.push(bus.on(ScenarioEvents.UPDATED, () => this._scheduleReload()));
    this._unsubscribes.push(bus.on(FilterEvents.CHANGED, () => this._scheduleReload()));
    this._unsubscribes.push(
      cmd.pluginState.subscribe(this._getPluginId(), (pluginState) => {
        this._applyPluginState(pluginState);
      })
    );
    // Keep sidebar filters available while this plugin is active.
    this._applySidebarDisabled();
  }

  disconnectedCallback() {
    // Unsubscribe all listeners
    for (const unsubscribe of this._unsubscribes) {
      unsubscribe();
    }
    this._unsubscribes = [];

    if (this._reloadTimer) {
      clearTimeout(this._reloadTimer);
      this._reloadTimer = null;
    }

    cmd.filter.clearSidebarDisabledElements();
    super.disconnectedCallback();
  }

  _scheduleReload() {
    // Debounce rapid events
    try {
      // If the UI is not visible (plugin closed) avoid reloading data.
      if (!this.hasAttribute('visible')) return;
      if (this._reloadTimer) clearTimeout(this._reloadTimer);
      this._reloadTimer = setTimeout(() => {
        this._reloadTimer = null;
        this.loadData();
      }, 200);
    } catch (e) {
      this.loadData();
    }
  }

  _closeClicked() {
    const plugin = pluginManager.get(this._getPluginId());
    if (plugin) plugin.deactivate();
  }

  async openFeatureDetails(featureId) {
    const feature = sel.feature.getEffectiveFeatureById(String(featureId));
    if (feature === null) throw new Error(`Task ${featureId} is not loaded`);
    await pluginManager.deactivate(this._getPluginId());
    cmd.feature.setSelectedFeature(feature);
  }

  async loadData() {
    this.loading = true;
    this.error = null;

    try {
      // Build months list
      this.months = buildMonths({
        dataset_start: this.startDate,
        dataset_end: this.endDate,
      });

      // Cost reports selected-plan scope plus explicitly enabled Context. Team
      // Drill-down and final task visibility must not alter financial inputs.
      const contextFeatures = sel.scope.getContextFeatures();

      if (contextFeatures.length === 0) {
        throw new Error(
          'No features available. Please ensure one or more plans are selected.'
        );
      }

      // Resolve winners over the complete scenario graph; filters only select report rows.
      const reportIds = new Set(sel.scope.getVisibleFeatures()
        .map((feature) => String(feature.id)));
      const featuresPayload = sel.feature.getEffectiveFeatures();
      const selectedStates = sel.filter.getSelectedFeatureStateSet();
      const reportFilterIds = new Set(featuresPayload
        .filter((feature) => selectedStates.has(feature.state)
          && sel.filter.featurePassesFilters(feature))
        .map((feature) => String(feature.id)));

      // Fetch cost data
      const costResult = await dataService.getCost({ features: featuresPayload });
      if (!costResult.ok) throw new Error(costResult.error.message, { cause: costResult.error });
      const json = costResult.data;

      const payloadById = new Map(featuresPayload.map((feature) => [String(feature.id), feature]));

      const projectsById = {};
      for (const project of json.projects) {
        project.features = project.features.map((feature) => {
          const source = payloadById.get(String(feature.id));
          return { ...feature, capacity: source.capacity, stateCategory: source.stateCategory,
            project: project.id,
            displayMode: !reportFilterIds.has(String(feature.id)) ? 'excluded'
              : reportIds.has(String(feature.id)) ? 'normal' : 'context' };
        });
        projectsById[String(project.id)] = project;
      }
      json.projects = projectsById;

      this.data = json;

      // Fetch cost teams metadata (members + sites) to enable per-site breakdowns
      const teamsResult = await dataService.getCostTeams();
      if (!teamsResult.ok) throw new Error(teamsResult.error.message, { cause: teamsResult.error });
      this.costTeams = teamsResult.data;

      this.expandedProjects = new Set(sel.selection.getSelectedProjectIds());

      this.loading = false;
      this.requestUpdate();
    } catch (err) {
      console.error('[PluginCost] Failed to load data:', err);
      this.error = err.message;
      this.loading = false;
    }
  }

  handleViewChange(view) {
    this.activeView = view;
    this.requestUpdate();
  }

  handleViewModeChange(mode) {
    this.viewMode = mode;
    this.requestUpdate();
  }

  handleDateChange() {
    this._persistPluginState();
    // Rebuild months and reload data
    this.loadData();
  }

  toggleProject(projectId) {
    if (this.expandedProjects.has(projectId)) {
      this.expandedProjects.delete(projectId);
    } else {
      this.expandedProjects.add(projectId);
    }
    this.requestUpdate();
  }

  toggleTask(taskId) {
    if (this.expandedTasks.has(taskId)) {
      this.expandedTasks.delete(taskId);
    } else {
      this.expandedTasks.add(taskId);
    }
    this.requestUpdate();
  }

  toggleTeam(teamId) {
    if (this.expandedTeams.has(teamId)) {
      this.expandedTeams.delete(teamId);
    } else {
      this.expandedTeams.add(teamId);
    }
    this.requestUpdate();
  }

  setProjectView(projectId, view) {
    // Toggle behaviour: if the requested view is already selected, unset it
    const current = this.projectViewSelection && this.projectViewSelection[projectId];
    if (current === view) {
      const copy = Object.assign({}, this.projectViewSelection);
      delete copy[projectId];
      this.projectViewSelection = copy;
    } else {
      this.projectViewSelection = Object.assign({}, this.projectViewSelection, {
        [projectId]: view,
      });
    }
    this.requestUpdate();
  }

  renderToolbar() {
    return html`
      <div class="toolbar">
        <div class="toolbar-title">Cost Analysis</div>

        <div class="tab-buttons">
          <button
            class="${this.activeView === 'project' ? 'active' : ''}"
            @click="${() => this.handleViewChange('project')}"
          >
            Plan View
          </button>
          <button
            class="${this.activeView === 'task' ? 'active' : ''}"
            @click="${() => this.handleViewChange('task')}"
          >
            Task View
          </button>
          <button
            class="${this.activeView === 'team' ? 'active' : ''}"
            @click="${() => this.handleViewChange('team')}"
          >
            Team View
          </button>
          <button
            class="${this.activeView === 'team-members' ? 'active' : ''}"
            @click="${() => this.handleViewChange('team-members')}"
          >
            Workforce
          </button>
        </div>

        ${this.activeView !== 'team-members' ?
          html`
            <div class="date-controls">
              <label for="start-date">From:</label>
              <input
                type="date"
                id="start-date"
                .value="${this.startDate}"
                @change="${(e) => {
                  this.startDate = e.target.value;
                  this.handleDateChange();
                }}"
              />
              <label for="end-date">To:</label>
              <input
                type="date"
                id="end-date"
                .value="${this.endDate}"
                @change="${(e) => {
                  this.endDate = e.target.value;
                  this.handleDateChange();
                }}"
              />
            </div>
          `
        : ''}
        ${(() => {
          // For Team view always show the global Cost/Hours toggle.
          if (this.activeView === 'team') {
            return html`
              <div class="view-toggle">
                <button
                  class="${this.viewMode === 'cost' ? 'active' : ''}"
                  @click="${() => this.handleViewModeChange('cost')}"
                >
                  Cost
                </button>
                <button
                  class="${this.viewMode === 'hours' ? 'active' : ''}"
                  @click="${() => this.handleViewModeChange('hours')}"
                >
                  Hours
                </button>
              </div>
            `;
          }
          // For Project (Plan) view only show when at least one expanded project
          // has a selected sub-view (teams or features) so the sub-tables are visible.
          if (this.activeView === 'project') {
            const expanded = Array.from(this.expandedProjects);
            const show = expanded.some(
              (pid) => this.projectViewSelection && this.projectViewSelection[pid]
            );
            if (show) {
              return html`
                <div class="view-toggle">
                  <button
                    class="${this.viewMode === 'cost' ? 'active' : ''}"
                    @click="${() => this.handleViewModeChange('cost')}"
                  >
                    Cost
                  </button>
                  <button
                    class="${this.viewMode === 'hours' ? 'active' : ''}"
                    @click="${() => this.handleViewModeChange('hours')}"
                  >
                    Hours
                  </button>
                </div>
              `;
            }
          }
          return '';
        })()}

        <div class="toolbar-spacer"></div>
        <button class="close-btn" @click="${() => this._closeClicked()}">Close</button>
      </div>
    `;
  }

  renderProjectView() {
    return renderProjectView(this);
  }

  renderProjectTable() {
    return null;
  }

  buildTeamMonthAllocations() {
    return null;
  }

  renderProjectSummaryTable(teams, teamAllocations, monthKeys) {
    return null;
  }

  renderTeamMonthTable(teams, teamAllocations, monthKeys) {
    return null;
  }

  renderFeatureList(features, monthKeys) {
    return null;
  }

  renderTaskView() {
    return renderTaskView(this);
  }

  renderTeamView() {
    return renderTeamView(this);
  }

  renderTeamMembersView() {
    return renderTeamMembersView(this);
  }

  renderTeamTable(team, monthKeys) {
    return null;
  }

  render() {
    return html`
      ${this.renderToolbar()}

      <div class="content">
        ${this.loading ? html` <div class="loading">Loading cost data...</div> ` : ''}
        ${this.error ?
          html`
            <div class="error">
              <div class="error-title">Error</div>
              <div>${this.error}</div>
            </div>
          `
        : ''}
        ${!this.loading && !this.error ?
          html`
            ${this.activeView === 'project' ? this.renderProjectView() : ''}
            ${this.activeView === 'task' ? this.renderTaskView() : ''}
            ${this.activeView === 'team' ? this.renderTeamView() : ''}
            ${this.activeView === 'team-members' ? this.renderTeamMembersView() : ''}
          `
        : ''}
      </div>
    `;
  }
}

customElements.define('plugin-cost', PluginCostComponent);
