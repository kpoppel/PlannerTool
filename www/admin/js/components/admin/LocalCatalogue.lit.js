import { LitElement, css, html, nothing } from '/static/js/vendor/lit.js';
import { adminProvider } from '../../services/providerREST.js';

const TABS = { processes: 'Processes and Types', states: 'States', workflows: 'Workflows',
  fields: 'Fields', field_schemas: 'Field Schemas' };
const CATEGORIES = ['Proposed', 'InProgress', 'Resolved', 'Completed', 'Removed'];
const FIELD_TYPES = ['string', 'text', 'integer', 'number', 'boolean', 'date', 'enum'];
const LEVELS = ['portfolio', 'requirement', 'task', 'none'];
const choices = (values) => values.map((value) => ({ id: value, name: value }));
const toggle = (values, value, checked) => checked ? [...values, value]
  : values.filter((entry) => entry !== value);

function text(label, value, set, type = 'text') {
  return html`<label>${label} <input type=${type} .value=${value === null ? '' : String(value)}
    @input=${(event) => set(type === 'number'
      ? (event.target.value === '' ? null : event.target.valueAsNumber) : event.target.value)}></label>`;
}

function select(label, entries, value, set, empty = 'Select') {
  return html`<label>${label} <select @change=${(event) => set(event.target.value)}>
    <option value="" .selected=${value === ''}>${empty}</option>
    ${entries.map((entry) => html`<option value=${entry.id}
      .selected=${entry.id === value}>${entry.name}</option>`)}
  </select></label>`;
}

function check(label, checked, set, transition = '') {
  return html`<label><input type="checkbox" data-transition=${transition} .checked=${checked}
    @change=${(event) => set(event.target.checked)}>${label}</label>`;
}

export class LocalCatalogue extends LitElement {
  static properties = { model: { state: true }, tab: { state: true },
    busy: { state: true }, message: { state: true } };

  static styles = css`
    nav, .actions, .row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    nav { margin-bottom: 16px; }
    nav button[aria-current='page'] { font-weight: bold; }
    fieldset { margin: 12px 0; min-width: 0; border: 1px solid #cbd5e1; }
    label { display: inline-flex; align-items: center; gap: 6px; }
    input, select { max-width: 100%; }
    .entry { display: grid; gap: 8px; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
  `;

  constructor() {
    super();
    this.model = null;
    this.tab = 'processes';
    this.busy = false;
    this.message = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this._run(() => adminProvider.getLocalCatalogue());
  }

  async _run(operation, message = '') {
    this.busy = true;
    this.message = '';
    try {
      const result = await operation();
      if (!result.ok) throw new Error(result.error.message);
      this.model = result.data;
      this.message = message;
    } catch (error) { this.message = error.message; }
    finally { this.busy = false; }
  }

  _replace(key, entries) { this.model = { ...this.model, [key]: entries }; }

  _renderEntries(key, label, create, render) {
    const entries = this.model[key];
    return html`${entries.map((entry, index) => {
      const update = (patch) => this._replace(key, entries.map((item) =>
        item.id === entry.id ? { ...item, ...patch } : item));
      const shift = (delta) => {
        const next = [...entries];
        [next[index], next[index + delta]] = [next[index + delta], next[index]];
        this._replace(key, next);
      };
      return html`<fieldset><legend>${entry.name === undefined ? entry.label : entry.name}</legend>
        ${render.call(this, entry, update)}
        <div class="actions">
          <button ?disabled=${index === 0} @click=${() => shift(-1)}>Move up</button>
          <button ?disabled=${index === entries.length - 1} @click=${() => shift(1)}>Move down</button>
          <button @click=${() => this._replace(key, entries.filter((item) => item.id !== entry.id))}>
            Remove ${label}</button>
        </div></fieldset>`;
    })}<button @click=${() => this._replace(key, [...entries, { id: crypto.randomUUID(), ...create }])}>
      Add ${label}</button>`;
  }

