/**
 * PluginCostV2Component
 * LitElement component providing three-view cost analysis.
 * 
 * Views:
 * - Project: Per-project team-month breakdown tables
 * - Task: Parent/child task tree with budget deviation indicators
 * - Team: Per-team feature allocation tables
 * 
 * All views show monthly Int/Ext cost/hours breakdowns with date range
 * and cost/hours toggle controls.
 */
import { LitElement, html, css } from '../vendor/lit.js';
import { state } from '../services/State.js';
import { dataService } from '../services/dataService.js';
import {
  buildMonths,
  monthKey,
  monthLabel
} from './PluginCostV2Calculator.js';

import { renderProjectView } from './PluginCostV2ProjectView.js';
import { renderTaskView } from './PluginCostV2TaskView.js';
import { renderTeamView } from './PluginCostV2TeamView.js';
import { renderTeamMembersView } from './PluginCostV2TeamMembersView.js';
import { bus } from '../core/EventBus.js';
import { FeatureEvents, ProjectEvents, TeamEvents, ScenarioEvents, FilterEvents } from '../core/EventRegistry.js';
import { pluginManager } from '../core/PluginManager.js';

export class PluginCostV2Component extends LitElement {
  static properties = {
    activeView: { type: String }, // 'project' | 'task' | 'team'
    viewMode: { type: String }, // 'cost' | 'hours'
    startDate: { type: String },
    endDate: { type: String },
    data: { type: Object },
    loading: { type: Boolean },
    error: { type: String },
    expandedProjects: { type: Object },
      expandedTasks: { type: Object },
      projectViewSelection: { type: Object }
  };

  constructor() {
    super();
    this.activeView = 'project';
    this.viewMode = 'cost';
    this.data = null;
    this.loading = false;
    this.error = null;
    this.expandedProjects = new Set();
    this.expandedTasks = new Set();
    this.projectViewSelection = {}; // per-project: 'teams' | 'features'
    
    // Default date range: current year
    const now = new Date();
    const year = now.getFullYear();
    this.startDate = `${year}-01-01`;
    this.endDate = `${year}-12-31`;
    
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
      background: #2196F3;
      color: white;
      border-color: #2196F3;
    }

