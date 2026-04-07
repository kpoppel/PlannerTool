import { html, css } from '/static/js/vendor/lit.js';
import { BaseConfigComponent } from './BaseConfigComponent.lit.js';
import { adminProvider } from '../../services/providerREST.js';
import {
  setMetadata,
  getMetadata,
  getStateCategoryColor,
  azureProjectFromAreaPath,
} from '../../services/azureMetadataCache.js';

export class AdminProjects extends BaseConfigComponent {
  static properties = {
    ...BaseConfigComponent.properties,
    editingIndex: { type: Number },
    localProjects: { type: Array },
    availableTaskTypes: { type: Array },
    availableStates: { type: Array },
    _searchFilter: { type: String, state: true },
    _prefetchLoading: { type: Boolean, state: true },
    // Azure browse state
    _azureProjects: { type: Array, state: true },
    _azureAreaPaths: { type: Array, state: true },
    _selectedAzureProject: { type: String, state: true },
    _azureBrowseLoading: { type: Boolean, state: true },
    _azureBrowseError: { type: String, state: true },
    _azureBrowsePanelOpen: { type: Boolean, state: true },
    _areaPathFilter: { type: String, state: true },
    // Per-edit metadata fetched from the area path
    _editMetadata: { type: Object, state: true },
    _editMetadataLoading: { type: Boolean, state: true },
    _editMetadataError: { type: String, state: true },
  };

  static styles = [
    BaseConfigComponent.styles,
    css`
      .compact-table-view {
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      .toolbar {
        display: flex;
        gap: 8px;
        margin-bottom: 8px;
        align-items: center;
      }

      .btn {
        padding: 8px 10px;
        border-radius: 6px;
        border: 1px solid #e6e6e6;
        background: #fff;
        cursor: pointer;
        font-size: 0.9rem;
      }

      .btn.primary {
        background: #3b82f6;
        color: #fff;
        border: none;
      }

      .search-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }

      .search-input {
        flex: 1;
        padding: 6px 10px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 14px;
        max-width: 400px;
      }

      .table-container {
        overflow-x: auto;
        overflow-y: auto;
        flex: 1;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }

      thead th {
        font-weight: 600;
        text-align: left;
        padding: 10px;
        border-bottom: 1px solid #e6e6e6;
        color: #6b7280;
        position: sticky;
        top: 0;
        background: #fff;
        z-index: 10;
      }

      tbody tr {
        border-bottom: 1px solid #f4f4f4;
      }

      tbody tr.editing-row {
        background: #fbfdff;
      }

      td {
        padding: 8px 10px;
        vertical-align: top;
      }

      .chip {
        display: inline-block;
        background: #f3f4f6;
        padding: 3px 7px;
        border-radius: 999px;
        font-size: 12px;
        margin-right: 4px;
        margin-bottom: 3px;
        white-space: nowrap;
      }

      .chip.removable {
        cursor: pointer;
        padding-right: 4px;
      }

      .chip.removable:hover {
        filter: brightness(0.92);
      }

      .chip-remove {
        margin-left: 3px;
        font-weight: bold;
        color: #888;
      }

      .small {
        font-size: 12px;
        color: #6b7280;
      }

      .actions {
        display: flex;
        gap: 6px;
        align-items: center;
      }

      .action-btn {
        border: 1px solid #e6e6e6;
        background: #fff;
        padding: 5px 8px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.82rem;
        white-space: nowrap;
      }

      .action-btn:hover {
        background: #f9fafb;
      }

      .nowrap {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 300px;
      }

      /* Inline edit inputs */
      .inline-input {
        width: 100%;
        padding: 5px 7px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 13px;
        box-sizing: border-box;
      }

      .inline-select {
        padding: 5px 7px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 13px;
      }

      .load-btn {
        padding: 5px 8px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        background: #f9fafb;
        cursor: pointer;
        font-size: 12px;
        white-space: nowrap;
      }

      /* States layout — fetch + display on same horizontal line */
      .states-row {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: 6px;
      }

      .states-section {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 3px;
      }

      .states-label {
        font-size: 11px;
        color: #9ca3af;
        font-weight: 600;
        white-space: nowrap;
        margin-right: 2px;
      }

      .states-divider {
        width: 1px;
        height: 16px;
        background: #e5e7eb;
        align-self: center;
        flex-shrink: 0;
      }

      /* Edit-mode chip editor */
      .chip-editor {
        display: flex;
        flex-wrap: wrap;
        gap: 3px;
        margin-bottom: 4px;
        min-height: 22px;
      }

      .add-chip-select {
        padding: 4px 6px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 12px;
        max-width: 200px;
      }

      .add-chip-input {
        padding: 4px 6px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 12px;
        width: 160px;
      }

      .edit-states-row {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
      }

      .edit-state-section {
        min-width: 180px;
      }

      .edit-state-section-title {
        font-size: 11px;
        color: #6b7280;
        font-weight: 600;
        margin-bottom: 3px;
      }

      .edit-meta-hint {
        font-size: 11px;
        color: #9ca3af;
        margin-top: 2px;
      }

      .browse-error {
        color: #dc2626;
        font-size: 12px;
      }

      /* Browse panel */
      .browse-panel {
        border: 1px solid #e6e6e6;
        border-radius: 8px;
        padding: 10px 12px;
        margin-bottom: 10px;
        background: #f9fafb;
      }

      .browse-panel-header {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        font-weight: 600;
        font-size: 0.88rem;
        color: #374151;
      }

      .browse-panel-body {
        margin-top: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .browse-row {
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .browse-select {
        padding: 6px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 13px;
        min-width: 220px;
      }

      .area-path-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 200px;
        overflow-y: auto;
        border: 1px solid #e6e6e6;
        border-radius: 4px;
        padding: 4px;
        background: #fff;
      }

      .area-path-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 3px 6px;
        border-radius: 4px;
        font-size: 13px;
      }

      .area-path-row:hover {
        background: #f3f4f6;
      }

      .area-path-name {
        flex: 1;
        font-family: monospace;
        font-size: 12px;
        color: #374151;
      }
    `,
  ];

