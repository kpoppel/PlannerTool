import { LitElement, css, html, nothing } from '/static/js/vendor/lit.js';
import { dataService } from '../services/dataService.js';

const BASE_FIELDS = ['title', 'description', 'state'];
const numberTypes = ['integer', 'number'];
const sameValue = (left, right) => left === right;
const displayValue = (value) => value === null ? '(empty)' : JSON.stringify(value);

function choice(name, entries, value, set, placeholder = 'Select') {
  return html`<select name=${name} @change=${(event) => set(event.target.value)}>
    <option value="" .selected=${value === ''}>${placeholder}</option>
    ${entries.map((entry) => html`<option value=${entry.id}
      .selected=${entry.id === value}>${entry.name}</option>`)}
  </select>`;
}

export class TaskEditor extends LitElement {
  static properties = { task: { attribute: false }, planId: { type: String }, canDelete: { type: Boolean },
    metadata: { state: true }, draft: { state: true }, busy: { state: true },
    error: { state: true }, conflicts: { state: true } };

  static styles = css`
    form, .fields { display: grid; gap: 12px; }
    label { display: grid; gap: 4px; }
    textarea { min-height: 76px; resize: vertical; }
    input, select, textarea { box-sizing: border-box; width: 100%; }
    footer { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
    .conflicts { border-left: 3px solid #9a5d19; padding-left: 12px; overflow-wrap: anywhere; }
    [role='alert'] { color: #912d23; }
  `;

  constructor() {
    super();
    this.task = null;
    this.planId = '';
    this.canDelete = false;
    this.metadata = null;
    this.draft = null;
    this.busy = false;
    this.error = '';
    this.conflicts = [];
  }

  connectedCallback() {
    super.connectedCallback();
    this._load();
  }

  async _load() {
    this.busy = true;
    this.error = '';
    try {
      const result = await dataService.getTaskEditor();
      if (!result.ok) throw new Error(result.error.message);
      this.metadata = result.data;
      if (this.task === null) {
        const plans = result.data.plans;
        const plan = plans.find((entry) => entry.id === this.planId);
        const selected = plan === undefined ? plans[0] : plan;
        this._choosePlan(selected === undefined ? '' : selected.id);
      } else {
        const process = this.metadata.catalogue.processes.find((entry) => entry.id === this.task.process_id);
        const type = process.types.find((entry) => entry.name === this.task.type);
        this.draft = { project: this.task.project, typeId: type.id,
          ...Object.fromEntries(this._editFields(type).map((field) => [field, this.task[field]])) };
      }
    } catch (error) { this.error = error.message; }
    finally { this.busy = false; }
  }

  get _types() {
    return this.metadata.catalogue.processes.flatMap((process) => process.types
      .map((type) => ({ ...type, name: `${process.name} / ${type.name}` })));
  }

  _schema(type) {
    return this.metadata.catalogue.field_schemas.find((entry) => entry.id === type.field_schema_id);
  }

  /** Custom fields exist only for types whose field schema defines any. */
  _editFields(type) {
    return this._schema(type).fields.length > 0 ? [...BASE_FIELDS, 'customFields'] : BASE_FIELDS;
  }

  _choosePlan(project) {
    const plan = this.metadata.plans.find((entry) => entry.id === project);
    this.draft = { ...this.draft, project, typeId: '', customFields: {} };
    if (this.draft.title === undefined) Object.assign(this.draft, { title: '', description: null });
    if (plan !== undefined && plan.typeIds.length === 1) this._chooseType(plan.typeIds[0]);
  }

  _chooseType(typeId) {
    this._patch({ typeId, customFields: {} });
  }

  _patch(patch) { this.draft = { ...this.draft, ...patch }; }

  _customField(field, entry) {
    const values = this.draft.customFields;
    const value = Object.hasOwn(values, field.key) ? values[field.key]
      : this.task === null ? entry.default : null;
    const set = (next) => {
      const customFields = { ...this.draft.customFields };
      if (next === null && this.task !== null) delete customFields[field.key];
      else customFields[field.key] = next;
      this._patch({ customFields });
    };
    let control;
    if (field.type === 'boolean' || field.type === 'enum') {
      const options = field.type === 'boolean' ? ['true', 'false'] : field.options;
      control = choice(field.key, options.map((name) => ({ id: name, name })),
        value === null ? '' : String(value), (selected) => set(selected === '' ? null
          : field.type === 'boolean' ? selected === 'true' : selected), 'Not set');
    } else if (field.type === 'text') {
      control = html`<textarea name=${field.key} ?required=${entry.required}
        maxlength=${entry.max_length === null ? nothing : entry.max_length}
        .value=${value === null ? '' : value}
        @input=${(event) => set(event.target.value === '' ? null : event.target.value)}></textarea>`;
    } else {
      const numeric = numberTypes.includes(field.type);
      control = html`<input name=${field.key} type=${numeric ? 'number' : field.type === 'date' ? 'date' : 'text'}
        min=${entry.min === null ? nothing : entry.min}
        max=${entry.max === null ? nothing : entry.max}
        maxlength=${entry.max_length === null ? nothing : entry.max_length}
        step=${field.type === 'integer' ? '1' : 'any'} ?required=${entry.required}
        .value=${value === null ? '' : String(value)} @input=${(event) => set(event.target.value === ''
          ? null : numeric ? event.target.valueAsNumber : event.target.value)}>`;
    }
    return html`<label>${field.label}${entry.required ? ' (required)' : ''}${control}</label>`;
  }

