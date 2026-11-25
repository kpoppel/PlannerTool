import { LitElement, css, html, nothing } from '/static/js/vendor/lit.js';
import { adminProvider } from '../../services/providerREST.js';
import './plans/WorkforceTree.lit.js';

export class LocalPlans extends LitElement {
  static properties = {
    mode: { type: String }, model: { state: true }, selectedId: { state: true },
    busy: { state: true }, message: { state: true },
  };

  static styles = css`
    .layout { display: grid; grid-template-columns: minmax(150px, 220px) minmax(0, 1fr); gap: 20px; }
    nav, .fields { display: grid; align-content: start; gap: 10px; }
    label { display: flex; align-items: center; gap: 8px; }
    button[aria-current='true'] { font-weight: bold; }
    .actions, .marker { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    form { display: grid; gap: 16px; }
  `;

  constructor() {
    super();
    this.mode = 'plans';
    this.model = null;
    this.selectedId = '';
    this.busy = false;
    this.message = '';
    this.levels = [];
    this.types = [];
    this.iterations = [];
  }

  connectedCallback() {
    super.connectedCallback();
    this._load();
  }

  async _load() {
    this.busy = true;
    this.message = '';
    try {
      const plans = await adminProvider.getLocalPlans();
      if (!plans.ok) throw new Error(plans.error.message);
      if (this.mode === 'plans') {
        const [catalogue, iterations, projects, workforce] = await Promise.all([
          adminProvider.getLocalCatalogue(), adminProvider.getIterations(), adminProvider.getProjects(),
          adminProvider.getWorkforce(),
        ]);
        for (const result of [catalogue, iterations, projects, workforce]) {
          if (!result.ok) throw new Error(result.error.message);
        }
        this.levels = projects.data.container_types;
        this.workforce = workforce.data.content.teams;
        this.types = catalogue.data.processes.flatMap((process) => process.types
          .filter((type) => type.backlog_level !== 'task')
          .map((type) => ({ id: type.id, name: `${process.name} / ${type.name}` })));
        this.iterations = iterations.data.iteration_sets.filter((set) => set.source_type !== 'ado');
      }
      this.model = plans.data;
      this.selectedId = this.model.plans.length > 0 ? this.model.plans[0].id : '';
    } catch (error) {
      this.message = error.message;
    } finally { this.busy = false; }
  }

  get plan() {
    return this.model.plans.find((plan) => plan.id === this.selectedId);
  }

  _addPlan() {
    const plan = { id: crypto.randomUUID(), name: '', type: this.levels[0], archived: false,
      closed_history_days: 0, task_types: [], iteration_uuid: null, markers: [] };
    this.model = { ...this.model, plans: [...this.model.plans, plan] };
    this.selectedId = plan.id;
  }

  _update(patch) {
    this.model = { ...this.model, plans: this.model.plans.map((plan) =>
      plan.id === this.selectedId ? { ...plan, ...patch } : plan) };
  }

  _deletePlan() {
    if (!window.confirm(`Delete plan "${this.plan.name}"?`)) return;
    const plans = this.model.plans.filter((plan) => plan.id !== this.selectedId);
    this.model = { ...this.model, plans };
    this.selectedId = plans.length > 0 ? plans[0].id : '';
  }

  async _save(event) {
    event.preventDefault();
    this.busy = true;
    this.message = '';
    try {
      const result = await adminProvider.saveLocalPlans(this.model);
      if (!result.ok) throw new Error(result.error.message);
      this.model = result.data;
      this.message = 'Saved.';
    } catch (error) { this.message = error.message; }
    finally { this.busy = false; }
  }

