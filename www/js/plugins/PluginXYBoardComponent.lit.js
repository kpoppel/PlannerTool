/**
 * PluginXYBoardComponent.lit.js
 * LitElement that renders the XY Board: a scrollable table where
 * columns = distinct values of the selected X field and
 * rows = distinct values of the selected Y field.
 *
 * Each table cell contains stacked XYCard components for the matching
 * features. Multi-valued fields (e.g. productType: ["A","B"]) cause a
 * card to appear in every matching cell.
 *
 * Toolbar selectors (task types, X field, Y field, card details) are
 * fully plugin-controlled and persisted via PlannerApi plugin state.
 */
import { LitElement, html, css } from '../vendor/lit.js';
import { bus } from '../core/EventBus.js';
import {
  FeatureEvents, AppEvents, ProjectEvents,
  ScenarioEvents, ViewManagementEvents, UIEvents,
} from '../core/EventRegistry.js';
import { computeGrid } from './xyBoardUtils.js';
import '../components/XYCard.lit.js';

// Fields available for axis and badge selection
const AVAILABLE_FIELDS = [
  { value: 'state', label: 'State' },
  { value: 'type', label: 'Type' },
  { value: 'iterationPath', label: 'Iteration' },
  { value: 'priority', label: 'Priority' },
  { value: 'severity', label: 'Severity' },
  { value: 'productType', label: 'Product Type' },
  { value: 'tags', label: 'Tags' },
  { value: 'areaPath', label: 'Area Path' },
];

/** localStorage / pluginStateService key */
const STATE_KEY = 'plugin-xy-board';

export class PluginXYBoardComponent extends LitElement {
  static properties = {
    xField: { type: String },
    yField: { type: String },
    /** @type {string[]} selected task type filters */
    selectedTypes: { type: Array },
    /** @type {string[]} fields to render as badges inside each card */
    detailFields: { type: Array },
    // --- internal reactive state ---
    _xVals: { type: Array, state: true },
    _yVals: { type: Array, state: true },
    /** @type {Map<string, Map<string, Object[]>>} */
    _grid: { type: Object, state: true },
    _selectedId: { type: String, state: true },
    /** @type {string[]} available task types derived from features */
    _availableTypes: { type: Array, state: true },
    /** @type {{value:string,label:string}[]} available fields for card details derived from features */
    _availableFields: { type: Array, state: true },
    /** id of the currently open dropdown panel, or null */
    _openDropdown: { type: String, state: true },
    /** Whether the component is visible (opened by plugin wrapper) */
    _open: { type: Boolean, state: true },
  };

  static styles = css`
    :host {
      display: none;
      flex-direction: column;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      background: var(--color-bg, #f8fafc);
      font-family: inherit;
    }

    :host([open]) {
      display: flex;
    }

    /* ---- Toolbar ---- */
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      padding: 8px 12px;
      background: #fff;
      border-bottom: 1px solid #e2e8f0;
      flex-shrink: 0;
    }

    /* ---- Custom dropdown controls ---- */
    .xy-select-wrap {
      position: relative;
    }

    .xy-select-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      background: #fff;
      cursor: pointer;
      font-size: 13px;
      color: #334155;
      white-space: nowrap;
      transition: background 0.15s, border-color 0.15s;
    }

    .xy-select-btn:hover {
      background: #f1f5f9;
      border-color: #94a3b8;
    }

    .xy-select-btn .select-label {
      font-weight: 600;
      color: #64748b;
      font-size: 12px;
    }

    .xy-select-btn .select-preview {
      color: #1e40af;
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .xy-select-btn .select-arrow {
      font-size: 10px;
      color: #94a3b8;
    }

    .xy-dropdown {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      z-index: 100;
      background: var(--color-sidebar-bg, #1e2d45);
      color: var(--color-sidebar-text, #e8eaf0);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
      padding: 8px;
      min-width: 180px;
      max-height: 340px;
      overflow-y: auto;
    }

    .xy-chip {
      padding: 5px 12px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      margin-bottom: 3px;
      color: var(--color-sidebar-text, #e8eaf0);
      transition: background 0.1s;
    }

    .xy-chip:hover {
      background: rgba(255, 255, 255, 0.18);
    }

    .xy-chip.active {
      background: rgb(55, 85, 130);
      border-color: transparent;
    }

    /* Transparent full-screen backdrop — closes open dropdowns on outside click */
    .bd {
      position: fixed;
      inset: 0;
      z-index: 99;
    }

    /* ---- Board scroll area ---- */
    .board-wrap {
      flex: 1;
      overflow: auto;
      padding: 8px;
    }

    /* ---- Table ---- */
    table.xy-grid {
      /* border-collapse:separate is required for sticky headers/columns to
         properly occlude scrolling content. With collapse, borders are shared
         between cells so the sticky cell background cannot cover them. */
      border-collapse: separate;
      border-spacing: 0;
      table-layout: fixed;
      width: 100%;
      /*
       * min-width keeps each data column at ≥200px.
       * With table-layout:fixed and width:100%, columns share available space
       * equally; the min-width only triggers horizontal scroll when
       * the viewport is narrower than 160px + 200px × colCount.
       */
      min-width: calc(160px + 200px * var(--col-count, 4));
    }

    table.xy-grid th,
    table.xy-grid td {
      /* Each cell draws only its right+bottom border to avoid doubling
         under border-collapse:separate */
      border-right: 1px solid #e2e8f0;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: top;
      padding: 6px;
      white-space: normal;
      word-break: break-word;
      overflow-wrap: break-word;
    }

    /* Restore outer left/top edges */
    table.xy-grid thead th {
      border-top: 1px solid #e2e8f0;
    }
    table.xy-grid th:first-child,
    table.xy-grid td:first-child {
      border-left: 1px solid #e2e8f0;
    }

    /* Column headers (X axis) */
    table.xy-grid thead th {
      background: #f1f5f9;
      font-size: 13px;
      font-weight: 600;
      color: #334155;
      position: sticky;
      top: 0;
      z-index: 2;
    }

    /* Row headers (Y axis) — sticky left */
    table.xy-grid tbody th {
      background: #fff;
      font-size: 13px;
      font-weight: 600;
      color: #334155;
      position: sticky;
      left: 0;
      z-index: 3;
      min-width: 160px;
      max-width: 220px;
      text-align: left;
    }

    /* Corner cell sticky in both directions */
    table.xy-grid thead th.corner {
      left: 0;
      z-index: 4;
    }

    /* ---- Cell contents ---- */
    .cell-contents {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    /* Empty state */
    .empty-msg {
      padding: 32px;
      text-align: center;
      color: #94a3b8;
      font-size: 14px;
    }
  `;