  _typeFields(type) {
    const { states, workflows, fields } = this.metadata.catalogue;
    const workflow = workflows.find((entry) => entry.id === type.workflow_id);
    const schema = this._schema(type);
    const current = this.task === null ? workflow.initial
      : workflow.states.find((id) => states.find((entry) => entry.id === id).name === this.task.state);
    const allowed = new Set([current, ...workflow.from_any,
      ...workflow.transitions.filter((edge) => edge.from === current).map((edge) => edge.to)]);
    const stateOptions = workflow.states.filter((id) => allowed.has(id))
      .map((id) => states.find((entry) => entry.id === id).name);
    return html`${this.task === null ? html`<span>Initial state: ${states.find((state) => state.id === current).name}</span>`
      : html`<label>State <select name="state" @change=${(event) => this._patch({ state: event.target.value })}>
        ${stateOptions.map((name) => html`<option .selected=${name === this.draft.state} value=${name}>${name}</option>`)}
      </select></label>`}
      ${schema.fields.map((entry) => this._customField(fields.find((field) => field.id === entry.field_id), entry))}`;
  }

  _changes() {
    const type = this._types.find((entry) => entry.id === this.draft.typeId);
    return this._editFields(type).filter((field) => {
      if (field !== 'customFields') return !sameValue(this.draft[field], this.task[field]);
      const before = this.task.customFields;
      const after = this.draft.customFields;
      return [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .some((key) => !sameValue(before[key], after[key]));
    });
  }

  async _run(operation) {
    this.busy = true;
    this.error = '';
    try {
      const result = await operation();
      if (!result.ok) {
        if (result.error.code === 'task_conflict') this.conflicts = result.error.detail.conflicts;
        throw new Error(result.error.message);
      }
      this.dispatchEvent(new CustomEvent('task-committed', { detail: result.data }));
    } catch (error) { this.error = error.message; }
    finally { this.busy = false; }
  }

  async _save(event) {
    event.preventDefault();
    if (this.busy || this.conflicts.length > 0) return;
    if (this.task === null) {
      await this._run(() => dataService.createTask(this.draft));
      return;
    }
    const keys = this._changes();
    if (keys.length === 0) return;
    await this._run(() => dataService.publishBaseline([{ id: this.task.id,
      ...Object.fromEntries(keys.map((key) => [key, this.draft[key]])),
      base: { revision: this.task.revision,
        fields: Object.fromEntries(keys.map((key) => [key, this.task[key]])) },
    }]));
  }

  _delete() {
    if (this.busy || this.conflicts.length > 0 || !window.confirm(`Delete "${this.task.title}"?`)) return;
    return this._run(() => dataService.deleteTask(this.task.id, this.task.revision));
  }

  render() {
    if (this.draft === null) return html`${this.busy ? 'Loading task catalogue...' : nothing}
      <p role="alert">${this.error}</p>`;
    const { plans } = this.metadata;
    const { project, typeId, title, description } = this.draft;
    const plan = plans.find((entry) => entry.id === project);
    const type = this._types.find((entry) => entry.id === typeId);
    return html`<form @submit=${this._save}>
      <div class="fields" ?inert=${this.busy || this.conflicts.length > 0}>
        ${this.task === null ? html`<label>Plan ${choice('project', plans, project, (id) => this._choosePlan(id))}</label>
          <label>Task type ${choice('typeId', plan === undefined ? [] : this._types.filter((entry) =>
            plan.typeIds.includes(entry.id)), typeId, (id) => this._chooseType(id))}</label>` : nothing}
        <label>Title <input name="title" required .value=${title}
          @input=${(event) => this._patch({ title: event.target.value })}></label>
        <label>Description <textarea name="description" .value=${description === null ? '' : description}
          @input=${(event) => this._patch({ description: event.target.value === '' ? null : event.target.value })}></textarea></label>
        ${type === undefined ? nothing : this._typeFields(type)}
      </div>
      ${this.error ? html`<div role="alert">${this.error}</div>` : nothing}
      ${this.conflicts.length > 0 ? html`<div class="conflicts">
        ${this.conflicts.map((conflict) => html`<p><strong>${conflict.field === null ? 'Task revision' : conflict.field}</strong>:
          reviewed ${displayValue(conflict.base)}, current ${displayValue(conflict.current)},
          proposed ${displayValue(conflict.proposed)}.</p>`)}
        <button type="button" @click=${() => this.dispatchEvent(new CustomEvent('task-reload'))}>Reload current task</button>
      </div>` : nothing}
      <footer><button ?disabled=${this.busy || this.conflicts.length > 0 || type === undefined}>
        ${this.task === null ? 'Create task' : 'Save task'}</button>
        ${this.task === null || !this.canDelete ? nothing : html`<button type="button"
          ?disabled=${this.busy || this.conflicts.length > 0} @click=${this._delete}>Delete task</button>`}
      </footer></form>`;
  }
}

customElements.define('task-editor', TaskEditor);