import { LitElement, html, css, nothing } from '/static/js/vendor/lit.js';
import { adminProvider } from '../../services/providerREST.js';
import { durationDays, generateIterations, generatorDefaults, validateIteration } from '../../services/iterationSets.js';

const SOURCE_LABELS = { ado: 'Azure DevOps', generated: 'Date generator', manual: 'Manual' };
const copy = (value) => structuredClone(value);
const dateLabel = (value) => new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined,
  { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

export class AdminIterations extends LitElement {
  static properties = {
    sets: { state: true }, usage: { state: true }, draft: { state: true }, activeTab: { state: true },
    loading: { state: true }, busy: { state: true }, browseLoading: { state: true },
    sourceRows: { state: true }, filterText: { state: true }, projects: { state: true },
    projectLoading: { state: true }, error: { state: true }, status: { state: true },
    dialog: { state: true }, newSource: { state: true }, projectError: { state: true },
    expandedPaths: { state: true },
  };

  static styles = css`
    :host { display: flex; flex-direction: column; height: calc(100vh - 94px); min-height: 570px;
      min-width: 860px; color: #243447; font-size: 13px; --line: #dce1e5; --muted: #637080; --accent: #176d68; }
    * { box-sizing: border-box; }
    h2, h3, p { margin: 0; }
    h2 { font-size: 21px; } h3 { font-size: 15px; font-weight: 600; }
    button, input, select { font: inherit; }
    button { cursor: pointer; border: 1px solid #bdc6cd; border-radius: 4px; padding: 8px 12px; background: #fff; color: inherit; }
    button:hover:not(:disabled) { background: #f0f5f4; }
    button:disabled { opacity: .45; cursor: default; }
    button.primary { background: var(--accent); border-color: var(--accent); color: white; }
    button.primary:hover:not(:disabled) { background: #125b57; }
    button.quiet { border-color: transparent; background: transparent; }
    button.icon { width: 32px; height: 32px; padding: 0; flex-shrink: 0; font-size: 18px; }
    button.danger { color: #a03332; }
    input:not([type=checkbox]), select { width: 100%; padding: 8px; border: 1px solid #bdc6cd; border-radius: 4px; color: inherit; background: white; min-width: 0; }
    input[type=checkbox] { accent-color: var(--accent); width: 16px; height: 16px; flex-shrink: 0; }
    :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    small, .muted { color: var(--muted); font-size: 12px; }
    label.field { display: flex; flex-direction: column; gap: 7px; font-size: 12px; font-weight: 600; }
    .page-heading { display: flex; align-items: center; justify-content: space-between; padding-bottom: 20px; }
    .page-heading p { margin-top: 6px; color: var(--muted); }
    .workspace { display: grid; grid-template-columns: 190px minmax(0, 1fr); border-top: 1px solid var(--line); flex: 1; min-height: 0; }
    .sets { padding: 18px 14px 18px 0; border-right: 1px solid var(--line); overflow: auto; }
    .eyebrow { text-transform: uppercase; font-size: 11px; color: var(--muted); margin-bottom: 12px; }
    .set-item { text-align: left; width: 100%; padding: 12px; border-color: transparent; margin-bottom: 5px; }
    .set-item.selected { background: #eaf5f2; border-color: #bdd8cf; }
    .set-item strong { display: block; overflow-wrap: anywhere; }
    .set-item small { display: block; font-size: 11px; margin-top: 7px; }
    .editor { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
    .editor-head { padding: 18px 0 0 20px; flex-shrink: 0; }
    .title-row { display: flex; align-items: center; gap: 10px; }
    .title-row h3 { overflow-wrap: anywhere; }
    .tag { font-size: 11px; padding: 3px 7px; border-radius: 3px; background: #eef1f4; color: #526171; white-space: nowrap; }
    .tag.green { color: var(--accent); background: #eaf5f2; }
    .subline { font-size: 12px; color: var(--muted); margin-top: 8px; }
    .tabs { display: flex; gap: 24px; margin-top: 14px; border-bottom: 1px solid var(--line); }
    .tabs button { border: 0; border-radius: 0; padding: 12px 0; color: var(--muted); }
    .tabs button[aria-selected=true] { box-shadow: inset 0 -2px var(--accent); color: var(--accent); font-weight: 600; }
    .members { display: grid; grid-template-columns: minmax(270px, 1fr) minmax(300px, 1fr); flex: 1; min-height: 0; }
    .source { padding: 18px 18px 14px 20px; border-right: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; gap: 12px; }
    .source > * { flex-shrink: 0; }
    .section-head { display: flex; align-items: center; justify-content: space-between; min-height: 32px; gap: 8px; }
    .source-context { line-height: 1.8; }
    .source-context strong { display: block; }
    .scroll { flex: 1; min-height: 80px; overflow: auto; }
    .source-row { display: flex; align-items: center; gap: 8px; border-bottom: 1px solid #edf0f2; padding: 10px 2px; min-height: 46px; }
    .source-row .row-label { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .source-row strong { display: block; font-size: 12px; font-weight: 500; }
    .source-row small { display: block; margin-top: 3px; font-size: 11px; }
    .iteration-tree { list-style: none; margin: 0; padding: 0; }
    .iteration-tree .iteration-tree { margin-left: 12px; padding-left: 8px; border-left: 1px solid var(--line); }
    .tree-label { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; cursor: pointer; }
    .tree-toggle, .tree-spacer { width: 24px; height: 28px; flex: 0 0 24px; }
    .tree-toggle { padding: 0; font-size: 18px; }
    .tree-tools { display: flex; gap: 8px; }
    .tree-tools button { padding: 4px 8px; font-size: 12px; }
    .selection { font-size: 12px; color: var(--accent); }
    .notice { border-left: 3px solid #c3954c; padding: 10px 12px; background: #fcf5e8; color: #82551b; font-size: 12px; line-height: 1.6; }
    .error { background: #fff1f0; border-left-color: #bd4944; color: #962e2b; }
    .message { margin-top: 12px; }
    .preview { padding: 18px 0 14px 20px; overflow: auto; }
    .metric { margin: 12px 0 5px; } .metric b { font-size: 25px; margin-right: 5px; }
    .range { font-size: 12px; margin-bottom: 14px; color: var(--muted); }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; padding: 10px 8px; color: var(--muted); font-weight: 500; background: #f5f7f8; }
    td { padding: 12px 8px; border-bottom: 1px solid #edf0f2; vertical-align: top; }
    td:not(:first-child) { white-space: nowrap; }
    td:first-child { overflow-wrap: anywhere; }
    .short { display: block; margin-top: 5px; color: #82551b; font-size: 11px; }
    .preview-note { font-size: 12px; line-height: 1.7; color: var(--muted); margin-top: 16px; }
    .footer { display: flex; align-items: center; gap: 8px; padding: 16px 0 0 20px; border-top: 1px solid var(--line); flex-shrink: 0; }
    .footer .status { margin-right: auto; font-size: 12px; }
    .dirty { color: #82551b; }
    .empty { padding: 36px 16px; text-align: center; color: var(--muted); line-height: 1.8; }
    .secondary { padding: 24px 0 20px 20px; flex: 1; min-height: 0; overflow: auto; }
    .secondary > p { margin: 14px 0 20px; color: var(--muted); line-height: 1.7; }
    dl { display: grid; grid-template-columns: 145px 1fr; gap: 18px; margin: 22px 0; }
    dt { color: var(--muted); } dd { margin: 0; overflow-wrap: anywhere; }
    details { padding: 18px 0; border-top: 1px solid var(--line); } summary { cursor: pointer; }
    .generator { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 0 3px; }
    .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 12px; }
    .wide { grid-column: 1 / -1; }
    .note { color: var(--muted); font-size: 12px; line-height: 1.6; margin-top: 14px; }
    dialog { color: inherit; width: 460px; padding: 24px; border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 12px 40px #24344725; }
    dialog::backdrop { background: #18273566; }
    dialog h3 { margin-bottom: 20px; }
    dialog .field { margin-top: 16px; }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 24px; }
    [hidden] { display: none !important; }
  `;

  constructor() {
    super();
    this.sets = []; this.usage = {}; this.draft = null; this.activeTab = 'members';
    this.loading = true; this.busy = false; this.browseLoading = false;
    this.sourceRows = []; this.filterText = ''; this.projects = []; this.projectLoading = false;
    this.error = ''; this.projectError = ''; this.status = ''; this.dialog = ''; this.newSource = 'generated';
    this._sourceRequest = 0; this._appliedGenerator = null;
    this.expandedPaths = new Set(); this._unfilteredExpansion = null;
    this._onBeforeUnload = (event) => {
      if (this.hasUnsavedChanges || this.busy) { event.preventDefault(); event.returnValue = ''; }
    };
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('beforeunload', this._onBeforeUnload);
    this.loadConfig();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._sourceRequest += 1;
    window.removeEventListener('beforeunload', this._onBeforeUnload);
  }

  get hasUnsavedChanges() {
    return this.draft !== null && JSON.stringify(this.draft) !== JSON.stringify(this.sets.find((set) => set.id === this.draft.id));
  }
  get generatorPending() {
    return this.draft !== null && this.draft.source_type === 'generated' && JSON.stringify(this.draft.generator) !== this._appliedGenerator;
  }
  get assignedPlans() {
    if (this.draft === null || !Object.hasOwn(this.usage, this.draft.id)) return [];
    return this.usage[this.draft.id];
  }
  get filteredSourceRows() {
    const query = this.filterText.trim().toLowerCase();
    return this.sourceRows.filter((row) => row.path.toLowerCase().includes(query));
  }
  get sourceTree() {
    const selected = new Set(this.draft === null ? [] : this.draft.selected_paths);
    const included = new Set(this.draft === null ? [] : this.draft.values.map((row) => row.path));
    const query = this.filterText.trim().toLowerCase();
    const nodes = new Map(this.sourceRows.map((row) => [row.path, { row, children: [] }]));
    const roots = [];
    for (const node of nodes.values()) {
      let parent = node.row.path;
      do { parent = parent.slice(0, Math.max(0, parent.lastIndexOf('\\'))); }
      while (parent && !nodes.has(parent));
      if (nodes.has(parent)) nodes.get(parent).children.push(node);
      else roots.push(node);
    }
    const summarize = (node) => {
      node.size = 1; node.selected = selected.has(node.row.path) ? 1 : 0;
      node.included = included.has(node.row.path) ? 1 : 0;
      node.matches = node.row.path.toLowerCase().includes(query);
      for (const child of node.children) {
        summarize(child);
        node.size += child.size; node.selected += child.selected; node.included += child.included;
        node.matches = node.matches || child.matches;
      }
    };
    for (const root of roots) summarize(root);
    return roots;
  }

  toggleBranch(path) {
    const expanded = new Set(this.expandedPaths);
    if (expanded.has(path)) expanded.delete(path); else expanded.add(path);
    this.expandedPaths = expanded;
  }

  expandAllBranches() {
    const expanded = new Set();
    const visit = (node) => {
      if (node.children.length) expanded.add(node.row.path);
      node.children.forEach(visit);
    };
    this.sourceTree.forEach(visit);
    this.expandedPaths = expanded;
  }

  collapseAllBranches() { this.expandedPaths = new Set(); }

  setSourceFilter(value) {
    if (value.trim() && !this.filterText.trim()) this._unfilteredExpansion = new Set(this.expandedPaths);
    this.filterText = value;
    if (value.trim()) {
      const expanded = new Set();
      const visit = (node) => {
        if (node.matches && node.children.length) expanded.add(node.row.path);
        node.children.forEach(visit);
      };
      this.sourceTree.forEach(visit);
      this.expandedPaths = expanded;
    } else if (this._unfilteredExpansion !== null) {
      this.expandedPaths = this._unfilteredExpansion;
      this._unfilteredExpansion = null;
    }
  }
  get sortedValues() {
    return this.draft.values.toSorted((first, second) => first.startDate.localeCompare(second.startDate));
  }

  async loadConfig() {
    this.loading = true; this.error = '';
    try {
      const result = await adminProvider.getIterations();
      if (!result.ok) throw new Error(result.error.message);
      this.sets = result.data.iteration_sets;
      this.usage = result.data.usage;
      this.activateSet(this.sets.length ? this.sets[0] : null);
      if (this.draft !== null && this.draft.source_type === 'ado') this.loadSource();
    } catch (error) {
      console.error('Loading iteration sets failed', error);
      this.error = error.message;
    } finally { this.loading = false; }
  }

  activateSet(set) {
    this._sourceRequest += 1; this.browseLoading = false;
    this.draft = set === null ? null : copy(set);
    this._appliedGenerator = set === null ? null : JSON.stringify(set.generator);
    this.sourceRows = []; this.filterText = ''; this.activeTab = 'members'; this.status = ''; this.error = '';
    this.expandedPaths = new Set(); this._unfilteredExpansion = null;
  }

  mayLeave() {
    return !this.busy && (!this.hasUnsavedChanges || window.confirm('Discard unsaved changes to this iteration set?'));
  }

  selectSet(set) {
    if (this.draft !== null && this.draft.id === set.id) return;
    if (!this.mayLeave()) return;
    this.activateSet(set);
    if (set.source_type === 'ado') this.loadSource();
  }

  createDraft(name, source, project) {
    if (!name.trim()) throw new Error('Enter a set name.');
    this.activateSet(null);
    this.draft = { id: crypto.randomUUID(), name: name.trim(), source_type: source,
      source_project: source === 'ado' ? project : null, root_path: null, selected_paths: [],
      generator: source === 'generated' ? generatorDefaults() : null, values: [], cached_at: null };
    this._appliedGenerator = null;
  }

  updateGenerator(key, value) {
    this.error = '';
    this.draft = { ...this.draft, generator: { ...this.draft.generator, [key]: value } };
  }

  generatePreview(event) {
    if (event) event.preventDefault();
    try {
      const values = generateIterations(this.draft.generator);
      this.draft = { ...this.draft, values };
      this._appliedGenerator = JSON.stringify(this.draft.generator);
      this.error = ''; this.requestUpdate();
    } catch (error) { this.error = error.message; }
  }

  async loadProjects() {
    this.projectLoading = true; this.projectError = '';
    try {
      const config = await adminProvider.getBrowseConfig();
      if (!config.ok) throw new Error(config.error.message);
      const result = await adminProvider.browseAzureProjects(config.data.organization_url);
      if (!result.ok) throw new Error(result.error.message);
      this.projects = result.data.projects;
    } catch (error) {
      console.error('Loading iteration source projects failed', error);
      this.projectError = error.message;
    } finally { this.projectLoading = false; }
  }

  async loadSource() {
    const request = ++this._sourceRequest;
    const id = this.draft.id;
    const project = this.draft.source_project;
    this.browseLoading = true; this.error = '';
    try {
      const result = await adminProvider.browseIterations({ project, depth: 10 });
      if (request !== this._sourceRequest || this.draft === null || this.draft.id !== id) return;
      if (!result.ok) throw new Error(result.error.message);
      this.sourceRows = result.data.iterations.map((row) => ({ path: row.path,
        name: typeof row.name === 'string' ? row.name : row.path.split('\\').at(-1),
        startDate: typeof row.startDate === 'string' ? row.startDate.split('T')[0] : null,
        finishDate: typeof row.finishDate === 'string' ? row.finishDate.split('T')[0] : null,
      })).sort((first, second) => first.path.localeCompare(second.path));
      this.applySourceSelection(this.draft.selected_paths);
      if (this.filterText.trim()) this.setSourceFilter(this.filterText);
    } catch (error) {
      if (request !== this._sourceRequest) return;
      console.error('Loading ADO iteration source failed', { project, error });
      this.error = error.message;
    } finally { if (request === this._sourceRequest) this.browseLoading = false; }
  }

  applySourceSelection(paths) {
    const values = [];
    for (const row of this.sourceRows) {
      if (!paths.includes(row.path) || !row.startDate || !row.finishDate) continue;
      try { values.push(validateIteration(row)); }
      catch (error) { this.error = `Excluded ${row.name}: ${error.message}`; }
    }
    this.draft = { ...this.draft, selected_paths: paths, values };
  }

  toggleSourcePath(path, checked) {
    const subtree = this.sourceRows.filter((row) => row.path === path || row.path.startsWith(`${path}\\`)).map((row) => row.path);
    const paths = new Set(this.draft.selected_paths.filter((selected) => !subtree.includes(selected)));
    if (checked) for (const selected of subtree) paths.add(selected);
    this.applySourceSelection([...paths].sort());
  }

  async saveSet() {
    if (this.busy || this.draft === null || !this.hasUnsavedChanges || this.generatorPending || !this.draft.values.length) return;
    if (!this.draft.name.trim()) { this.error = 'Enter a set name.'; return; }
    const saved = { ...copy(this.draft), name: this.draft.name.trim(), cached_at: new Date().toISOString() };
    const next = this.sets.filter((set) => set.id !== saved.id);
    const index = this.sets.findIndex((set) => set.id === saved.id);
    next.splice(index < 0 ? next.length : index, 0, saved);
    this.busy = true; this.error = '';
    try {
      const result = await adminProvider.saveIterations({ iteration_sets: next });
      if (!result.ok) throw new Error(result.error.message);
      this.sets = next; this.draft = copy(saved); this.status = 'Set saved. Available presets updated.';
    } catch (error) {
      console.error('Saving iteration set failed', { id: saved.id, error });
      this.error = error.message;
    } finally { this.busy = false; }
  }

  discardChanges() {
    if (!this.mayLeave()) return;
    const saved = this.sets.find((set) => set.id === this.draft.id);
    this.activateSet(saved === undefined ? (this.sets.length ? this.sets[0] : null) : saved);
  }

  async deleteSet() {
    if (this.busy || this.draft === null || this.assignedPlans.length) return;
    const id = this.draft.id;
    if (!this.sets.some((set) => set.id === id) || !window.confirm(`Delete iteration set "${this.draft.name}"? This cannot be undone.`)) return;
    this.busy = true; this.error = '';
    try {
      const result = await adminProvider.deleteIterationSet(id);
      if (!result.ok) {
        if (result.error.status === 409) {
          this.usage = { ...this.usage, [id]: result.error.detail.projects };
          this.activeTab = 'usage';
        }
        throw new Error(result.error.message);
      }
      this.sets = this.sets.filter((set) => set.id !== id);
      this.activateSet(this.sets.length ? this.sets[0] : null);
    } catch (error) {
      console.error('Deleting iteration set failed', { id, error });
      this.error = error.message;
    } finally { this.busy = false; }
  }

  async showDialog(kind, row = null) {
    if (kind === 'new' && !this.mayLeave()) return;
    this.dialog = kind; this.error = ''; this._editingRow = row;
    if (kind === 'new') this.newSource = 'generated';
    await this.updateComplete;
    this.shadowRoot.querySelector('dialog').showModal();
  }

  closeDialog() { this.shadowRoot.querySelector('dialog').close(); this.dialog = ''; }

  onCreate(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get('name')).trim();
    if (!name) { this.error = 'Enter a set name.'; return; }
    const source = this.newSource;
    this.createDraft(name, source, source === 'ado' ? String(data.get('project')) : '');
    this.closeDialog();
    if (source === 'ado') this.loadSource();
  }

  onManualSave(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const row = validateIteration({ path: this._editingRow === null ? crypto.randomUUID() : this._editingRow.path,
        name: String(data.get('name')), startDate: String(data.get('start')), finishDate: String(data.get('end')) });
      const values = this.draft.values.filter((value) => value.path !== row.path);
      this.draft = { ...this.draft, values: [...values, row] };
      this.closeDialog();
    } catch (error) { this.error = error.message; }
  }

  _renderGenerator() {
    const settings = this.draft.generator;
    const until = settings.mode === 'until';
    const input = (key, label, type, attributes = {}) => html`<label class="field">${label}<input
      type=${type} .value=${String(settings[key])} min=${attributes.min === undefined ? nothing : attributes.min}
      max=${attributes.max === undefined ? nothing : attributes.max} required
      @input=${(event) => this.updateGenerator(key, type === 'number' ? Number(event.target.value) : event.target.value)}></label>`;
    return html`<form class="generator" id="generator" @submit=${this.generatePreview}><div class="fields">
      <label class="field wide">Generate by<select @change=${(event) => this.updateGenerator('mode', event.target.value)}>
        <option value="count" .selected=${!until}>Length + count</option><option value="until" .selected=${until}>Length + end date</option>
      </select></label>
      ${input('start', 'Start date', 'date', { max: '9999-12-31' })}
      ${until ? input('end', 'End date (inclusive)', 'date', { min: settings.start, max: '9999-12-31' }) : input('count', 'Number of iterations', 'number', { min: 1, max: 520 })}
      ${input('length', 'Iteration length', 'number', { min: 1, max: settings.unit === 'weeks' ? 52 : 366 })}
      <label class="field">Unit<select @change=${(event) => this.updateGenerator('unit', event.target.value)}>
        <option value="weeks" .selected=${settings.unit === 'weeks'}>Weeks</option><option value="days" .selected=${settings.unit === 'days'}>Calendar days</option>
      </select></label>
      ${input('prefix', 'Name prefix', 'text')}${input('firstNumber', 'First number', 'number', { min: 1, max: 99999 })}
    </div><p class="note">Inclusive calendar dates, including weekends. Iterations are contiguous. Maximum 520 iterations.</p></form>
    <div><button class="primary" type="submit" form="generator">Generate preview</button></div>`;
  }

  _renderSourceNodes(nodes) {
    return html`<ul class="iteration-tree">${nodes.filter((node) => node.matches).map((node) => {
      const row = node.row;
      const branch = node.children.length > 0;
      const expanded = this.expandedPaths.has(row.path);
      const childrenId = `children-${encodeURIComponent(row.path)}`;
      return html`<li><div class="source-row">
        ${branch ? html`<button class="quiet tree-toggle" type="button"
          title=${`${expanded ? 'Collapse' : 'Expand'} ${row.name}`}
          aria-label=${`${expanded ? 'Collapse' : 'Expand'} ${row.path}`}
          aria-expanded=${expanded} aria-controls=${childrenId}
          @click=${() => this.toggleBranch(row.path)}>${expanded ? html`&#9662;` : html`&#9656;`}</button>` : html`<span class="tree-spacer"></span>`}
        <label class="tree-label"><input type="checkbox" aria-label=${`Include ${row.path}`}
          .checked=${node.selected === node.size} .indeterminate=${node.selected > 0 && node.selected < node.size}
          @change=${(event) => this.toggleSourcePath(row.path, event.target.checked)}>
          <span class="row-label" title=${row.path}><strong>${row.name}</strong>
            ${branch ? html`<small>${node.size - 1} descendants / ${node.included} included</small>` : nothing}
            <small>${row.startDate && row.finishDate ? `${dateLabel(row.startDate)} - ${dateLabel(row.finishDate)}` : branch ? 'Dates not set' : 'Excluded: dates not set'}</small>
          </span>
        </label>
      </div>${branch ? html`<div id=${childrenId} ?hidden=${!expanded}>${expanded ? this._renderSourceNodes(node.children) : nothing}</div>` : nothing}</li>`;
    })}</ul>`;
  }

  _renderAdo() {
    const selected = this.draft.selected_paths;
    const excluded = selected.length - this.draft.values.length;
    const tree = this.sourceTree;
    return html`<div class="source-context"><strong>${this.draft.source_project}</strong><small>Azure DevOps project</small></div>
      <label class="field">Find an iteration<input type="search" placeholder="Name or path" .value=${this.filterText}
        @input=${(event) => this.setSourceFilter(event.target.value)}></label>
      <div class="tree-tools"><button class="quiet" ?disabled=${this.browseLoading || !tree.length} @click=${this.expandAllBranches}>Expand all</button>
        <button class="quiet" ?disabled=${this.browseLoading || !tree.length} @click=${this.collapseAllBranches}>Collapse all</button></div>
      <div class="scroll" aria-label="Available iterations">
        ${this.browseLoading ? html`<p class="empty">Loading source iterations...</p>` : this._renderSourceNodes(tree)}
        ${!this.browseLoading && !this.filteredSourceRows.length ? html`<p class="empty">${this.sourceRows.length ? 'No matching iterations' : 'Reload source to browse iterations.'}</p>` : nothing}
      </div><div class="selection">${selected.length} selected / ${this.draft.values.length} included</div>
      ${excluded > 0 ? html`<div class="notice">${excluded} selected entries excluded: dates are missing, invalid, or the source entry is no longer available.</div>` : nothing}`;
  }

  _renderManual() {
    return html`<div class="scroll">${this.sortedValues.map((row) => html`<div class="source-row">
      <div class="row-label"><strong>${row.name}</strong><small>${dateLabel(row.startDate)} - ${dateLabel(row.finishDate)}</small></div>
      <button class="quiet icon" title="Edit iteration" aria-label=${`Edit ${row.name}`} @click=${() => this.showDialog('manual', row)}>&#9998;</button>
      <button class="quiet icon danger" title="Remove iteration" aria-label=${`Remove ${row.name}`}
        @click=${() => { this.draft = { ...this.draft, values: this.draft.values.filter((value) => value.path !== row.path) }; }}>&times;</button>
    </div>`)}${!this.draft.values.length ? html`<p class="empty">No iterations yet</p>` : nothing}</div>
    <div><button @click=${() => this.showDialog('manual')}>+ Add iteration</button></div>`;
  }

  _renderPreview() {
    const values = this.sortedValues;
    const generated = this.draft.source_type === 'generated';
    const settings = generated && this._appliedGenerator !== null ? JSON.parse(this._appliedGenerator) : null;
    const expectedDays = settings === null ? 0 : settings.length * (settings.unit === 'weeks' ? 7 : 1);
    const last = values.at(-1);
    const short = generated && last !== undefined && durationDays(last) < expectedDays;
    return html`<section class="preview" aria-label="Resulting set"><div class="section-head"><h3>Resulting set</h3>
      <span class="tag ${this.generatorPending ? '' : 'green'}">${this.generatorPending ? 'Out of date' : 'Preview'}</span></div>
      <div class="metric"><b>${values.length}</b> dated iterations</div>
      <div class="range">${values.length ? `${dateLabel(values[0].startDate)} - ${dateLabel(values.map((row) => row.finishDate).sort().at(-1))}` : 'No dates'}</div>
      ${this.generatorPending ? html`<div class="notice">Settings changed. Generate a new preview before saving.</div>` : short ? html`<div class="notice">Final iteration shortened to ${durationDays(last)} calendar days.</div>` : nothing}
      <table><thead><tr><th scope="col">Iteration</th><th scope="col">Start</th><th scope="col">End</th></tr></thead><tbody>
        ${values.map((row) => html`<tr><td>${row.name}${generated ? html`<small class=${durationDays(row) < expectedDays ? 'short' : 'muted'}><br>${durationDays(row)} calendar days${durationDays(row) < expectedDays ? ' / Short final' : ''}</small>` : nothing}</td>
          <td>${dateLabel(row.startDate)}</td><td>${dateLabel(row.finishDate)}</td></tr>`)}
      </tbody></table>${!values.length ? html`<p class="empty">${generated ? 'Generate a preview from the date settings.' : 'No dated iterations included.'}</p>` : nothing}
      <p class="preview-note">${generated ? 'Regenerating replaces the draft iterations. Saving updates the set.' : this.draft.source_type === 'ado' ? 'Fixed selection. New source iterations are not added automatically. Reload the source to review changed dates.' : 'Each iteration has its own dates. Changes are applied when you save the set.'} Existing task dates stay unchanged.</p>
    </section>`;
  }

  _renderUsage() {
    return html`<section class="secondary" role="tabpanel" id="view-usage" aria-labelledby="tab-usage"><h3>Plans using this set</h3>
      <p>Saving changes updates the available presets for these plans. Existing task dates stay unchanged.</p>
      <table><thead><tr><th>Plan</th><th>Assignment</th></tr></thead><tbody>${this.assignedPlans.map((plan) => html`<tr><td>${plan.name}</td><td>Assigned in Plans</td></tr>`)}</tbody></table>
      ${this.assignedPlans.length ? html`<div class="notice message">Reassign these plans before deleting this set.</div>` : html`<p>No plans assigned</p>`}</section>`;
  }

  _renderDetails() {
    return html`<section class="secondary" role="tabpanel" id="view-details" aria-labelledby="tab-details"><h3>Set details</h3>
      <dl><dt>Source</dt><dd>${SOURCE_LABELS[this.draft.source_type]}</dd><dt>Membership</dt><dd>Reviewed snapshot</dd>
        <dt>Last saved</dt><dd>${this.draft.cached_at === null ? 'Not saved yet' : new Date(this.draft.cached_at).toLocaleString()}</dd></dl>
      <details><summary>Technical identifiers</summary><dl><dt>Set ID (read-only)</dt><dd><code>${this.draft.id}</code></dd>
        ${this.draft.source_type === 'ado' ? html`<dt>Source project</dt><dd>${this.draft.source_project}</dd><dt>Selected source paths</dt><dd>${this.draft.selected_paths.map((path) => html`<div>${path}</div>`)}</dd>` : nothing}</dl></details>
      <button class="danger" ?disabled=${this.assignedPlans.length > 0 || !this.sets.some((set) => set.id === this.draft.id)} @click=${this.deleteSet}>Delete set</button>
      ${this.assignedPlans.length ? html`<p>Reassign the plans listed in Used by before deleting this set.</p>` : nothing}</section>`;
  }

  _onTabKey(event) {
    const tabs = ['members', 'usage', 'details'];
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.indexOf(this.activeTab);
    this.activeTab = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3];
    this.updateComplete.then(() => this.shadowRoot.getElementById(`tab-${this.activeTab}`).focus());
  }

  _renderDialog() {
    if (this.dialog === 'new') return html`<form @submit=${this.onCreate}><h3>New iteration set</h3>
      <label class="field">Set name<input name="name" required maxlength="100"></label>
      <label class="field">Source<select @change=${(event) => { this.newSource = event.target.value; if (this.newSource === 'ado') this.loadProjects(); }}>
        ${Object.entries(SOURCE_LABELS).map(([value, label]) => html`<option value=${value} .selected=${value === this.newSource}>${label}</option>`)}
      </select></label>
      ${this.newSource === 'ado' ? html`<label class="field">Azure DevOps project<select name="project" required ?disabled=${this.projectLoading}>
        <option value="">${this.projectLoading ? 'Loading projects...' : 'Select a project'}</option>${this.projects.map((project) => html`<option value=${project}>${project}</option>`)}</select></label>
        ${this.projectError ? html`<p class="notice error message">${this.projectError}</p><button type="button" @click=${this.loadProjects}>Retry projects</button>` : nothing}` : nothing}
      ${this.error ? html`<p class="notice error message" role="alert">${this.error}</p>` : nothing}
      <div class="dialog-actions"><button type="button" @click=${this.closeDialog}>Cancel</button><button class="primary" ?disabled=${this.newSource === 'ado' && (this.projectLoading || !this.projects.length)}>Create draft</button></div></form>`;
    if (this.dialog === 'rename') return html`<form @submit=${(event) => {
      event.preventDefault(); const name = String(new FormData(event.currentTarget).get('name')).trim();
      if (!name) { this.error = 'Enter a set name.'; return; }
      this.draft = { ...this.draft, name }; this.closeDialog();
    }}><h3>Rename set</h3><label class="field">Set name<input name="name" .value=${this.draft.name} required maxlength="100"></label>
      <div class="dialog-actions"><button type="button" @click=${this.closeDialog}>Cancel</button><button class="primary">Apply to draft</button></div></form>`;
    if (this.dialog === 'manual') {
      const row = this._editingRow === null ? { name: '', startDate: '', finishDate: '' } : this._editingRow;
      return html`<form @submit=${this.onManualSave}><h3>${this._editingRow === null ? 'Add iteration' : 'Edit iteration'}</h3>
        <label class="field">Iteration name<input name="name" .value=${row.name} required maxlength="100"></label>
        <label class="field">Start date<input name="start" type="date" .value=${row.startDate} required max="9999-12-31"></label>
        <label class="field">End date (inclusive)<input name="end" type="date" .value=${row.finishDate} required max="9999-12-31"></label>
        ${this.error ? html`<p class="notice error message" role="alert">${this.error}</p>` : nothing}
        <div class="dialog-actions"><button type="button" @click=${this.closeDialog}>Cancel</button><button class="primary">Apply to draft</button></div></form>`;
    }
    return nothing;
  }

  render() {
    return html`<header class="page-heading"><div><h2>Iteration sets</h2><p>Schedule presets for your plans</p></div>
      <button class="primary" ?disabled=${this.busy || this.loading} @click=${() => this.showDialog('new')}>+ New set</button></header>
      ${this.loading ? html`<p class="empty">Loading iteration sets...</p>` : html`<div class="workspace">
        <aside class="sets" aria-label="Iteration sets"><div class="eyebrow">Saved sets (${this.sets.length})</div>
          ${this.sets.map((set) => html`<button class="set-item ${this.draft !== null && this.draft.id === set.id ? 'selected' : ''}" ?disabled=${this.busy}
            @click=${() => this.selectSet(set)}><strong>${set.name}</strong><small>${SOURCE_LABELS[set.source_type]} / ${set.values.length} iterations</small>
            <small>${Object.hasOwn(this.usage, set.id) ? this.usage[set.id].length : 0} plans</small></button>`)}
          ${this.draft !== null && !this.sets.some((set) => set.id === this.draft.id) ? html`<div class="set-item selected"><strong>${this.draft.name}</strong><small>New draft</small></div>` : nothing}
        </aside>
        ${this.draft === null ? html`<div class="empty"><h3>No iteration sets</h3>${this.error ? html`<p class="notice error" role="alert">${this.error}</p><button @click=${this.loadConfig}>Retry loading</button>` : nothing}</div>` : html`
          <section class="editor" aria-label="Selected iteration set" ?inert=${this.busy}>
            <header class="editor-head"><div class="title-row"><h3>${this.draft.name}</h3><span class="tag">${SOURCE_LABELS[this.draft.source_type]}</span>
              <button class="quiet icon" title="Rename set" aria-label="Rename set" @click=${() => this.showDialog('rename')}>&#9998;</button></div>
              <p class="subline">${this.assignedPlans.length} assigned plans</p>
              <div class="tabs" role="tablist" aria-label="Set views" @keydown=${this._onTabKey}>
                ${['members', 'usage', 'details'].map((tab) => html`<button role="tab" id=${`tab-${tab}`} aria-controls=${`view-${tab}`}
                  aria-selected=${this.activeTab === tab} tabindex=${this.activeTab === tab ? '0' : '-1'} @click=${() => { this.activeTab = tab; }}>
                  ${tab === 'members' ? 'Members' : tab === 'usage' ? `Used by (${this.assignedPlans.length})` : 'Details'}</button>`)}
              </div></header>
            ${this.activeTab === 'members' ? html`<div class="members" role="tabpanel" id="view-members" aria-labelledby="tab-members">
              <section class="source" aria-label="Iteration source"><div class="section-head"><h3>${this.draft.source_type === 'ado' ? 'Source iterations' : SOURCE_LABELS[this.draft.source_type]}</h3>
                ${this.draft.source_type === 'ado' ? html`<button class="quiet icon" title="Reload source iterations" aria-label="Reload source iterations" ?disabled=${this.browseLoading} @click=${this.loadSource}>&#8635;</button>` : nothing}</div>
                ${this.draft.source_type === 'generated' ? this._renderGenerator() : this.draft.source_type === 'ado' ? this._renderAdo() : this._renderManual()}
              </section>${this._renderPreview()}</div>` : this.activeTab === 'usage' ? this._renderUsage() : this._renderDetails()}
            ${this.error ? html`<div class="notice error message" role="alert">${this.error}</div>` : nothing}
            <footer class="footer"><span class="status ${this.hasUnsavedChanges ? 'dirty' : ''}" role="status">${this.busy ? 'Saving...' : this.hasUnsavedChanges ? 'Unsaved changes' : this.status ? this.status : 'All changes saved'}</span>
              <button ?disabled=${!this.hasUnsavedChanges || this.busy} @click=${this.discardChanges}>Discard changes</button>
              <button class="primary" ?disabled=${this.busy || !this.hasUnsavedChanges || this.generatorPending || !this.draft.values.length || this.browseLoading} @click=${this.saveSet}>Save set</button></footer>
          </section>`}
      </div>`}
      <dialog @cancel=${() => { this.dialog = ''; }} aria-label=${this.dialog === 'new' ? 'New iteration set' : this.dialog === 'manual' ? 'Iteration dates' : 'Rename set'}>${this._renderDialog()}</dialog>`;
  }
}

customElements.define('admin-iterations', AdminIterations);