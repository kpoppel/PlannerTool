import { LitElement, html, css } from '../vendor/lit.js';
import { sel } from '../application/imports.js';
import { store } from '../application/store.js';
import { dataService } from '../services/dataService.js';
import { getIconTemplate } from '../services/IconService.js';
import { DEFAULT_SCOPES, addMonths, buildForecast, selectPlanTasks, validateScopes } from './coneOfUncertainty.js';

const PREFERENCE_KEY = 'coneOfUncertainty.scopes';
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
    .scope-legend { display: flex; gap: 12px; margin: 14px 0 8px; }
    .scope-summary { flex: 1; padding: 8px 12px; border-left: 4px solid var(--scope-color); background: white; }
    .scope-summary strong, .scope-summary span { display: block; }
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
    .period-label { position: absolute; top: 8px; font-size: 11px; padding: 0 4px; overflow: hidden; white-space: nowrap; color: var(--scope-color); }
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
    this.ready = this._loadPreferences();
  }

  disconnectedCallback() {
    this._unsubscribe();
    super.disconnectedCallback();
  }

  open() { this.setAttribute('open', ''); this.requestUpdate(); }
  close() { this.removeAttribute('open'); }

  async _loadPreferences() {
    this._loaded = false;
    try {
      const stored = await dataService.getLocalPref(PREFERENCE_KEY);
      // Boundary guard: payload comes from external persistence/API and may be missing fields; normalize here, not downstream.
      const scopes = stored === undefined ? DEFAULT_SCOPES : stored;
      validateScopes(scopes);
      this.scopes = scopes.map((scope) => ({ ...scope }));
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
        <p>Three consecutive scopes measured from the forecast origin. Percentages apply to
          inclusive task duration; the planned start determines the scope. Task dates are never changed.</p>
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
    return 100 * (date.getTime() - forecast.origin.getTime())
      / (forecast.rangeEnd.getTime() - forecast.origin.getTime());
  }

  _renderPeriods(forecast, labels = false) {
    return this.scopes.map((scope, index) => {
      const left = this._position(forecast.boundaries[index], forecast);
      const width = this._position(forecast.boundaries[index + 1], forecast) - left;
      return html`
        <div aria-hidden="true" class=${`period scope-${index}`} style=${`left:${left}%;width:${width}%`}></div>
        ${labels ? html`<span class=${`period-label scope-${index}`}
          style=${`left:${left}%;width:${width}%`}>${this._scopeLabel(index)}</span>` : ''}
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
    return html`
      <div class="task-row" role="row" aria-label=${description}>
        <div class="task-label" role="rowheader" title=${row.feature.title}>
          <span class="task-type" title=${row.feature.type} role="img"
            aria-label=${row.feature.type}>${getIconTemplate(row.feature.type)}</span>
          <div class="task-copy">
            <strong>${row.feature.title}</strong>
            <small>${row.feature.id} · ${row.scopeIndex < 0 ? 'Ongoing work' : this._scopeLabel(row.scopeIndex)}</small>
          </div>
        </div>
        <div class=${`track scope-${row.scopeIndex}`} role="cell" aria-label=${description}>
          ${this._renderPeriods(forecast)}
          <div class="bar" style=${`left:${left}%;width:${Math.max(0, earliest - left)}%`}></div>
          ${row.scopeIndex >= 0 ? html`
            <div class="uncertainty" style=${`left:${earliest}%;width:${latest - earliest}%`}></div>
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
    const tasks = selectPlanTasks(sel.feature.getEffectiveFeatures(),
      sel.selection.getSelectedProjectIds(), this.rootsOnly, this.search);
    const forecast = this._loaded ? buildForecast(tasks, this.origin, this.scopes) : null;
    const ticks = [];
    if (forecast !== null) {
      const months = (forecast.rangeEnd.getUTCFullYear() - forecast.origin.getUTCFullYear()) * 12
        + forecast.rangeEnd.getUTCMonth() - forecast.origin.getUTCMonth();
      const step = Math.max(1, Math.ceil(months / 16));
      for (let month = 0; month <= months; month += step) {
        ticks.push(addMonths(forecast.origin, month));
      }
    }
    return html`
      <header>
        <h2>Cone of uncertainty</h2>
        <p>Communicate the range, not a promise.</p>
        <p class="disclaimer"><strong>Illustrative forecast, not a commitment.</strong>
          Shaded ranges are planning assumptions, not statistical confidence intervals.
          Starts are held fixed; dependencies, capacity changes and correlated delays are not modeled.</p>
        <div class="toolbar">
          <label>Forecast origin <input type="date" required .value=${this.origin}
            @change=${(event) => {
              if (event.target.validity.valid && event.target.value !== '') {
                this.origin = event.target.value;
              } else {
                event.target.reportValidity();
                event.target.value = this.origin;
              }
            }}></label>
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
          <div class="scope-legend">
            ${this.scopes.map((scope, index) => html`
              <div class=${`scope-summary scope-${index}`}>
                <strong>${this._scopeLabel(index)}</strong>
                <span>${scope.lower}% / +${scope.upper}% duration</span>
                <small>${MONTH_LABEL.format(forecast.boundaries[index])} -
                  ${MONTH_LABEL.format(forecast.boundaries[index + 1])}</small>
              </div>
            `)}
          </div>
          <p class="key">Solid: duration up to earliest finish · Shading: possible finish range ·
            Dark marker: planned finish. Ranges rounded outward to whole days; labels show months.</p>
        `}
      </header>
      ${forecast === null ? html`<p class="status">${this._error === '' ? 'Loading preferences...' : 'Forecast unavailable until preferences are restored.'}</p>` : html`
        <div class="status" role="status">
          ${forecast.rows.length} tasks · ${forecast.invalidCount} undated or invalid schedules omitted ·
          ${forecast.outsideCount} outside forecast window omitted.
          Tasks starting before the origin have no modeled range.
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
              <div class="column-title" role="columnheader">Illustrative finish range</div>
            </div>
            ${forecast.rows.map((row) => this._renderRow(row, forecast))}
          </div>
          ${forecast.rows.length === 0
            ? html`<p class="empty">No scheduled tasks match. Select a plan, adjust the forecast origin,
              or choose All levels.</p>` : ''}
        </div>
      `}
    `;
  }
}

customElements.define('plugin-cone-of-uncertainty', PluginConeOfUncertaintyComponent);