  constructor() {
    super();
    this.xField = 'state';
    this.yField = 'type';
    this.selectedTypes = [];
    this.detailFields = ['priority', 'severity'];
    this._xVals = [];
    this._yVals = [];
    this._grid = new Map();
    this._selectedId = null;
    this._availableTypes = [];
    /** @type {{value:string,label:string}[]} fields derived from the live feature set */
    this._availableFields = [...AVAILABLE_FIELDS];
    this._openDropdown = null;
    this._open = false;

    this._boundRefresh = this._refresh.bind(this);
    this._boundOnSelected = this._onSelected.bind(this);
    this._boundOnProjectsChanged = this._onProjectsChanged.bind(this);
    // Details-panel edits mark features dirty → refresh to pick up dirty flag
    // and scenario/view changes may alter effective features or project state
    this._boundRefreshOnDetails = this._refresh.bind(this);
  }

  get _api() {
    if (!this.api) throw new Error('PluginXYBoardComponent requires PlannerApi');
    return this.api;
  }

  connectedCallback() {
    super.connectedCallback();
    bus.on(FeatureEvents.UPDATED, this._boundRefresh);
    bus.on(AppEvents.READY, this._boundRefresh);
    bus.on(FeatureEvents.SELECTED, this._boundOnSelected);
    bus.on(ProjectEvents.CHANGED, this._boundOnProjectsChanged);
    // Scenario activation/save changes which features are effective
    bus.on(ScenarioEvents.ACTIVATED, this._boundRefreshOnDetails);
    bus.on(ScenarioEvents.SAVED, this._boundRefreshOnDetails);
    // View activation changes project/team selection and display settings
    bus.on(ViewManagementEvents.ACTIVATED, this._boundRefreshOnDetails);
    // Details-panel closes after the user edits a field, marking the feature dirty
    bus.on(UIEvents.DETAILS_HIDE, this._boundRefreshOnDetails);
    this._loadState();
    this._refresh();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    bus.off(FeatureEvents.UPDATED, this._boundRefresh);
    bus.off(AppEvents.READY, this._boundRefresh);
    bus.off(FeatureEvents.SELECTED, this._boundOnSelected);
    bus.off(ProjectEvents.CHANGED, this._boundOnProjectsChanged);
    bus.off(ScenarioEvents.ACTIVATED, this._boundRefreshOnDetails);
    bus.off(ScenarioEvents.SAVED, this._boundRefreshOnDetails);
    bus.off(ViewManagementEvents.ACTIVATED, this._boundRefreshOnDetails);
    bus.off(UIEvents.DETAILS_HIDE, this._boundRefreshOnDetails);
  }