  _field(field, update) {
    return html`<div class="row">${text('Label', field.label, (label) => update({ label }))}
      ${text('Key', field.key, (key) => update({ key }))}
      ${select('Type', choices(FIELD_TYPES), field.type,
        (type) => { if (type !== '') update({ type, options: [] }); })}
      ${field.type === 'enum' ? html`<label>Options <textarea .value=${field.options.join('\n')}
        @change=${(event) => update({ options: event.target.value.split('\n').map((line) => line.trim())
          .filter((line) => line !== '') })}></textarea></label>` : nothing}</div>`;
  }

  _schema(schema, update) {
    const fields = this.model.fields.map((field) => ({ ...field, name: field.label }));
    return html`${text('Name', schema.name, (name) => update({ name }))}
      ${schema.fields.map((entry) => {
        const field = fields.find((candidate) => candidate.id === entry.field_id);
        const edit = (patch) => update({ fields: schema.fields.map((item) =>
          item.field_id === entry.field_id ? { ...item, ...patch } : item) });
        const numeric = field !== undefined && ['integer', 'number'].includes(field.type);
        let defaultEditor = nothing;
        if (field !== undefined) {
          if (field.type === 'enum' || field.type === 'boolean') {
            const options = field.type === 'enum' ? field.options : ['true', 'false'];
            defaultEditor = select('Default', choices(options), entry.default === null ? '' : String(entry.default),
              (value) => edit({ default: value === '' ? null : field.type === 'boolean' ? value === 'true' : value }), 'None');
          } else {
            defaultEditor = text('Default', entry.default,
              (value) => edit({ default: value === '' ? null : value }),
              numeric ? 'number' : field.type === 'date' ? 'date' : 'text');
          }
        }
        return html`<div class="entry"><strong>${field === undefined ? entry.field_id : field.label}</strong>
          <div class="row">${check('Required', entry.required, (required) => edit({ required }))}
            ${defaultEditor}
            ${numeric ? html`${text('Min', entry.min, (min) => edit({ min }), 'number')}
              ${text('Max', entry.max, (max) => edit({ max }), 'number')}` : nothing}
            ${field !== undefined && ['string', 'text'].includes(field.type)
              ? text('Max length', entry.max_length, (max_length) => edit({ max_length }), 'number') : nothing}
            <button @click=${() => update({ fields: schema.fields.filter((item) => item.field_id !== entry.field_id) })}>
              Remove field</button></div></div>`;
      })}
      ${select('Add field', fields.filter((field) => !schema.fields.some((entry) => entry.field_id === field.id)), '',
        (field_id) => { if (field_id !== '') update({ fields: [...schema.fields,
          { field_id, required: false, default: null, min: null, max: null, max_length: null }] }); }, 'Choose field')}`;
  }

  _workflow(workflow, update) {
    const members = workflow.states.map((id) => this.model.states.find((state) => state.id === id))
      .filter((state) => state !== undefined);
    return html`${text('Name', workflow.name, (name) => update({ name }))}
      <fieldset><legend>States</legend>${this.model.states.map((state) => check(state.name,
        workflow.states.includes(state.id), (checked) => {
          const states = toggle(workflow.states, state.id, checked);
          update({ states, initial: states.includes(workflow.initial) ? workflow.initial
            : states.length === 0 ? '' : states[0],
          from_any: workflow.from_any.filter((id) => states.includes(id)),
          transitions: workflow.transitions.filter(({ from, to }) => states.includes(from) && states.includes(to)) });
        }))}</fieldset>
      ${select('Initial state', members, workflow.initial, (initial) => update({ initial }))}
      <fieldset><legend>Allowed transitions</legend>${members.map((target) => html`<div class="entry">
        <strong>To ${target.name}</strong><div class="row">
          ${check('From any state', workflow.from_any.includes(target.id),
            (checked) => update({ from_any: toggle(workflow.from_any, target.id, checked) }))}
          ${members.filter((source) => source.id !== target.id).map((source) => {
            const isEdge = ({ from, to }) => from === source.id && to === target.id;
            return check(`From ${source.name}`, workflow.transitions.some(isEdge), (checked) => update({
              transitions: checked ? [...workflow.transitions, { from: source.id, to: target.id }]
                : workflow.transitions.filter((edge) => !isEdge(edge)),
            }), `${source.id}:${target.id}`);
          })}</div></div>`)}</fieldset>`;
  }

