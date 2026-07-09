import { LitElement, html, css } from '../vendor/lit.js';
import { bus } from '../core/EventBus.js';
import {
  AppEvents,
  FeatureEvents,
  FilterEvents,
  ProjectEvents,
  ScenarioEvents,
  StateFilterEvents,
  TeamEvents,
  UIEvents,
  ViewManagementEvents,
} from '../core/EventRegistry.js';
import { pluginManager } from '../core/PluginManager.js';
import { state } from '../services/State.js';
import { getIconTemplate } from '../services/IconService.js';

function normalizeState(value) {
  return String(value || '').trim().toLowerCase();
}

function getFeatureType(feature) {
  return String(feature?.type || feature?.workItemType || feature?.work_item_type || 'Unknown');
}

function toTitle(value) {
  return String(value || '').trim() || 'Untitled';
}

function numberOrZero(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function featureTags(feature) {
  const raw = feature?.tags;
  if (Array.isArray(raw)) return raw.map((t) => String(t)).filter(Boolean);
  if (typeof raw === 'string') {
    return raw
      .split(/[;,]/)
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

function hasAnyCapacity(feature) {
  const entries = Array.isArray(feature?.capacity) ? feature.capacity : [];
  return entries.some((c) => numberOrZero(c?.capacity) > 0);
}

function getFeatureTeamAllocation(feature, teamId) {
  const entries = Array.isArray(feature?.capacity) ? feature.capacity : [];
  return entries
    .filter((c) => String(c?.team) === String(teamId))
    .reduce((sum, c) => sum + numberOrZero(c?.capacity), 0);
}

export class PluginPortfolioComponent extends LitElement {
  static properties = {
    _open: { type: Boolean, state: true },
    _selectedFeatureId: { type: String, state: true },
    _rows: { type: Array, state: true },
    _unallocated: { type: Array, state: true },
    _columnStates: { type: Array, state: true },
    _projectById: { type: Object, state: true },
    _unallocatedOpen: { type: Boolean, state: true },
  };

  static styles = css`
    :host {
      display: none;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      background: #f0f2f5;
      color: #1e293b;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial,
        sans-serif;
    }

    :host([open]) {
      display: flex;
      flex-direction: column;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 12px 16px;
      background: #f5f5f5;
      border-bottom: 1px solid #ddd;
      flex-shrink: 0;
      z-index: 5;
    }

    .toolbar-title {
      font-size: 16px;
      font-weight: 600;
      color: #333;
      margin: 0;
    }

    .toolbar-spacer {
      flex: 1;
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

    .main-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-height: 0;
    }

    .board-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-height: 0;
      padding: 8px;
    }

    .board-scroll {
      flex: 1;
      overflow: auto;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #ffffff;
    }

    table.pgrid {
      border-collapse: separate;
      border-spacing: 0;
      table-layout: fixed;
      min-width: calc(182px + 210px * var(--state-count, 4));
      width: 100%;
    }

    table.pgrid thead th {
      position: sticky;
      top: 0;
      z-index: 20;
      background: #1a2a3e;
      color: #dde4f0;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 7px 10px;
      border-right: 1px solid rgba(255, 255, 255, 0.1);
      border-bottom: 2px solid rgba(255, 255, 255, 0.06);
      white-space: nowrap;
    }

    table.pgrid thead th:first-child {
      width: 182px;
      z-index: 30;
      position: sticky;
      left: 0;
      border-right: 2px solid rgba(255, 255, 255, 0.15);
      text-align: left;
    }

    .state-th-inner {
      display: inline-flex;
      align-items: center;
      gap: 7px;
    }

    .state-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
      background: #94a3b8;
    }

    .state-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.12);
      color: rgba(255, 255, 255, 0.75);
      min-width: 18px;
      height: 16px;
      border-radius: 8px;
      font-size: 0.65rem;
      font-weight: 700;
      padding: 0 4px;
      margin-left: 2px;
    }

    table.pgrid td.tc {
      position: sticky;
      left: 0;
      z-index: 10;
      background: #1a2a3e;
      color: #dde4f0;
      width: 182px;
      min-width: 182px;
      padding: 8px 10px;
      border-right: 2px solid rgba(255, 255, 255, 0.1);
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      vertical-align: top;
    }

    .tc-name {
      font-size: 0.8rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 7px;
    }

    .tc-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      flex-shrink: 0;
      background: #3b82f6;
    }

    table.pgrid td.sc {
      padding: 5px;
      border-right: 1px solid #e2e8f0;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: top;
      min-height: 70px;
      background: #ffffff;
    }

    .pcard {
      background: #ffffff;
      border: 1px solid #dde3ec;
      border-left: 4px solid #ccc;
      border-radius: 5px;
      padding: 6px 8px;
      margin-bottom: 5px;
      cursor: pointer;
      font-size: 0.76rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      position: relative;
      user-select: none;
      transition: box-shadow 0.14s;
    }

    .pcard:hover {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.14);
    }

    .pcard.selected {
      box-shadow: 0 0 0 2px #60a5fa;
    }

    .pcard.dirty::after {
      content: '';
      position: absolute;
      top: 5px;
      right: 6px;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #f59e0b;
      box-shadow: 0 0 4px rgba(245, 158, 11, 0.6);
    }

    .card-id {
      display: inline-flex;
      align-items: center;
      font-size: 0.65rem;
      font-weight: 700;
      color: #64748b;
      margin-bottom: 2px;
      gap: 6px;
    }

    .card-type {
      display: inline-flex;
      width: 14px;
      height: 14px;
      align-items: center;
      justify-content: center;
    }

    .card-title {
      font-size: 0.78rem;
      font-weight: 600;
      line-height: 1.3;
      margin-bottom: 5px;
      color: #1e293b;
    }

    .card-footer {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-wrap: wrap;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 0.62rem;
      font-weight: 700;
      line-height: 1.4;
      border: 1px solid #dde3ec;
      background: #f8fafc;
      color: #334155;
    }

    .badge-proj {
      color: #ffffff;
      border-color: transparent;
    }

    .badge-pct {
      background: rgba(0, 0, 0, 0.07);
      color: #64748b;
      border-color: transparent;
    }

    .badge-multi {
      background: #fef3c7;
      color: #b45309;
      border: 1px solid #fcd34d;
    }

    .badge-dates {
      background: rgba(0, 0, 0, 0.05);
      color: #64748b;
      font-weight: 500;
      font-size: 0.6rem;
      border-color: transparent;
    }

    .badge-tag {
      background: #f0fdf4;
      color: #166534;
      border: 1px solid #bbf7d0;
    }

    .empty-cell {
      color: #94a3b8;
      font-size: 0.75rem;
      padding: 2px 4px;
    }

    .unalloc-panel {
      flex-shrink: 0;
      max-height: 210px;
      display: flex;
      flex-direction: column;
      background: #ffffff;
      border-top: 2px solid #fcd34d;
      margin: 0 8px 8px;
      border-left: 1px solid #e2e8f0;
      border-right: 1px solid #e2e8f0;
      border-bottom: 1px solid #e2e8f0;
      border-radius: 0 0 8px 8px;
      overflow: hidden;
    }

    .panel-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      background: #f1f5f9;
      border-bottom: 1px solid #e2e8f0;
      cursor: pointer;
      user-select: none;
      min-height: 32px;
    }

    .panel-header:hover {
      background: #e8edf4;
    }

    .panel-title {
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
    }

    .panel-subtitle {
      font-size: 0.72rem;
      color: #64748b;
      margin-left: 2px;
    }

    .panel-toggle {
      margin-left: auto;
      font-size: 0.72rem;
      color: #64748b;
      width: 14px;
      text-align: center;
      transition: transform 0.2s;
    }

    .panel-toggle.up {
      transform: rotate(180deg);
    }

    .unalloc-scroll {
      overflow-y: auto;
      flex: 1;
    }

    table.ugrid {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.78rem;
    }

    table.ugrid th {
      padding: 6px 12px;
      background: #fffbeb;
      color: #92400e;
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border-bottom: 1px solid #fde68a;
      text-align: left;
      white-space: nowrap;
      position: sticky;
      top: 0;
      z-index: 5;
    }

    table.ugrid td {
      padding: 6px 12px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: middle;
    }

    table.ugrid tbody tr:hover td {
      background: #fffbeb;
      cursor: pointer;
    }

    .empty-row td {
      text-align: center;
      padding: 16px;
      color: #64748b;
      font-style: italic;
    }

    .state-cell {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }

    .state-cell-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #94a3b8;
      flex-shrink: 0;
    }
  `;

  constructor() {
    super();
    this._open = false;
    this._selectedFeatureId = null;
    this._rows = [];
    this._unallocated = [];
    this._columnStates = [];
    this._projectById = {};
    this._unallocatedOpen = true;

    this._boundRefresh = this._refresh.bind(this);
    this._boundSelected = this._onFeatureSelected.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();

    bus.on(AppEvents.READY, this._boundRefresh);
    bus.on(ProjectEvents.CHANGED, this._boundRefresh);
    bus.on(TeamEvents.CHANGED, this._boundRefresh);
    bus.on(FeatureEvents.UPDATED, this._boundRefresh);
    bus.on(ScenarioEvents.ACTIVATED, this._boundRefresh);
    bus.on(ScenarioEvents.SAVED, this._boundRefresh);
    bus.on(UIEvents.DETAILS_HIDE, this._boundRefresh);
    bus.on(StateFilterEvents.CHANGED, this._boundRefresh);
    bus.on(FilterEvents.CHANGED, this._boundRefresh);
    bus.on(FeatureEvents.SELECTED, this._boundSelected);
    bus.on(ViewManagementEvents.ACTIVATED, this._boundRefresh);

    this._refresh();
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    bus.off(AppEvents.READY, this._boundRefresh);
    bus.off(ProjectEvents.CHANGED, this._boundRefresh);
    bus.off(TeamEvents.CHANGED, this._boundRefresh);
    bus.off(FeatureEvents.UPDATED, this._boundRefresh);
    bus.off(ScenarioEvents.ACTIVATED, this._boundRefresh);
    bus.off(ScenarioEvents.SAVED, this._boundRefresh);
    bus.off(UIEvents.DETAILS_HIDE, this._boundRefresh);
    bus.off(StateFilterEvents.CHANGED, this._boundRefresh);
    bus.off(FilterEvents.CHANGED, this._boundRefresh);
    bus.off(FeatureEvents.SELECTED, this._boundSelected);
    bus.off(ViewManagementEvents.ACTIVATED, this._boundRefresh);
  }

  open() {
    this._open = true;
    this.setAttribute('open', '');
    this._refresh();
  }

  close() {
    this._open = false;
    this.removeAttribute('open');
  }

  _onFeatureSelected(payload) {
    const id = payload?.id || payload?.feature?.id || null;
    this._selectedFeatureId = id;
  }

  _refresh() {
    let features = [];
    try {
      features = state.getEffectiveFeatures() || [];
    } catch (_) {
      return;
    }

    const uniqueById = new Map();
    for (const feature of features) {
      if (!feature || !feature.id) continue;
      uniqueById.set(String(feature.id), feature);
    }
    const deduped = Array.from(uniqueById.values());

    const projects = state.projects || [];
    const teams = state.teams || [];
    const selectedProjects = new Set(
      projects.filter((p) => p?.selected).map((p) => String(p.id))
    );
    const selectedTeams = teams.filter((t) => t?.selected);
    const selectedTeamIds = new Set(selectedTeams.map((t) => String(t.id)));

    this._projectById = Object.fromEntries(projects.map((p) => [String(p.id), p]));

    this._columnStates =
      (state.availableFeatureStates || []).length > 0 ?
        [...state.availableFeatureStates]
      : Array.from(
          new Set(deduped.map((f) => String(f.state || '').trim()).filter(Boolean))
        ).sort();

    const stateMap = new Map(this._columnStates.map((s) => [normalizeState(s), s]));

    const availableTypes =
      (state.availableTaskTypes || []).length > 0 ?
        [...state.availableTaskTypes]
      : Array.from(new Set(deduped.map((f) => getFeatureType(f)).filter(Boolean))).sort();

    const sidebarVisibleTypes = new Set(
      availableTypes.filter((t) => state._viewService?.isTypeVisible?.(t) !== false)
    );

    const sidebarStateFilterRaw =
      state.selectedFeatureStateFilter instanceof Set ?
        Array.from(state.selectedFeatureStateFilter)
      : state.selectedFeatureStateFilter || [];
    const sidebarStateFilter = new Set(sidebarStateFilterRaw.map((s) => normalizeState(s)));

    const expansion = state.expansionState || {};
    const hasExpansion =
      !!expansion.expandParentChild ||
      !!expansion.expandRelations ||
      !!expansion.expandTeamAllocated;

    const expandedIds = hasExpansion ? state.getExpandedFeatureIds() : null;
    const taskFilterService = state.taskFilterService;

    const rows = selectedTeams.map((team) => {
      const cells = {};
      for (const stateName of this._columnStates) {
        cells[stateName] = [];
      }
      return { team, cells };
    });

    const rowsByTeamId = new Map(rows.map((row) => [String(row.team.id), row]));
    const unallocated = [];

    const filtered = deduped.filter((feature) => {
      const featureId = String(feature.id);

      if (hasExpansion) {
        if (!expandedIds?.has(featureId)) return false;
      } else {
        if (!selectedProjects.has(String(feature.project))) return false;
      }

      const featureStateNorm = normalizeState(feature.state);
      if (!stateMap.has(featureStateNorm)) return false;
      if (sidebarStateFilter.size > 0 && !sidebarStateFilter.has(featureStateNorm)) return false;

      const featureType = getFeatureType(feature);
      if (!sidebarVisibleTypes.has(featureType)) return false;

      if (taskFilterService && !taskFilterService.featurePassesFilters(feature)) return false;

      if (hasAnyCapacity(feature)) {
        const hasSelectedTeamAllocation =
          selectedTeams.length > 0 &&
          selectedTeams.some((team) => getFeatureTeamAllocation(feature, team.id) > 0);
        if (!hasSelectedTeamAllocation) return false;
      }

      return true;
    });

    for (const feature of filtered) {
      const stateName = stateMap.get(normalizeState(feature.state));
      if (!stateName) continue;

      if (!hasAnyCapacity(feature)) {
        unallocated.push(feature);
        continue;
      }

      for (const teamId of selectedTeamIds) {
        const allocation = getFeatureTeamAllocation(feature, teamId);
        if (allocation <= 0) continue;
        const row = rowsByTeamId.get(teamId);
        if (!row) continue;
        row.cells[stateName].push({ feature, allocation });
      }
    }

    for (const row of rows) {
      for (const stateName of this._columnStates) {
        row.cells[stateName].sort((a, b) => {
          const aTitle = toTitle(a.feature.title).toLowerCase();
          const bTitle = toTitle(b.feature.title).toLowerCase();
          return aTitle.localeCompare(bTitle);
        });
      }
    }

    unallocated.sort((a, b) => toTitle(a.title).localeCompare(toTitle(b.title)));

    this._rows = rows;
    this._unallocated = unallocated;
  }

  _projectColorForFeature(feature) {
    try {
      const pid = String(feature?.projectId || feature?.project || '');
      return state._colorService?.getProjectColor?.(pid) || '#9aa8bf';
    } catch (_) {
      return '#9aa8bf';
    }
  }

  _projectNameForFeature(feature) {
    const project = this._projectById[String(feature?.project || '')];
    return project?.name || feature?.project || 'Unknown';
  }

  _isMultiProject(feature) {
    if (Array.isArray(feature?.projects) && feature.projects.length > 1) return true;
    if (typeof feature?.project === 'string' && feature.project.includes(',')) return true;
    return false;
  }

  _selectFeature(feature) {
    if (!feature) return;
    bus.emit(FeatureEvents.SELECTED, feature);
  }

  async _closePlugin() {
    try {
      await pluginManager.deactivate('plugin-portfolio-board');
    } catch (err) {
      console.warn('[PluginPortfolio] failed to deactivate plugin', err);
    }
  }

  _toggleUnallocated() {
    this._unallocatedOpen = !this._unallocatedOpen;
  }

  _renderCard(feature, allocation) {
    const typeName = getFeatureType(feature);
    const selected = String(feature.id) === String(this._selectedFeatureId);
    const tags = featureTags(feature);
    const start = feature?.start || null;
    const end = feature?.end || null;
    const dates = start && end ? `${start.slice(0, 7)} -> ${end.slice(0, 7)}` : null;

    return html`
      <div
        class="pcard ${selected ? 'selected' : ''} ${feature?.dirty ? 'dirty' : ''}"
        style="border-left-color:${this._projectColorForFeature(feature)}"
        @click="${() => this._selectFeature(feature)}"
      >
        <div class="card-id">
          <span class="card-type">${getIconTemplate(typeName)}</span>
          ${feature.id}
        </div>
        <div class="card-title">${toTitle(feature.title)}</div>
        <div class="card-footer">
          <span class="badge badge-proj" style="background:${this._projectColorForFeature(feature)}">
            ${this._projectNameForFeature(feature)}
          </span>
          ${this._isMultiProject(feature) ? html`<span class="badge badge-multi">Multi-team</span>` : ''}
          <span class="badge badge-pct">${allocation.toFixed(0)}%</span>
          ${dates ? html`<span class="badge badge-dates">${dates}</span>` : ''}
          ${tags.slice(0, 2).map((tag) => html`<span class="badge badge-tag">${tag}</span>`)}
          ${tags.length > 2 ? html`<span class="badge">+${tags.length - 2}</span>` : ''}
        </div>
      </div>
    `;
  }

  _renderBoard() {
    if (!this._rows.length || !this._columnStates.length) {
      return html`<div class="empty-cell" style="padding: 12px;">No teams or states selected.</div>`;
    }

    const stateCounts = Object.fromEntries(this._columnStates.map((s) => [s, 0]));
    for (const row of this._rows) {
      for (const stateName of this._columnStates) {
        stateCounts[stateName] += (row.cells[stateName] || []).length;
      }
    }

    return html`
      <div class="board-scroll">
        <table class="pgrid" style="--state-count:${this._columnStates.length}">
          <thead>
            <tr>
              <th>Teams</th>
              ${this._columnStates.map(
                (stateName) => html`
                  <th>
                    <div class="state-th-inner">
                      <span class="state-dot"></span>
                      ${stateName}
                      <span class="state-count">${stateCounts[stateName] || 0}</span>
                    </div>
                  </th>
                `
              )}
            </tr>
          </thead>
          <tbody>
            ${this._rows.map(
              (row) => html`
                <tr>
                  <td class="tc">
                    <div class="tc-name">
                      <span class="tc-dot" style="background:${row.team?.color || '#3b82f6'}"></span>
                      ${row.team?.name || row.team?.id || 'Unknown Team'}
                    </div>
                  </td>
                  ${this._columnStates.map((stateName) => {
                    const cards = row.cells[stateName] || [];
                    return html`
                      <td class="sc">
                        ${cards.length
                          ? cards.map((entry) => this._renderCard(entry.feature, entry.allocation))
                          : html`<div class="empty-cell">-</div>`}
                      </td>
                    `;
                  })}
                </tr>
              `
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  _renderUnallocated() {
    const subtitle = this._unallocated.length
      ? `${this._unallocated.length} task${this._unallocated.length > 1 ? 's' : ''} need team assignment`
      : '- all tasks allocated';

    return html`
      <div class="unalloc-panel">
        <div class="panel-header" @click="${this._toggleUnallocated}">
          <span class="panel-title">Unallocated Tasks</span>
          <span class="panel-subtitle">${subtitle}</span>
          <span class="panel-toggle ${this._unallocatedOpen ? 'up' : ''}">▼</span>
        </div>

        ${this._unallocatedOpen
          ? html`
              <div class="unalloc-scroll">
                <table class="ugrid">
                  <thead>
                    <tr>
                      <th style="width:68px;">ID</th>
                      <th>Title</th>
                      <th style="width:130px;">Project</th>
                      <th style="width:110px;">Start</th>
                      <th style="width:110px;">End</th>
                      <th style="width:110px;">State</th>
                      <th>Tags</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${this._unallocated.length === 0
                      ? html`<tr class="empty-row"><td colspan="7">All tasks have team allocations</td></tr>`
                      : this._unallocated.map((feature) => {
                          const tags = featureTags(feature);
                          return html`
                            <tr @click="${() => this._selectFeature(feature)}">
                              <td><strong>${feature.id}</strong></td>
                              <td>${toTitle(feature.title)}</td>
                              <td>
                                <span
                                  class="badge badge-proj"
                                  style="background:${this._projectColorForFeature(feature)}"
                                >
                                  ${this._projectNameForFeature(feature)}
                                </span>
                              </td>
                              <td>${feature?.start || '-'}</td>
                              <td>${feature?.end || '-'}</td>
                              <td>
                                <span class="state-cell">
                                  <span class="state-cell-dot"></span>
                                  ${feature?.state || '-'}
                                </span>
                              </td>
                              <td>
                                ${tags.length
                                  ? tags.map((tag) => html`<span class="badge badge-tag">${tag}</span>`)
                                  : html`<span style="color:#64748b;">-</span>`}
                              </td>
                            </tr>
                          `;
                        })}
                  </tbody>
                </table>
              </div>
            `
          : ''}
      </div>
    `;
  }

  render() {
    return html`
      <div class="toolbar">
        <div class="toolbar-title">Portfolio Planning Board</div>
        <div class="toolbar-spacer"></div>
        <button class="close-btn" @click="${this._closePlugin}">Close</button>
      </div>

      <div class="main-content">
        <div class="board-panel">${this._renderBoard()}</div>
        ${this._renderUnallocated()}
      </div>
    `;
  }
}

customElements.define('plugin-portfolio-board', PluginPortfolioComponent);
