import { LitElement, html, css } from '../vendor/lit.js';
import { cmd, sel } from '../application/imports.js';
import { store } from '../application/store.js';
import { bus } from '../core/EventBus.js';
import { FeatureEvents, FilterEvents } from '../core/EventRegistry.js';
import { featureTypeKey } from '../application/shared/workItemDisplay.js';
import { dataService } from '../services/dataService.js';
import { getIconTemplate } from '../services/IconService.js';
import { DEFAULT_SCOPES, addMonths, buildForecast, selectPlanTasks, validateScopes } from './coneOfUncertainty.js';

const PREFERENCE_KEY = 'coneOfUncertainty.scopes';
const SORT_MODE_PREFERENCE_KEY = 'coneOfUncertainty.sortMode';
const FILTER_PREFERENCE_KEY = 'coneOfUncertainty.filters';
const MONTH_LABEL = new Intl.DateTimeFormat('en', {
  month: 'short', year: 'numeric', timeZone: 'UTC',
});

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export class PluginConeOfUncertaintyComponent extends LitElement {
  static properties = {
    origin: { state: true },
    scopes: { state: true },
    rootsOnly: { state: true },
    _sortMode: { state: true },
    _filters: { state: true },
    search: { state: true },
    _loaded: { state: true },
    _loading: { state: true },
    _error: { state: true },
    _saving: { state: true },
    _status: { state: true },
  };

  static styles = css`
    :host {
      display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0;
      color: #17283e; background: #f7f9fc; font: 14px/1.45 system-ui, sans-serif;
    }
    * { box-sizing: border-box; }
    header { padding: 18px 24px 10px; }
    h2 { margin: 0 0 4px; font-size: 23px; }
    p { margin: 4px 0 10px; }
    .disclaimer { color: #624219; background: #fff4d9; padding: 10px 14px; border-radius: 6px; }
    .toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 18px; margin: 12px 0; }
    label { display: inline-flex; gap: 8px; align-items: center; }
    input, select, button {
      font: inherit; padding: 5px 8px; border: 1px solid #aebdd0; border-radius: 4px;
      color: #17283e; background: white; color-scheme: light;
    }
    button { cursor: pointer; color: #163f78; background: white; }
    button:disabled { cursor: wait; }
    input[type=number] { width: 100px; }
    details { border: 1px solid #cbd6e5; border-radius: 6px; padding: 8px 12px; background: white; }
    summary { cursor: pointer; font-weight: 600; }
    fieldset { display: inline-flex; gap: 12px; flex-wrap: wrap; margin: 10px 12px 8px 0; border: 1px solid #cbd6e5; }
    .settings-actions { display: flex; gap: 10px; align-items: center; }
    .scope-0 { --scope-color: #3a63b8; --scope-tint: #edf2ff; }
    .scope-1 { --scope-color: #087c92; --scope-tint: #eaf6fa; }
    .scope-2 { --scope-color: #8650ae; --scope-tint: #f5effa; }
    .chart { flex: 1; min-height: 180px; overflow: auto; margin: 0 24px 20px; border: 1px solid #cbd6e5; background: white; }
    .chart-content { min-width: 1200px; }
    .chart-header, .task-row { display: grid; grid-template-columns: 280px minmax(700px, 1fr) 220px; }
    .chart-header { position: sticky; top: 0; z-index: 4; background: #f8fafc; font-weight: 600; }
    .task-label, .column-title { padding: 12px; position: sticky; left: 0; background: white; z-index: 2; border-right: 1px solid #dfe6ef; }
    .column-title { background: #f8fafc; }
    .task-label { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 4px 8px; }
    .task-label { cursor: pointer; }
    .task-type { flex: 0 0 16px; display: inline-flex; }
    .task-type svg { width: 16px; height: 16px; }
    .task-copy { min-width: 0; }
    .task-label strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .task-label small { display: block; color: #53667c; font-size: 11px; }
    .task-row { border-top: 1px solid #e4eaf2; min-height: 40px; font-size: 13px; line-height: 1.15; }
    .axis { position: relative; min-height: 84px; overflow: hidden; }
    .tick { position: absolute; bottom: 8px; font-size: 11px; white-space: nowrap; padding-left: 4px; }
    .period { position: absolute; top: 0; bottom: 0; background: var(--scope-tint); border-left: 1px dashed var(--scope-color); }
    .period.scope-2 { border-right: 1px dashed var(--scope-color); }
    .period-label { position: absolute; top: 4px; display: flex; flex-direction: row; flex-wrap: nowrap;
      align-items: center; gap: 6px; width: max-content; font-size: 14px; padding: 0 2px;
      overflow: visible; white-space: nowrap;
      color: var(--scope-color); background: var(--scope-tint); }
    .track { position: relative; min-height: 39px; }
    .bar, .uncertainty, .baseline-line {
      position: absolute; top: 50%; height: 18px; transform: translateY(-50%);
    }
    .bar { background: var(--scope-color, #64748b); border-radius: 5px 0 0 5px; min-width: 3px; }
    .uncertainty { min-width: 3px; border: 1px dashed var(--scope-color); border-radius: 0 5px 5px 0;
      background: linear-gradient(90deg, var(--scope-color), var(--scope-tint)); opacity: 0.65; }
    .baseline-line { height: 2px; background: var(--scope-color); }
    .planned-finish {
      position: absolute; top: 50%; height: 26px; transform: translateY(-50%);
      border-left: 2px solid #17283e;
    }
    .finish-range { display: flex; flex-direction: column; justify-content: center;
      padding: 4px 8px; background: white; z-index: 1; }
    .finish-range small { display: block; color: #53667c; font-size: 11px; }
    .status { padding: 0 24px 10px; color: #53667c; }
    .error { color: #8d2424; background: #fff0ef; padding: 10px 14px; }
    .empty { padding: 30px; text-align: center; }
    .key { font-size: 12px; color: #53667c; }
  `;

  constructor() {
    super();
    this.origin = today();
    this.scopes = DEFAULT_SCOPES.map((scope) => ({ ...scope }));
    this.rootsOnly = true;
    this._sortMode = 'date';
    this._filters = { states: [], types: [] };
    this._previousSortMode = null;
    this._previousFilters = null;
    this.search = '';
    this._loaded = false;
    this._loading = true;
    this._error = '';
    this._saving = false;
    this._status = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this._unsubscribe = store.subscribe((state) => state, () => this.requestUpdate());
    this._unsubscribeFeatureUpdates = bus.on(FeatureEvents.UPDATED, () => this.requestUpdate());
    this._unsubscribeFilterChanges = bus.on(FilterEvents.CHANGED, () => this._persistFilterPreferences());
    this.ready = this._loadPreferences();
  }

  disconnectedCallback() {
    this._unsubscribe();
    this._unsubscribeFeatureUpdates();
    this._unsubscribeFilterChanges();
    if (this.hasAttribute('open')) this.close();
    else cmd.filter.clearSidebarDisabledElements();
    super.disconnectedCallback();
  }

  async open() {
    this.setAttribute('open', '');
    this.origin = today();
    await this.ready;
    this._disableSidebarFilters();
    if (this._previousSortMode === null) this._previousSortMode = sel.view.getFeatureSortMode();
    if (this._previousFilters === null) {
      this._previousFilters = {
        states: sel.filter.getSelectedFeatureStateNames(),
        types: sel.filter.getSelectedTaskTypeNames(),
      };
    }
    cmd.filter.setSelectedStates(this._filters.states);
    cmd.filter.setSelectedTaskTypes(this._filters.types);
    cmd.view.setFeatureSortMode(this._sortMode);
    this.requestUpdate();
  }

  close() {
    this.removeAttribute('open');
    cmd.filter.clearSidebarDisabledElements();
    if (this._previousFilters !== null) {
      cmd.filter.setSelectedStates(this._previousFilters.states);
      cmd.filter.setSelectedTaskTypes(this._previousFilters.types);
      this._previousFilters = null;
    }
    if (this._previousSortMode !== null) {
      cmd.view.setFeatureSortMode(this._previousSortMode);
      this._previousSortMode = null;
    }
  }

  async _loadPreferences() {
    this._loaded = false;
    try {
      const stored = await dataService.getLocalPref(PREFERENCE_KEY);
      const storedSortMode = await dataService.getLocalPref(SORT_MODE_PREFERENCE_KEY);
      const storedFilters = await dataService.getLocalPref(FILTER_PREFERENCE_KEY);
      // Boundary guard: payload comes from external persistence/API and may be missing fields; normalize here, not downstream.
      const scopes = stored === undefined ? DEFAULT_SCOPES : stored;
      validateScopes(scopes);
      let filters;
      if (storedFilters === undefined) {
        filters = {
          states: sel.filter.getSelectedFeatureStateNames(),
          types: sel.filter.getSelectedTaskTypeNames(),
        };
      } else {
        if (storedFilters === null || typeof storedFilters !== 'object'
          || !(storedFilters.states instanceof Array) || !(storedFilters.types instanceof Array)
          || !storedFilters.states.every((value) => typeof value === 'string')
          || !storedFilters.types.every((value) => typeof value === 'string')) {
          throw new Error('Task filter preferences must contain state and type name lists.');
        }
        filters = { states: [...storedFilters.states], types: [...storedFilters.types] };
      }
      if (storedSortMode === undefined) this._sortMode = 'date';
      else if (storedSortMode === 'date' || storedSortMode === 'rank') {
        this._sortMode = storedSortMode;
      } else {
        throw new Error('Sort preference must be date or rank.');
      }
      this.scopes = scopes.map((scope) => ({ ...scope }));
      this._filters = filters;
      this._loaded = true;
      this._error = '';
    } catch (error) {
      console.error('Loading cone of uncertainty preferences failed', error);
      this._error = `Cannot load uncertainty preferences: ${error.message} Reset explicitly to continue.`;
    } finally {
      this._loading = false;
    }
  }

  async saveSettings(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const scopes = [0, 1, 2].map((index) => {
      const value = (name) => {
        const raw = form.elements.namedItem(`${name}-${index}`).value.trim();
        return raw === '' ? NaN : Number(raw);
      };
      return { endMonth: value('endMonth'), lower: value('lower'), upper: value('upper') };
    });
    await this._persistScopes(scopes);
    await this.updateComplete;
  }

  async resetSettings() {
    await this._persistScopes(DEFAULT_SCOPES.map((scope) => ({ ...scope })));
  }

  async _changeSortMode(event) {
    const mode = event.currentTarget.value;
    if (mode !== 'date' && mode !== 'rank') throw new Error(`Unsupported task sort mode: ${mode}`);
    this._sortMode = mode;
    cmd.view.setFeatureSortMode(mode);
    this._error = '';
    try {
      await dataService.setLocalPref(SORT_MODE_PREFERENCE_KEY, mode);
    } catch (error) {
      console.error('Saving cone of uncertainty sort preference failed', error);
      this._error = `Cannot save sort preference: ${error.message}`;
    }
  }

  _disableSidebarFilters() {
    const taskFilters = sel.filter.getTaskFilters();
    const disabledTaskFilters = Object.fromEntries(Object.entries(taskFilters)
      .map(([dimension, options]) => [dimension, Object.keys(options)]));
    cmd.filter.setSidebarDisabledElements({ taskFilters: disabledTaskFilters });
  }

  async _persistFilterPreferences() {
    if (!this.hasAttribute('open')) return;
    const filters = {
      states: sel.filter.getSelectedFeatureStateNames(),
      types: sel.filter.getSelectedTaskTypeNames(),
    };
    this._filters = filters;
    this._error = '';
    try {
      await dataService.setLocalPref(FILTER_PREFERENCE_KEY, {
        states: [...filters.states], types: [...filters.types],
      });
    } catch (error) {
      console.error('Saving cone of uncertainty filter preferences failed', error);
      this._error = `Cannot save task filter preferences: ${error.message}`;
    }
  }

  async _persistScopes(scopes) {
    this._status = '';
    try {
      validateScopes(scopes);
    } catch (error) {
      this._error = error.message;
      return;
    }
    this._saving = true;
    try {
      await dataService.setLocalPref(PREFERENCE_KEY, scopes);
      this.scopes = scopes;
      this._loaded = true;
      this._error = '';
      this._status = 'Uncertainty preferences saved in this browser.';
    } catch (error) {
      console.error('Saving cone of uncertainty preferences failed', error);
      this._error = `Cannot save uncertainty preferences: ${error.message}`;
    } finally {
      this._saving = false;
    }
  }

  _scopeLabel(index) {
    const start = index === 0 ? 0 : this.scopes[index - 1].endMonth;
    return `${start}-${this.scopes[index].endMonth} months`;
  }

  _renderSettings() {
    return html`
      <details>
        <summary>Uncertainty settings</summary>
        <p>Three consecutive scopes measured from today. Percentages apply to inclusive task
          duration, or remaining duration for active work. Task dates are never changed.</p>
        <form @submit=${this.saveSettings}>
          ${this.scopes.map((scope, index) => html`
            <fieldset ?disabled=${this._saving || this._loading}>
              <legend>Scope ${index + 1}</legend>
              <label>End month <input name=${`endMonth-${index}`} type="number" min="1"
                step="1" required .value=${String(scope.endMonth)}></label>
              <label>Lower % <input name=${`lower-${index}`} type="number" min="-100"
                max="0" step="any" required .value=${String(scope.lower)}></label>
              <label>Upper % <input name=${`upper-${index}`} type="number" min="0"
                step="any" required .value=${String(scope.upper)}></label>
            </fieldset>
          `)}
          <div class="settings-actions">
            <button type="submit" ?disabled=${this._saving || this._loading}>Save preferences</button>
            <button type="button" ?disabled=${this._saving || this._loading}
              @click=${this.resetSettings}>Reset to defaults</button>
            <span role="status">${this._status}</span>
          </div>
        </form>
      </details>
    `;
  }

  _position(date, forecast) {
    return 100 * (date.getTime() - forecast.axisStart.getTime())
      / (forecast.rangeEnd.getTime() - forecast.axisStart.getTime());
  }

  _renderPeriods(forecast, labels = false) {
    return this.scopes.map((scope, index) => {
      const left = this._position(forecast.boundaries[index], forecast);
      const width = this._position(forecast.boundaries[index + 1], forecast) - left;
      const startMonth = index === 0 ? 0 : this.scopes[index - 1].endMonth;
      const title = `${this._scopeLabel(index)}: ${scope.lower}% / +${scope.upper}%`;
      return html`
        <div aria-hidden="true" class=${`period scope-${index}`} style=${`left:${left}%;width:${width}%`}></div>
        ${labels ? html`<span class=${`period-label scope-${index}`}
          title=${title} style=${`left:${left}%`}>
          <span>${startMonth}-${scope.endMonth}m</span>
          <span>${scope.lower}%</span>
          <span>+${scope.upper}%</span>
        </span>` : ''}
      `;
    });
  }

  _renderRow(row, forecast) {
    const left = Math.max(0, this._position(row.start, forecast));
    const planned = this._position(row.end, forecast);
    const earliest = row.earliest === null ? planned : this._position(row.earliest, forecast);
    const latest = row.latest === null ? planned : this._position(row.latest, forecast);
    const range = row.scopeIndex < 0 ? 'Not modeled (starts before origin)'
      : `${MONTH_LABEL.format(row.earliest)} - ${MONTH_LABEL.format(row.latest)}`;
    const description = `${row.feature.id}: ${row.feature.title}. Planned finish ${MONTH_LABEL.format(row.end)}. Finish range: ${range}.`;
    const tooltip = `${row.feature.title}\nState: ${row.feature.state}\nStart: ${row.feature.start}\nEnd: ${row.feature.end}`;
    return html`
      <div class="task-row" role="row" aria-label=${description}>
        <div class="task-label" role="rowheader" title=${row.feature.title}
          @click=${() => cmd.feature.setSelectedFeature(row.feature)}>
          <span class="task-type" title=${row.feature.type} role="img"
            aria-label=${row.feature.type}>${getIconTemplate(row.feature.type)}</span>
          <div class="task-copy">
            <strong>${row.feature.title}</strong>
            <small>${row.feature.id} · ${row.scopeIndex < 0 ? 'Ongoing work' : this._scopeLabel(row.scopeIndex)}</small>
          </div>
        </div>
        <div class=${`track scope-${row.scopeIndex}`} role="cell" aria-label=${description}>
          ${this._renderPeriods(forecast)}
          <div class="bar" title=${tooltip}
            style=${`left:${left}%;width:${Math.max(0, earliest - left)}%`}></div>
          ${row.scopeIndex >= 0 ? html`
            <div class="uncertainty" title=${tooltip}
              style=${`left:${earliest}%;width:${latest - earliest}%`}></div>
            <div class="baseline-line" style=${`left:${earliest}%;width:${planned - earliest}%`}></div>
          ` : ''}
          <span class="planned-finish" title=${`Planned finish: ${MONTH_LABEL.format(row.end)}`}
            style=${`left:${planned}%`}></span>
        </div>
        <div class="finish-range" role="cell">${range}
          <small>Planned: ${MONTH_LABEL.format(row.end)}</small>
        </div>
      </div>
    `;
  }

  render() {
    const features = sel.feature.getEffectiveFeatures();
    const planIds = sel.selection.getSelectedProjectIds();
    const selectedStates = new Set(sel.filter.getSelectedFeatureStateNames()
      .map((state) => state.toLowerCase()));
    const selectedTypes = new Set(sel.filter.getSelectedTaskTypeNames());
    const tasks = selectPlanTasks(features, planIds, this.rootsOnly, this.search)
      .filter((feature) => selectedTypes.has(featureTypeKey(feature))
        && selectedStates.has(String(feature.state).toLowerCase())).map((feature) => ({
      ...feature,
      stateCategory: sel.filter.getFeatureStateCategory(feature),
    }));
    const forecast = this._loaded ? buildForecast(tasks, this.origin, this.scopes) : null;
    const ticks = [];
    if (forecast !== null) {
      const sortMode = sel.view.getFeatureSortMode();
      forecast.rows.sort((first, second) => {
        if (sortMode === 'date') {
          const firstEnd = first.latest === null ? first.end : first.latest;
          const secondEnd = second.latest === null ? second.end : second.latest;
          return firstEnd.getTime() - secondEnd.getTime();
        }
        const firstRank = Number.isInteger(first.feature.originalRank) ? first.feature.originalRank : 0;
        const secondRank = Number.isInteger(second.feature.originalRank) ? second.feature.originalRank : 0;
        return firstRank - secondRank;
      });
      const months = (forecast.rangeEnd.getUTCFullYear() - forecast.axisStart.getUTCFullYear()) * 12
        + forecast.rangeEnd.getUTCMonth() - forecast.axisStart.getUTCMonth();
      const step = Math.max(1, Math.ceil(months / 16));
      for (let month = 0; month <= months; month += step) {
        ticks.push(addMonths(forecast.axisStart, month));
      }
    }
    return html`
      <header>
        <h2>Cone of uncertainty</h2>
        <p>Communicate the range, not a promise.</p>
        <p class="disclaimer"><strong>Forecast, not a commitment.</strong>
          Shaded ranges are planning assumptions, not statistical confidence intervals.
          Starts are held fixed; dependencies, capacity changes and correlated delays are not modeled.</p>
        <div class="toolbar">
          <span class="forecast-origin">Forecast origin: ${this.origin}</span>
          <label>Sort order <select name="sortMode" .value=${this._sortMode}
            @change=${this._changeSortMode}>
            <option value="date">Date</option>
            <option value="rank">Rank</option>
          </select></label>
          <label>Task hierarchy <select name="levels" .value=${this.rootsOnly ? 'roots' : 'all'}
            @change=${(event) => { this.rootsOnly = event.target.value === 'roots'; }}>
            <option value="roots">Highest level only</option>
            <option value="all">All levels</option>
          </select></label>
          <label>Search <input type="search" placeholder="Task ID or title" .value=${this.search}
            @input=${(event) => { this.search = event.target.value; }}></label>
        </div>
        ${this._renderSettings()}
        ${this._error !== '' ? html`<p class="error" role="alert">${this._error}</p>` : ''}
        ${forecast === null ? '' : html`
          <p class="key">Solid: duration up to earliest finish · Shading: possible finish range ·
            Dark marker: planned finish. Ranges rounded outward to whole days; labels show months.</p>
        `}
      </header>
      ${forecast === null ? html`<p class="status">${this._error === '' ? 'Loading preferences...' : 'Forecast unavailable until preferences are restored.'}</p>` : html`
        <div class="status" role="status">
          ${forecast.rows.length} tasks · ${forecast.invalidCount} undated or invalid schedules omitted ·
          ${forecast.outsideCount} outside forecast window omitted.
          Non-active tasks starting before the origin have no modeled range.
          ${forecast.rangeEnd.getTime() > forecast.horizon.getTime() + 86400000
            ? 'The axis extends beyond the forecast horizon to show complete finish ranges.' : ''}
          Plan selection applies; board task/team filters are independent of this view.
        </div>
        <div class="chart" role="region" aria-label="Uncertainty timeline" tabindex="0">
          <div class="chart-content" role="table" aria-label="Task finish forecasts">
            <div class="chart-header" role="row">
              <div class="column-title" role="columnheader">Task</div>
              <div class="axis" role="columnheader" aria-label="Calendar timeline">
                ${this._renderPeriods(forecast, true)}
                ${ticks.map((date) => html`<span class="tick"
                  style=${`left:clamp(0px, ${this._position(date, forecast)}%, calc(100% - 64px))`}>${MONTH_LABEL.format(date)}</span>`)}
              </div>
              <div class="column-title" role="columnheader">Forecast finish range</div>
            </div>
            ${forecast.rows.map((row) => this._renderRow(row, forecast))}
          </div>
          ${forecast.rows.length === 0
            ? html`<p class="empty">No scheduled tasks match. Select a plan, adjust the task hierarchy,
              or choose All levels.</p>` : ''}
        </div>
      `}
    `;
  }
}

customElements.define('plugin-cone-of-uncertainty', PluginConeOfUncertaintyComponent);