  _process(process, update) {
    return html`${text('Name', process.name, (name) => update({ name }))}
      <fieldset><legend>Task types</legend>${process.types.map((type) => {
        const edit = (patch) => update({ types: process.types.map((item) =>
          item.id === type.id ? { ...item, ...patch } : item) });
        return html`<div class="entry"><div class="row">
          ${text('Name', type.name, (name) => edit({ name }))}
          ${select('Backlog level', choices(LEVELS), type.backlog_level, (backlog_level) => edit({ backlog_level }))}
          ${text('Tier', type.tier, (tier) => edit({ tier }), 'number')}
          ${select('Workflow', this.model.workflows, type.workflow_id, (workflow_id) => edit({ workflow_id }))}
          ${select('Field schema', this.model.field_schemas, type.field_schema_id,
            (field_schema_id) => edit({ field_schema_id }))}
          <button @click=${() => update({ types: process.types.filter((item) => item.id !== type.id),
            parent_rules: process.parent_rules.filter(({ parent, child }) => parent !== type.id && child !== type.id),
          })}>Remove type</button></div></div>`;
      })}<button @click=${() => update({ types: [...process.types, { id: crypto.randomUUID(), name: 'New type',
        backlog_level: 'portfolio', tier: 0, workflow_id: '', field_schema_id: '' }] })}>Add task type</button></fieldset>
      <fieldset><legend>Parent rules</legend>${process.types.map((parent) => html`<div class="entry">
        <strong>${parent.name} can parent</strong><div class="row">
          ${process.types.filter((child) => child.id !== parent.id).map((child) => {
            const isRule = (rule) => rule.parent === parent.id && rule.child === child.id;
            return check(child.name, process.parent_rules.some(isRule), (checked) => update({ parent_rules:
              checked ? [...process.parent_rules, { parent: parent.id, child: child.id }]
                : process.parent_rules.filter((rule) => !isRule(rule)),
            }));
          })}</div></div>`)}</fieldset>`;
  }

  _renderTab() {
    switch (this.tab) {
      case 'fields': return this._renderEntries('fields', 'field', { label: 'New field', key: '',
        type: 'string', options: [] }, this._field);
      case 'field_schemas': return this._renderEntries('field_schemas', 'schema', { name: 'New schema', fields: [] }, this._schema);
      case 'states': return this._renderEntries('states', 'state', { name: 'New state', category: 'Proposed' },
        (state, update) => html`<div class="row">${text('Name', state.name, (name) => update({ name }))}
          ${select('Category', choices(CATEGORIES), state.category, (category) => update({ category }))}</div>`);
      case 'workflows': return this._renderEntries('workflows', 'workflow', { name: 'New workflow', states: [],
        initial: '', transitions: [], from_any: [] }, this._workflow);
      case 'processes': return this._renderEntries('processes', 'process', { name: 'New process', types: [],
        parent_rules: [] }, this._process);
      default: throw new Error(`Unknown catalogue view ${this.tab}`);
    }
  }

  render() {
    return html`<h2>Local Catalogue</h2><p role="status">${this.busy ? 'Working...' : this.message}</p>
      ${this.model === null ? nothing : html`<div ?inert=${this.busy}>
        <nav aria-label="Catalogue views">${Object.entries(TABS).map(([id, label]) => html`<button
          data-tab=${id} aria-current=${id === this.tab ? 'page' : 'false'}
          @click=${() => { this.tab = id; }}>${label}</button>`)}</nav>
        ${this._renderTab()}
        <p class="actions"><button data-save @click=${() => this._run(
          () => adminProvider.saveLocalCatalogue(this.model), 'Saved.')}>Save catalogue</button>
          <button @click=${() => this._run(() => adminProvider.getLocalCatalogue())}>Reload</button>
          ${Object.keys(TABS).every((key) => this.model[key].length === 0) ? html`<button
            @click=${() => this._run(() => adminProvider.createLocalStarterCatalogue(this.model.revision), 'Saved.')}>
            Create starter catalogue</button>` : nothing}</p></div>`}`;
  }
}

customElements.define('admin-local-catalogue', LocalCatalogue);