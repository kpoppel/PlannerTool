import { html, css } from '/static/js/vendor/lit.js';
import { BaseConfigComponent } from './BaseConfigComponent.lit.js';
import { adminProvider } from '../../services/providerREST.js';

export class AdminProjects extends BaseConfigComponent {
  static properties = {
    ...BaseConfigComponent.properties,
    editingIndex: { type: Number },
    localProjects: { type: Array },
    availableTaskTypes: { type: Array },
    availableStates: { type: Array },
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
        margin-bottom: 12px;
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
        height: 56px;
        border-bottom: 1px solid #f4f4f4;
      }

      td {
        padding: 8px 10px;
        vertical-align: middle;
      }

      .chip {
        display: inline-block;
        background: #f3f4f6;
        padding: 4px 8px;
        border-radius: 999px;
        font-size: 12px;
        margin-right: 6px;
        margin-bottom: 4px;
      }

      .chip.removable {
        cursor: pointer;
        padding-right: 4px;
      }

      .chip.removable:hover {
        background: #fee;
      }

      .chip-remove {
        margin-left: 4px;
        font-weight: bold;
        color: #999;
      }

      .small {
        font-size: 13px;
        color: #6b7280;
      }

      .actions {
        display: flex;
        gap: 6px;
      }

      .action-btn {
        border: 1px solid #e6e6e6;
        background: #fff;
        padding: 6px 8px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.85rem;
      }

      .action-btn:hover {
        background: #f9fafb;
      }

      .nowrap {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 360px;
      }

      .edit-row {
        background: #fbfdff;
      }

      .edit-row td {
        padding: 12px 10px;
      }

