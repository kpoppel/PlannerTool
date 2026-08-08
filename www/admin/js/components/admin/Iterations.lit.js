import { LitElement, html, css } from '/static/js/vendor/lit.js';
import { adminProvider } from '../../services/providerREST.js';

function resultErrorMessage(result, fallback = 'Request failed') {
  if (result?.error?.message) return result.error.message;
  if (typeof result?.error === 'string') return result.error;
  return fallback;
}

/**
 * AdminIterations - Manage iteration sets configuration.
 */
export class AdminIterations extends LitElement {
  static styles = css`
    :host {
      display: block;
      height: 100%;
    }
    h2 {
      margin-top: 0;
      font-size: 1.1rem;
    }

    .container {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      height: calc(100vh - 160px);
    }

    .panel {
      padding: 12px;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .panel h3 {
      margin: 0 0 12px 0;
      font-size: 1rem;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 8px;
    }

    .browser {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }

    .browser-controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
    }

    .browser-controls input,
    .browser-controls select {
      flex: 1 1 220px;
      min-width: 180px;
      padding: 6px 10px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 0.9rem;
    }

    .browser-controls input {
      flex: 2 1 320px;
    }

    .browser-controls button {
      padding: 6px 12px;
      border-radius: 4px;
      border: 1px solid #ccc;
      background: #f3f4f6;
      cursor: pointer;
      font-size: 0.9rem;
    }

    .browser-controls button:hover {
      background: #e5e7eb;
    }

    .iterations-list {
      flex: 1;
      overflow-y: auto;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      padding: 8px;
      background: #fafafa;
    }

    .iteration-item {
      padding: 8px;
      margin-bottom: 4px;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      font-size: 0.85rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .iteration-item .path {
      font-family: monospace;
      font-weight: 500;
      word-break: break-word;
    }

    .iteration-item .dates {
      font-size: 0.8rem;
      color: #6b7280;
    }

    .iteration-item.selected {
      border-color: #3b82f6;
      background: #eff6ff;
    }

    .browser-actions {
      margin-top: 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }

    .selection-summary {
      font-size: 0.85rem;
      color: #4b5563;
    }

    .set-row {
      border: 1px solid #e6e6e6;
      border-radius: 8px;
      padding: 10px;
      margin-bottom: 10px;
      background: #f9fafb;
    }

    .set-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .set-grid input {
      width: 100%;
      box-sizing: border-box;
      padding: 6px 8px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 0.9rem;
      background: #fff;
    }

    .set-meta {
      font-size: 0.82rem;
      color: #4b5563;
      margin-top: 6px;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    .set-actions {
      margin-top: 8px;
      display: flex;
      gap: 8px;
    }

    .set-actions button {
      border: 1px solid #e6e6e6;
      background: #fff;
      padding: 5px 8px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.82rem;
      white-space: nowrap;
    }

    .btn-danger {
      background: #fee2e2;
      border-color: #fecaca;
      color: #991b1b;
    }

    .btn-muted {
      background: #f9fafb;
      border-color: #e5e7eb;
    }

    .notice {
      margin: 8px 0 12px 0;
      padding: 8px 10px;
      border: 1px solid #fcd34d;
      background: #fffbeb;
      border-radius: 6px;
      color: #92400e;
      font-size: 0.86rem;
    }

    .config-editor {
      flex: 1;
      overflow-y: auto;
    }

    .config-section {
      margin-bottom: 16px;
    }

    .config-section label {
      display: block;
      font-weight: 500;
      margin-bottom: 4px;
      font-size: 0.9rem;
    }

    .actions {
      display: flex;
      gap: 8px;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
    }

    button.primary {
      padding: 8px 16px;
      border-radius: 6px;
      background: #3b82f6;
      color: #fff;
      border: 1px solid #3b82f6;
      cursor: pointer;
      font-size: 0.9rem;
    }

    button.primary:hover {
      background: #2563eb;
    }

    .status {
      margin-left: 8px;
      font-size: 0.9rem;
      color: #333;
    }

    .status.success {
      color: #10b981;
    }
    .status.error {
      color: #ef4444;
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px;
      color: #6b7280;
    }

    .toggle-mode {
      margin-left: auto;
      font-size: 0.85rem;
      padding: 6px 12px;
    }

    .raw-editor {
      flex: 1;
      min-height: 0;
    }

    .raw-editor textarea {
      width: 100%;
      height: 100%;
      font-family: monospace;
      padding: 8px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      resize: none;
    }
  `;

