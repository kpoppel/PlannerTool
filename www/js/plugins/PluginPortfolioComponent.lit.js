import { LitElement, html, css, unsafeSVG } from '../vendor/lit.js';
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
  buildPortfolioTimelineSvgMarkup,
  formatTimelineMonthLabel,
} from './portfolioTimeline.js';

const ENABLE_STATE_CELL_ACCENT = true;
const STATE_CELL_ACCENT_ALPHA = 0.1;
const TIMELINE_MONTH_GRID_SPACING = 120;
const TIMELINE_FADED_CATEGORIES = new Set(['completed', 'removed']);
// Tune this default cap for the timeline viewport height.
const DEFAULT_TIMELINE_MAX_HEIGHT_VH = 50;

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

function hexToRgba(hex, alpha = 0.12) {
  if (!hex) return `rgba(148, 163, 184, ${alpha})`;
  const value = String(hex).replace('#', '');
  if (value.length !== 6) return `rgba(148, 163, 184, ${alpha})`;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  if ([r, g, b].some((part) => Number.isNaN(part))) {
    return `rgba(148, 163, 184, ${alpha})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
    _timelineOpen: { type: Boolean, state: true },
    _timelineLayout: { type: Object, state: true },
    _dragState: { type: Object, state: true },
    _statusMessage: { type: String, state: true },
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

    .timeline-panel {
      position: sticky;
      top: 0;
      z-index: 35;
      display: flex;
      flex-direction: column;
      max-height: var(--portfolio-timeline-max-height, ${DEFAULT_TIMELINE_MAX_HEIGHT_VH}vh);
      border-bottom: 1px solid #d7e1ee;
      background: linear-gradient(180deg, #f8fbff 0%, #eef4fb 100%);
      box-shadow: 0 1px 0 rgba(15, 23, 42, 0.04);
    }

    .timeline-panel .panel-header {
      background: transparent;
      border-bottom: 1px solid rgba(148, 163, 184, 0.18);
    }

    .timeline-summary {
      font-size: 0.72rem;
      color: #475569;
    }

    .timeline-body {
      flex: 1;
      display: grid;
      grid-template-columns: ${TIMELINE_LABEL_WIDTH}px minmax(0, 1fr);
      align-items: start;
      min-height: 0;
      overflow: auto;
    }

    .timeline-labels {
      position: sticky;
      left: 0;
      z-index: 40;
      background: rgba(248, 251, 255, 0.96);
      border-right: 1px solid #dbe5f1;
      box-shadow: 1px 0 0 rgba(15, 23, 42, 0.03);
    }

    .timeline-label {
      display: flex;
      align-items: center;
      padding: 0 10px;
      font-size: 0.72rem;
      font-weight: 700;
      color: #334155;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      box-sizing: border-box;
      border-bottom: 1px solid rgba(148, 163, 184, 0.14);
    }

    .timeline-label .tc-dot {
      margin-right: 8px;
      width: 8px;
      height: 8px;
      flex-shrink: 0;
    }

    .timeline-svg-wrap {
      position: relative;
      overflow: hidden;
      background:
        repeating-linear-gradient(
          to right,
          rgba(148, 163, 184, 0.07) 0,
          rgba(148, 163, 184, 0.07) 1px,
          transparent 1px,
          transparent ${TIMELINE_MONTH_GRID_SPACING}px
        ),
        #fff;
    }

    .timeline-svg {
      display: block;
      overflow: visible;
      pointer-events: auto;
    }

    .timeline-empty {
      padding: 10px 12px;
      color: #64748b;
      font-size: 0.76rem;
      font-style: italic;
      border-top: 1px solid rgba(148, 163, 184, 0.14);
    }

    .timeline-year-label {
      fill: #334155;
      font-size: 10px;
      font-weight: 700;
    }

    .timeline-month-number {
      fill: #1e293b;
      font-size: 10px;
      font-weight: 700;
      pointer-events: none;
    }

    .timeline-month-line {
      stroke: rgba(148, 163, 184, 0.42);
      stroke-width: 1;
      shape-rendering: crispEdges;
      pointer-events: none;
    }

    .timeline-year-line {
      stroke: rgba(100, 116, 139, 0.52);
      stroke-width: 1;
      shape-rendering: crispEdges;
      pointer-events: none;
    }

    .timeline-today {
      stroke: #dc2626;
      stroke-width: 1.5;
      stroke-dasharray: 5 4;
      shape-rendering: crispEdges;
      pointer-events: none;
    }

    .timeline-row-divider {
      stroke: rgba(148, 163, 184, 0.18);
      stroke-width: 1;
      shape-rendering: crispEdges;
      pointer-events: none;
    }

    .timeline-year-label {
      pointer-events: none;
    }

    .timeline-bar {
      pointer-events: visiblePainted;
    }

    table.pgrid td.sc.drop-allowed {
      box-shadow: inset 0 0 0 2px rgba(22, 163, 74, 0.55);
    }

    .pcard.dragging {
      opacity: 0.45;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
    }

    table.pgrid {
      border-collapse: separate;
      border-spacing: 0;
      table-layout: fixed;
      min-width: calc(182px + 210px * var(--state-count, 4));
      width: 100%;
    }

    .status-toast {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 2000;
      max-width: 320px;
      padding: 10px 12px;
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.94);
      color: #f8fafc;
      font-size: 0.74rem;
      font-weight: 600;
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.28);
      pointer-events: none;
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
      top: 0;
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

    this._columnStates =
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
    this._timelineLayout = buildPortfolioTimelineLayout(rows, unallocated, this._columnStates);
  }

  _timelineBarCategory(feature) {
    const category = state.featureStateService?.getCategoryForState?.(feature?.state);
    return String(category || '').toLowerCase();
  }

  _timelineBarOpacity(feature) {
    return TIMELINE_FADED_CATEGORIES.has(this._timelineBarCategory(feature)) ? 0.36 : 0.92;
  }

  _timelineBarTooltip(feature) {
    const start = feature?.start || '-';
    const end = feature?.end || '-';
    const projectName = this._projectNameForFeature(feature);
    return `${feature?.id || ''}\n${toTitle(feature?.title)}\n${projectName}\n${start} -> ${end}`.trim();
  }

  _renderTimeline() {
    const layout = this._timelineLayout;
    const hasTimeline = !layout.empty;
    const subtitle = hasTimeline
      ? `${formatTimelineMonthLabel(layout.months[0])} -> ${formatTimelineMonthLabel(layout.months[layout.months.length - 1])}`
      : 'No dated tasks in the current selection';

    const timelineSvg = hasTimeline
      ? unsafeSVG(
          buildPortfolioTimelineSvgMarkup(layout, {
            getBarColor: (feature) => this._projectColorForFeature(feature),
            getBarOpacity: (feature) => this._timelineBarOpacity(feature),
            getBarTooltip: (feature) => this._timelineBarTooltip(feature),
          })
        )
      : null;

    return html`
      <div class="timeline-panel">
        <div class="panel-header" @click=${() => { this._timelineOpen = !this._timelineOpen; }}>
          <span class="panel-title">Timeline Overview</span>
          <span class="panel-subtitle timeline-summary">${subtitle}</span>
          <span class="panel-toggle ${this._timelineOpen ? 'up' : ''}">▼</span>
        </div>

        ${this._timelineOpen
          ? hasTimeline
            ? html`
                <div class="timeline-body">
                  <div class="timeline-labels" style="width:${TIMELINE_LABEL_WIDTH}px;">
                    <div class="timeline-label" style="height:${TIMELINE_HEADER_HEIGHT}px;">Teams</div>
                    ${layout.rows.map(
                      (row) => html`<div class="timeline-label" style="height:${row.height}px;">
                        <span class="tc-dot" style="background:${row.color}"></span>
                        ${row.label}
                      </div>`
                    )}
                  </div>
                  <div class="timeline-svg-wrap">${timelineSvg}</div>
                </div>
              `
            : html`<div class="timeline-empty">No dated tasks in the current selection.</div>`
          : ''}
      </div>
    `;
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
      if (!updated) throw new Error('State update rejected');
      this._showStatus(`Moved ${featureId} to ${nextState}`);
    } catch (error) {
      console.warn('[PluginPortfolio] failed to update feature state', error);
      this._showStatus(`Failed to move ${featureId} to ${nextState}`);
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

  _toggleUnallocated() {
    this._unallocatedOpen = !this._unallocatedOpen;
  }

  _renderCard(feature, allocation, teamId) {
    const typeName = getFeatureType(feature);
    const selected = String(feature.id) === String(this._selectedFeatureId);
    const dragging = String(feature.id) === String(this._dragState?.featureId || '');
    const tags = featureTags(feature);
    const start = feature?.start || null;
    const end = feature?.end || null;
    const dates = start && end ? `${start.slice(0, 7)} -> ${end.slice(0, 7)}` : null;

    return html`
      <div
        class="pcard ${selected ? 'selected' : ''} ${feature?.dirty ? 'dirty' : ''} ${dragging ? 'dragging' : ''}"
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
                          ? cards.map((entry) => this._renderCard(entry.feature, entry.allocation, rowTeamId))
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

      <div class="main-content" @click="${this._clearSelectionOnBackground}">
        ${this._renderTimeline()}
        <div class="board-panel">${this._renderBoard()}</div>
        ${this._renderUnallocated()}
      </div>

      ${this._statusMessage ? html`<div class="status-toast">${this._statusMessage}</div>` : ''}
    `;
  }
}

customElements.define('plugin-portfolio-board', PluginPortfolioComponent);