      .edit-form {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .form-group {
        display: flex;
        gap: 12px;
        align-items: center;
      }

      .form-group label {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .chip-editor {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 6px;
      }

      .add-chip-input {
        margin-top: 6px;
        padding: 6px;
        width: 220px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 13px;
      }

      .add-chip-select {
        margin-top: 6px;
        padding: 6px;
        width: 220px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 13px;
      }

      .form-section {
        min-width: 220px;
      }

      .form-section-title {
        font-size: 13px;
        color: #6b7280;
        margin-bottom: 4px;
      }

      .edit-actions {
        margin-left: auto;
        display: flex;
        gap: 8px;
      }

      .type-select {
        padding: 6px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 14px;
      }

      .browse-panel {
        border: 1px solid #e6e6e6;
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 12px;
        background: #f9fafb;
      }

      .browse-panel-header {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        font-weight: 600;
        font-size: 0.9rem;
        color: #374151;
      }

      .browse-panel-body {
        margin-top: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
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
        gap: 4px;
        max-height: 220px;
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
        padding: 4px 6px;
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

      .browse-error {
        color: #dc2626;
        font-size: 13px;
        padding: 4px 0;
      }
    `,
  ];

  constructor() {
    super();
    this.editingIndex = -1;
    this.localProjects = [];
    this.availableTaskTypes = [];
    this.availableStates = [];
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

  get configType() {
    return 'projects';
  }
  get title() {
    return 'Projects Configuration';
  }
  get defaultContent() {
    return { project_map: [] };
  }

  updated(changedProperties) {
    super.updated(changedProperties);
    if (changedProperties.has('content') && this.content) {
      this.localProjects = JSON.parse(JSON.stringify(this.content.project_map || []));
    }
    if (changedProperties.has('schema') && this.schema) {
      this.extractSchemaEnums();
    }
  }

  extractSchemaEnums() {
    if (!this.schema?.properties?.project_map?.items?.properties) return;

    const props = this.schema.properties.project_map.items.properties;

    // Extract task_types enum
    if (props.task_types?.items?.enum) {
      this.availableTaskTypes = props.task_types.items.enum;
    }

    // Extract default states as suggestions
    if (props.include_states?.default) {
      this.availableStates = props.include_states.default;
    }
    // Also check display_states for available states
    if (props.display_states?.default && this.availableStates.length === 0) {
      this.availableStates = props.display_states.default;
    }
  }

  // --- Per-edit area path metadata ---

  /**
   * Fetch work item types and states for the given area path and store in _editMetadata.
   * The Azure project name is derived from the first segment of the area path.
   * @param {string} areaPath
   */
  async _fetchEditMetadata(areaPath) {
    if (!areaPath) {
      this._editMetadata = null;
      this._editMetadataError = '';
      return;
    }
    // First segment of the area path is the Azure DevOps project name
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
    const result = await adminProvider.browseAreaPaths(project);
    this._azureBrowseLoading = false;
    if (result.error) {
      this._azureBrowseError = result.error;
    } else {
      this._azureAreaPaths = result.area_paths || [];
    }
  }

  async _onAddAreaPathToConfig(areaPath) {
    this._azureBrowseLoading = true;
    this._azureBrowseError = '';
    // Query types/states actually present in this specific area path, not all project types.
    const metadata = await adminProvider.getAreaPathMetadata(this._selectedAzureProject, areaPath);
    this._azureBrowseLoading = false;
    if (metadata.error) {
      this._azureBrowseError = metadata.error;
      return;
    }
    // Derive a friendly name from the last segment of the area path
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
    // Re-use the metadata we just fetched so the edit form's selects are pre-populated
    this._editMetadata = metadata;
    this._editMetadataError = '';
  }

  renderBrowsePanel() {
    return html`
      <div class="browse-panel">
        <div class="browse-panel-header" @click="${() => { this._azureBrowsePanelOpen = !this._azureBrowsePanelOpen; }}">
          <span>${this._azureBrowsePanelOpen ? '▼' : '▶'}</span>
          <span>🔍 Browse from Azure DevOps</span>
          ${this._azureBrowseLoading ? html`<span class="small" style="margin-left:8px;color:#6b7280">Loading…</span>` : ''}
        </div>
        ${this._azureBrowsePanelOpen ? html`
          <div class="browse-panel-body">
            ${this._azureBrowseError ? html`<div class="browse-error">${this._azureBrowseError}</div>` : ''}
            <div class="browse-row">
              <button class="btn" @click="${this._onBrowseAzureProjects}" ?disabled="${this._azureBrowseLoading}">
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
              <div class="small" style="color:#6b7280">
                ${this._azureAreaPaths.length} area path${this._azureAreaPaths.length !== 1 ? 's' : ''} found
                — click <strong>+ Add</strong> to auto-configure a new project entry:
              </div>
              <input
                type="text"
                class="add-chip-input"
                style="width:100%;box-sizing:border-box;margin-top:0"
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
                ${this._azureAreaPaths.filter((ap) => ap.toLowerCase().includes(this._areaPathFilter.toLowerCase())).length === 0
                  ? html`<div class="small" style="padding:8px;text-align:center">No matches for "${this._areaPathFilter}"</div>`
                  : ''}
              </div>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  // --- Project CRUD methods ---

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
    this._editMetadata = null;
    this._editMetadataError = '';
    const project = this.localProjects[index];
    if (project?.area_path) {
      this._fetchEditMetadata(project.area_path);
    }
  }

  cancelEdit() {
    // Reset local projects from content
    this.localProjects = JSON.parse(JSON.stringify(this.content.project_map || []));
    this.editingIndex = -1;
    this._editMetadata = null;
    this._editMetadataError = '';
  }

  saveEdit(index) {
    this.editingIndex = -1;
    // Update content and trigger save
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
    this.localProjects[index] = {
      ...this.localProjects[index],
      [field]: value,
    };
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
    this.updateProjectField(
      index,
      field,
      current.filter((v) => v !== chipValue)
    );
    // If removing from include_states, also remove from display_states
    if (field === 'include_states') {
      const disp = this.localProjects[index]['display_states'] || [];
      if (disp.includes(chipValue)) {
        this.updateProjectField(
          index,
          'display_states',
          disp.filter((v) => v !== chipValue)
        );
      }
    }
  }

  renderDisplayRow(project, index) {
    return html`
      <tr class="display-row">
        <td><input type="checkbox" /></td>
        <td>
          <div style="font-weight:700">${project.name || 'Unnamed'}</div>
          <div class="small">Type: ${project.type}</div>
        </td>
        <td class="nowrap" title="${project.area_path}">${project.area_path || '—'}</td>
        <td>
          ${(project.task_types || []).map(
            (type) => html` <span class="chip">${type}</span> `
          )}
          ${(project.task_types || []).length === 0 ?
            html`<span class="small">—</span>`
          : ''}
        </td>
        <td>
          <div class="small" style="margin-bottom:4px">Fetch:</div>
          ${(project.include_states || []).map(
            (state) => html` <span class="chip">${state}</span> `
          )}
          ${(project.include_states || []).length === 0 ?
            html`<span class="small">—</span>`
          : ''}
          ${(project.display_states || []).length > 0 ?
            html`
              <div class="small" style="margin-top:8px;margin-bottom:4px">Display:</div>
              ${(project.display_states || []).map(
                (state) => html`
                  <span class="chip" style="background:#e0f2fe">${state}</span>
                `
              )}
            `
          : ''}
        </td>
        <td>
          <div class="actions">
            <button class="action-btn" @click="${() => this.editProject(index)}">
              Edit
            </button>
            <button class="action-btn" @click="${() => this.deleteProject(index)}">
              🗑
            </button>
          </div>
        </td>
      </tr>
    `;
  }

  renderEditRow(project, index) {
    // Use metadata fetched from the area path when available; fall back to schema-derived lists
    const editTypes = this._editMetadata?.types?.length > 0
      ? this._editMetadata.types
      : this.availableTaskTypes;
    const editStates = this._editMetadata?.states?.length > 0
      ? this._editMetadata.states
      : this.availableStates;

    return html`
      <tr class="edit-row">
        <td></td>
        <td colspan="5">
          <div class="edit-form">
            <div class="form-group">
              <label
                style="display:flex;flex-direction:column;min-width:250px;margin-right:16px"
              >
                Project Name
                <input
                  style="padding:6px;border:1px solid #d1d5db;border-radius:4px;font-size:14px;margin-top:4px"
                  .value="${project.name || ''}"
                  @input="${(e) =>
                    this.updateProjectField(index, 'name', e.target.value)}"
                />
              </label>
              <label
                style="display:flex;flex-direction:column;min-width:140px;margin-right:16px"
              >
                Type
                <select
                  style="padding:6px;border:1px solid #d1d5db;border-radius:4px;font-size:14px;margin-top:4px"
                  .value="${project.type || 'project'}"
                  @change="${(e) =>
                    this.updateProjectField(index, 'type', e.target.value)}"
                >
                  <option value="project">project</option>
                  <option value="team">team</option>
                </select>
              </label>
              <label style="display:flex;flex-direction:column;flex:1">
                Area Path
                <div style="display:flex;gap:6px;margin-top:4px">
                  <input
                    style="flex:1;padding:6px;border:1px solid #d1d5db;border-radius:4px;font-size:14px"
                    .value="${project.area_path || ''}"
                    @input="${(e) => {
                      this.updateProjectField(index, 'area_path', e.target.value);
                      // Clear stale metadata when area path is edited manually
                      this._editMetadata = null;
                      this._editMetadataError = '';
                    }}"
                  />
                  <button
                    class="btn"
                    title="Fetch available work item types and states for this area path"
                    ?disabled="${this._editMetadataLoading || !project.area_path}"
                    @click="${() => this._fetchEditMetadata(project.area_path)}"
                  >${this._editMetadataLoading ? '…' : '⟳ Load'}</button>
                </div>
                ${this._editMetadataError ? html`<div class="browse-error" style="font-size:12px">${this._editMetadataError}</div>` : ''}
                ${this._editMetadata && !this._editMetadataLoading ? html`
                  <div class="small" style="color:#6b7280;margin-top:2px">
                    Types available: ${(this._editMetadata.types || []).join(', ') || '—'}
                  </div>` : ''}
              </label>
            </div>