    .view-toggle {
      display: flex;
      gap: 4px;
      margin-left: auto;
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
      background: #4CAF50;
      color: white;
      border-color: #4CAF50;
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

    .date-controls input[type="date"] {
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

    th, td {
      padding: 8px;
      text-align: left;
      border: 1px solid #ddd;
    }

    th {
      background: #f5f5f5;
      font-weight: 600;
      color: #333;
      position: sticky;
      top: 0;
      z-index: 1;
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

    .deviation-indicator {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 600;
      margin-left: 8px;
    }

    .deviation-indicator.high {
      background: #ffebee;
      color: #c62828;
    }

    .deviation-indicator.medium {
      background: #fff3e0;
      color: #ef6c00;
    }

    .project-header {
      font-weight: 600;
      font-size: 14px;
      color: #1976D2;
    }

    .team-header {
      font-weight: 600;
      font-size: 14px;
      color: #4CAF50;
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
      background: linear-gradient(180deg,#1976D2,#1565C0);
      color: white;
      border-color: #1565C0;
      box-shadow: 0 1px 0 rgba(0,0,0,0.04);
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
    .summary-table tr.alt td { background: #efefef; }
    .summary-table td.metric { width: 280px; white-space: nowrap; }
    .summary-table td.sum-column, .summary-table th.sum-column {
      background: #e8f2ff;
      font-weight: 700;
      border-left: 2px solid #dfe9f6;
      color: #123b5a;
    }
    /* Apply consistent Sum styling across all tables */
    table td.sum-column, table th.sum-column {
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
    .summary-table tr.site-pair td { background: white; }
    .summary-table tr.site-pair.alt td { background: #efefef; }
    .summary-table tr.group-row.alt td { background: #efefef; }
    .summary-table tr.site-pair td:first-child { padding-left: 12px; }
    
      /* Icon sizing for type icons used in lists/tables */
      .type-icon { display: inline-flex; align-items: center; vertical-align: middle; }
      .type-icon svg { width: 16px; height: 16px; display: block; }
  `;

  open() {
    this.setAttribute('visible', '');
    this.loadData();
    // Ensure sidebar disabled state is applied when plugin UI opens
    try { this._applySidebarDisabled(); } catch (e) {}
  }

  // Apply the sidebar disabled configuration
  _applySidebarDisabled() {
    // Ensure unplanned is unchecked, and all other task filters are checked
    state.taskFilterService.setFilter('schedule', 'unplanned', false);
    // Schedule: ensure planned is true
    state.taskFilterService.setFilter('schedule', 'planned', true);
    // Allocation
    state.taskFilterService.setFilter('allocation', 'allocated', true);
    state.taskFilterService.setFilter('allocation', 'unallocated', true);
    // Hierarchy
    state.taskFilterService.setFilter('hierarchy', 'hasParent', true);
    state.taskFilterService.setFilter('hierarchy', 'noParent', true);
    // Relations
    state.taskFilterService.setFilter('relations', 'hasLinks', true);
    state.taskFilterService.setFilter('relations', 'noLinks', true);

    // Force all states selected via public State API
    state.setAllStatesSelected(true);

    // Ensure all task types are checked via public State API
    // Prefer the sidebar's known available task types. The ViewManagementService
    // does not reliably expose the loaded task types at runtime.
    // Read available task types from State service (preferred) or fall back
    // to any saved view options. Do NOT query other components' internals.
    console.log(state.availableTaskTypes);
    state.setSelectedTaskTypes(state.availableTaskTypes);

    // Now disable buttons
    const disabled = {
      taskFilters: {
        schedule: ['planned'],
        allocation: ['allocated','unallocated'],
        hierarchy: ['hasParent','noParent'],
        relations: ['hasLinks','noLinks']
      },
      taskTypes: [],
      states: Array.isArray(state.availableFeatureStates) ? Array.from(state.availableFeatureStates) : [],
      expansion: ['parentChild','relations','teamAllocated']
    };
    state.setSidebarDisabledElements(disabled);
    //try { state.setSidebarDisabledElements(disabled); } catch (e) { bus.emit(FilterEvents.CHANGED, { disabledSidebar: disabled }); }
  }

  connectedCallback() {
    super.connectedCallback();
    // Subscribe to global state events that should trigger a recalculation
    try {
      this._unsubscribes.push(bus.on(FeatureEvents.UPDATED, () => this._scheduleReload()));
      this._unsubscribes.push(bus.on(ProjectEvents.CHANGED, () => this._scheduleReload()));
      this._unsubscribes.push(bus.on(TeamEvents.CHANGED, () => this._scheduleReload()));
      this._unsubscribes.push(bus.on(ScenarioEvents.ACTIVATED, () => this._scheduleReload()));
      this._unsubscribes.push(bus.on(ScenarioEvents.UPDATED, () => this._scheduleReload()));
      this._unsubscribes.push(bus.on(FilterEvents.CHANGED, () => this._scheduleReload()));
    } catch (e) {
      console.warn('[PluginCostV2] failed to subscribe to state events', e);
    }
    // Signal sidebar which controls are not relevant while this plugin is active
    this._applySidebarDisabled();
  }

  disconnectedCallback() {
    // Unsubscribe all listeners
    try {
      for (const u of this._unsubscribes) { if (typeof u === 'function') u(); }
      this._unsubscribes = [];
    } catch (e) {}
    if (this._reloadTimer) { clearTimeout(this._reloadTimer); this._reloadTimer = null; }
    try { state.clearSidebarDisabledElements(); } catch (e) { try { bus.emit(FilterEvents.CHANGED, { disabledSidebar: null }); } catch (err) {} }
    super.disconnectedCallback();
  }

  _scheduleReload() {
    // Debounce rapid events
    try {
      // If the UI is not visible (plugin closed) avoid reloading data.
      if (!this.hasAttribute('visible')) return;
      if (this._reloadTimer) clearTimeout(this._reloadTimer);
      this._reloadTimer = setTimeout(() => { this._reloadTimer = null; this.loadData(); }, 200);
    } catch (e) { this.loadData(); }
  }

  _closeClicked() {
    const plugin = pluginManager.get('plugin-cost-v2');
    plugin.deactivate();
  }

  close() {
    // Hide UI and cancel any pending reloads so we don't fetch while closed
    this.removeAttribute('visible');
    if (this._reloadTimer) { clearTimeout(this._reloadTimer); this._reloadTimer = null; }
    // Clear any sidebar masks/disabled maps so the UI restores immediately
    try { state.clearSidebarDisabledElements(); } catch (e) { try { bus.emit(FilterEvents.CHANGED, { disabledSidebar: {} }); } catch (err) {} }
  }

  async loadData() {
    this.loading = true;
    this.error = null;

    try {
      // Build months list
      this.months = buildMonths({
        dataset_start: this.startDate,
        dataset_end: this.endDate
      });

      // Get effective features from state
      const effectiveFeatures = state && typeof state.getEffectiveFeatures === 'function' 
        ? state.getEffectiveFeatures() 
        : [];

      if (effectiveFeatures.length === 0) {
        throw new Error('No features available. Please ensure projects and teams are selected.');
      }

      // Build features payload for cost API
      // Honor sidebar-selected task types when present. If multiple types
      // are selected, apply the "lowest level counts" rule: when a parent
      // item has children of a selected type, skip the parent so children
      // are authoritative.
      let selectedTypes = null;
      try {
        const sidebar = document.querySelector('app-sidebar');
        if (sidebar && sidebar.selectedTaskTypes && typeof sidebar.selectedTaskTypes.values === 'function') {
          selectedTypes = new Set(Array.from(sidebar.selectedTaskTypes).map(s => String(s).toLowerCase()));
        }
      } catch (e) { selectedTypes = null; }

      // Helper: determine if a feature has children according to state.childrenByEpic
      const hasChildren = (fid) => {
        try {
          const map = state.childrenByEpic || new Map();
          const list = map.get(Number(fid)) || map.get(String(fid)) || [];
          return Array.isArray(list) && list.length > 0;
        } catch (e) { return false; }
      };

      let filteredFeatures = (effectiveFeatures || []).filter(f => {
        if (!f) return false;
        if (!selectedTypes || selectedTypes.size === 0) return true;
        const ftype = String(f.type || f.feature_type || '').toLowerCase();
        if (!selectedTypes.has(ftype)) return false;
        // If multiple types selected, prefer lowest-level: skip parents
        if (selectedTypes.size > 1) {
          if (hasChildren(f.id)) return false;
        }
        return true;
      });

      // Apply task filters (planned/unplanned, allocation, etc.) from TaskFilterService
      try {
        const tfs = state.taskFilterService;
        if (tfs) {
          // If the schedule.unplanned option is turned off, proactively
          // filter out features that are truly unplanned. Some backends
          // set placeholder dates (today) for unplanned items which would
          // otherwise appear as "planned"; treat those as unplanned too.
          let taskFilters = null;
          try { if (typeof tfs.getFilters === 'function') taskFilters = tfs.getFilters(); } catch (e) { taskFilters = null; }
          if (taskFilters && taskFilters.schedule && taskFilters.schedule.unplanned === false) {
            const today = (new Date()).toISOString().slice(0,10);
            filteredFeatures = filteredFeatures.filter(f => {
              try {
                const hasStart = !!(f && f.start);
                const hasEnd = !!(f && f.end);
                // No dates => unplanned
                if (!hasStart && !hasEnd) return false;
                // Placeholder: start===end===today => treat as unplanned
                if (hasStart && hasEnd && String(f.start).startsWith(today) && String(f.end).startsWith(today) && String(f.start) === String(f.end)) return false;
                return true;
              } catch (e) { return true; }
            });
          }

          if (typeof tfs.featurePassesFilters === 'function') {
            const ff = filteredFeatures.filter(f => tfs.featurePassesFilters(f));
            filteredFeatures.length = 0;
            Array.prototype.push.apply(filteredFeatures, ff);
          }
        }
      } catch (e) {}

      const featuresPayload = filteredFeatures.map(f => ({
        id: f.id,
        project: f.project,
        start: f.start,
        end: f.end,
        capacity: Array.isArray(f.capacity) ? f.capacity : [],
        title: f.title || f.name || '',
        type: f.type || f.feature_type || '',
        state: f.state || '',
        relations: f.relations || []
      }));

      // Fetch cost data
      const json = await dataService.getCost({ features: featuresPayload });

      // Normalize projects structure: backend returns an array of projects
      // while older clients expect an object keyed by project id. Convert
      // an array into a lookup so subsequent code can index by project id.
      // Also enrich each feature object with `capacity` (from the payload)
      // and `project` so downstream allocation and filtering works.
      const payloadById = (featuresPayload || []).reduce((acc, f) => { if(f && f.id != null) acc[String(f.id)] = f; return acc; }, {});

      if (json && Array.isArray(json.projects)) {
        const projectsById = {};
        for (const p of json.projects) {
          if (!p || p.id == null) continue;
          // Ensure features array exists
          p.features = Array.isArray(p.features) ? p.features : [];

          // Enrich each feature with capacity (from the payload) and project id
          p.features = p.features.map(feat => {
            const fid = String(feat.id);
            const src = payloadById[fid];
            const capacity = src && Array.isArray(src.capacity) ? src.capacity : (feat.capacity || []);
            return Object.assign({}, feat, { capacity: capacity, project: p.id });
          });

          projectsById[String(p.id)] = p;
        }
        json.projects = projectsById;
      }

      this.data = json;

      // Fetch cost teams metadata (members + sites) to enable per-site breakdowns
      try {
        const ct = await dataService.getCostTeams();
        this.costTeams = ct && ct.teams ? ct : { teams: [] };
      } catch (e) {
        this.costTeams = { teams: [] };
      }

      // Start with project sections expanded for all selected projects
      try {
        const selectedProjects = (state.projects || []).filter(p => p.selected).map(p => p.id);
        this.expandedProjects = new Set(selectedProjects);
      } catch (e) {
        this.expandedProjects = new Set();
      }

      this.loading = false;
      this.requestUpdate();
    } catch (err) {
      console.error('[PluginCostV2] Failed to load data:', err);
      this.error = err.message || 'Failed to load cost data';
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

  setProjectView(projectId, view) {
    // Toggle behaviour: if the requested view is already selected, unset it
    const current = this.projectViewSelection && this.projectViewSelection[projectId];
    if (current === view) {
      const copy = Object.assign({}, this.projectViewSelection);
      delete copy[projectId];
      this.projectViewSelection = copy;
    } else {
      this.projectViewSelection = Object.assign({}, this.projectViewSelection, { [projectId]: view });
    }
    this.requestUpdate();
  }

  renderToolbar() {
    return html`
      <div class="toolbar">
        <div class="toolbar-title">Cost Analysis (v2)</div>
        
        <div class="tab-buttons">
          <button 
            class="${this.activeView === 'project' ? 'active' : ''}"
            @click="${() => this.handleViewChange('project')}">
            Plan View
          </button>
          <button 
            class="${this.activeView === 'task' ? 'active' : ''}"
            @click="${() => this.handleViewChange('task')}">
            Task View
          </button>
          <button 
            class="${this.activeView === 'team' ? 'active' : ''}"
            @click="${() => this.handleViewChange('team')}">
            Team View
          </button>
          <button
            class="${this.activeView === 'team-members' ? 'active' : ''}"
            @click="${() => this.handleViewChange('team-members')}">
            Team Members
          </button>
        </div>

        <div class="date-controls">
          <label for="start-date">From:</label>
          <input 
            type="date" 
            id="start-date" 
            .value="${this.startDate}"
            @change="${(e) => { this.startDate = e.target.value; this.handleDateChange(); }}" />
          <label for="end-date">To:</label>
          <input 
            type="date" 
            id="end-date" 
            .value="${this.endDate}"
            @change="${(e) => { this.endDate = e.target.value; this.handleDateChange(); }}" />
        </div>

        <div class="view-toggle">
          <button 
            class="${this.viewMode === 'cost' ? 'active' : ''}"
            @click="${() => this.handleViewModeChange('cost')}">
            Cost
          </button>
          <button 
            class="${this.viewMode === 'hours' ? 'active' : ''}"
            @click="${() => this.handleViewModeChange('hours')}">
            Hours
          </button>
        </div>

        <button class="close-btn" @click="${() => this._closeClicked()}">Close</button>
      </div>
    `;
  }

  renderProjectView() {
    return renderProjectView(this);
  }

  renderProjectTable() { return null; }

  buildTeamMonthAllocations() { return null; }

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

  renderTaskNode(featureId, featureMap, childrenMap, depth) {
    return null;
  }

  renderDeviationDetail(parent, children, deviation) {
    return null;
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
        ${this.loading ? html`
          <div class="loading">Loading cost data...</div>
        ` : ''}
        
        ${this.error ? html`
          <div class="error">
            <div class="error-title">Error</div>
            <div>${this.error}</div>
          </div>
        ` : ''}
        
        ${!this.loading && !this.error ? html`
          ${this.activeView === 'project' ? this.renderProjectView() : ''}
          ${this.activeView === 'task' ? this.renderTaskView() : ''}
          ${this.activeView === 'team' ? this.renderTeamView() : ''}
          ${this.activeView === 'team-members' ? this.renderTeamMembersView() : ''}
        ` : ''}
      </div>
    `;
  }
}

customElements.define('plugin-cost-v2', PluginCostV2Component);
