import { LitElement, html, css } from '/static/js/vendor/lit.js';
import { BaseConfigComponent } from '../BaseConfigComponent.lit.js';
import './WorkforceTree.lit.js';

export class DefaultWorkforce extends LitElement {
  static properties = { content: { type: Object }, catalogue: { type: Object }, level: { state: true } };
  static styles = [BaseConfigComponent.styles, css`
    :host { height: auto; max-width: 700px; }
    select { padding: 8px; margin: 8px 0; min-width: 200px; }
    .summary { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }
    .chip { background: #edf2f7; border-radius: 4px; padding: 4px 8px; font-size: 13px; }
  `];
  constructor() {
    super();
    this.content = { container_types: [], project_map: [], allocation_defaults: {} };
    this.catalogue = { teams: [], groups: [] };
    this.level = '';
  }
  willUpdate() {
    if (!this.content.container_types.includes(this.level)) {
      this.level = this.content.container_types.length > 0 ? this.content.container_types[0] : '';
    }
  }
  _onSelection(event) {
    this.dispatchEvent(new CustomEvent('config-change', { bubbles: true, composed: true,
      detail: { ...this.content, allocation_defaults: {
        ...this.content.allocation_defaults, [this.level]: event.detail,
      } } }));
  }
  render() {
    const overrides = this.content.project_map.filter((plan) => plan.type === this.level
      && Object.hasOwn(plan, 'allocatable_ids')).length;
    if (!this.level) return html`<h2>Default workforce</h2><p>Add a plan level first.</p>`;
    const selected = this.content.allocation_defaults[this.level];
    const records = [...this.catalogue.groups, ...this.catalogue.teams];
    return html`<h2>Default workforce</h2><label>Plan level <select aria-label="Plan level"
      @change=${(event) => { this.level = event.target.value; }}>
      ${this.content.container_types.map((level) => html`<option .selected=${level === this.level}>${level}</option>`)}
      </select></label><p>${overrides} ${overrides === 1 ? 'plan overrides' : 'plans override'} this default</p>
      <div class="summary">${selected.map((id) => {
        const record = records.find((item) => item.id === id);
        return html`<span class="chip">${record.name}${record.archived ? ' (archived)' : ''}</span>`;
      })}${selected.length === 0 ? 'No workforce selected' : ''}</div>
      <plan-workforce-tree .catalogue=${this.catalogue} .selected=${selected}
        @selection-change=${this._onSelection}></plan-workforce-tree>`;
  }
}
customElements.define('plan-default-workforce', DefaultWorkforce);