  // ---- Public API called by PluginXYBoard ----

  open() {
    this._open = true;
    this.setAttribute('open', '');
    this._refresh();
  }

  close() {
    this._open = false;
    this.removeAttribute('open');
  }

  // ---- Data ----

  _onProjectsChanged(_projects) {
    // Plan menu selection changed — recompute grid using the latest selection.
    this._refresh();
  }

  _refresh() {
    let features = [];
    try {
      features = this._api.features.list() || [];
    } catch (_) {
      // state not yet ready — will be called again on AppEvents.READY
      return;
    }

    // Derive available task types — union of baseline cache and effective features
    // so all types are visible in the select even if filtered
    const typeSet = new Set([
      ...(this._api.taskTypes.getAvailable() || []),
      ...features.map((f) => f.type || f.workItemType).filter(Boolean),
    ]);
    this._availableTypes = Array.from(typeSet).sort();

    // Derive all field keys present on the feature set so the card-details
    // select offers real field choices beyond the static AVAILABLE_FIELDS list
    const knownValues = new Set(AVAILABLE_FIELDS.map((f) => f.value));
    const extraFields = [];
    for (const f of features) {
      for (const key of Object.keys(f)) {
        if (!knownValues.has(key) && !key.startsWith('_') && !['id','title','projectId'].includes(key)) {
          knownValues.add(key);
          extraFields.push({ value: key, label: key });
        }
      }
    }
    this._availableFields = [
      ...AVAILABLE_FIELDS,
      ...extraFields.sort((a, b) => a.label.localeCompare(b.label)),
    ];

    // Apply plan-menu project filter.
    // Features use `f.project` (string) to reference their parent project.
    // When projects are empty (not yet loaded) show everything.
    // When all projects are deselected show nothing (empty board).
    const allProjects = this._api.selection.getProjects() || [];
    let afterProjectFilter;
    if (allProjects.length === 0) {
      // Projects not yet loaded — do not filter
      afterProjectFilter = features;
    } else {
      const selectedProjectIds = new Set(
        allProjects.filter((p) => p.selected).map((p) => p.id)
      );
      afterProjectFilter =
        selectedProjectIds.size === 0
          ? [] // no plans selected — empty board (mirrors timeline board behaviour)
          : features.filter((f) => selectedProjectIds.has(f.project));
    }

    // Apply plugin-local task type filter
    const filtered =
      this.selectedTypes.length
        ? afterProjectFilter.filter((f) => this.selectedTypes.includes(f.type || f.workItemType))
        : afterProjectFilter;

    const stateComparator = (a, b) => this._api.taskTypes.compareFeatureStates(a, b);
    const { xVals, yVals, grid } = computeGrid(filtered, this.xField, this.yField, {
      xSort: this.xField === 'state' ? stateComparator : null,
      ySort: this.yField === 'state' ? stateComparator : null,
    });
    this._xVals = xVals;
    this._yVals = yVals;
    this._grid = grid;
  }

  _onSelected(payload) {
    const id = payload?.id ?? payload?.feature?.id ?? null;
    this._selectedId = id;
  }

  // ---- Persistence ----

  _saveState() {
    try {
      this._api.plugins.setState(STATE_KEY, {
        xField: this.xField,
        yField: this.yField,
        selectedTypes: this.selectedTypes,
        detailFields: this.detailFields,
      });
    } catch (_) {
      // pluginStateService may not be ready on first load
    }
  }

  _loadState() {
    try {
      const saved = this._api.plugins.getState(STATE_KEY);
      if (!saved) return;
      if (saved.xField) this.xField = saved.xField;
      if (saved.yField) this.yField = saved.yField;
      if (Array.isArray(saved.selectedTypes)) this.selectedTypes = saved.selectedTypes;
      if (Array.isArray(saved.detailFields)) this.detailFields = saved.detailFields;
    } catch (_) {
      // ignore if not available
    }
  }

  // ---- Dropdown interaction ----

  _toggleDropdown(id) {
    this._openDropdown = this._openDropdown === id ? null : id;
  }

  _toggleType(t) {
    const idx = this.selectedTypes.indexOf(t);
    this.selectedTypes =
      idx >= 0 ? this.selectedTypes.filter((x) => x !== t) : [...this.selectedTypes, t];
    this._saveState();
    this._refresh();
  }

  _toggleDetailField(val) {
    const idx = this.detailFields.indexOf(val);
    this.detailFields =
      idx >= 0 ? this.detailFields.filter((x) => x !== val) : [...this.detailFields, val];
    this._saveState();
    this.requestUpdate();
  }

  _selectXField(val) {
    this.xField = val;
    this._openDropdown = null;
    this._saveState();
    this._refresh();
  }