  static properties = {
    config: { type: Object },
    browsedIterations: { type: Array },
    browseProject: { type: String },
    browseProjects: { type: Array },
    filterText: { type: String },
    selectedPaths: { type: Object },
    loading: { type: Boolean },
    statusMsg: { type: String },
    statusType: { type: String },
    useRawMode: { type: Boolean },
  };

  constructor() {
    super();
    this.config = {
      iteration_sets: [],
    };
    this.browsedIterations = [];
    this.browseProject = '';
    this.browseProjects = [];
    this.filterText = '';
    this.selectedPaths = new Set();
    this.loading = false;
    this.statusMsg = '';
    this.statusType = '';
    this.useRawMode = false;
  }

  get filteredIterations() {
    const list = Array.isArray(this.browsedIterations) ? this.browsedIterations : [];
    const q = String(this.filterText || '').trim().toLowerCase();
    if (!q) return list;
    return list.filter((it) => this.stripIterationPrefix(it?.path || '').toLowerCase().includes(q));
  }

  normalizeConfig(rawConfig) {
    const base = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};

    const rawSets = Array.isArray(base.iteration_sets) ? base.iteration_sets : [];
    const normalizedSets = rawSets
      .filter((s) => s && typeof s === 'object')
      .map((s) => ({
        id: String(s.id || '').trim(),
        name: String(s.name || s.id || '').trim(),
        source_project: String(s.source_project || '').trim(),
        root_path: s.root_path ? String(s.root_path).trim() : '',
        values: Array.isArray(s.values) ? s.values : [],
        cached_at: s.cached_at || null,
      }))
      .filter((s) => s.id && s.source_project);

