import { LitElement, html } from '../vendor/lit.js';
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
import {
  TIMELINE_HEADER_HEIGHT,
  TIMELINE_LABEL_WIDTH,
  buildPortfolioTimelineLayout,
} from './portfolioTimeline.js';
import { createPortfolioStyles } from './PluginPortfolioComponent.styles.js';
import { renderPortfolioTimeline } from './PortfolioTimelineRenderer.js';
import { renderUnallocatedPanel } from './PortfolioUnallocatedRenderer.js';
import {
  normalizeState,
  getFeatureType,
  toTitle,
  numberOrZero,
  featureTags,
  hasAnyCapacity,
  getFeatureTeamAllocation,
  hexToRgba,
} from './PortfolioPluginUtils.js';

const ENABLE_STATE_CELL_ACCENT = true;
const STATE_CELL_ACCENT_ALPHA = 0.1;
const TIMELINE_MONTH_GRID_SPACING = 120;
// Tune this default cap for the timeline viewport height.
const DEFAULT_TIMELINE_MAX_HEIGHT_VH = 50;

export class PluginPortfolioComponent extends LitElement {
  static properties = {
    _open: { type: Boolean, state: true },
    _selectedFeatureId: { type: String, state: true },
    _rows: { type: Array, state: true },
    _unallocated: { type: Array, state: true },
    _columnStates: { type: Array, state: true },
    _projectById: { type: Object, state: true },
    _unallocatedOpen: { type: Boolean, state: true },
    _boardOpen: { type: Boolean, state: true },
    _timelineOpen: { type: Boolean, state: true },
    _timelineLayout: { type: Object, state: true },
    _dragState: { type: Object, state: true },
    _statusMessage: { type: String, state: true },
    _pendingChangesCount: { type: Number, state: true },
    _activeScenarioId: { type: String, state: true },
  };

  static styles = createPortfolioStyles(
    DEFAULT_TIMELINE_MAX_HEIGHT_VH,
    TIMELINE_LABEL_WIDTH,
    TIMELINE_MONTH_GRID_SPACING
  );

