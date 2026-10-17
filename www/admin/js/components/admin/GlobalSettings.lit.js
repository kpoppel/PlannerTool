import { html, css } from '/static/js/vendor/lit.js';
import { BaseConfigComponent } from './BaseConfigComponent.lit.js';
import { adminProvider } from '../../services/providerREST.js';

export class AdminGlobalSettings extends BaseConfigComponent {
  static properties = {
    processes: { type: Array },
    saving: { type: Boolean },
    ready: { type: Boolean },
    dirty: { type: Boolean },
  };

  static styles = [BaseConfigComponent.styles, css`
    .panel .editor { display: block; padding: 0 12px 0 0; }
    .process { padding: 16px 0; border-bottom: 1px solid #dce1e7; }
    .process:first-child { padding-top: 0; }
    .process-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
    h3 { font-size: 1rem; margin: 0 auto 0 0; }
    h4 { margin: 0 0 8px; font-size: 0.85rem; overflow-wrap: anywhere; }
    .tier { display: flex; align-items: center; gap: 10px; margin: 8px 0; }
    .tier-label { color: #586575; width: 54px; flex-shrink: 0; font-size: 0.85rem; }
    .types { display: flex; flex-wrap: wrap; gap: 8px; }
    .type { display: inline-flex; align-items: center; gap: 6px; padding: 3px 6px;
      border: 1px solid #d6dce2; border-radius: 4px; background: #f5f7f9; }
    .icon-btn { width: 28px; height: 28px; padding: 0; flex-shrink: 0; }
    button:disabled { opacity: 0.5; cursor: default; }
    .state-columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 20px; margin-top: 20px; }
    .state-column { min-width: 0; }
    .states { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
    .state { padding: 3px 8px; border-radius: 4px; background: #e7ebef; color: #283643;
      font-size: 0.85rem; max-width: 100%; overflow-wrap: anywhere; box-sizing: border-box; }
    .state[data-category='InProgress'] { background: #dbeafe; color: #1e40af; }
    .state[data-category='Resolved'] { background: #fff0c2; color: #704d00; }
    .state[data-category='Completed'] { background: #dcfce7; color: #166534; }
    .actions { flex-shrink: 0; flex-wrap: wrap; }
    .status { overflow-wrap: anywhere; }
  `];

  constructor() {
    super();
    this.content = { schema_version: 2, process_order: [], type_tiers: {} };
    this.processes = [];
    this.saving = false;
    this.ready = false;
    this.dirty = false;
  }

  async loadConfig() {
    this.loading = true;
    this.ready = false;
    this.statusMsg = '';
    try {
      const catalogue = await adminProvider.getAdoProcesses();
      if (!catalogue.ok) throw new Error(catalogue.error.message);
      const settings = await adminProvider.getGlobalSettings();
      if (!settings.ok) throw new Error(settings.error.message);
      this.processes = catalogue.data.processes;
      this.content = structuredClone(settings.data);
      this.ready = true;
      this.dirty = false;
    } catch (error) {
      console.error('Loading global display settings failed', error);
      this.statusMsg = error.message;
      this.statusType = 'error';
    } finally {
      this.loading = false;
    }
  }

  async saveConfig() {
    this.saving = true;
    this.statusMsg = '';
    try {
      const result = await adminProvider.saveGlobalSettings(this.content);
      if (!result.ok) throw new Error(result.error.message);
      this.dirty = false;
      this.statusMsg = 'Saved.';
      this.statusType = 'success';
    } catch (error) {
      console.error('Saving global display settings failed', error);
      this.statusMsg = error.message;
      this.statusType = 'error';
    } finally {
      this.saving = false;
    }
  }

  moveProcess(index, direction) {
    const order = [...this.content.process_order];
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    this.content = { ...this.content, process_order: order };
    this.dirty = true;
  }

  moveType(processId, tierIndex, name, direction) {
    const tiers = this.content.type_tiers[processId].map((tier) => [...tier]);
    tiers[tierIndex] = tiers[tierIndex].filter((type) => type !== name);
    const target = tierIndex + direction;
    if (target < 0) tiers.unshift([name]);
    else if (target === tiers.length) tiers.push([name]);
    else tiers[target].push(name);
    this.content = { ...this.content, type_tiers: { ...this.content.type_tiers,
      [processId]: tiers.filter((tier) => tier.length > 0) } };
    this.dirty = true;
  }

  stateColumns(process, tiers) {
    const columns = new Map();
    for (const name of tiers.flat()) {
      const type = process.types.find((item) => item.name === name);
      const states = [...type.states].sort((first, second) => first.order - second.order)
        .filter((state) => state.category !== 'Removed');
      const key = JSON.stringify(states.map((state) => [state.name, state.category]));
      if (!columns.has(key)) columns.set(key, { names: [], states });
      columns.get(key).names.push(name);
    }
    return [...columns.values()];
  }

  render() {
    if (this.loading) return html`<div class="loading">Loading global settings...</div>`;
    return html`
      <h2>Global Project Settings</h2>
      <div class="panel">
        <div class="editor">
          ${this.ready && this.content.process_order.length === 0
            ? html`<p>No work item types imported.</p>` : ''}
          ${this.ready ? this.content.process_order.map((processId, index) => {
            const process = this.processes.find((item) => item.id === processId);
            const tiers = this.content.type_tiers[processId];
            return html`<section class="process" data-process-id=${processId}>
              <div class="process-header">
                <h3 class="process-title">${process.name}</h3>
                <button class="icon-btn" title=${`Move ${process.name} up`}
                  ?disabled=${index === 0 || this.saving}
                  @click=${() => this.moveProcess(index, -1)}>&#8593;</button>
                <button class="icon-btn" title=${`Move ${process.name} down`}
                  ?disabled=${index === this.content.process_order.length - 1 || this.saving}
                  @click=${() => this.moveProcess(index, 1)}>&#8595;</button>
              </div>
              ${tiers.map((tier, tierIndex) => html`<div class="tier">
                <span class="tier-label">Tier ${tierIndex + 1}</span>
                <div class="types">${tier.map((name) => html`<span class="type">
                  <span>${name}</span>
                  <button class="icon-btn" title=${`Move ${name} up a tier`}
                    ?disabled=${this.saving}
                    @click=${() => this.moveType(processId, tierIndex, name, -1)}>&#8593;</button>
                  <button class="icon-btn" title=${`Move ${name} down a tier`}
                    ?disabled=${this.saving}
                    @click=${() => this.moveType(processId, tierIndex, name, 1)}>&#8595;</button>
                </span>`)}</div>
              </div>`)}
              <div class="state-columns">${this.stateColumns(process, tiers).map((column) => html`
                <div class="state-column"><h4>${column.names.join(', ')}</h4>
                  <div class="states">${column.states.map((state) => html`
                    <span class="state" data-category=${state.category}>${state.name}</span>
                  `)}</div>
                </div>
              `)}</div>
            </section>`;
          }) : ''}
        </div>
        <div class="actions">
          <button class="primary" ?disabled=${!this.ready || !this.dirty || this.saving}
            @click=${this.saveConfig}>${this.saving ? 'Saving...' : 'Save'}</button>
          <button ?disabled=${this.saving} @click=${this.loadConfig}>Reload</button>
          <span class="status ${this.statusType}" role="status">${this.statusMsg}</span>
        </div>
      </div>
    `;
  }
}

customElements.define('admin-global-settings', AdminGlobalSettings);