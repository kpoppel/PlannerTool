import { html, css } from '/static/js/vendor/lit.js';
import { BaseConfigComponent } from './BaseConfigComponent.lit.js';

export class AdminProjects extends BaseConfigComponent {
  static properties = {
    ...BaseConfigComponent.properties,
    editingIndex: { type: Number },
    localProjects: { type: Array },
    availableTaskTypes: { type: Array },
    availableStates: { type: Array }
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
    `
  ];

  constructor() {
    super();
    this.editingIndex = -1;
    this.localProjects = [];
    this.availableTaskTypes = [];
    this.availableStates = [];
  }

  get configType() { return 'projects'; }
  get title() { return 'Projects Configuration'; }
  get defaultContent() { return { project_map: [] }; }

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
  }

  addNewProject() {
    const newProject = {
      name: 'New Project',
      type: 'project',
      area_path: '',
      task_types: [],
      include_states: []
    };
    this.localProjects = [...this.localProjects, newProject];
    this.editingIndex = this.localProjects.length - 1;
  }

  editProject(index) {
    this.editingIndex = index;
  }

  cancelEdit() {
    // Reset local projects from content
    this.localProjects = JSON.parse(JSON.stringify(this.content.project_map || []));
    this.editingIndex = -1;
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
      [field]: value
    };
    this.requestUpdate();
  }

  addChip(index, field, value) {
    if (!value || !value.trim()) return;
    const current = this.localProjects[index][field] || [];
    if (!current.includes(value.trim())) {
      this.updateProjectField(index, field, [...current, value.trim()]);
    }
  }

  removeChip(index, field, chipValue) {
    const current = this.localProjects[index][field] || [];
    this.updateProjectField(index, field, current.filter(v => v !== chipValue));
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
          ${(project.task_types || []).map(type => html`
            <span class="chip">${type}</span>
          `)}
          ${(project.task_types || []).length === 0 ? html`<span class="small">—</span>` : ''}
        </td>
        <td>
          ${(project.include_states || []).map(state => html`
            <span class="chip">${state}</span>
          `)}
          ${(project.include_states || []).length === 0 ? html`<span class="small">—</span>` : ''}
        </td>
        <td>
          <div class="actions">
            <button class="action-btn" @click="${() => this.editProject(index)}">Edit</button>
            <button class="action-btn" @click="${() => this.deleteProject(index)}">🗑</button>
          </div>
        </td>
      </tr>
    `;
  }

  renderEditRow(project, index) {
    return html`
      <tr class="edit-row">
        <td></td>
        <td colspan="5">
          <div class="edit-form">
            <div class="form-group">
              <label style="display:flex;flex-direction:column;min-width:250px;margin-right:16px">
                Project Name
                <input 
                  style="padding:6px;border:1px solid #d1d5db;border-radius:4px;font-size:14px;margin-top:4px"
                  .value="${project.name || ''}" 
                  @input="${(e) => this.updateProjectField(index, 'name', e.target.value)}"
                />
              </label>
              <label style="display:flex;flex-direction:column;min-width:140px;margin-right:16px">
                Type
                <select 
                  style="padding:6px;border:1px solid #d1d5db;border-radius:4px;font-size:14px;margin-top:4px"
                  .value="${project.type || 'project'}"
                  @change="${(e) => this.updateProjectField(index, 'type', e.target.value)}"
                >
                  <option value="project">project</option>
                  <option value="team">team</option>
                </select>
              </label>
              <label style="display:flex;flex-direction:column;flex:1">
                Area Path
                <input 
                  style="padding:6px;border:1px solid #d1d5db;border-radius:4px;font-size:14px;margin-top:4px"
                  .value="${project.area_path || ''}" 
                  @input="${(e) => this.updateProjectField(index, 'area_path', e.target.value)}"
                />
              </label>
            </div>

            <div class="form-group">
              <div class="form-section">
                <div class="form-section-title">Work Item Types</div>
                <div class="chip-editor">
                  ${(project.task_types || []).map(type => html`
                    <span class="chip removable" @click="${() => this.removeChip(index, 'task_types', type)}">
                      ${type}<span class="chip-remove">×</span>
                    </span>
                  `)}
                </div>
                ${this.availableTaskTypes.length > 0 ? html`
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
                    ${this.availableTaskTypes.filter(t => !(project.task_types || []).includes(t)).map(type => html`
                      <option value="${type}">${type}</option>
                    `)}
                  </select>
                ` : html`
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
                <div class="form-section-title">States</div>
                <div class="chip-editor">
                  ${(project.include_states || []).map(state => html`
                    <span class="chip removable" @click="${() => this.removeChip(index, 'include_states', state)}">
                      ${state}<span class="chip-remove">×</span>
                    </span>
                  `)}
                </div>
                ${this.availableStates.length > 0 ? html`
                  <select 
                    class="add-chip-select"
                    @change="${(e) => {
                      if (e.target.value) {
                        this.addChip(index, 'include_states', e.target.value);
                        e.target.value = '';
                      }
                    }}"
                  >
                    <option value="">+ Add state</option>
                    ${this.availableStates.filter(s => !(project.include_states || []).includes(s)).map(state => html`
                      <option value="${state}">${state}</option>
                    `)}
                  </select>
                ` : ''}
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

              <div class="edit-actions">
                <button class="action-btn" style="background:#10b981;color:#fff" @click="${() => this.saveEdit(index)}">Save</button>
                <button class="action-btn" @click="${() => this.cancelEdit()}">Cancel</button>
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
                <button class="btn primary" @click="${this.addNewProject}">+ Add Project</button>
                <button class="btn" @click="${this.saveConfig}">💾 Save All</button>
                <button class="btn" @click="${this.loadConfig}">🔄 Reload</button>
                <div style="margin-left:auto;color:#6b7280;font-size:0.9rem">
                  Showing ${projects.length} project${projects.length !== 1 ? 's' : ''}
                </div>
                <button class="btn toggle-mode" @click="${this.toggleMode}">
                  ${this.useRawMode ? '📋 Table Mode' : '📝 Raw JSON'}
                </button>
              </div>

              ${this.useRawMode ? html`
                <textarea 
                  style="width: 100%; height: 100%; font-family: monospace; padding: 8px; flex: 1;"
                  .value="${JSON.stringify(this.content, null, 2)}"
                  @input="${(e) => { 
                    try { 
                      this.content = JSON.parse(e.target.value);
                      this.localProjects = JSON.parse(JSON.stringify(this.content.project_map || []));
                    } catch(err) { /* ignore parse errors while typing */ }
                  }}"
                ></textarea>
              ` : html`
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
                      ${projects.length === 0 ? html`
                        <tr>
                          <td colspan="6" style="text-align:center;padding:40px;color:#6b7280">
                            No projects configured. Click "Add Project" to create one.
                          </td>
                        </tr>
                      ` : projects.map((project, index) => html`
                        ${this.renderDisplayRow(project, index)}
                        ${this.editingIndex === index ? this.renderEditRow(project, index) : ''}
                      `)}
                    </tbody>
                  </table>
                </div>
              `}
            </div>
          </div>
          <div class="actions">
            ${this.statusMsg ? html`
              <span class="status ${this.statusType}">${this.statusMsg}</span>
            ` : ''}
          </div>
        </div>
      </section>
    `;
  }
}

customElements.define('admin-projects', AdminProjects);