    return {
      iteration_sets: normalizedSets,
    };
  }

  connectedCallback() {
    super.connectedCallback();
    this.loadConfig();
    this.loadBrowseProjects();
  }

  async loadConfig() {
    this.loading = true;
    try {
      const result = await adminProvider.getIterations();
      if (!result?.ok) {
        throw new Error(resultErrorMessage(result, 'Failed to load iterations config'));
      }
      this.config = this.normalizeConfig(result.data);
      this.statusMsg = '';
    } catch (e) {
      this.statusMsg = 'Error loading iterations config';
      this.statusType = 'error';
    } finally {
      this.loading = false;
    }
  }

  async loadBrowseProjects() {
    try {
      const adoResult = await adminProvider.getAdo();
      if (!adoResult?.ok) {
        throw new Error(resultErrorMessage(adoResult, 'Failed to load ADO configuration'));
      }
      const org = (adoResult.data && adoResult.data.organization_url) || '';
      const result = await adminProvider.browseAzureProjects(org);
      if (!result?.ok) {
        throw new Error(resultErrorMessage(result, 'Failed to browse Azure projects'));
      }
      this.browseProjects = Array.isArray(result?.data?.projects) ? result.data.projects : [];
      if (!this.browseProject && this.browseProjects.length > 0) {
        this.browseProject = this.browseProjects[0];
      }
      if (this.browseProject) {
        await this.browseIterations();
      }
    } catch (e) {
      console.error('Failed to load Azure projects:', e);
      this.browseProjects = [];
    }
  }

  async browseIterations() {
    if (!this.browseProject) {
      this.browsedIterations = [];
      this.selectedPaths = new Set();
      return;
    }

    this.statusMsg = 'Browsing...';
    this.statusType = '';
    try {
      const result = await adminProvider.browseIterations({
        project: this.browseProject,
        depth: 10,
      });
      if (!result?.ok) {
        throw new Error(resultErrorMessage(result, 'Failed to browse iterations'));
      }
      this.browsedIterations = Array.isArray(result?.data?.iterations) ? result.data.iterations : [];
      this.selectedPaths = new Set();
      this.statusMsg = `Found ${this.browsedIterations.length} iterations`;
      this.statusType = 'success';
      setTimeout(() => {
        this.statusMsg = '';
      }, 3000);
    } catch (e) {
      this.statusMsg = 'Error browsing iterations';
      this.statusType = 'error';
      this.browsedIterations = [];
    }
  }

  // Strip project\Iteration\ prefix from path for display.
  stripIterationPrefix(path) {
    if (!path) return path;
     const normalized = String(path).replace(/\//g, '\\');
    const parts = normalized.split('\\').filter(Boolean);
    if (parts.length === 0) return normalized;

    let idx = 0;
    if (this.browseProject && parts[0].toLowerCase() === String(this.browseProject).toLowerCase()) {
      idx = 1;
    }
    if (parts[idx] && /^iterations?$/i.test(parts[idx])) {
      idx += 1;
    }
    const stripped = parts.slice(idx).join('\\');
    return stripped || normalized;
  }

  _newSetId() {
    if (globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID();
    }
    return `set_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  toggleSelectPath(path) {
    const next = new Set(this.selectedPaths || []);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    this.selectedPaths = next;
  }

  _selectedIterationValues() {
    const roots = Array.from(this.selectedPaths || []);
    if (roots.length === 0) return [];

    const byPath = new Map();
    for (const it of this.browsedIterations || []) {
      const path = String(it?.path || '');
      if (!path) continue;
      const include = roots.some((root) => path === root || path.startsWith(`${root}\\`));
      if (include && !byPath.has(path)) byPath.set(path, it);
    }
    return Array.from(byPath.values());
  }

  saveAsNewIterationSet() {
    if (!this.browseProject) {
      this.statusMsg = 'Select an Azure project first';
      this.statusType = 'error';
      return;
    }
    if ((this.selectedPaths || new Set()).size === 0) {
      this.statusMsg = 'Select one or more iteration paths from the list first';
      this.statusType = 'error';
      return;
    }

    const values = this._selectedIterationValues();
    if (values.length === 0) {
      this.statusMsg = 'No iteration values matched your selection';
      this.statusType = 'error';
      return;
    }

    const selectedRoots = Array.from(this.selectedPaths || []);
    const rootLabels = selectedRoots.map((p) => this.stripIterationPrefix(p));
    const leaf = rootLabels[0]?.split('\\').pop() || 'Iterations';
    const next = {
      id: this._newSetId(),
      name: rootLabels.length === 1 ? `Iterations (${leaf})` : `Iterations (${rootLabels.length} roots)`,
      source_project: this.browseProject,
      root_path: rootLabels.length === 1 ? rootLabels[0] : null,
      values,
      cached_at: new Date().toISOString(),
    };

    this.config = {
      ...this.config,
      iteration_sets: [...(this.config.iteration_sets || []), next],
    };
    this.statusMsg = `Added set ${next.name} with ${values.length} iterations`;
    this.statusType = 'success';
    this.selectedPaths = new Set();
  }

  updateSetField(index, key, value) {
    const next = [...(this.config.iteration_sets || [])];
    next[index] = { ...next[index], [key]: value };
    this.config = { ...this.config, iteration_sets: next };
  }

  async deleteSet(index) {
    const set = (this.config.iteration_sets || [])[index];
    if (!set) return;
    const ok = confirm(`Delete iteration set "${set.name || set.id}"?`);
    if (!ok) return;

    const result = await adminProvider.deleteIterationSet(set.id);
    if (result?.ok) {
      const next = [...(this.config.iteration_sets || [])];
      next.splice(index, 1);
      this.config = { ...this.config, iteration_sets: next };
      this.statusMsg = 'Iteration set deleted';
      this.statusType = 'success';
      return;
    }

    const status = result?.error?.status;
    const detail = result?.error?.detail;
    if (status === 409 && detail?.error === 'referenced_by_projects') {
      const names = (detail.projects || []).map((p) => p.name || p.id).filter(Boolean);
      const msg = names.length > 0
        ? `This set is associated to: ${names.join(', ')}.\n\nUnassociate all and delete?`
        : 'This set is associated to one or more projects. Unassociate all and delete?';
      const proceed = confirm(msg);
      if (!proceed) return;

      const unassoc = await adminProvider.unassociateAllIterations(set.id);
      if (!unassoc?.ok) {
        this.statusMsg = 'Failed to unassociate projects';
        this.statusType = 'error';
        return;
      }

      const retry = await adminProvider.deleteIterationSet(set.id);
      if (retry?.ok) {
        const next = [...(this.config.iteration_sets || [])];
        next.splice(index, 1);
        this.config = { ...this.config, iteration_sets: next };
        this.statusMsg = 'Unassociated projects and deleted set';
        this.statusType = 'success';
        return;
      }
    }

    this.statusMsg = result?.error?.message || result?.error || 'Error deleting set';
    this.statusType = 'error';
  }

  async saveConfig() {
    this.statusMsg = 'Saving...';
    this.statusType = '';

    try {
      // Parse from raw JSON if in raw mode
      if (this.useRawMode) {
        const textarea = this.shadowRoot.querySelector('.raw-editor textarea');
        if (textarea) {
          try {
            this.config = this.normalizeConfig(JSON.parse(textarea.value));
          } catch (e) {
            this.statusMsg = 'Invalid JSON: ' + e.message;
            this.statusType = 'error';
            return;
          }
        }
      }

      const result = await adminProvider.saveIterations(this.config);
      if (!result?.ok) {
        this.statusMsg = result?.error?.message || result?.error || 'Error saving';
        this.statusType = 'error';
        return;
      }
      this.statusMsg = 'Saved successfully';
      this.statusType = 'success';
      setTimeout(() => {
        this.statusMsg = '';
      }, 3000);
    } catch (e) {
      this.statusMsg = 'Error saving';
      this.statusType = 'error';
    }
  }

  toggleMode() {
    this.useRawMode = !this.useRawMode;
  }

  render() {
    if (this.loading) {
      return html`<div class="loading">Loading iterations configuration...</div>`;
    }

    return html`
      <section>
        <h2>Iterations Configuration</h2>
        <div class="container">
          <!-- Left panel: Browse iterations -->
          <div class="panel">
            <h3>Browse Iterations</h3>
            <div class="browser">
              <div class="browser-controls">
                <select
                  .value="${this.browseProject}"
                  @change="${async (e) => {
                    this.browseProject = e.target.value;
                    await this.browseIterations();
                  }}"
                >
                  <option value="">Select Azure project</option>
                  ${this.browseProjects.map((proj) => html`<option value="${proj}">${proj}</option>`)}
                </select>
                <input
                  type="text"
                  placeholder="Filter iteration paths"
                  .value="${this.filterText}"
                  @input="${(e) => {
                    this.filterText = e.target.value;
                  }}"
                />
              </div>

              <div class="iterations-list">
                ${this.filteredIterations.length === 0 ?
                  html`
                    <div style="text-align: center; color: #6b7280; padding: 20px;">
                      ${this.browseProject
                        ? (this.filterText ? `No matches for "${this.filterText}"` : 'No iterations found')
                        : 'Select an Azure project'}
                    </div>
                  `
                : this.filteredIterations.map(
                    (it) => html`
                      <div
                        class="iteration-item ${this.selectedPaths.has(it.path) ? 'selected' : ''}"
                      >
                        <div>
                          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                            <input
                              type="checkbox"
                              .checked="${this.selectedPaths.has(it.path)}"
                              @change="${() => this.toggleSelectPath(it.path || '')}"
                            />
                            <span class="path">${this.stripIterationPrefix(it.path)}</span>
                          </label>
                          ${it.startDate || it.finishDate ?
                            html`
                              <div class="dates">
                                ${it.startDate ? `Start: ${it.startDate}` : ''}
                                ${it.finishDate ? `End: ${it.finishDate}` : ''}
                              </div>
                            `
                          : ''}
                        </div>
                      </div>
                    `
                  )}
              </div>

              <div class="browser-actions">
                <div class="selection-summary">
                  ${(this.selectedPaths || new Set()).size} selected path(s)
                </div>
                <button class="btn-muted" @click="${this.saveAsNewIterationSet}">
                  Make Set from Selection
                </button>
              </div>
            </div>
          </div>

          <!-- Right panel: Configuration -->
          <div class="panel">
            <div
              style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px;"
            >
              <h3 style="margin: 0;">Configuration</h3>
              <button class="toggle-mode" @click="${this.toggleMode}">
                ${this.useRawMode ? 'Form Mode' : 'Raw JSON'}
              </button>
            </div>
            ${this.useRawMode ?
              html`
                <div class="raw-editor">
                  <textarea
                    .value="${JSON.stringify(this.config, null, 2)}"
                    @input="${(e) => {
                      try {
                        this.config = this.normalizeConfig(JSON.parse(e.target.value));
                      } catch (err) {
                        // Keep typing, don't update until valid
                      }
                    }}"
                  ></textarea>
                </div>
              `
            : html`
                <div class="config-editor">
                  <div class="config-section">
                    <label>Configured Iteration Sets</label>
                    ${this.config.iteration_sets.length === 0
                      ? html`<div class="notice" style="border-color:#e5e7eb;background:#f9fafb;color:#4b5563;">No iteration sets yet. Browse and save one from the left panel.</div>`
                      : this.config.iteration_sets.map(
                          (set, idx) => html`
                            <div class="set-row">
                              <div class="set-grid">
                                <input
                                  type="text"
                                  .value="${set.name || ''}"
                                  @input="${(e) => this.updateSetField(idx, 'name', e.target.value)}"
                                  placeholder="Set name"
                                />
                                <input
                                  type="text"
                                  .value="${set.source_project || ''}"
                                  @input="${(e) => this.updateSetField(idx, 'source_project', e.target.value)}"
                                  placeholder="Source Azure project"
                                />
                                <input
                                  type="text"
                                  .value="${set.root_path || ''}"
                                  @input="${(e) => this.updateSetField(idx, 'root_path', e.target.value)}"
                                  placeholder="Root path (optional)"
                                />
                                <input
                                  type="text"
                                  .value="${set.id || ''}"
                                  @input="${(e) => this.updateSetField(idx, 'id', e.target.value)}"
                                  placeholder="Set ID"
                                />
                              </div>
                              <div class="set-meta">
                                <span>values: ${Array.isArray(set.values) ? set.values.length : 0}</span>
                                <span>cached: ${set.cached_at || 'n/a'}</span>
                              </div>
                              <div class="set-actions">
                                <button class="btn-danger" @click="${() => this.deleteSet(idx)}">Delete</button>
                              </div>
                            </div>
                          `
                        )}
                  </div>

                  <div class="actions">
                    <button class="primary" @click="${this.saveConfig}">
                      Save Configuration
                    </button>
                    ${this.statusMsg ?
                      html`
                        <span class="status ${this.statusType}">${this.statusMsg}</span>
                      `
                    : ''}
                  </div>
                </div>
              `}
          </div>
        </div>
      </section>
    `;
  }
}

customElements.define('admin-iterations', AdminIterations);