  _selectYField(val) {
    this.yField = val;
    this._openDropdown = null;
    this._saveState();
    this._refresh();
  }

  _onCardClick(e) {
    const { feature } = e.detail;
    bus.emit(FeatureEvents.SELECTED, feature);
  }

  // ---- Rendering helpers ----

  _projectColor(feature) {
    try {
      return this._api.colors.getProject(feature.projectId) || null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Render a custom chip-style dropdown selector.
   * @param {string} id - unique key tracking which dropdown is open
   * @param {string} label - label text on the button
   * @param {{value:string,label:string}[]} options
   * @param {(v:string)=>boolean} activeCheck - true when option is selected
   * @param {(v:string)=>void} onSelect - called when option chip is clicked
   */
  _renderDropdown(id, label, options, activeCheck, onSelect) {
    const isOpen = this._openDropdown === id;
    const activeOpts = options.filter((o) => activeCheck(o.value));
    const preview =
      activeOpts.length === 0 || activeOpts.length === options.length
        ? 'All'
        : activeOpts.map((o) => o.label).join(', ');

    return html`
      <div class="xy-select-wrap">
        <button
          class="xy-select-btn"
          @click="${(e) => { e.stopPropagation(); this._toggleDropdown(id); }}"
        >
          <span class="select-label">${label}</span>
          <span class="select-preview">${preview}</span>
          <span class="select-arrow">${isOpen ? '▲' : '▼'}</span>
        </button>
        ${isOpen
          ? html`
              <div class="xy-dropdown">
                ${options.map(
                  (o) => html`
                    <div
                      class="xy-chip ${activeCheck(o.value) ? 'active' : ''}"
                      @click="${(e) => { e.stopPropagation(); onSelect(o.value); }}"
                    >
                      ${o.label}
                    </div>
                  `
                )}
              </div>
            `
          : ''}
      </div>
    `;
  }

  _renderToolbar() {
    const { _availableTypes, _availableFields, selectedTypes, xField, yField, detailFields } = this;
    const typeOptions = _availableTypes.map((t) => ({ value: t, label: t }));

    return html`
      <div class="toolbar">
        ${this._renderDropdown(
          'types', 'Task types', typeOptions,
          (v) => selectedTypes.length === 0 || selectedTypes.includes(v),
          (v) => this._toggleType(v)
        )}
        ${this._renderDropdown(
          'xfield', 'X axis', _availableFields,
          (v) => v === xField,
          (v) => this._selectXField(v)
        )}
        ${this._renderDropdown(
          'yfield', 'Y axis', _availableFields,
          (v) => v === yField,
          (v) => this._selectYField(v)
        )}
        ${this._renderDropdown(
          'details', 'Card details', _availableFields,
          (v) => detailFields.includes(v),
          (v) => this._toggleDetailField(v)
        )}
      </div>
    `;
  }

  _renderGrid() {
    const { _xVals, _yVals, _grid, _selectedId, detailFields } = this;

    if (_xVals.length === 0 && _yVals.length === 0) {
      return html`<div class="empty-msg">No features match the current filter.</div>`;
    }

    return html`
      <div class="board-wrap">
        <table class="xy-grid" style="--col-count:${_xVals.length}">
          <colgroup>
            <col style="width:160px">
            ${_xVals.map(() => html`<col>`)}
          </colgroup>
          <thead>
            <tr>
              <th class="corner"></th>
              ${_xVals.map((x) => html`<th>${x}</th>`)}
            </tr>
          </thead>
          <tbody>
            ${_yVals.map((y) => {
              const rowMap = _grid.get(y);
              return html`
                <tr>
                  <th>${y}</th>
                  ${_xVals.map((x) => {
                    const cellFeatures = rowMap?.get(x) ?? [];
                    return html`
                      <td>
                        <div class="cell-contents">
                          ${cellFeatures.map(
                            (f) => html`
                              <xy-card
                                .feature="${f}"
                                .detailFields="${detailFields}"
                                .selected="${f.id === _selectedId}"
                                .projectColor="${this._projectColor(f)}"
                                @xy-card-click="${this._onCardClick}"
                              ></xy-card>
                            `
                          )}
                        </div>
                      </td>
                    `;
                  })}
                </tr>
              `;
            })}
          </tbody>
        </table>
      </div>
    `;
  }

  render() {
    return html`
      ${this._openDropdown ? html`<div class="bd" @click="${() => { this._openDropdown = null; }}"></div>` : ''}
      ${this._renderToolbar()}
      ${this._renderGrid()}
    `;
  }
}

customElements.define('plugin-xy-board', PluginXYBoardComponent);