  constructor() {
    super();
    this._open = false;
    this._selectedFeatureId = null;
    this._rows = [];
    this._unallocated = [];
    this._columnStates = [];
    this._projectById = {};
    this._unallocatedOpen = true;
    this._boardOpen = true;
    this._timelineOpen = false;
    this._timelineLayout = {
      empty: true,
      rows: [],
      months: [],
      totalWidth: TIMELINE_LABEL_WIDTH,
      totalHeight: TIMELINE_HEADER_HEIGHT,
      stickyOffset: TIMELINE_HEADER_HEIGHT,
      rangeStart: null,
      rangeEnd: null,
    };
    this._dragState = {
      featureId: null,
      fromState: null,
      fromTeamId: null,
      toState: null,
      toTeamId: null,
      active: false,
      allowed: false,
    };
    this._statusMessage = '';
    this._pendingChangesCount = 0;
    this._activeScenarioId = 'baseline';

    this._dragToastTimer = null;
    this._suppressClickUntil = 0;
    this._pointerDown = null;

    this._boundRefresh = this._refresh.bind(this);
    this._boundSelected = this._onFeatureSelected.bind(this);
    this._boundPointerMove = this._handleGlobalPointerMove.bind(this);
    this._boundPointerUp = this._handleGlobalPointerUp.bind(this);
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

    this._cleanupPointerTracking();
    this._clearToastTimer();
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

    const sidebarStateFilterRaw =
      state.selectedFeatureStateFilter instanceof Set ?
        Array.from(state.selectedFeatureStateFilter)
      : state.selectedFeatureStateFilter || [];
    const sidebarStateFilter = new Set(sidebarStateFilterRaw.map((s) => normalizeState(s)));

    const allAvailableStates =
      (state.availableFeatureStates || []).length > 0 ?
        [...state.availableFeatureStates]
      : Array.from(
          new Set(deduped.map((f) => String(f.state || '').trim()).filter(Boolean))
        ).sort((a, b) => {
          if (typeof state.compareFeatureStates === 'function') {
            return state.compareFeatureStates(a, b);
          }
          return a.localeCompare(b);
        });

    // Sidebar state selection is the source of truth for visible portfolio columns.
    this._columnStates = allAvailableStates.filter((s) =>
      sidebarStateFilter.has(normalizeState(s))
    );

    const stateMap = new Map(this._columnStates.map((s) => [normalizeState(s), s]));

    const availableTypes =
      (state.availableTaskTypes || []).length > 0 ?
        [...state.availableTaskTypes]
      : Array.from(new Set(deduped.map((f) => getFeatureType(f)).filter(Boolean))).sort();

    const sidebarVisibleTypes = new Set(
      availableTypes.filter((t) => state._viewService?.isTypeVisible?.(t) !== false)
    );

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
      if (!sidebarStateFilter.has(featureStateNorm)) return false;

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
        // Sort by title
        row.cells[stateName].sort((a, b) => {
          const aTitle = toTitle(a.feature.title).toLowerCase();
          const bTitle = toTitle(b.feature.title).toLowerCase();
          return aTitle.localeCompare(bTitle);
        });

        // Apply hierarchical ordering with depth tracking
        const features = row.cells[stateName].map((entry) => entry.feature);
        const featuresWithDepth = this._orderFeaturesHierarchicallyWithDepth(features);
        const entryMap = new Map(
          row.cells[stateName].map((entry) => [String(entry.feature.id), entry])
        );
        row.cells[stateName] = featuresWithDepth.map((f) => {
          const entry = entryMap.get(String(f.id));
          return { ...entry, depth: f.depth };
        });
      }
    }

    // Apply hierarchical ordering with depth to unallocated items (roots at end)
    const unallocatedWithDepth = this._orderUnallocatedHierarchically(unallocated);

    this._rows = rows;
    this._unallocated = unallocatedWithDepth;
    this._timelineLayout = buildPortfolioTimelineLayout(rows, unallocated, this._columnStates);

    // Update scenario and pending changes info
    this._updateScenarioInfo();
  }

  _updateScenarioInfo() {
    try {
      this._activeScenarioId = state.activeScenarioId || 'baseline';

      const activeScenario = (state.scenarios.list() || []).find(
        (s) => s.id === this._activeScenarioId
      );
      this._pendingChangesCount =
        activeScenario?.overrides ? Object.keys(activeScenario.overrides).length : 0;
    } catch (_) {
      this._activeScenarioId = 'baseline';
      this._pendingChangesCount = 0;
    }
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

  _renderTimeline() {
    return renderPortfolioTimeline({
      layout: this._timelineLayout,
      projectById: this._projectById,
      isOpen: this._timelineOpen,
      onToggle: () => { this._timelineOpen = !this._timelineOpen; },
      getProjectColor: (feature) => this._projectColorForFeature(feature),
    });
  }

  _hasMultipleTeamAllocations(feature) {
    const allocations = Array.isArray(feature?.capacity) ? feature.capacity : [];
    const allocatedTeams = allocations.filter((entry) => numberOrZero(entry?.capacity) > 0);
    if (allocatedTeams.length > 1) return true;
    return false;
  }

  _getStateColorInfo(stateName) {
    const stateColors = state.getFeatureStateColors ? state.getFeatureStateColors() : {};
    const configured = stateColors?.[stateName] || null;
    const background = configured?.background || state.getFeatureStateColor?.(stateName) || '#94a3b8';
    const text = configured?.text || '#ffffff';
    return { background, text };
  }

  _selectFeature(feature) {
    if (!feature) return;
    if (this._suppressClickUntil && Date.now() < this._suppressClickUntil) return;
    this._selectedFeatureId = String(feature.id);
    bus.emit(FeatureEvents.SELECTED, feature);
  }

  _clearToastTimer() {
    if (this._dragToastTimer) {
      window.clearTimeout(this._dragToastTimer);
      this._dragToastTimer = null;
    }
  }

  _showStatus(message) {
    this._statusMessage = message || '';
    this._clearToastTimer();
    if (!this._statusMessage) return;
    this._dragToastTimer = window.setTimeout(() => {
      this._statusMessage = '';
      this._dragToastTimer = null;
    }, 2400);
  }

  _cleanupPointerTracking() {
    window.removeEventListener('pointermove', this._boundPointerMove);
    window.removeEventListener('pointerup', this._boundPointerUp);
    window.removeEventListener('mouseup', this._boundPointerUp);
    this._pointerDown = null;
  }

  _handleCardPointerDown(event, feature) {
    if (!feature) return;
    this._pointerDown = {
      featureId: String(feature.id),
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    window.addEventListener('pointermove', this._boundPointerMove);
    window.addEventListener('pointerup', this._boundPointerUp);
    window.addEventListener('mouseup', this._boundPointerUp);
  }

  _handleGlobalPointerMove(event) {
    if (!this._pointerDown || this._pointerDown.moved) return;
    const dx = Math.abs(event.clientX - this._pointerDown.x);
    const dy = Math.abs(event.clientY - this._pointerDown.y);
    if (dx > 5 || dy > 5) {
      this._pointerDown.moved = true;
      this._suppressClickUntil = Date.now() + 250;
    }
  }

  _handleGlobalPointerUp() {
    this._cleanupPointerTracking();
  }

  _resetDragState() {
    this._dragState = {
      featureId: null,
      fromState: null,
      fromTeamId: null,
      toState: null,
      toTeamId: null,
      active: false,
      allowed: false,
    };
  }

  _handleDragStart(event, feature, teamId) {
    if (!feature) return;
    const fromState = String(feature.state || '');
    const featureId = String(feature.id);
    const fromTeamId = teamId == null ? null : String(teamId);
    this._dragState = {
      featureId,
      fromState,
      fromTeamId,
      toState: null,
      toTeamId: null,
      active: true,
      allowed: false,
    };
    this._suppressClickUntil = Date.now() + 250;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(
        'application/json',
        JSON.stringify({ featureId, fromState, fromTeamId })
      );
      event.dataTransfer.setData('text/plain', featureId);
    }
  }

  _handleDragEnd() {
    this._resetDragState();
  }

  _handleDragOver(event, stateName, teamId) {
    if (!this._dragState?.active) return;
    void stateName;
    const targetTeamId = teamId == null ? null : String(teamId);
    const sameRow =
      this._dragState.fromTeamId == null ||
      targetTeamId === this._dragState.fromTeamId;
    const allowed = sameRow;
    if (allowed) event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = allowed ? 'move' : 'none';
    }
    if (this._dragState.allowed !== allowed) {
      this._dragState = {
        ...this._dragState,
        allowed,
      };
    }
  }

  _handleDragLeave(event, stateName, teamId) {
    void event;
    void stateName;
    void teamId;
  }

  _handleDrop(event, stateName, teamId) {
    if (!this._dragState?.active) return;
    event.preventDefault();

    const nextState = String(stateName || '');
    const nextTeamId = teamId == null ? null : String(teamId);
    const featureId = this._dragState.featureId;
    const fromState = this._dragState.fromState;
    const fromTeamId = this._dragState.fromTeamId;
    if (!featureId || !nextState) {
      this._resetDragState();
      return;
    }

    if (fromTeamId != null && nextTeamId !== fromTeamId) {
      this._resetDragState();
      return;
    }

    if (normalizeState(fromState) === normalizeState(nextState)) {
      this._resetDragState();
      return;
    }

    try {
      const updated = state.updateFeatureField(featureId, 'state', nextState);
      if (updated) {
        this._showStatus(`Moved ${featureId} to ${nextState}`);
      }
    } finally {
      this._resetDragState();
    }
  }

  _clearSelectionOnBackground(event) {
    const target = event?.target;
    if (!target || typeof target.closest !== 'function') return;

    if (target.closest('.pcard') || target.closest('.ugrid tbody tr')) return;

    this._selectedFeatureId = null;
  }

  async _closePlugin() {
    try {
      await pluginManager.deactivate('plugin-portfolio-board');
    } catch (err) {
      console.warn('[PluginPortfolio] failed to deactivate plugin', err);
    }
  }

  _buildChildrenMap(features) {
    const childrenMap = new Map();
    for (const f of features) {
      if (f.parentId) {
        const parentId = String(f.parentId);
        if (!childrenMap.has(parentId)) {
          childrenMap.set(parentId, []);
        }
        childrenMap.get(parentId).push(f);
      }
    }
    return childrenMap;
  }

  _orderFeaturesHierarchicallyWithDepth(features) {
    const childrenMap = this._buildChildrenMap(features);
    const sourceIds = new Set(features.map((f) => String(f.id)));
    const roots = features.filter(
      (f) => !f.parentId || !sourceIds.has(String(f.parentId))
    );

    const ordered = [];
    const visited = new Set();

    const visit = (item, depth = 0) => {
      const itemId = String(item.id);
      if (visited.has(itemId)) return;
      visited.add(itemId);
      ordered.push({ ...item, depth });
      const children = childrenMap.get(itemId) || [];
      for (const child of children) {
        visit(child, depth + 1);
      }
    };

    for (const root of roots) {
      visit(root, 0);
    }

    for (const f of features) {
      const fId = String(f.id);
      if (!visited.has(fId)) {
        visit(f, 0);
      }
    }

    return ordered;
  }

  _orderUnallocatedHierarchically(features) {
    const childrenMap = this._buildChildrenMap(features);
    const sourceIds = new Set(features.map((f) => String(f.id)));
    
    // Roots are features without parents in the source set
    const roots = features.filter(
      (f) => !f.parentId || !sourceIds.has(String(f.parentId))
    );
    
    // Features with parents are non-roots
    const withParents = features.filter(
      (f) => f.parentId && sourceIds.has(String(f.parentId))
    );

    const ordered = [];
    const visited = new Set();

    const visit = (item, depth = 0) => {
      const itemId = String(item.id);
      if (visited.has(itemId)) return;
      visited.add(itemId);
      ordered.push({ ...item, depth });
      const children = childrenMap.get(itemId) || [];
      for (const child of children) {
        visit(child, depth + 1);
      }
    };

    // First, find all parent features in the with-parents set and visit them
    const parentIds = new Set(withParents.map((f) => String(f.parentId)));
    for (const parentId of parentIds) {
      const parent = features.find((f) => String(f.id) === parentId);
      if (parent) {
        visit(parent, 0);
      }
    }

    // Then visit remaining features to catch any that weren't visited
    for (const f of features) {
      const fId = String(f.id);
      if (!visited.has(fId)) {
        visit(f, 0);
      }
    }

    return ordered;
  }

  _toggleUnallocated() {
    this._unallocatedOpen = !this._unallocatedOpen;
  }

  _renderCard(feature, allocation, teamId, depth = 0) {
    const typeName = getFeatureType(feature);
    const selected = String(feature.id) === String(this._selectedFeatureId);
    const dragging = String(feature.id) === String(this._dragState?.featureId || '');
    const tags = featureTags(feature);
    const start = feature?.start || null;
    const end = feature?.end || null;
    const dates = start && end ? `${start.slice(0, 7)} -> ${end.slice(0, 7)}` : null;

    let depthClass = `pcard-child-${depth}`;
    if (depth > 3) {
      depthClass = 'pcard-child-deep';
    }

    return html`
      <div
        class="pcard ${depthClass} ${selected ? 'selected' : ''} ${feature?.dirty ? 'dirty' : ''} ${dragging ? 'dragging' : ''}"
        style="border-left-color:${this._projectColorForFeature(feature)}"
        draggable="true"
        @pointerdown="${(event) => this._handleCardPointerDown(event, feature)}"
        @dragstart="${(event) => this._handleDragStart(event, feature, teamId)}"
        @dragend="${this._handleDragEnd}"
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
          ${this._hasMultipleTeamAllocations(feature) ? html`<span class="badge badge-multi">🔗 Multi-team</span>` : ''}
          <span class="badge badge-pct">${allocation.toFixed(0)}%</span>
          ${dates ? html`<span class="badge badge-dates">${dates}</span>` : ''}
          ${tags.map((tag) => html`<span class="badge badge-tag">${tag}</span>`)}
        </div>
      </div>
    `;
  }

  _renderBoard() {
    const subtitle = `${this._rows.length} team${this._rows.length > 1 ? 's' : ''} · ${this._columnStates.length} state${this._columnStates.length > 1 ? 's' : ''}` || 'Board';
    const boardClass = this._boardOpen ? '' : 'collapsed';
    
    if (!this._rows.length || !this._columnStates.length) {
      return html`
        <div class="board-panel ${boardClass}">
          <div class="panel-header" @click="${this._toggleBoard}">
            <span class="panel-title">Board</span>
            <span class="panel-subtitle">No teams or states selected</span>
            <span class="panel-toggle ${this._boardOpen ? 'up' : ''}">▼</span>
          </div>
        </div>
      `;
    }

    const stateCounts = Object.fromEntries(this._columnStates.map((s) => [s, 0]));
    for (const row of this._rows) {
      for (const stateName of this._columnStates) {
        stateCounts[stateName] += (row.cells[stateName] || []).length;
      }
    }

    return html`
      <div class="board-panel ${boardClass}">
        <div class="panel-header" @click="${this._toggleBoard}">
          <span class="panel-title">Board</span>
          <span class="panel-subtitle">${subtitle}</span>
          <span class="panel-toggle ${this._boardOpen ? 'up' : ''}">▼</span>
        </div>
        ${this._boardOpen ? html`
      <div class="board-scroll">
        <table class="pgrid" style="--state-count:${this._columnStates.length}">
          <thead>
            <tr>
              <th>Teams</th>
              ${this._columnStates.map(
                (stateName) => {
                  const stateColor = this._getStateColorInfo(stateName);
                  return html`
                  <th>
                    <div class="state-th-inner">
                      <span class="state-dot" style="background:${stateColor.background}"></span>
                      ${stateName}
                      <span
                        class="state-count"
                        style="background:${stateColor.background}; color:${stateColor.text};"
                      >${stateCounts[stateName] || 0}</span>
                    </div>
                  </th>
                `;
                }
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
                    const stateColor = this._getStateColorInfo(stateName);
                    const cellStyle = ENABLE_STATE_CELL_ACCENT
                      ? `background:${hexToRgba(stateColor.background, STATE_CELL_ACCENT_ALPHA)};`
                      : '';
                    const rowTeamId = String(row.team?.id || '');
                    const rowHighlight =
                      this._dragState?.active &&
                      String(this._dragState.fromTeamId || '') === rowTeamId;
                    const dropClass = rowHighlight ? 'drop-allowed' : '';
                    return html`
                      <td
                        class="sc ${dropClass}"
                        style="${cellStyle}"
                        @dragover="${(event) => this._handleDragOver(event, stateName, rowTeamId)}"
                        @dragleave="${(event) => this._handleDragLeave(event, stateName, rowTeamId)}"
                        @drop="${(event) => this._handleDrop(event, stateName, rowTeamId)}"
                      >
                        ${cards.length
                          ? cards.map((entry) => this._renderCard(entry.feature, entry.allocation, rowTeamId, entry.depth))
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
        ` : ''}
      </div>
    `;
  }

  _toggleUnallocated() {
    this._unallocatedOpen = !this._unallocatedOpen;
  }

  _toggleBoard() {
    this._boardOpen = !this._boardOpen;
  }

  _renderUnallocated() {
    return renderUnallocatedPanel({
      unallocated: this._unallocated,
      isOpen: this._unallocatedOpen,
      isBoardCollapsed: !this._boardOpen,
      onToggle: () => this._toggleUnallocated(),
      onSelectFeature: (feature) => this._selectFeature(feature),
      getProjectColor: (feature) => this._projectColorForFeature(feature),
      getProjectName: (feature) => this._projectNameForFeature(feature),
    });
  }

  render() {
    const isBaselineScenario = this._activeScenarioId === 'baseline';
    const hasWarnings = isBaselineScenario || this._pendingChangesCount === 0;

    return html`
      <div class="toolbar">
        <div class="toolbar-title">Portfolio Planning Board</div>
        <div class="toolbar-spacer"></div>
        
        ${this._pendingChangesCount > 0 ? html`
          <div class="status-indicator pending">
            <span class="status-badge">${this._pendingChangesCount}</span>
            <span class="status-label">pending change${this._pendingChangesCount > 1 ? 's' : ''}</span>
          </div>
        ` : ''}
        
        ${isBaselineScenario ? html`
          <div class="status-indicator warning">
            <span class="warning-icon">⚠</span>
            <span class="status-label">No scenario selected</span>
          </div>
        ` : ''}
        
        <button class="close-btn" @click="${this._closePlugin}">Close</button>
      </div>

      <div class="main-content" @click="${this._clearSelectionOnBackground}">
        ${this._renderTimeline()}
        ${this._renderBoard()}
        ${this._renderUnallocated()}
      </div>

      ${this._statusMessage ? html`<div class="status-toast">${this._statusMessage}</div>` : ''}
    `;
  }
}

customElements.define('plugin-portfolio-board', PluginPortfolioComponent);
