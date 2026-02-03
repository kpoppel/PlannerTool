import { LitElement, html, css } from '/static/js/vendor/lit.js';
import { adminProvider } from '../../services/providerREST.js';

/**
 * AdminIterations - Manage iteration root paths configuration
 * 
 * This component allows admins to:
 * - Browse available iterations for a project
 * - Configure default iteration root paths
 * - Set project-specific overrides
 */
export class AdminIterations extends LitElement {
  static styles = css`
    :host { display: block; height: 100%; }
    h2 { margin-top: 0; font-size: 1.1rem; }
    
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
      gap: 8px;
      margin-bottom: 12px;
    }
    
    .browser-controls input {
      flex: 1;
      padding: 6px 10px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 0.9rem;
    }
    
    .browser-controls button {
      padding: 6px 12px;
      border-radius: 4px;
      border: 1px solid #ccc;
      background: #f3f4f6;
      cursor: pointer;
      font-size: 0.9rem;
    }
    
    .browser-controls button:hover { background: #e5e7eb; }
    
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
    }
    
    .iteration-item .dates {
      font-size: 0.8rem;
      color: #6b7280;
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
    
    .roots-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 8px;
    }
    
    .root-item {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 6px 8px;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
    }
    
    .root-item input {
      flex: 1;
      padding: 4px 8px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 0.85rem;
      font-family: monospace;
    }
    
    .root-item button {
      padding: 4px 8px;
      border-radius: 4px;
      border: 1px solid #ccc;
      background: #f3f4f6;
      cursor: pointer;
      font-size: 0.8rem;
    }
    
    .root-item button:hover { background: #e5e7eb; }
    
    .add-root {
      padding: 6px 12px;
      border-radius: 4px;
      border: 1px solid #3b82f6;
      background: #eff6ff;
      color: #3b82f6;
      cursor: pointer;
      font-size: 0.85rem;
      margin-bottom: 8px;
    }
    
    .add-root:hover { background: #dbeafe; }
    
    .project-overrides {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 2px solid #e5e7eb;
    }
    
    .override-item {
      margin-bottom: 12px;
      padding: 12px;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
    }
    
    .override-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    
    .override-header input {
      flex: 1;
      padding: 4px 8px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 0.85rem;
      font-weight: 500;
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
    
    button.primary:hover { background: #2563eb; }
    
    .status {
      margin-left: 8px;
      font-size: 0.9rem;
      color: #333;
    }
    
    .status.success { color: #10b981; }
    .status.error { color: #ef4444; }
    
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
    browseRoot: { type: String },
    loading: { type: Boolean },
    statusMsg: { type: String },
    statusType: { type: String },
    useRawMode: { type: Boolean },
    configuredProjects: { type: Array }
  };

  constructor() {
    super();
    this.config = { azure_project: '', default_roots: [], project_overrides: {} };
    this.browsedIterations = [];
    this.browseProject = '';
    this.browseRoot = '';
    this.loading = false;
    this.statusMsg = '';
    this.statusType = '';
    this.useRawMode = false;
    this.configuredProjects = [];
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
      this.config = data || { azure_project: '', default_roots: [], project_overrides: {} };
      // Pre-fill browseProject from config if available
      if (this.config.azure_project && !this.browseProject) {
        this.browseProject = this.config.azure_project;
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
      if (data && data.project_map) {
        // Extract unique project names from configured projects
        const names = new Set();
        data.project_map.forEach(p => {
          if (p.name) names.add(p.name);
        });
        this.configuredProjects = Array.from(names).sort();
      }
    } catch (e) {
      console.error('Failed to load projects:', e);
      this.configuredProjects = [];
    }
  }

  async browseIterations() {
    this.statusMsg = 'Browsing...';
    this.statusType = '';
    try {
      // Construct full path with Iteration\ prefix for the API
      let fullRootPath = null;
      if (this.browseRoot && this.browseRoot.trim()) {
        fullRootPath = `${this.browseProject}\\Iteration\\${this.browseRoot}`;
      }
      
      const result = await adminProvider.browseIterations({
        project: this.browseProject,
        root_path: fullRootPath,
        depth: 10
      });
      this.browsedIterations = result.iterations || [];
      this.statusMsg = `Found ${this.browsedIterations.length} iterations`;
      this.statusType = 'success';
      setTimeout(() => { this.statusMsg = ''; }, 3000);
    } catch (e) {
      this.statusMsg = 'Error browsing iterations';
      this.statusType = 'error';
      this.browsedIterations = [];
    }
  }

  // Strip project\Iteration\ prefix from path for display
  stripIterationPrefix(path) {
    if (!path) return path;
    const match = path.match(/^(.+?)\\Iteration\\(.+)$/);
    return match ? match[2] : path;
  }

  addDefaultRoot() {
    this.config.default_roots = [...this.config.default_roots, ''];
    this.requestUpdate();
  }

  removeDefaultRoot(index) {
    this.config.default_roots = this.config.default_roots.filter((_, i) => i !== index);
    this.requestUpdate();
  }

  updateDefaultRoot(index, value) {
    this.config.default_roots[index] = value;
    this.requestUpdate();
  }

  addProjectOverride() {
    // Use first available configured project as default
    const defaultProject = this.configuredProjects.length > 0 ? this.configuredProjects[0] : '';
    if (defaultProject) {
      this.config.project_overrides[defaultProject] = [];
      this.requestUpdate();
    } else {
      alert('No configured projects found. Please configure projects first.');
    }
  }

  changeProjectOverrideName(oldName, newName) {
    if (oldName === newName) return;
    if (this.config.project_overrides[newName]) {
      alert('Project override already exists for: ' + newName);
      return;
    }
    this.config.project_overrides[newName] = this.config.project_overrides[oldName];
    delete this.config.project_overrides[oldName];
    this.requestUpdate();
  }

  removeProjectOverride(projectName) {
    delete this.config.project_overrides[projectName];
    this.requestUpdate();
  }

  addOverrideRoot(projectName) {
    this.config.project_overrides[projectName] = [
      ...this.config.project_overrides[projectName],
      ''
    ];
    this.requestUpdate();
  }

  removeOverrideRoot(projectName, index) {
    this.config.project_overrides[projectName] = this.config.project_overrides[projectName].filter((_, i) => i !== index);
    this.requestUpdate();
  }

  updateOverrideRoot(projectName, index, value) {
    this.config.project_overrides[projectName][index] = value;
    this.requestUpdate();
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
            this.config = JSON.parse(textarea.value);
          } catch (e) {
            this.statusMsg = 'Invalid JSON: ' + e.message;
            this.statusType = 'error';
            return;
          }
        }
      }
      
      await adminProvider.saveIterations(this.config);
      this.statusMsg = 'Saved successfully';
      this.statusType = 'success';
      setTimeout(() => { this.statusMsg = ''; }, 3000);
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
                <input
                  type="text"
                  placeholder="Azure Project name"
                  .value="${this.browseProject}"
                  @input="${(e) => { this.browseProject = e.target.value; }}"
                />
                <input
                  type="text"
                  placeholder="Root path (optional)"
                  .value="${this.browseRoot}"
                  @input="${(e) => { this.browseRoot = e.target.value; }}"
                />
                <button @click="${this.browseIterations}">Browse</button>
              </div>
              
              <div class="iterations-list">
                ${this.browsedIterations.length === 0 ? html`
                  <div style="text-align: center; color: #6b7280; padding: 20px;">
                    Enter project name and click Browse
                  </div>
                ` : this.browsedIterations.map(it => html`
                  <div class="iteration-item">
                    <div>
                      <div class="path">${this.stripIterationPrefix(it.path)}</div>
                      ${it.startDate || it.finishDate ? html`
                        <div class="dates">
                          ${it.startDate ? `Start: ${it.startDate}` : ''} 
                          ${it.finishDate ? `End: ${it.finishDate}` : ''}
                        </div>
                      ` : ''}
                    </div>
                  </div>
                `)}
              </div>
            </div>
          </div>

          <!-- Right panel: Configuration -->
          <div class="panel">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px;">
              <h3 style="margin: 0;">Configuration</h3>
              <button class="toggle-mode" @click="${this.toggleMode}">
                ${this.useRawMode ? 'Form Mode' : 'Raw JSON'}
              </button>
            </div>
            ${this.useRawMode ? html`
              <div class="raw-editor">
                <textarea
                  .value="${JSON.stringify(this.config, null, 2)}"
                  @input="${(e) => { 
                    try { 
                      this.config = JSON.parse(e.target.value); 
                    } catch(err) { 
                      // Keep typing, don't update until valid
                    }
                  }}"
                ></textarea>
              </div>
            ` : html`
            <div class="config-editor">
              <div class="config-section">
                <label>Azure Project Name</label>
                <div class="root-item">
                  <input
                    type="text"
                    .value="${this.config.azure_project || ''}"
                    @input="${(e) => { this.config.azure_project = e.target.value; this.requestUpdate(); }}"
                    placeholder="e.g., my_azure_project"
                  />
                </div>
              </div>

              <div class="config-section">
                <label>Default Iteration Roots (without 'Iteration\\' prefix)</label>
                <div class="roots-list">
                  ${this.config.default_roots.map((root, index) => html`
                    <div class="root-item">
                      <input
                        type="text"
                        .value="${root}"
                        @input="${(e) => this.updateDefaultRoot(index, e.target.value)}"
                        placeholder="e.g., my_team or my_path\\my_team"
                      />
                      <button @click="${() => this.removeDefaultRoot(index)}">Remove</button>
                    </div>
                  `)}
                </div>
                <button class="add-root" @click="${this.addDefaultRoot}">+ Add Default Root</button>
              </div>

              <div class="project-overrides">
                <label>Project Overrides</label>
                ${Object.entries(this.config.project_overrides).map(([projectName, roots]) => html`
                  <div class="override-item">
                    <div class="override-header">
                      <select
                        .value="${projectName}"
                        @change="${(e) => this.changeProjectOverrideName(projectName, e.target.value)}"
                        style="margin-right: 8px; flex: 1; padding: 4px 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 0.85rem;"
                      >
                        ${this.configuredProjects.map(proj => html`
                          <option value="${proj}" ?selected="${proj === projectName}">${proj}</option>
                        `)}
                      </select>
                      <button @click="${() => this.removeProjectOverride(projectName)}">Remove Project</button>
                    </div>
                    <div class="roots-list">
                      ${roots.map((root, index) => html`
                        <div class="root-item">
                          <input
                            type="text"
                            .value="${root}"
                            @input="${(e) => this.updateOverrideRoot(projectName, index, e.target.value)}"
                            placeholder="e.g., Team1 or Backend\\Team1"
                          />
                          <button @click="${() => this.removeOverrideRoot(projectName, index)}">Remove</button>
                        </div>
                      `)}
                      <button class="add-root" @click="${() => this.addOverrideRoot(projectName)}">+ Add Root</button>
                    </div>
                  </div>
                `)}
                <button class="add-root" @click="${this.addProjectOverride}">+ Add Project Override</button>
              </div>

              <div class="actions">
                <button class="primary" @click="${this.saveConfig}">Save Configuration</button>
                ${this.statusMsg ? html`
                  <span class="status ${this.statusType}">${this.statusMsg}</span>
                ` : ''}
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
