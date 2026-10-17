import { LitElement, html, css } from '/static/js/vendor/lit.js';
import { BaseConfigComponent } from '../BaseConfigComponent.lit.js';

export class PlanLevels extends LitElement {
  static properties = { content: { type: Object }, newLevel: { state: true }, error: { state: true } };
  static styles = [BaseConfigComponent.styles, css`
    :host { height: auto; max-width: 650px; }
    .level { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid #e5e7eb; }
    .name { flex: 1; }
    .add { display: flex; gap: 8px; margin-top: 16px; }
    input { padding: 8px; flex: 1; }
    button:disabled { opacity: .45; cursor: not-allowed; }
  `];
  constructor() {
    super();
    this.content = { container_types: [], project_map: [], allocation_defaults: {} };
    this.newLevel = '';
    this.error = '';
  }
  _emit(content) {
    this.dispatchEvent(new CustomEvent('config-change', { detail: content, bubbles: true, composed: true }));
  }
  addLevel(name) {
    const value = name.trim();
    if (!value || this.content.container_types.some((level) => level.toLowerCase() === value.toLowerCase())) {
      this.error = 'Enter a unique level name';
      return;
    }
    this._emit({ ...this.content, container_types: [...this.content.container_types, value],
      allocation_defaults: { ...this.content.allocation_defaults, [value]: [] } });
    this.newLevel = '';
    this.error = '';
  }
  moveLevel(index, direction) {
    const levels = [...this.content.container_types];
    const target = index + direction;
    if (target < 0 || target >= levels.length) return;
    [levels[index], levels[target]] = [levels[target], levels[index]];
    this._emit({ ...this.content, container_types: levels });
  }
  removeLevel(level) {
    if (this.content.project_map.some((plan) => plan.type === level)) return;
    const defaults = { ...this.content.allocation_defaults };
    delete defaults[level];
    this._emit({ ...this.content, container_types: this.content.container_types.filter((name) => name !== level),
      allocation_defaults: defaults });
  }
  render() {
    return html`<h2>Plan levels</h2>${this.content.container_types.map((level, index) => {
      const used = this.content.project_map.filter((plan) => plan.type === level);
      return html`<div class="level"><span>${index + 1}</span><strong class="name">${level}</strong>
        <button title=${`Move ${level} up`} ?disabled=${index === 0}
          @click=${() => this.moveLevel(index, -1)}>&#8593;</button>
        <button title=${`Move ${level} down`} ?disabled=${index === this.content.container_types.length - 1}
          @click=${() => this.moveLevel(index, 1)}>&#8595;</button>
        <button title=${used.length > 0 ? `Used by ${used.map((plan) => plan.name).join(', ')}` : `Remove ${level}`}
          ?disabled=${used.length > 0} @click=${() => this.removeLevel(level)}>Remove</button></div>`;
    })}<form class="add" @submit=${(event) => { event.preventDefault(); this.addLevel(this.newLevel); }}>
      <input aria-label="New level name" .value=${this.newLevel}
        @input=${(event) => { this.newLevel = event.target.value; }}>
      <button type="submit">Add level</button></form>
      ${this.error ? html`<p role="alert">${this.error}</p>` : ''}`;
  }
}
customElements.define('plan-levels', PlanLevels);