import { LitElement, html, css } from '/static/js/vendor/lit.js';
import { BaseConfigComponent } from '../BaseConfigComponent.lit.js';

export class PlansList extends LitElement {
  static properties = { content: { type: Object }, catalogue: { type: Object },
    statuses: { type: Object }, search: { state: true }, level: { state: true }, busy: { type: Boolean },
    _dragId: { state: true }, _dropId: { state: true }, _dropPosition: { state: true } };
  static styles = [BaseConfigComponent.styles, css`
    :host { height: auto; }
    .toolbar { display: flex; gap: 10px; margin-bottom: 20px; }
    input, select { padding: 8px; border: 1px solid #ccc; border-radius: 4px; }
    input { flex: 1; max-width: 340px; }
    h3 { font-size: 14px; color: #566170; margin: 24px 0 6px; }
    .plan-row { display: grid; grid-template-columns: 24px minmax(130px, 1fr) minmax(150px, 1.4fr) minmax(130px, 1fr) auto;
      gap: 12px; align-items: center; border-bottom: 1px solid #e5e7eb; padding: 12px 0; position: relative; }
    .plan-row.dragging { opacity: .45; background: #eff6ff; }
    .plan-row[data-drop-position="before"]::after,
    .plan-row[data-drop-position="after"]::after { content: ''; position: absolute;
      left: 0; right: 0; height: 3px; background: #2563eb; border-radius: 2px;
      pointer-events: none; z-index: 1; }
    .plan-row[data-drop-position="before"]::after { top: -2px; }
    .plan-row[data-drop-position="after"]::after { bottom: -2px; }
    .name { border: 0; background: none; text-align: left; padding: 4px 0; color: #1d4ed8; font-weight: 600; }
    .path { overflow-wrap: anywhere; color: #566170; font-size: 12px; }
    .handle { cursor: grab; display: flex; align-items: center; justify-content: center;
      width: 24px; height: 32px; color: #64748b; border-radius: 4px; }
    .handle[draggable="true"]:hover { color: #1d4ed8; background: #eff6ff; }
    .handle[draggable="false"] { cursor: default; }
    .dragging .handle { cursor: grabbing; }
    .grip { width: 12px; height: 18px; pointer-events: none;
      background: radial-gradient(circle, currentColor 1.5px, transparent 1.6px) 0 0 / 6px 6px; }
    small { display: block; color: #566170; margin-top: 4px; }
    .warning { color: #92400e; }
    details { position: relative; }
    summary { cursor: pointer; padding: 6px; list-style: none; font-size: 20px; }
    .menu { position: absolute; right: 0; z-index: 2; min-width: 150px; background: white;
      border: 1px solid #ccc; border-radius: 6px; box-shadow: 0 4px 12px #0002; }
    .menu button { display: block; width: 100%; border: 0; text-align: left; }
    button:disabled { opacity: .45; cursor: not-allowed; }
  `];
  constructor() {
    super();
    this.content = { container_types: [], project_map: [] };
    this.catalogue = { processes: [] };
    this.statuses = {};
    this.search = '';
    this.level = '';
    this.busy = false;
    this._dragId = '';
    this._dropId = '';
    this._dropPosition = '';
  }
  willUpdate() {
    if (this.busy) this._clearDrag();
    if (this.level === 'archived' && !this.content.project_map.some((plan) => plan.archived)) this.level = '';
    if (this.level !== '' && this.level !== 'archived'
      && !this.content.container_types.includes(this.level)) this.level = '';
  }
  _emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  movePlan(sourceId, targetId, insertion = 'at') {
    if (this.busy) return;
    const plans = this.content.project_map;
    const source = plans.find((plan) => plan.id === sourceId);
    const target = plans.find((plan) => plan.id === targetId);
    if (source === undefined || target === undefined || source === target
      || source.archived || target.archived || source.type !== target.type) return;
    const siblings = plans.filter((plan) => plan.type === source.type && !plan.archived);
    const moved = [...siblings];
    moved.splice(moved.indexOf(source), 1);
    const targetIndex = insertion === 'at' ? siblings.indexOf(target)
      : moved.indexOf(target) + (insertion === 'after' ? 1 : 0);
    moved.splice(targetIndex, 0, source);
    if (moved.every((plan, index) => plan === siblings[index])) return;
    let index = 0;
    this._emit('config-change', { ...this.content,
      project_map: plans.map((plan) => plan.type === source.type && !plan.archived ? moved[index++] : plan) });
  }
  _clearDrag() {
    this._dragId = '';
    this._dropId = '';
    this._dropPosition = '';
  }
  _onDragOver(event, plan) {
    const source = this.content.project_map.find((entry) => entry.id === this._dragId);
    if (this.busy || source === undefined || source.archived || plan.archived
      || source.id === plan.id || source.type !== plan.type) {
      this._dropId = '';
      this._dropPosition = '';
      return;
    }
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    this._dropId = plan.id;
    this._dropPosition = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
  }
  _imported(plan) {
    const project = plan.area_path.split(/[\\/]/)[0].toLowerCase();
    const process = this.catalogue.processes.find((entry) =>
      entry.projects.some((name) => name.toLowerCase() === project));
    return process !== undefined && plan.task_types.length > 0 && plan.task_types.every((name) =>
      process.types.some((type) => type.imported && type.name.toLowerCase() === name.toLowerCase()));
  }
  _row(plan) {
    const siblings = this.content.project_map.filter((item) => item.type === plan.type && !item.archived);
    const position = siblings.indexOf(plan);
    const status = this.statuses[plan.id];
    return html`<div class=${this._dragId === plan.id ? 'plan-row dragging' : 'plan-row'} data-plan=${plan.id}
      data-drop-position=${this._dropId === plan.id ? this._dropPosition : ''}
      @dragover=${(event) => this._onDragOver(event, plan)}
      @drop=${(event) => {
        event.preventDefault();
        if (this._dropId === plan.id) this.movePlan(this._dragId, plan.id, this._dropPosition);
        this._clearDrag();
      }}>
      <span class="handle" title="Drag to reorder within this level" aria-label=${`Drag ${plan.name} to reorder`}
        draggable=${!plan.archived && !this.busy ? 'true' : 'false'}
        @dragstart=${(event) => {
          this._dragId = plan.id;
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', plan.id);
        }}
        @dragend=${() => this._clearDrag()}>${plan.archived ? '' : html`<span class="grip" aria-hidden="true"></span>`}</span>
      <div><button class="name" ?disabled=${this.busy} @click=${() => this._emit('edit-plan', plan.id)}>${plan.name}</button>
        ${plan.archived ? html`<small>Archived</small>` : ''}
        ${!this._imported(plan) ? html`<small class="warning">Process not imported</small>` : ''}</div>
      <div class="path">${plan.area_path}</div><div>${plan.task_types.join(', ')}
        ${plan.closed_history_days > 0 ? html`<small>${plan.closed_history_days} days closed history</small>` : ''}
        ${status === undefined ? '' : html`<small class=${status.error ? 'warning' : ''}>${status.message}</small>
          ${status.error && !plan.archived ? html`<button ?disabled=${this.busy}
            @click=${() => this._emit('refresh-plan', plan.id)}>Retry</button>` : ''}`}</div>
      <details><summary aria-label=${`Actions for ${plan.name}`} title="Plan actions">&#8943;</summary>
        <div class="menu" @click=${(event) => { event.currentTarget.parentElement.open = false; }}>${!plan.archived ? html`
          <button title="Move up" ?disabled=${this.busy || position === 0}
            @click=${() => this.movePlan(plan.id, siblings[position - 1].id)}>Move up</button>
          <button title="Move down" ?disabled=${this.busy || position === siblings.length - 1}
            @click=${() => this.movePlan(plan.id, siblings[position + 1].id)}>Move down</button>` : ''}
          <button ?disabled=${this.busy} @click=${() => this._emit('plan-action', {
            id: plan.id, action: plan.archived ? 'restore' : 'archive',
          })}>${plan.archived ? 'Restore' : 'Archive'}</button>
          <button ?disabled=${this.busy} @click=${() => this._emit('plan-action', { id: plan.id, action: 'delete' })}>Delete</button>
        </div></details></div>`;
  }
  render() {
    const archived = this.content.project_map.filter((plan) => plan.archived).length;
    const visible = this.content.project_map.filter((plan) =>
      (this.level === 'archived' ? plan.archived : !plan.archived)
      && (this.level === '' || this.level === 'archived' || plan.type === this.level)
      && `${plan.name} ${plan.area_path} ${plan.task_types.join(' ')}`.toLowerCase().includes(this.search.toLowerCase()));
    return html`<div class="toolbar"><input type="search" aria-label="Search plans" placeholder="Search plans"
      .value=${this.search} @input=${(event) => { this.search = event.target.value; }}>
      <select aria-label="Filter by level" @change=${(event) => { this.level = event.target.value; }}>
        <option value="" .selected=${this.level === ''}>All levels</option>
        ${this.content.container_types.map((level) => html`<option .value=${level} .selected=${this.level === level}>${level}</option>`)}
        ${archived > 0 ? html`<option value="archived" .selected=${this.level === 'archived'}>Archived plans (${archived})</option>` : ''}
      </select><button class="primary" ?disabled=${this.busy || this.content.container_types.length === 0}
        @click=${() => this._emit('new-plan', null)}>New plan</button></div>
      <div @dragleave=${(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          this._dropId = '';
          this._dropPosition = '';
        }
      }}>${this.content.container_types.map((level) => {
        const plans = visible.filter((plan) => plan.type === level);
        return plans.length === 0 ? '' : html`<section><h3>${level}</h3>${plans.map((plan) => this._row(plan))}</section>`;
      })}</div>${visible.length === 0 ? html`<p>No plans found.</p>` : ''}`;
  }
}
customElements.define('plans-list', PlansList);