  constructor() {
    super();
    this.editingIndex = -1;
    this.localProjects = [];
    this.availableTaskTypes = [];
    this.availableStates = [];
    this._searchFilter = '';
    this._prefetchLoading = false;
    this._azureProjects = [];
    this._azureAreaPaths = [];
    this._selectedAzureProject = '';
    this._azureBrowseLoading = false;
    this._azureBrowseError = '';
    this._azureBrowsePanelOpen = false;
    this._areaPathFilter = '';
    this._editMetadata = null;
    this._editMetadataLoading = false;
    this._editMetadataError = '';
  }

  get configType() { return 'projects'; }
  get title() { return 'Projects Configuration'; }
  get defaultContent() { return { project_map: [] }; }

  updated(changedProperties) {
    super.updated(changedProperties);
    if (changedProperties.has('content') && this.content) {
      this.localProjects = JSON.parse(JSON.stringify(this.content.project_map || []));
      // Prefetch metadata for all configured projects so state colors are ready
      this._prefetchMetadata();
    }
    if (changedProperties.has('schema') && this.schema) {
      this.extractSchemaEnums();
    }
  }

  extractSchemaEnums() {
    if (!this.schema?.properties?.project_map?.items?.properties) return;
    const props = this.schema.properties.project_map.items.properties;
    if (props.task_types?.items?.enum) {
      this.availableTaskTypes = props.task_types.items.enum;
    }
    if (props.include_states?.default) {
      this.availableStates = props.include_states.default;
    }
    if (props.display_states?.default && this.availableStates.length === 0) {
      this.availableStates = props.display_states.default;
    }
  }

  // --- Metadata prefetch ---

  /**
   * Prefetch and cache Azure project metadata for all configured projects.
   * Called automatically whenever the project list is loaded. Silently ignores
   * errors (e.g. no PAT configured yet).
   */
  async _prefetchMetadata() {
    const areaPaths = this.localProjects.map((p) => p.area_path).filter(Boolean);
    if (areaPaths.length === 0) return;
    this._prefetchLoading = true;
    try {
      const result = await adminProvider.prefetchProjectsMetadata(areaPaths);
      if (result.results) {
        for (const [, data] of Object.entries(result.results)) {
          const { azure_project, ...metadata } = data;
          if (azure_project) {
            setMetadata(azure_project, metadata);
          }
        }
        // Re-render to apply category colors to state chips
        this.requestUpdate();
      }
    } catch (err) {
      // Non-fatal: metadata is used only for colors / dropdown hints
      console.warn('AdminProjects: metadata prefetch failed (no PAT or connection?)', err);
    } finally {
      this._prefetchLoading = false;
    }
  }