            <div class="form-group">
              <div class="form-section">
                <div class="form-section-title">Work Item Types</div>
                <div class="chip-editor">
                  ${(project.task_types || []).map(
                    (type) => html`
                      <span
                        class="chip removable"
                        @click="${() => this.removeChip(index, 'task_types', type)}"
                      >
                        ${type}<span class="chip-remove">×</span>
                      </span>
                    `
                  )}
                </div>
                ${editTypes.length > 0 ?
                  html`
                    <select
                      class="add-chip-select"
                      @change="${(e) => {
                        if (e.target.value) {
                          this.addChip(index, 'task_types', e.target.value);
                          e.target.value = '';
                        }
                      }}"
                    >
                      <option value="">+ Add work item type</option>
                      ${editTypes
                        .filter((t) => !(project.task_types || []).includes(t))
                        .map((type) => html` <option value="${type}">${type}</option> `)}
                    </select>
                  `
                : html`
                    <input
                      class="add-chip-input"
                      placeholder="Add type and press Enter"
                      @keydown="${(e) => {
                        if (e.key === 'Enter') {
                          this.addChip(index, 'task_types', e.target.value);
                          e.target.value = '';
                        }
                      }}"
                    />
                  `}
              </div>

              <div class="form-section">
                <div class="form-section-title">States to Fetch</div>
                <div class="chip-editor">
                  ${(project.include_states || []).map(
                    (state) => html`
                      <span
                        class="chip removable"
                        @click="${() => this.removeChip(index, 'include_states', state)}"
                      >
                        ${state}<span class="chip-remove">×</span>
                      </span>
                    `
                  )}
                </div>
                ${editStates.length > 0 ?
                  html`
                    <select
                      class="add-chip-select"
                      @change="${(e) => {
                        if (e.target.value) {
                          this.addChip(index, 'include_states', e.target.value);
                          e.target.value = '';
                        }
                      }}"
                    >
                      <option value="">+ Add state to fetch</option>
                      ${editStates
                        .filter((s) => !(project.include_states || []).includes(s))
                        .map(
                          (state) => html` <option value="${state}">${state}</option> `
                        )}
                    </select>
                  `
                : ''}
                <input
                  class="add-chip-input"
                  placeholder="Add custom state and press Enter"
                  @keydown="${(e) => {
                    if (e.key === 'Enter') {
                      this.addChip(index, 'include_states', e.target.value);
                      e.target.value = '';
                    }
                  }}"
                />
              </div>

              <div class="form-section">
                <div class="form-section-title">States for UI Display</div>
                <div class="chip-editor">
                  ${(project.display_states || []).map(
                    (state) => html`
                      <span
                        class="chip removable"
                        style="background:#e0f2fe"
                        @click="${() => this.removeChip(index, 'display_states', state)}"
                      >
                        ${state}<span class="chip-remove">×</span>
                      </span>
                    `
                  )}
                </div>
                ${editStates.length > 0 ?
                  html`
                    <select
                      class="add-chip-select"
                      @change="${(e) => {
                        if (e.target.value) {
                          this.addChip(index, 'display_states', e.target.value);
                          e.target.value = '';
                        }
                      }}"
                    >
                      <option value="">+ Add display state</option>
                      ${editStates
                        .filter((s) => !(project.display_states || []).includes(s))
                        .map(
                          (state) => html` <option value="${state}">${state}</option> `
                        )}
                    </select>
                  `
                : ''}
                <input
                  class="add-chip-input"
                  placeholder="Add custom state and press Enter"
                  @keydown="${(e) => {
                    if (e.key === 'Enter') {
                      this.addChip(index, 'display_states', e.target.value);
                      e.target.value = '';
                    }
                  }}"
                />
              </div>

              <div class="edit-actions">
                <button
                  class="action-btn"
                  style="background:#10b981;color:#fff"
                  @click="${() => this.saveEdit(index)}"
                >
                  Save
                </button>
                <button class="action-btn" @click="${() => this.cancelEdit()}">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  render() {
    if (this.loading) {
      return html`<div class="loading">Loading ${this.title.toLowerCase()}...</div>`;
    }

    const projects = this.localProjects || [];

    return html`
      <section>
        <h2>${this.title}</h2>
        <div class="panel">
          <div class="editor">
            <div class="compact-table-view">
              <div class="toolbar">
                <button class="btn primary" @click="${this.addNewProject}">
                  + Add Project
                </button>
                <button class="btn" @click="${this.saveConfig}">💾 Save All</button>
                <button class="btn" @click="${this.loadConfig}">🔄 Reload</button>
                <div style="margin-left:auto;color:#6b7280;font-size:0.9rem">
                  Showing ${projects.length} project${projects.length !== 1 ? 's' : ''}
                </div>
                <button class="btn toggle-mode" @click="${this.toggleMode}">
                  ${this.useRawMode ? '📋 Table Mode' : '📝 Raw JSON'}
                </button>
              </div>

              ${this.useRawMode ?
                html`
                  <textarea
                    style="width: 100%; height: 100%; font-family: monospace; padding: 8px; flex: 1;"
                    .value="${JSON.stringify(this.content, null, 2)}"
                    @input="${(e) => {
                      try {
                        this.content = JSON.parse(e.target.value);
                        this.localProjects = JSON.parse(
                          JSON.stringify(this.content.project_map || [])
                        );
                      } catch (err) {
                        /* ignore parse errors while typing */
                      }
                    }}"
                  ></textarea>
                `
              : html`
                  ${this.renderBrowsePanel()}
                  <div class="table-container">
                    <table>
                      <thead>
                        <tr>
                          <th style="width:36px"><input type="checkbox" /></th>
                          <th style="width:200px">Project</th>
                          <th>Area Path</th>
                          <th style="width:220px">Work Item Types</th>
                          <th style="width:220px">States</th>
                          <th style="width:120px">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${projects.length === 0 ?
                          html`
                            <tr>
                              <td
                                colspan="6"
                                style="text-align:center;padding:40px;color:#6b7280"
                              >
                                No projects configured. Click "Add Project" to create one.
                              </td>
                            </tr>
                          `
                        : projects.map(
                            (project, index) => html`
                              ${this.renderDisplayRow(project, index)}
                              ${this.editingIndex === index ?
                                this.renderEditRow(project, index)
                              : ''}
                            `
                          )}
                      </tbody>
                    </table>
                  </div>
                `}
            </div>
          </div>
          <div class="actions">
            ${this.statusMsg ?
              html` <span class="status ${this.statusType}">${this.statusMsg}</span> `
            : ''}
          </div>
        </div>
      </section>
    `;
  }
}

customElements.define('admin-projects', AdminProjects);
