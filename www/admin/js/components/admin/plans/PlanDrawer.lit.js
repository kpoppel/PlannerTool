import { LitElement, html, css } from '/static/js/vendor/lit.js';
import { BaseConfigComponent } from '../BaseConfigComponent.lit.js';
import './AreaPathPicker.lit.js';
import './WorkforceTree.lit.js';

const HISTORY_OPTIONS = [[0, 'None (default)'], [30, '1 month'], [90, '3 months'],
  [182, '6 months'], [365, '1 year']];

export class PlanDrawer extends LitElement {
  static properties = { plan: { type: Object }, content: { type: Object }, catalogue: { type: Object },
    iterations: { type: Array }, workforce: { type: Object }, draft: { state: true }, step: { state: true },
    process: { state: true }, pending: { state: true }, areaError: { state: true }, changeArea: { state: true },
    busy: { type: Boolean }, error: { type: String }, saved: { type: Boolean }, feedback: { type: String },
    loadFailed: { type: Boolean } };
  static styles = [BaseConfigComponent.styles, css`
    :host { position: fixed; inset: 0; z-index: 1200; height: auto; }
    .scrim { position: absolute; inset: 0; background: #17203355; }
    .drawer { position: absolute; inset: 0 0 0 auto; width: 620px; max-width: calc(100vw - 80px);
      background: white; display: flex; flex-direction: column; box-shadow: -6px 0 24px #0002; }
    header, footer { padding: 20px 24px; flex-shrink: 0; }
    header { border-bottom: 1px solid #e5e7eb; }
    h2 { margin: 0; }
    .body { flex: 1; min-height: 0; overflow: auto; padding: 20px 24px; }
    .body.area-step { display: flex; flex-direction: column; }
    .body.area-step > fieldset { display: flex; flex: 1; flex-direction: column;
      min-height: 0; margin-bottom: 0; }
    .body.area-step > fieldset > .area-editor { display: flex; flex: 1;
      flex-direction: column; min-height: 0; }
    footer { border-top: 1px solid #e5e7eb; display: flex; gap: 8px; justify-content: flex-end; }
    .steps { display: flex; gap: 8px; padding: 0; list-style: none; margin-bottom: 0; }
    .steps li { flex: 1; font-size: 12px; color: #6b7280; border-bottom: 3px solid #e5e7eb; padding: 10px 0 6px; }
    .steps li[aria-current=step] { color: #1d4ed8; border-color: #3b82f6; }
    .field { display: block; margin: 0 0 18px; }
    .field > span { display: block; font-weight: 600; margin-bottom: 6px; }
    input[type=text], select { width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid #ccc; border-radius: 4px; }
    fieldset { border: 0; padding: 0; margin: 0 0 18px; min-width: 0; }
    legend { font-weight: 600; margin-bottom: 8px; }
    fieldset label { display: flex; gap: 8px; align-items: center; padding: 5px 0; }
    small, .help { color: #566170; font-size: 12px; font-weight: normal; }
    .callout { background: #fffbeb; border-left: 3px solid #d97706; padding: 10px; margin: 12px 0; }
    .danger { border-top: 1px solid #e5e7eb; margin-top: 24px; padding-top: 16px; }
    .danger button { color: #b91c1c; margin-right: 8px; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    [role=alert] { color: #b91c1c; }
    [role=status] { padding: 12px 0; }
    dd { margin: 4px 0 16px; overflow-wrap: anywhere; }
    dt { color: #566170; font-size: 12px; }
    [hidden] { display: none; }
  `];
  constructor() {
    super();
    this.plan = null;
    this.content = { container_types: [], project_map: [], allocation_defaults: {} };
    this.catalogue = { processes: [] };
    this.iterations = [];
    this.workforce = { groups: [], teams: [] };
    this.draft = null;
    this.step = 0;
    this.process = null;
    this.pending = true;
    this.areaError = '';
    this.changeArea = false;
    this.busy = false;
    this.error = '';
    this.saved = false;
    this.feedback = '';
    this.loadFailed = false;
    this._nameTouched = false;
    this._typesTouched = false;
  }
  willUpdate(changed) {
    if (changed.has('plan') || this.draft === null) {
      this.draft = this.plan === null ? { id: crypto.randomUUID(), name: '',
        type: this.content.container_types[0], area_path: '', task_types: [], closed_history_days: 0 }
        : structuredClone(this.plan);
    }
  }
  firstUpdated() {
    this._previousFocus = document.activeElement;
    this.shadowRoot.querySelector('.drawer').focus();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._previousFocus !== null && this._previousFocus !== undefined) this._previousFocus.focus();
  }
  _emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  _convention() {
    if (this.process === null) return [];
    const projects = new Set(this.process.projects.map((project) => project.toLowerCase()));
    const names = this.content.project_map.filter((plan) => plan.id !== this.draft.id
      && plan.type === this.draft.type && projects.has(plan.area_path.split(/[\\/]/)[0].toLowerCase()))
      .flatMap((plan) => plan.task_types.map((name) => name.toLowerCase()));
    return this.process.types.filter((type) => type.backlog_level !== 'task' && !type.missing
      && names.includes(type.name.toLowerCase())).map((type) => type.name);
  }
  _onArea(event) {
    const { areaPath, process, pending, error } = event.detail;
    const oldProject = this.draft.area_path.split(/[\\/]/)[0].toLowerCase();
    const newProject = areaPath.split(/[\\/]/)[0].toLowerCase();
    const changedProject = oldProject !== newProject;
    this.process = process;
    this.pending = pending;
    this.areaError = error;
    this.draft = { ...this.draft, area_path: areaPath };
    if (!this._nameTouched && this.plan === null) {
      this.draft = { ...this.draft, name: areaPath.split(/[\\/]/).at(-1) };
    }
    if (changedProject && this.changeArea) {
      this._typesTouched = false;
      this.draft = { ...this.draft, task_types: [] };
    }
    if (process !== null && !pending && !this._typesTouched && (this.plan === null || this.changeArea)) {
      this.draft = { ...this.draft, task_types: this._convention() };
    }
  }
  setName(name) { this._nameTouched = true; this.draft = { ...this.draft, name }; }
  toggleType(name, selected) {
    this._typesTouched = true;
    const types = this.draft.task_types.filter((type) => type.toLowerCase() !== name.toLowerCase());
    this.draft = { ...this.draft, task_types: selected ? [...types, name] : types };
  }
  setWorkforce(inherit) {
    const draft = { ...this.draft };
    if (inherit) delete draft.allocatable_ids;
    else draft.allocatable_ids = [];
    this.draft = draft;
  }
  get areaValid() { return !this.pending && !this.areaError && this.process !== null && this.draft.area_path !== ''; }
  get detailsValid() {
    return this.draft.name.trim() !== '' && this.content.container_types.includes(this.draft.type)
      && this.process !== null && this.draft.task_types.length > 0
      && this.draft.task_types.every((name) => this.process.types.some((type) => !type.missing
        && type.backlog_level !== 'task' && type.name.toLowerCase() === name.toLowerCase()));
  }
  get validStep() {
    if (this.plan !== null) return this.areaValid && this.detailsValid;
    if (this.step === 0) return this.areaValid;
    if (this.step === 1) return this.detailsValid;
    return this.areaValid && this.detailsValid;
  }
  next() { if (this.validStep && this.step < 3) this.step += 1; }
  submit() {
    if (this.busy || this.saved || !this.areaValid || !this.detailsValid) return;
    const selected = this.process.types.filter((type) => this.draft.task_types.some((name) =>
      name.toLowerCase() === type.name.toLowerCase()));
    const processImports = {};
    const additions = selected.filter((type) => !type.imported).map((type) => type.reference_name);
    if (additions.length > 0) processImports[this.process.id] = additions;
    const refresh = this.plan === null || ['area_path', 'task_types', 'closed_history_days']
      .some((key) => JSON.stringify(this.plan[key]) !== JSON.stringify(this.draft[key]));
    this._emit('plan-submit', { plan: { ...this.draft, name: this.draft.name.trim() }, processImports, refresh });
  }
  _details() {
    const convention = this._convention();
    const unavailable = this.process === null ? [] : this.draft.task_types.filter((name) =>
      !this.process.types.some((type) => type.name.toLowerCase() === name.toLowerCase()
        && !type.missing && type.backlog_level !== 'task'));
    return html`<label class="field"><span>Name</span><input type="text" aria-label="Plan name"
      .value=${this.draft.name} @input=${(event) => this.setName(event.target.value)}></label>
      <label class="field"><span>Plan level</span><select aria-label="Plan level" @change=${(event) => {
        this.draft = { ...this.draft, type: event.target.value };
        if (!this._typesTouched && this.plan === null) this.draft = { ...this.draft, task_types: this._convention() };
      }}>${this.content.container_types.map((level) => html`<option .selected=${level === this.draft.type}>${level}</option>`)}</select></label>
      <p>Process: <strong>${this.process === null ? 'Not resolved' : this.process.name}</strong></p>
      <fieldset><legend>Work item types</legend>${this.process === null ? '' : this.process.types
        .filter((type) => !type.missing).map((type) => html`<label><input type="checkbox" .value=${type.name}
          .checked=${this.draft.task_types.some((name) => name.toLowerCase() === type.name.toLowerCase())}
          ?disabled=${type.backlog_level === 'task'}
          @change=${(event) => this.toggleType(type.name, event.target.checked)}>${type.name}
          <small>${type.backlog_level === 'task' ? 'Task-level types cannot be imported'
            : convention.includes(type.name) ? `used by other ${this.draft.type} plans` : ''}
            ${!type.imported && type.backlog_level !== 'task' ? ' (not yet imported)' : ''}</small></label>`)}
        ${unavailable.map((name) => html`<p class="callout">Unavailable type: ${name}
          <button title=${`Remove unavailable type ${name}`} aria-label=${`Remove unavailable type ${name}`}
            @click=${() => this.toggleType(name, false)}>&#215;</button></p>`)}
        <small>Select at least one work item type.</small></fieldset>
      <label class="field"><span>Closed work history</span><select aria-label="Closed work history"
        @change=${(event) => { this.draft = { ...this.draft, closed_history_days: Number(event.target.value) }; }}>
        ${HISTORY_OPTIONS.map(([days, label]) => html`<option .value=${String(days)}
          .selected=${days === this.draft.closed_history_days}>${label}</option>`)}
        ${HISTORY_OPTIONS.some(([days]) => days === this.draft.closed_history_days) ? ''
          : html`<option .value=${String(this.draft.closed_history_days)} selected>${this.draft.closed_history_days} days</option>`}
        </select><p class="help">Completed work linked to active items always shows, whatever this setting is.</p></label>
      <label class="field"><span>Iteration set</span><select aria-label="Iteration set" @change=${(event) => {
        const draft = { ...this.draft };
        if (event.target.value === '') delete draft.iteration_uuid;
        else draft.iteration_uuid = event.target.value;
        this.draft = draft;
      }}><option value="" .selected=${!Object.hasOwn(this.draft, 'iteration_uuid')}>None</option>
        ${this.iterations.map((iteration) => html`<option .value=${iteration.id}
          .selected=${iteration.id === this.draft.iteration_uuid}>${iteration.name}</option>`)}</select></label>`;
  }
  _workforce() {
    const inherit = !Object.hasOwn(this.draft, 'allocatable_ids');
    return html`<fieldset><legend>Workforce</legend>
      <label><input type="radio" name="workforce" .checked=${inherit}
        @change=${() => this.setWorkforce(true)}>Inherit level default</label>
      <label><input type="radio" name="workforce" .checked=${!inherit}
        @change=${() => this.setWorkforce(false)}>Choose for this plan</label></fieldset>
      ${inherit ? '' : html`<plan-workforce-tree .catalogue=${this.workforce} .selected=${this.draft.allocatable_ids}
        @selection-change=${(event) => { this.draft = { ...this.draft, allocatable_ids: event.detail }; }}></plan-workforce-tree>`}`;
  }
  _review() {
    return html`<h3>${this.draft.name}</h3><dl><dt>Area path</dt><dd>${this.draft.area_path}</dd>
      <dt>Plan level</dt><dd>${this.draft.type}</dd><dt>Process</dt><dd>${this.process.name}</dd>
      <dt>Work item types</dt><dd>${this.draft.task_types.join(', ')}</dd>
      <dt>Closed work history</dt><dd>${this.draft.closed_history_days === 0 ? 'None' : `${this.draft.closed_history_days} days`}</dd>
      <dt>Workforce</dt><dd>${Object.hasOwn(this.draft, 'allocatable_ids')
        ? `${this.draft.allocatable_ids.length} selected` : 'Inherit level default'}</dd></dl>`;
  }
  _onKeydown(event) {
    if (event.key === 'Escape' && !this.busy) { event.stopPropagation(); this._emit('close-drawer', null); }
    if (event.key !== 'Tab') return;
    const controls = [...this.shadowRoot.querySelectorAll('button, input, select, [tabindex="0"]')]
      .filter((element) => !element.disabled && element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && this.shadowRoot.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && this.shadowRoot.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  render() {
    if (this.draft === null) return '';
    const editing = this.plan !== null;
    const areaStep = editing ? this.changeArea : this.step === 0;
    return html`<div class="scrim" @click=${() => { if (!this.busy) this._emit('close-drawer', null); }}></div>
      <section class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" tabindex="-1"
        @keydown=${this._onKeydown}><header><h2 id="drawer-title">${editing ? 'Edit plan' : 'New plan'}</h2>
        ${editing ? '' : html`<ol class="steps">${['Area path', 'Details', 'Workforce', 'Review'].map((label, index) =>
          html`<li aria-current=${this.step === index ? 'step' : 'false'}>${index + 1}. ${label}</li>`)}</ol>`}</header>
        <div class=${areaStep ? 'body area-step' : 'body'}><fieldset ?disabled=${this.busy || this.saved} ?inert=${this.busy || this.saved}>
          ${editing ? html`<p>${this.draft.area_path}</p><button @click=${() => { this.changeArea = !this.changeArea; }}>Change area path...</button>
            ${this.changeArea ? html`<p class="callout">Changing the area path replaces the source of this plan's work items.</p>` : ''}` : ''}
          <div class="area-editor" ?hidden=${editing ? !this.changeArea : this.step !== 0}>
            <plan-area-path-picker .areaPath=${this.draft.area_path} .currentId=${this.draft.id}
              .plans=${this.content.project_map} @area-change=${this._onArea}></plan-area-path-picker></div>
          ${editing && !this.changeArea && (this.pending || this.areaError) ? html`
            <p role="status">${this.pending ? 'Resolving process...' : this.areaError}</p>
            ${this.areaError ? html`<button @click=${() => this.shadowRoot.querySelector('plan-area-path-picker').loadProjects()}>Retry</button>` : ''}` : ''}
          ${editing || this.step === 1 ? this._details() : ''}
          ${editing || this.step === 2 ? this._workforce() : ''}
          ${!editing && this.step === 3 ? this._review() : ''}
          ${editing ? html`<div class="danger"><h3>Danger zone</h3>
            <button @click=${() => this._emit('plan-action', { id: this.plan.id, action: this.plan.archived ? 'restore' : 'archive' })}>${this.plan.archived ? 'Restore' : 'Archive'}</button>
            <button @click=${() => this._emit('plan-action', { id: this.plan.id, action: 'delete' })}>Delete</button></div>` : ''}
          </fieldset>${this.error ? html`<p role="alert">${this.error}</p>` : ''}
          ${this.feedback ? html`<p role="status">${this.feedback}</p>` : ''}
          ${this.loadFailed ? html`<button ?disabled=${this.busy} @click=${() => this._emit('refresh-plan', this.draft.id)}>Retry</button>` : ''}
        </div><footer><button ?disabled=${this.busy} @click=${() => this._emit('close-drawer', null)}>${this.saved ? 'Done' : 'Cancel'}</button>
          ${this.saved ? '' : html`${!editing && this.step > 0 ? html`<button ?disabled=${this.busy}
            @click=${() => { this.step -= 1; }}>Back</button>` : ''}
            ${!editing && this.step < 3 ? html`<button class="primary" ?disabled=${this.busy || !this.validStep}
              @click=${this.next}>Next</button>` : html`<button class="primary"
              ?disabled=${this.busy || !this.validStep} @click=${this.submit}>${editing ? 'Save' : 'Create plan'}</button>`}`}
        </footer></section>`;
  }
}
customElements.define('plan-drawer', PlanDrawer);