  // --- Per-edit area path metadata ---

  /** @param {string} areaPath */
  async _fetchEditMetadata(areaPath) {
    if (!areaPath) {
      this._editMetadata = null;
      this._editMetadataError = '';
      return;
    }
    const sep = areaPath.includes('\\') ? '\\' : '/';
    const azureProject = areaPath.split(sep)[0];
    if (!azureProject) return;

    this._editMetadataLoading = true;
    this._editMetadataError = '';
    const metadata = await adminProvider.getAreaPathMetadata(azureProject, areaPath);
    this._editMetadataLoading = false;
    if (metadata.error) {
      this._editMetadataError = `Could not load metadata: ${metadata.error}`;
    } else {
      this._editMetadata = metadata;
      // Update the JS module-level cache so colors refresh
      setMetadata(azureProject, metadata);
      this.requestUpdate();
    }
  }

  // --- Azure browse methods ---

  async _onBrowseAzureProjects() {
    this._azureBrowseLoading = true;
    this._azureBrowseError = '';
    this._azureProjects = [];
    this._azureAreaPaths = [];
    this._selectedAzureProject = '';
    const result = await adminProvider.browseAzureProjects();
    this._azureBrowseLoading = false;
    if (result.error) {
      this._azureBrowseError = result.error;
    } else {
      this._azureProjects = result.projects || [];
      this._azureBrowsePanelOpen = true;
    }
  }

  async _onAzureProjectSelect(e) {
    const project = e.target.value;
    this._selectedAzureProject = project;
    this._azureAreaPaths = [];
    this._azureBrowseError = '';
    if (!project) return;
    this._areaPathFilter = '';
    this._azureBrowseLoading = true;
    // Fetch area paths and project-level metadata in parallel
    const [pathsResult, metaResult] = await Promise.all([
      adminProvider.browseAreaPaths(project),
      // Project-level metadata carries all types + state_categories for coloring
      adminProvider.getWorkItemMetadata(project),
    ]);
    this._azureBrowseLoading = false;
    if (pathsResult.error) {
      this._azureBrowseError = pathsResult.error;
    } else {
      this._azureAreaPaths = pathsResult.area_paths || [];
    }
    // Cache project metadata regardless of area path result
    if (!metaResult.error) {
      setMetadata(project, metaResult);
    }
  }

  async _onAddAreaPathToConfig(areaPath) {
    this._azureBrowseLoading = true;
    this._azureBrowseError = '';
    const metadata = await adminProvider.getAreaPathMetadata(this._selectedAzureProject, areaPath);
    this._azureBrowseLoading = false;
    if (metadata.error) {
      this._azureBrowseError = metadata.error;
      return;
    }
    const sep = areaPath.includes('\\') ? '\\' : '/';
    const segments = areaPath.split(sep);
    const name = segments[segments.length - 1] || areaPath;
    const newEntry = {
      name,
      type: 'project',
      area_path: areaPath,
      task_types: metadata.types || [],
      include_states: metadata.states || [],
      display_states: metadata.states || [],
    };
    this.localProjects = [...this.localProjects, newEntry];
    this.editingIndex = this.localProjects.length - 1;
    // Cache the metadata and pre-populate the edit form
    setMetadata(this._selectedAzureProject, metadata);
    this._editMetadata = metadata;
    this._editMetadataError = '';
  }

