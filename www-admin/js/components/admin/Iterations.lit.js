import { LitElement, html, css } from '/static/js/vendor/lit.js';
import { adminProvider } from '../../services/providerREST.js';

/**
 * AdminIterations - Manage rule-based iteration resolution (schema v2).
 *
 * This component allows admins to:
 * - Browse available iterations for an Azure project/root
 * - Edit default source/roots and matching rules
 * - Preview effective resolution for configured projects
 * - Migrate legacy iterations config to v2 shape
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
      display: grid;
      grid-template-columns: 1fr 1fr auto;
      gap: 8px;
      margin-bottom: 12px;
    }

    .browser-controls input {
      padding: 6px 10px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 0.9rem;
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
    }

    .iteration-item .path {
      font-family: monospace;
      font-weight: 500;
    }

    .iteration-item .dates {
      font-size: 0.8rem;
      color: #6b7280;
      margin-top: 2px;
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
      font-weight: 600;
      margin-bottom: 6px;
      font-size: 0.9rem;
    }

    .small-note {
      color: #6b7280;
      font-size: 0.82rem;
      margin-bottom: 8px;
    }

    .root-item,
    .field-row {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 6px;
    }

    .root-item input,
    .field-row input,
    .field-row select {
      flex: 1;
      padding: 6px 8px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 0.85rem;
      box-sizing: border-box;
    }

    .rule-card {
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 10px;
      background: #f9fafb;
      margin-bottom: 10px;
    }

    .rule-header {
      display: flex;
      gap: 8px;
      margin-bottom: 8px;
      align-items: center;
    }

    .rule-header .rule-id {
      flex: 1;
      font-family: monospace;
      font-size: 0.84rem;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
    }

    button {
      padding: 6px 12px;
      border-radius: 6px;
      border: 1px solid #ccc;
      background: #f3f4f6;
      cursor: pointer;
      font-size: 0.85rem;
    }

    button:hover {
      background: #e5e7eb;
    }

    button.primary {
      background: #3b82f6;
      border-color: #3b82f6;
      color: #fff;
    }

    button.primary:hover {
      background: #2563eb;
    }

    .status {
      margin-left: 8px;
      font-size: 0.9rem;
    }

    .status.success {
      color: #10b981;
    }

    .status.error {
      color: #ef4444;
    }

    .warn-list {
      margin: 8px 0;
      padding: 8px;
      border: 1px solid #f59e0b;
      background: #fffbeb;
      border-radius: 4px;
      color: #92400e;
      font-size: 0.82rem;
    }

    .error-list {
      margin: 8px 0;
      padding: 8px;
      border: 1px solid #ef4444;
      background: #fef2f2;
      border-radius: 4px;
      color: #991b1b;
      font-size: 0.82rem;
    }

    .preview-list {
      margin-top: 10px;
      border-top: 1px solid #e5e7eb;
      padding-top: 10px;
      max-height: 280px;
      overflow: auto;
    }

    .preview-item {
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      padding: 8px;
      margin-bottom: 6px;
      background: #fff;
      font-size: 0.82rem;
    }

    .preview-title {
      font-weight: 600;
      margin-bottom: 4px;
    }

    .preview-root-ok {
      color: #047857;
    }

    .preview-root-error {
      color: #b91c1c;
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
      box-sizing: border-box;
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px;
      color: #6b7280;
    }
  `;

  static properties = {
    config: { type: Object },
    browsedIterations: { type: Array },
    browseProject: { type: String },
    browseRoot: { type: String },
    loading: { type: Boolean },
    statusMsg: { type: String },
    statusType: { type: String },
    useRawMode: { type: Boolean },
    configuredProjects: { type: Array },
    validationWarnings: { type: Array },
    validationErrors: { type: Array },
    previewResult: { type: Object },
  };

  constructor() {
    super();
    this.config = this._emptyConfig();
    this.browsedIterations = [];
    this.browseProject = '';
    this.browseRoot = '';
    this.loading = false;
    this.statusMsg = '';
    this.statusType = '';
    this.useRawMode = false;
    this.configuredProjects = [];
    this.validationWarnings = [];
    this.validationErrors = [];
    this.previewResult = null;
  }

  _emptyConfig() {
    return {
      schema_version: 2,
      default: {
        source_project: '',
        roots: [],
      },
      rules: [],
    };
  }

  normalizeConfig(rawConfig) {
    const base = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
    const defaultObj =
      base.default && typeof base.default === 'object' ?
        base.default
      : {};

    const rules = Array.isArray(base.rules) ? base.rules : [];
    const normalizedRules = rules
      .filter((r) => r && typeof r === 'object')
      .map((rule, index) => {
        const match = rule.match && typeof rule.match === 'object' ? rule.match : {};
        return {
          rule_id: String(rule.rule_id || rule.id || `rule-${index + 1}`),
          enabled: rule.enabled !== false,
          priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : 100,
          match: {
            project_names: this._asList(match.project_names, match.project_name),
            area_path_prefixes: this._asList(match.area_path_prefixes, match.area_path_prefix),
          },
          source_project: String(rule.source_project || rule.azure_project || ''),
          roots: this._asList(rule.roots),
        };
      });

    return {
      schema_version: 2,
      default: {
        source_project: String(defaultObj.source_project || base.azure_project || ''),
        roots: this._asList(defaultObj.roots, base.default_roots),
      },
      rules: normalizedRules,
    };
  }

  _asList(primary, fallback = null) {
    const value = primary ?? fallback;
    if (Array.isArray(value)) {
      return value
        .map((v) => String(v || '').trim())
        .filter((v) => !!v);
    }
    if (typeof value === 'string' && value.trim()) {
      return [value.trim()];
    }
    return [];
  }

  connectedCallback() {
    super.connectedCallback();
    this.loadConfig();
    this.loadProjects();
  }

  async loadConfig() {
    this.loading = true;
    try {
      const data = await adminProvider.getIterations();
      const content = data && data.content ? data.content : data;
      this.config = this.normalizeConfig(content);
      this.validationWarnings = data?.validation?.warnings || [];
      this.validationErrors = data?.validation?.errors || [];
      if (this.config.default.source_project && !this.browseProject) {
        this.browseProject = this.config.default.source_project;
      }
      this.statusMsg = '';
    } catch (e) {
      this.statusMsg = 'Error loading iterations config';
      this.statusType = 'error';
    } finally {
      this.loading = false;
    }
  }

  async loadProjects() {
    try {
      const data = await adminProvider.getProjects();
      const map = data?.project_map || [];
      const names = new Set();
      map.forEach((p) => {
        if (p?.name) names.add(p.name);
      });
      this.configuredProjects = Array.from(names).sort();
    } catch (e) {
      console.error('Failed to load projects:', e);
      this.configuredProjects = [];
    }
  }

  async browseIterations() {
    if (!this.browseProject || !this.browseProject.trim()) {
      this.statusMsg = 'Browse project is required';
      this.statusType = 'error';
      return;
    }
    this.statusMsg = 'Browsing...';
    this.statusType = '';
    try {
      let fullRootPath = null;
      if (this.browseRoot && this.browseRoot.trim()) {
        fullRootPath = `${this.browseProject}\\Iteration\\${this.browseRoot.trim()}`;
      }

      const result = await adminProvider.browseIterations({
        project: this.browseProject.trim(),
        root_path: fullRootPath,
        depth: 10,
      });
      this.browsedIterations = result.iterations || [];
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

  stripIterationPrefix(path) {
    if (!path) return path;
    const match = path.match(/^(.+?)\\Iteration\\(.+)$/);
    return match ? match[2] : path;
  }

  addDefaultRoot() {
    this.config.default.roots = [...(this.config.default.roots || []), ''];
    this.requestUpdate();
  }

  updateDefaultRoot(index, value) {
    const roots = [...(this.config.default.roots || [])];
    roots[index] = value;
    this.config.default.roots = roots;
    this.requestUpdate();
  }

  removeDefaultRoot(index) {
    this.config.default.roots = (this.config.default.roots || []).filter((_, i) => i !== index);
    this.requestUpdate();
  }

  addRule() {
    this.config.rules = [
      ...(this.config.rules || []),
      {
        rule_id: `rule-${(this.config.rules || []).length + 1}`,
        enabled: true,
        priority: 100,
        match: {
          project_names: [],
          area_path_prefixes: [],
        },
        source_project: this.config.default.source_project || '',
        roots: [],
      },
    ];
    this.requestUpdate();
  }

  removeRule(index) {
    this.config.rules = (this.config.rules || []).filter((_, i) => i !== index);
    this.requestUpdate();
  }

  updateRule(index, patch) {
    const rules = [...(this.config.rules || [])];
    rules[index] = { ...rules[index], ...patch };
    this.config.rules = rules;
    this.requestUpdate();
  }

  updateRuleMatchCsv(index, key, value) {
    const rule = (this.config.rules || [])[index] || {};
    const match = rule.match && typeof rule.match === 'object' ? { ...rule.match } : {};
    const parts = value
      .split(',')
      .map((x) => x.trim())
      .filter((x) => !!x);
    match[key] = parts;
    this.updateRule(index, { match });
  }

  addRuleRoot(index) {
    const rule = (this.config.rules || [])[index] || { roots: [] };
    this.updateRule(index, { roots: [...(rule.roots || []), ''] });
  }

  updateRuleRoot(index, rootIndex, value) {
    const rule = (this.config.rules || [])[index] || { roots: [] };
    const roots = [...(rule.roots || [])];
    roots[rootIndex] = value;
    this.updateRule(index, { roots });
  }

  removeRuleRoot(index, rootIndex) {
    const rule = (this.config.rules || [])[index] || { roots: [] };
    const roots = (rule.roots || []).filter((_, i) => i !== rootIndex);
    this.updateRule(index, { roots });
  }

  async saveConfig() {
    this.statusMsg = 'Saving...';
    this.statusType = '';

    try {
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
      this.validationWarnings = result?.validation?.warnings || [];
      this.validationErrors = result?.validation?.errors || [];
      this.statusMsg = 'Saved successfully';
      this.statusType = 'success';
      setTimeout(() => {
        this.statusMsg = '';
      }, 3000);
    } catch (e) {
      const detail = e?.message || '';
      this.statusMsg = detail ? `Error saving: ${detail}` : 'Error saving';
      this.statusType = 'error';
    }
  }

  async migrateToV2() {
    this.statusMsg = 'Migrating...';
    this.statusType = '';
    try {
      const result = await adminProvider.migrateIterations({ dry_run: false });
      this.config = this.normalizeConfig(result.content || {});
      this.validationWarnings = result?.validation?.warnings || [];
      this.validationErrors = result?.validation?.errors || [];
      this.statusMsg = 'Migration completed';
      this.statusType = 'success';
    } catch (e) {
      this.statusMsg = 'Migration failed';
      this.statusType = 'error';
    }
  }

  async previewResolution() {
    this.statusMsg = 'Previewing resolution...';
    this.statusType = '';
    try {
      const result = await adminProvider.previewIterationsResolution({
        content: this.config,
        fetch: true,
      });
      this.previewResult = result;
      this.validationWarnings = result?.validation?.warnings || this.validationWarnings;
      this.statusMsg = 'Resolution preview updated';
      this.statusType = 'success';
    } catch (e) {
      this.previewResult = null;
      this.statusMsg = 'Failed to preview resolution';
      this.statusType = 'error';
    }
  }

  toggleMode() {
    this.useRawMode = !this.useRawMode;
  }

  _renderValidation() {
    return html`
      ${this.validationErrors && this.validationErrors.length ?
        html`
          <div class="error-list">
            <div><strong>Validation errors:</strong></div>
            ${this.validationErrors.map((w) => html`<div>- ${w}</div>`)}
          </div>
        `
      : ''}
      ${this.validationWarnings && this.validationWarnings.length ?
        html`
          <div class="warn-list">
            <div><strong>Validation warnings:</strong></div>
            ${this.validationWarnings.map((w) => html`<div>- ${w}</div>`)}
          </div>
        `
      : ''}
    `;
  }

  _renderPreview() {
    if (!this.previewResult) return '';
    const summary = this.previewResult.summary || {};
    const projects = this.previewResult.projects || [];

    return html`
      <div class="preview-list">
        <div class="small-note">
          Preview: ${summary.projectCount || 0} projects, ${summary.totalIterations || 0} iterations,
          ${summary.fetchErrors || 0} root errors.
        </div>
        ${projects.map(
          (project) => html`
            <div class="preview-item">
              <div class="preview-title">${project.projectName || project.projectId}</div>
              <div>Area: ${project.areaPath || '—'}</div>
              <div>Rule: ${project.resolution?.matchedRuleId || 'default fallback'}</div>
              <div>Source: ${project.resolution?.sourceProject || '—'}</div>
              <div>Roots: ${(project.resolution?.roots || []).join(', ') || '—'}</div>
              ${(project.fetch?.roots || []).map(
                (rootResult) => html`
                  <div class="${rootResult.ok ? 'preview-root-ok' : 'preview-root-error'}">
                    ${rootResult.ok ? 'OK' : 'ERR'} ${rootResult.fullRootPath || '(default root)'}
                    ${rootResult.ok ? `(${rootResult.count})` : `(${rootResult.error || 'error'})`}
                  </div>
                `
              )}
            </div>
          `
        )}
      </div>
    `;
  }

  _renderRulesForm() {
    return html`
      <div class="config-section">
        <label>Default Source Project</label>
        <div class="field-row">
          <input
            type="text"
            .value="${this.config.default.source_project || ''}"
            @input="${(e) => {
              this.config.default.source_project = e.target.value;
              this.requestUpdate();
            }}"
            placeholder="e.g. Platform_Development"
          />
        </div>
      </div>

      <div class="config-section">
        <label>Default Roots</label>
        <div class="small-note">
          Relative to &lt;source_project&gt;\\Iteration\\... (e.g. eSW\\Platform)
        </div>
        ${(this.config.default.roots || []).map(
          (root, index) => html`
            <div class="root-item">
              <input
                type="text"
                .value="${root}"
                @input="${(e) => this.updateDefaultRoot(index, e.target.value)}"
                placeholder="e.g. eSW\\Platform"
              />
              <button @click="${() => this.removeDefaultRoot(index)}">Remove</button>
            </div>
          `
        )}
        <button @click="${this.addDefaultRoot}">+ Add Default Root</button>
      </div>

      <div class="config-section">
        <label>Rules</label>
        <div class="small-note">
          Highest priority wins. Area-prefix specificity is used as tie-breaker.
        </div>
        ${(this.config.rules || []).map(
          (rule, index) => html`
            <div class="rule-card">
              <div class="rule-header">
                <input
                  class="rule-id"
                  type="text"
                  .value="${rule.rule_id || ''}"
                  @input="${(e) => this.updateRule(index, { rule_id: e.target.value })}"
                  placeholder="rule id"
                />
                <label>
                  <input
                    type="checkbox"
                    .checked="${rule.enabled !== false}"
                    @change="${(e) => this.updateRule(index, { enabled: e.target.checked })}"
                  />
                  Enabled
                </label>
                <button @click="${() => this.removeRule(index)}">Remove Rule</button>
              </div>

              <div class="field-row">
                <label style="min-width: 70px;">Priority</label>
                <input
                  type="number"
                  .value="${rule.priority ?? 100}"
                  @input="${(e) =>
                    this.updateRule(index, { priority: Number.parseInt(e.target.value || '100', 10) })}"
                />
              </div>

              <div class="field-row">
                <label style="min-width: 70px;">Source</label>
                <input
                  type="text"
                  .value="${rule.source_project || ''}"
                  @input="${(e) => this.updateRule(index, { source_project: e.target.value })}"
                  placeholder="ADO source project"
                />
              </div>

              <div class="field-row">
                <label style="min-width: 70px;">Projects</label>
                <input
                  type="text"
                  .value="${(rule.match?.project_names || []).join(', ')}"
                  @input="${(e) =>
                    this.updateRuleMatchCsv(index, 'project_names', e.target.value)}"
                  placeholder="Configured project names (comma-separated)"
                />
              </div>

              <div class="field-row">
                <label style="min-width: 70px;">Areas</label>
                <input
                  type="text"
                  .value="${(rule.match?.area_path_prefixes || []).join(', ')}"
                  @input="${(e) =>
                    this.updateRuleMatchCsv(index, 'area_path_prefixes', e.target.value)}"
                  placeholder="Area path prefixes (comma-separated)"
                />
              </div>

              <div class="small-note">Rule roots (relative path parts)</div>
              ${(rule.roots || []).map(
                (root, rootIndex) => html`
                  <div class="root-item">
                    <input
                      type="text"
                      .value="${root}"
                      @input="${(e) => this.updateRuleRoot(index, rootIndex, e.target.value)}"
                      placeholder="e.g. eSW\\Teams\\Dalton"
                    />
                    <button @click="${() => this.removeRuleRoot(index, rootIndex)}">Remove</button>
                  </div>
                `
              )}
              <button @click="${() => this.addRuleRoot(index)}">+ Add Rule Root</button>
            </div>
          `
        )}
        <button @click="${this.addRule}">+ Add Rule</button>
      </div>
    `;
  }

  render() {
    if (this.loading) {
      return html`<div class="loading">Loading iterations configuration...</div>`;
    }

    return html`
      <section>
        <h2>Iterations Configuration (Rule-Based)</h2>
        <div class="container">
          <div class="panel">
            <h3>Browse Iterations</h3>
            <div class="browser">
              <div class="browser-controls">
                <input
                  type="text"
                  placeholder="Azure project"
                  .value="${this.browseProject}"
                  @input="${(e) => {
                    this.browseProject = e.target.value;
                  }}"
                />
                <input
                  type="text"
                  placeholder="Root path (optional)"
                  .value="${this.browseRoot}"
                  @input="${(e) => {
                    this.browseRoot = e.target.value;
                  }}"
                />
                <button @click="${this.browseIterations}">Browse</button>
              </div>

              <div class="iterations-list">
                ${this.browsedIterations.length === 0 ?
                  html`
                    <div style="text-align: center; color: #6b7280; padding: 20px;">
                      Enter project and click Browse
                    </div>
                  `
                : this.browsedIterations.map(
                    (it) => html`
                      <div class="iteration-item">
                        <div class="path">${this.stripIterationPrefix(it.path)}</div>
                        ${it.startDate || it.finishDate ?
                          html`
                            <div class="dates">
                              ${it.startDate ? `Start: ${it.startDate}` : ''}
                              ${it.finishDate ? ` End: ${it.finishDate}` : ''}
                            </div>
                          `
                        : ''}
                      </div>
                    `
                  )}
              </div>
            </div>
          </div>

          <div class="panel">
            <div
              style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px;"
            >
              <h3 style="margin: 0;">Rules Editor</h3>
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
                        // Keep typing
                      }
                    }}"
                  ></textarea>
                </div>
              `
            : html`
                <div class="config-editor">
                  ${this._renderValidation()}
                  ${this._renderRulesForm()}
                </div>
              `}

            <div class="actions">
              <button class="primary" @click="${this.saveConfig}">Save Configuration</button>
              <button @click="${this.previewResolution}">Test Rules</button>
              <button @click="${this.migrateToV2}">Migrate Legacy to V2</button>
              ${this.statusMsg ? html`<span class="status ${this.statusType}">${this.statusMsg}</span>` : ''}
            </div>
            ${this._renderPreview()}
          </div>
        </div>
      </section>
    `;
  }
}

customElements.define('admin-iterations', AdminIterations);
