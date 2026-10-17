import { LitElement, html, css } from '/static/js/vendor/lit.js';
import { BaseConfigComponent } from '../BaseConfigComponent.lit.js';

export class WorkforceTree extends LitElement {
  static properties = {
    catalogue: { type: Object }, selected: { type: Array }, filter: { state: true },
  };
  static styles = [BaseConfigComponent.styles, css`
    :host { height: auto; }
    input[type=search] { box-sizing: border-box; width: 100%; padding: 8px; margin-bottom: 10px; }
    .tree { max-height: 320px; overflow: auto; }
    .teams { padding-left: 24px; }
    label { display: flex; gap: 8px; align-items: center; padding: 5px 0; }
    section { margin-bottom: 12px; }
    h4 { font-size: 13px; margin: 8px 0; }
    small { color: #6b7280; }
  `];
  constructor() {
    super();
    this.catalogue = { groups: [], teams: [] };
    this.selected = [];
    this.filter = '';
  }
  _visible(record) { return !record.archived || this.selected.includes(record.id); }
  _matches(record) { return record.name.toLowerCase().includes(this.filter.toLowerCase()); }
  _onChange(record, checked) {
    this.selected = checked ? [...this.selected, record.id]
      : this.selected.filter((id) => id !== record.id);
    this.dispatchEvent(new CustomEvent('selection-change', {
      detail: this.selected, bubbles: true, composed: true,
    }));
  }
  _choice(record) {
    return html`<label><input type="checkbox" .value=${record.id}
      .checked=${this.selected.includes(record.id)}
      @change=${(event) => this._onChange(record, event.target.checked)}>
      ${record.name}${record.archived ? html`<small>archived</small>` : ''}</label>`;
  }
  render() {
    const teams = this.catalogue.teams.filter((team) => this._visible(team));
    const groups = this.catalogue.groups.filter((group) => this._visible(group));
    const ungrouped = teams.filter((team) => !groups.some((group) => group.id === team.group_id) && this._matches(team));
    return html`<input type="search" aria-label="Filter workforce" placeholder="Filter workforce"
      .value=${this.filter} @input=${(event) => { this.filter = event.target.value; }}>
      <div class="tree">${groups.map((group) => {
        const children = teams.filter((team) => team.group_id === group.id);
        const visibleChildren = children.filter((team) => this._matches(group) || this._matches(team));
        if (!this._matches(group) && visibleChildren.length === 0) return '';
        return html`<section data-group=${group.id}>
          ${this._choice(group)}
          <div class="teams">${visibleChildren.map((team) => this._choice(team))}</div>
        </section>`;
      })}${ungrouped.length > 0 ? html`<section><h4>Teams without a group</h4>
        ${ungrouped.map((team) => this._choice(team))}</section>` : ''}</div>`;
  }
}
customElements.define('plan-workforce-tree', WorkforceTree);