  _renderPlan(plan) {
    return html`<div class="fields">
      <label>Name <input name="plan-name" required .value=${plan.name}
        @input=${(event) => this._update({ name: event.target.value })}></label>
      <label>Plan level <select @change=${(event) => this._update({ type: event.target.value })}>
        ${this.levels.map((level) => html`<option value=${level} .selected=${level === plan.type}>${level}</option>`)}
      </select></label>
      <label>Closed history days <input type="number" min="0" required .value=${String(plan.closed_history_days)}
        @input=${(event) => this._update({ closed_history_days: event.target.valueAsNumber })}></label>
      <label>Iteration set <select @change=${(event) => this._update({
        iteration_uuid: event.target.value === '' ? null : event.target.value,
      })}>
        <option value="" .selected=${plan.iteration_uuid === null}>None</option>
        ${this.iterations.map((set) => html`<option value=${set.id}
          .selected=${set.id === plan.iteration_uuid}>${set.name}</option>`)}
      </select></label>
      <fieldset><legend>Task types</legend>${this.types.map((type) => html`<label>
        <input type="checkbox" value=${type.id} .checked=${plan.task_types.includes(type.id)}
          @change=${(event) => this._update({ task_types: event.target.checked
            ? [...plan.task_types, type.id] : plan.task_types.filter((id) => id !== type.id) })}>
        ${type.name}</label>`)}</fieldset>
      <label><input type="checkbox" .checked=${plan.archived}
        @change=${(event) => this._update({ archived: event.target.checked })}>Archived</label>
      <fieldset><legend>Workforce</legend><label><input type="checkbox"
        .checked=${Object.hasOwn(plan, 'allocatable_ids')} @change=${(event) => {
          if (event.target.checked) this._update({ allocatable_ids: [] });
          else this.model = { ...this.model, plans: this.model.plans.map((entry) => {
            if (entry.id !== plan.id) return entry;
            const { allocatable_ids, ...inherited } = entry;
            return inherited;
          }) };
        }}>Override plan level defaults</label>
        ${Object.hasOwn(plan, 'allocatable_ids') ? html`<plan-workforce-tree .catalogue=${this.workforce}
          .selected=${plan.allocatable_ids} @selection-change=${(event) => this._update({ allocatable_ids: event.detail })}>
        </plan-workforce-tree>` : nothing}</fieldset>
      <div><button type="button" @click=${this._deletePlan}>Delete plan</button></div>
    </div>`;
  }

  _renderMarkers(plan) {
    return html`<div class="fields">${plan.markers.map((marker) => {
      const update = (patch) => this._update({ markers: plan.markers.map((entry) =>
        entry.id === marker.id ? { ...entry, ...patch } : entry) });
      return html`<div class="marker">
        <label>Label <input required .value=${marker.label}
          @input=${(event) => update({ label: event.target.value })}></label>
        <label>Date <input type="date" required .value=${marker.date}
          @input=${(event) => update({ date: event.target.value })}></label>
        <label>Color <input type="color" .value=${marker.color === null ? '#245fa5' : marker.color}
          @input=${(event) => update({ color: event.target.value })}></label>
        <button type="button" @click=${() => this._update({
          markers: plan.markers.filter((entry) => entry.id !== marker.id),
        })}>Remove marker</button></div>`;
    })}<div><button type="button" @click=${() => this._update({ markers: [...plan.markers,
      { id: crypto.randomUUID(), label: '', date: '', color: null }] })}>Add marker</button></div></div>`;
  }

  render() {
    const title = this.mode === 'plans' ? 'Local Projects' : 'Local Plan Markers';
    return html`<h2>${title}</h2><p role="status">${this.busy ? 'Working...' : this.message}</p>
      ${this.model === null ? nothing : html`<div class="layout" ?inert=${this.busy}>
        <nav aria-label="Local plans">
          ${this.mode === 'plans' ? html`<button data-add-plan ?disabled=${this.levels.length === 0}
            @click=${this._addPlan}>Add plan</button>` : nothing}
          ${this.model.plans.map((plan) => html`<button aria-current=${plan.id === this.selectedId}
            @click=${() => { this.selectedId = plan.id; }}>${plan.name === '' ? 'New plan' : plan.name}</button>`)}
        </nav>
        <form @submit=${this._save}>
          ${this.plan === undefined ? nothing : this.mode === 'plans'
            ? this._renderPlan(this.plan) : this._renderMarkers(this.plan)}
          <div class="actions"><button data-save>Save</button>
            <button type="button" @click=${this._load}>Reload</button></div>
        </form></div>`}`;
  }
}

customElements.define('admin-local-plans', LocalPlans);