  renderBrowsePanel() {
    return html`
      <div class="browse-panel">
        <div class="browse-panel-header"
          @click="${() => { this._azureBrowsePanelOpen = !this._azureBrowsePanelOpen; }}">
          <span>${this._azureBrowsePanelOpen ? '▼' : '▶'}</span>
          <span>🔍 Browse from Azure DevOps</span>
          ${this._azureBrowseLoading
            ? html`<span class="small" style="margin-left:8px">Loading…</span>`
            : ''}
        </div>
        ${this._azureBrowsePanelOpen ? html`
          <div class="browse-panel-body">
            ${this._azureBrowseError
              ? html`<div class="browse-error">${this._azureBrowseError}</div>` : ''}
            <div class="browse-row">
              <button class="btn" @click="${this._onBrowseAzureProjects}"
                ?disabled="${this._azureBrowseLoading}">
                Load Projects
              </button>
              ${this._azureProjects.length > 0 ? html`
                <select class="browse-select" @change="${this._onAzureProjectSelect}">
                  <option value="">— Select project —</option>
                  ${this._azureProjects.map((p) => html`<option value="${p}">${p}</option>`)}
                </select>
              ` : ''}
            </div>
            ${this._selectedAzureProject && this._azureAreaPaths.length > 0 ? html`
              <div class="small">
                ${this._azureAreaPaths.length} area path${this._azureAreaPaths.length !== 1 ? 's' : ''}
                — click <strong>+ Add</strong> to auto-configure:
              </div>
              <input type="text" class="add-chip-input"
                style="width:100%;box-sizing:border-box;margin-top:0;max-width:none"
                placeholder="Filter area paths…"
                .value="${this._areaPathFilter}"
                @input="${(e) => { this._areaPathFilter = e.target.value; }}"
              />
              <div class="area-path-list">
                ${this._azureAreaPaths
                  .filter((ap) => ap.toLowerCase().includes(this._areaPathFilter.toLowerCase()))
                  .map((ap) => html`
                    <div class="area-path-row">
                      <span class="area-path-name">${ap}</span>
                      <button class="action-btn" ?disabled="${this._azureBrowseLoading}"
                        @click="${() => this._onAddAreaPathToConfig(ap)}">
                        + Add
                      </button>
                    </div>
                  `)}
                ${this._azureAreaPaths.filter((ap) =>
                    ap.toLowerCase().includes(this._areaPathFilter.toLowerCase())).length === 0
                  ? html`<div class="small" style="padding:6px;text-align:center">
                      No matches for "${this._areaPathFilter}"</div>`
                  : ''}
              </div>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  // --- Project CRUD ---

  addNewProject() {
    const newProject = {
      name: 'New Project',
      type: 'project',
      area_path: '',
      task_types: [],
      include_states: [],
      display_states: [],
    };
    this.localProjects = [...this.localProjects, newProject];
    this.editingIndex = this.localProjects.length - 1;
    this._editMetadata = null;
    this._editMetadataError = '';
  }

  editProject(index) {
    this.editingIndex = index;
    this._editMetadataError = '';
    const project = this.localProjects[index];
    if (project?.area_path) {
      // Use the already-cached metadata populated at tab load; only fetch from
      // the server if nothing is in the JS module cache for this Azure project.
      const azureProject = azureProjectFromAreaPath(project.area_path);
      const cached = azureProject ? getMetadata(azureProject) : null;
      if (cached) {
        this._editMetadata = cached;
      } else {
        this._editMetadata = null;
        this._fetchEditMetadata(project.area_path);
      }
    } else {
      this._editMetadata = null;
    }
  }

  cancelEdit() {
    this.localProjects = JSON.parse(JSON.stringify(this.content.project_map || []));
    this.editingIndex = -1;
    this._editMetadata = null;
    this._editMetadataError = '';
  }

  saveEdit(index) {
    this.editingIndex = -1;
    this.content = { ...this.content, project_map: [...this.localProjects] };
    this.requestUpdate();
  }

  deleteProject(index) {
    if (confirm('Delete this project configuration?')) {
      this.localProjects = this.localProjects.filter((_, i) => i !== index);
      this.content = { ...this.content, project_map: [...this.localProjects] };
      this.editingIndex = -1;
    }
  }

  updateProjectField(index, field, value) {
    this.localProjects[index] = { ...this.localProjects[index], [field]: value };
    this.requestUpdate();
  }

  addChip(index, field, value) {
    if (!value || !value.trim()) return;
    const current = this.localProjects[index][field] || [];
    if (!current.includes(value.trim())) {
      this.updateProjectField(index, field, [...current, value.trim()]);
      // Keep display_states in sync when include_states changes
      if (field === 'include_states') {
        const disp = this.localProjects[index]['display_states'] || [];
        if (!disp.includes(value.trim())) {
          this.updateProjectField(index, 'display_states', [...disp, value.trim()]);
        }
      }
    }
  }

  removeChip(index, field, chipValue) {
    const current = this.localProjects[index][field] || [];
    this.updateProjectField(index, field, current.filter((v) => v !== chipValue));
    // Mirror removal in display_states when removing from include_states
    if (field === 'include_states') {
      const disp = this.localProjects[index]['display_states'] || [];
      if (disp.includes(chipValue)) {
        this.updateProjectField(index, 'display_states', disp.filter((v) => v !== chipValue));
      }
    }
  }

  // --- Helpers ---

  /**
   * CSS background color for a state chip based on Azure DevOps category.
   * @param {string} areaPath
   * @param {string} state
   * @returns {string}
   */
  _stateBg(areaPath, state) {
    const azureProject = azureProjectFromAreaPath(areaPath);
    if (!azureProject) return '#f3f4f6';
    return getStateCategoryColor(azureProject, state);
  }

  /** Available types for the edit form: prefer fetched metadata, fall back to schema. */
  get _editTypes() {
    return this._editMetadata?.types?.length > 0
      ? this._editMetadata.types
      : this.availableTaskTypes;
  }

  /** Available states for the edit form: prefer fetched metadata, fall back to schema. */
  get _editStates() {
    return this._editMetadata?.states?.length > 0
      ? this._editMetadata.states
      : this.availableStates;
  }

  // --- Row rendering (single row handles both display and edit mode) ---

  /**
   * Render a state chip with category-derived background color.
   * In edit mode the chip is removable via click.
   * @param {string} state
   * @param {string} areaPath
   * @param {boolean} editable
   * @param {string} field
   * @param {number} index
   */
  _renderStateChip(state, areaPath, editable = false, field = '', index = -1) {
    const bg = this._stateBg(areaPath, state);
    if (editable) {
      return html`
        <span class="chip removable" style="background:${bg}"
          @click="${() => this.removeChip(index, field, state)}">
          ${state}<span class="chip-remove">×</span>
        </span>`;
    }
    return html`<span class="chip" style="background:${bg}">${state}</span>`;
  }

  /** States column in display mode: Fetch and Display sections on one horizontal line. */
  _renderStatesDisplay(project) {
    const fetch = project.include_states || [];
    const disp = project.display_states || [];
    return html`
      <div class="states-row">
        <div class="states-section">
          <span class="states-label">F:</span>
          ${fetch.length > 0
            ? fetch.map((s) => this._renderStateChip(s, project.area_path))
            : html`<span class="small">—</span>`}
        </div>
        ${disp.length > 0 ? html`
          <div class="states-divider"></div>
          <div class="states-section">
            <span class="states-label">D:</span>
            ${disp.map((s) => this._renderStateChip(s, project.area_path))}
          </div>
        ` : ''}
      </div>
    `;
  }

  /** States column in edit mode: chip editors for Fetch and Display side by side. */
  _renderStatesEdit(project, index) {
    const editStates = this._editStates;
    const fetch = project.include_states || [];
    const disp = project.display_states || [];
    return html`
      <div class="edit-states-row">
        <div class="edit-state-section">
          <div class="edit-state-section-title">States to Fetch</div>
          <div class="chip-editor">
            ${fetch.map((s) => this._renderStateChip(s, project.area_path, true, 'include_states', index))}
          </div>
          ${editStates.length > 0 ? html`
            <select class="add-chip-select" @change="${(e) => {
              if (e.target.value) { this.addChip(index, 'include_states', e.target.value); e.target.value = ''; }
            }}">
              <option value="">+ Add state</option>
              ${editStates.filter((s) => !fetch.includes(s)).map(
                (s) => html`<option value="${s}">${s}</option>`)}
            </select>
          ` : ''}
          <input class="add-chip-input" placeholder="Custom state + Enter"
            @keydown="${(e) => {
              if (e.key === 'Enter') { this.addChip(index, 'include_states', e.target.value); e.target.value = ''; }
            }}"
          />
        </div>
        <div class="edit-state-section">
          <div class="edit-state-section-title">States for UI Display</div>
          <div class="chip-editor">
            ${disp.map((s) => this._renderStateChip(s, project.area_path, true, 'display_states', index))}
          </div>
          ${editStates.length > 0 ? html`
            <select class="add-chip-select" @change="${(e) => {
              if (e.target.value) { this.addChip(index, 'display_states', e.target.value); e.target.value = ''; }
            }}">
              <option value="">+ Add state</option>
              ${editStates.filter((s) => !disp.includes(s)).map(
                (s) => html`<option value="${s}">${s}</option>`)}
            </select>
          ` : ''}
          <input class="add-chip-input" placeholder="Custom state + Enter"
            @keydown="${(e) => {
              if (e.key === 'Enter') { this.addChip(index, 'display_states', e.target.value); e.target.value = ''; }
            }}"
          />
        </div>
      </div>
    `;
  }

  renderRow(project, index) {
    const isEditing = this.editingIndex === index;

    if (!isEditing) {
      return html`
        <tr>
          <td><input type="checkbox" /></td>
          <td>
            <div style="font-weight:600">${project.name || 'Unnamed'}</div>
            <div class="small">${project.type || 'project'}</div>
          </td>
          <td class="nowrap" title="${project.area_path}">${project.area_path || '—'}</td>
          <td>
            ${(project.task_types || []).map((t) => html`<span class="chip">${t}</span>`)}
            ${(project.task_types || []).length === 0
              ? html`<span class="small">—</span>` : ''}
          </td>
          <td>${this._renderStatesDisplay(project)}</td>
          <td>
            <div class="actions">
              <button class="action-btn" @click="${() => this.editProject(index)}">Edit</button>
              <button class="action-btn" @click="${() => this.deleteProject(index)}">🗑</button>
            </div>
          </td>
        </tr>
      `;
    }

    // Edit mode — same row, inputs replace text
    const editTypes = this._editTypes;
    return html`
      <tr class="editing-row">
        <td></td>
        <td style="min-width:180px">
          <input class="inline-input" style="margin-bottom:4px"
            .value="${project.name || ''}"
            @input="${(e) => this.updateProjectField(index, 'name', e.target.value)}"
          />
          <select class="inline-select"
            .value="${project.type || 'project'}"
            @change="${(e) => this.updateProjectField(index, 'type', e.target.value)}">
            <option value="project">project</option>
            <option value="team">team</option>
          </select>
        </td>
        <td style="min-width:220px">
          <div style="display:flex;gap:4px;align-items:center">
            <input class="inline-input"
              .value="${project.area_path || ''}"
              @input="${(e) => {
                this.updateProjectField(index, 'area_path', e.target.value);
                this._editMetadata = null;
                this._editMetadataError = '';
              }}"
            />
            <button class="load-btn"
              title="Load types & states for this area path"
              ?disabled="${this._editMetadataLoading || !project.area_path}"
              @click="${() => this._fetchEditMetadata(project.area_path)}">
              ${this._editMetadataLoading ? '…' : '⟳'}
            </button>
          </div>
          ${this._editMetadataError
            ? html`<div class="browse-error">${this._editMetadataError}</div>` : ''}
          ${this._editMetadata && !this._editMetadataLoading ? html`
            <div class="edit-meta-hint">
              ${(this._editMetadata.types || []).join(', ') || '—'}
            </div>` : ''}
        </td>
        <td style="min-width:160px">
          <div class="chip-editor">
            ${(project.task_types || []).map((t) => html`
              <span class="chip removable"
                @click="${() => this.removeChip(index, 'task_types', t)}">
                ${t}<span class="chip-remove">×</span>
              </span>`)}
          </div>
          ${editTypes.length > 0 ? html`
            <select class="add-chip-select" @change="${(e) => {
              if (e.target.value) { this.addChip(index, 'task_types', e.target.value); e.target.value = ''; }
            }}">
              <option value="">+ Add type</option>
              ${editTypes.filter((t) => !(project.task_types || []).includes(t)).map(
                (t) => html`<option value="${t}">${t}</option>`)}
            </select>
          ` : html`
            <input class="add-chip-input" placeholder="Type + Enter"
              @keydown="${(e) => {
                if (e.key === 'Enter') { this.addChip(index, 'task_types', e.target.value); e.target.value = ''; }
              }}"
            />
          `}
        </td>
        <td>${this._renderStatesEdit(project, index)}</td>
        <td>
          <div class="actions" style="flex-direction:column;align-items:flex-start">
            <button class="action-btn" style="background:#10b981;color:#fff;margin-bottom:4px"
              @click="${() => this.saveEdit(index)}">Save</button>
            <button class="action-btn"
              @click="${() => this.cancelEdit()}">Cancel</button>
          </div>
        </td>
      </tr>
    `;
  }

  render() {
    if (this.loading) {
      return html`<div class="loading">Loading ${this.title.toLowerCase()}...</div>`;
    }

    const searchLower = this._searchFilter.toLowerCase();
    const filteredProjects = this.localProjects.filter((p) => {
      if (!searchLower) return true;
      return (
        (p.name || '').toLowerCase().includes(searchLower) ||
        (p.area_path || '').toLowerCase().includes(searchLower)
      );
    });

    return html`
      <section>
        <h2>${this.title}</h2>
        <div class="panel">
          <div class="editor">
            <div class="compact-table-view">
              <div class="toolbar">
                <button class="btn primary" @click="${this.addNewProject}">+ Add Project</button>
                <button class="btn" @click="${this.saveConfig}">💾 Save All</button>
                <button class="btn" @click="${this.loadConfig}">🔄 Reload</button>
                <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
                  ${this._prefetchLoading
                    ? html`<span class="small">Loading metadata…</span>` : ''}
                  <span style="color:#6b7280;font-size:0.88rem">
                    ${filteredProjects.length}${filteredProjects.length !== this.localProjects.length
                      ? `/${this.localProjects.length}` : ''}
                    project${this.localProjects.length !== 1 ? 's' : ''}
                  </span>
                  <button class="btn toggle-mode" @click="${this.toggleMode}">
                    ${this.useRawMode ? '📋 Table' : '📝 Raw JSON'}
                  </button>
                </div>
              </div>

              ${this.useRawMode ? html`
                <textarea
                  style="width:100%;height:100%;font-family:monospace;padding:8px;flex:1"
                  .value="${JSON.stringify(this.content, null, 2)}"
                  @input="${(e) => {
                    try {
                      this.content = JSON.parse(e.target.value);
                      this.localProjects = JSON.parse(JSON.stringify(this.content.project_map || []));
                    } catch { /* ignore parse errors while typing */ }
                  }}"
                ></textarea>
              ` : html`
                ${this.renderBrowsePanel()}

                <div class="search-bar">
                  <span class="small">🔎</span>
                  <input type="text" class="search-input"
                    placeholder="Search by name or area path…"
                    .value="${this._searchFilter}"
                    @input="${(e) => { this._searchFilter = e.target.value; }}"
                  />
                  ${this._searchFilter ? html`
                    <button class="btn" style="padding:4px 8px"
                      @click="${() => { this._searchFilter = ''; }}">✕</button>
                  ` : ''}
                </div>

                <div class="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th style="width:36px"><input type="checkbox" /></th>
                        <th style="width:180px">Project / Type</th>
                        <th>Area Path</th>
                        <th style="width:180px">Work Item Types</th>
                        <th>States (F: Fetch · D: Display)</th>
                        <th style="width:100px">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${filteredProjects.length === 0 ? html`
                        <tr>
                          <td colspan="6"
                            style="text-align:center;padding:40px;color:#6b7280">
                            ${this._searchFilter
                              ? `No projects match "${this._searchFilter}"`
                              : 'No projects configured. Click "+ Add Project" to create one.'}
                          </td>
                        </tr>
                      ` : filteredProjects.map((project) => {
                          // Use the actual index in localProjects so edits target the right entry
                          const realIndex = this.localProjects.indexOf(project);
                          return this.renderRow(project, realIndex);
                        })}
                    </tbody>
                  </table>
                </div>
              `}
            </div>
          </div>
          <div class="actions">
            ${this.statusMsg
              ? html`<span class="status ${this.statusType}">${this.statusMsg}</span>` : ''}
          </div>
        </div>
      </section>
    `;
  }
}

customElements.define('admin-projects', AdminProjects);
