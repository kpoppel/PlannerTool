import { html } from '/static/js/vendor/lit.js';

export const renderStateChip = (ctx, state, areaPath, editable = false, field = '', index = -1) => {
  const bg = ctx._stateBg(areaPath, state);
  if (editable) {
    return html`<span class="chip removable" style="background:${bg}"
      @click=${() => ctx.removeChip(index, field, state)}>
        ${state}<span class="chip-remove">×</span>
      </span>`;
  }
  return html`<span class="chip" style="background:${bg}">${state}</span>`;
};

export const renderBrowsePanelTemplate = (ctx) => html`
      <div class="browse-panel">
        <div class="browse-panel-header"
          @click=${() => { ctx._azureBrowsePanelOpen = !ctx._azureBrowsePanelOpen; }}>
          <span>${ctx._azureBrowsePanelOpen ? '▼' : '▶'}</span>
          <span>🔍 Browse from Azure DevOps</span>
          ${ctx._azureBrowseLoading
            ? html`<span class="small" style="margin-left:8px">Loading…</span>`
            : ''}
        </div>
        ${ctx._azureBrowsePanelOpen ? html`
          <div class="browse-panel-body">
            ${ctx._azureBrowseError
              ? html`<div class="browse-error">${ctx._azureBrowseError}</div>` : ''}
            <div class="browse-row">
              <button class="btn" @click=${ctx._onBrowseAzureProjects}
                ?disabled=${ctx._azureBrowseLoading}>
                Load Projects
              </button>
              ${ctx._azureProjects.length > 0 ? html`
                <select class="browse-select" @change=${ctx._onAzureProjectSelect}>
                  <option value="">— Select project —</option>
                  ${ctx._azureProjects.map((p) => html`<option value="${p}">${p}</option>`)}
                </select>
              ` : ''}
            </div>
            ${ctx._selectedAzureProject && ctx._azureAreaPaths.length > 0 ? html`
              <div class="small">
                ${ctx._azureAreaPaths.length} area path${ctx._azureAreaPaths.length !== 1 ? 's' : ''}
                — click <strong>+ Add</strong> to auto-configure:
              </div>
              <input type="text" class="add-chip-input"
                style="width:100%;box-sizing:border-box;margin-top:0;max-width:none"
                placeholder="Filter area paths…"
                .value=${ctx._areaPathFilter}
                @input=${(e) => { ctx._areaPathFilter = e.target.value; }}
              />
              <div class="area-path-list">
                ${ctx._azureAreaPaths
                  .filter((ap) => ap.toLowerCase().includes(ctx._areaPathFilter.toLowerCase()))
                  .map((ap) => html`
                    <div class="area-path-row">
                      <span class="area-path-name">${ap}</span>
                      <button class="action-btn" ?disabled=${ctx._azureBrowseLoading}
                        @click=${() => ctx._onAddAreaPathToConfig(ap)}>
                        + Add
                      </button>
                    </div>
                  `)}
                ${ctx._azureAreaPaths.filter((ap) =>
                    ap.toLowerCase().includes(ctx._areaPathFilter.toLowerCase())).length === 0
                  ? html`<div class="small" style="padding:6px;text-align:center">
                      No matches for "${ctx._areaPathFilter}"</div>`
                  : ''}
              </div>
            ` : ''}
          </div>
        ` : ''}
      </div>
`;

export const renderStatesDisplayTemplate = (ctx, project) => html`
  <div class="states-row">
    <div class="states-section">
      <span class="states-label">F:</span>
      ${ (project.include_states || []).length > 0
          ? (project.include_states || []).map((s) => renderStateChip(ctx, s, project.area_path))
          : html`<span class="small">—</span>` }
    </div>
    ${(project.display_states || []).length > 0 ? html`
      <div class="states-divider"></div>
      <div class="states-section">
        <span class="states-label">D:</span>
        ${ (project.display_states || []).map((s) => renderStateChip(ctx, s, project.area_path)) }
      </div>
    ` : ''}
  </div>
`;

export const renderStatesEditTemplate = (ctx, project, index) => {
  const editStates = ctx._editStates;
  const fetch = project.include_states || [];
  const disp = project.display_states || [];
  return html`
    <div class="edit-states-row">
      <div class="edit-state-section">
        <div class="edit-state-section-title">States to Fetch</div>
        <div class="chip-editor">
          ${fetch.map((s) => renderStateChip(ctx, s, project.area_path, true, 'include_states', index))}
        </div>
        ${editStates.length > 0 ? html`
          <select class="add-chip-select" @change=${(e) => {
            if (e.target.value) { ctx.addChip(index, 'include_states', e.target.value); e.target.value = ''; }
          }}>
            <option value="">+ Add state</option>
            ${editStates.filter((s) => !fetch.includes(s)).map((s) => html`<option value="${s}">${s}</option>`) }
          </select>
        ` : ''}
        <input class="add-chip-input" placeholder="Custom state + Enter"
          @keydown=${(e) => { if (e.key === 'Enter') { ctx.addChip(index, 'include_states', e.target.value); e.target.value = ''; } }}
        />
      </div>
      <div class="edit-state-section">
        <div class="edit-state-section-title">States for UI Display</div>
        <div class="chip-editor">
          ${disp.map((s) => renderStateChip(ctx, s, project.area_path, true, 'display_states', index))}
        </div>
        ${editStates.length > 0 ? html`
          <select class="add-chip-select" @change=${(e) => {
            if (e.target.value) { ctx.addChip(index, 'display_states', e.target.value); e.target.value = ''; }
          }}>
            <option value="">+ Add state</option>
            ${editStates.filter((s) => !disp.includes(s)).map((s) => html`<option value="${s}">${s}</option>`) }
          </select>
        ` : ''}
        <input class="add-chip-input" placeholder="Custom state + Enter"
          @keydown=${(e) => { if (e.key === 'Enter') { ctx.addChip(index, 'display_states', e.target.value); e.target.value = ''; } }}
        />
      </div>
    </div>
  `;
};

export const renderRowTemplate = (ctx, project, index) => {
  const isEditing = ctx.editingIndex === index;
  if (!isEditing) {
    return html`
      <tr draggable="true" data-index="${index}"
        @dragstart=${(e) => ctx._onRowDragStart(e)}
        @dragenter=${(e) => ctx._onRowDragEnter(e)}
        @dragleave=${(e) => ctx._onRowDragLeave(e)}
        @dragover=${(e) => ctx._onRowDragOver(e)}
        @drop=${(e) => ctx._onRowDrop(e)}
        @dragend=${(e) => ctx._onRowDragEnd(e)}>
        <td class="drag-handle" style="width:36px;cursor:grab">☰</td>
        <td>
          <div style="font-weight:600">${project.name || 'Unnamed'}</div>
          <div class="small">${project.type || 'project'}</div>
        </td>
        <td class="nowrap" title="${project.area_path}">${project.area_path || '—'}</td>
        <td>
          ${(project.task_types || []).map((t) => html`<span class="chip">${t}</span>`) }
          ${(project.task_types || []).length === 0
            ? html`<span class="small">—</span>` : ''}
        </td>
        <td>${renderStatesDisplayTemplate(ctx, project)}</td>
        <td>
          <div class="actions">
            <button class="action-btn" @click=${() => ctx.editProject(index)}>Edit</button>
            <button class="action-btn" @click=${() => ctx.deleteProject(index)}>🗑</button>
          </div>
        </td>
      </tr>
    `;
  }

  const editTypes = ctx._editTypes;
  return html`
    <tr class="editing-row">
      <td class="drag-handle" style="width:36px;opacity:0.6">☰</td>
      <td style="min-width:180px">
        <input class="inline-input" style="margin-bottom:4px"
          .value=${project.name || ''}
          @input=${(e) => ctx.updateProjectField(index, 'name', e.target.value)}
        />
        <select class="inline-select"
          .value=${project.type || 'project'}
          @change=${(e) => ctx.updateProjectField(index, 'type', e.target.value)}>
          <option value="project">project</option>
          <option value="team">team</option>
        </select>
      </td>
      <td style="min-width:220px">
        <div style="display:flex;gap:4px;align-items:center">
          <input class="inline-input"
            .value=${project.area_path || ''}
            @input=${(e) => {
              ctx.updateProjectField(index, 'area_path', e.target.value);
              ctx._editMetadata = null;
              ctx._editMetadataError = '';
            }}
          />
          <button class="load-btn"
            title="Load types &amp; states for this area path"
            ?disabled=${ctx._editMetadataLoading || !project.area_path}
            @click=${() => ctx._fetchEditMetadata(project.area_path)}>
            ${ctx._editMetadataLoading ? '…' : '⟳'}
          </button>
        </div>
        ${ctx._editMetadataError
          ? html`<div class="browse-error">${ctx._editMetadataError}</div>` : ''}
        ${ctx._editMetadata && !ctx._editMetadataLoading ? html`
          <div class="edit-meta-hint">
            ${(ctx._editMetadata.types || []).join(', ') || '—'}
          </div>` : ''}
      </td>
      <td style="min-width:160px">
        <div class="chip-editor">
          ${(project.task_types || []).map((t) => html`
            <span class="chip removable"
              @click=${() => ctx.removeChip(index, 'task_types', t)}>
              ${t}<span class="chip-remove">×</span>
            </span>`) }
        </div>
        ${editTypes.length > 0 ? html`
          <select class="add-chip-select" @change=${(e) => {
            if (e.target.value) { ctx.addChip(index, 'task_types', e.target.value); e.target.value = ''; }
          }}>
            <option value="">+ Add type</option>
            ${editTypes.filter((t) => !(project.task_types || []).includes(t)).map(
              (t) => html`<option value="${t}">${t}</option>`)}
          </select>
        ` : html`
          <input class="add-chip-input" placeholder="Type + Enter"
            @keydown=${(e) => {
              if (e.key === 'Enter') { ctx.addChip(index, 'task_types', e.target.value); e.target.value = ''; }
            }}
          />
        `}
      </td>
      <td>${renderStatesEditTemplate(ctx, project, index)}</td>
      <td>
        <div class="actions" style="flex-direction:column;align-items:flex-start">
          <button class="action-btn" style="background:#10b981;color:#fff;margin-bottom:4px"
            @click=${() => ctx.saveEdit(index)}>Save</button>
          <button class="action-btn"
            @click=${() => ctx.cancelEdit()}>Cancel</button>
        </div>
      </td>
    </tr>
  `;
};

export const renderMainTemplate = (ctx) => {
  if (ctx.loading) {
    return html`<div class="loading">Loading ${ctx.title.toLowerCase()}...</div>`;
  }

  const searchLower = (ctx._searchFilter || '').toLowerCase();
  const filteredProjects = (ctx.localProjects || []).filter((p) => {
    if (!searchLower) return true;
    return (
      (p.name || '').toLowerCase().includes(searchLower) ||
      (p.area_path || '').toLowerCase().includes(searchLower)
    );
  });

  return html`
    <section>
      <h2>${ctx.title}</h2>
      <div class="panel">
        <div class="editor">
          <div class="compact-table-view">
            <div class="toolbar">
              <button class="btn primary" @click="${ctx.addNewProject}">+ Add Project</button>
              <button class="btn" @click="${ctx.saveConfig}">💾 Save All</button>
              <button class="btn" @click="${ctx.loadConfig}">🔄 Reload</button>
              <div style="margin-left:auto;display:flex;align-items:center;gap:8px">
                ${ctx._prefetchLoading
                  ? html`<span class="small">Loading metadata…</span>` : ''}
                <span style="color:#6b7280;font-size:0.88rem">
                  ${filteredProjects.length}${filteredProjects.length !== (ctx.localProjects || []).length
                    ? `/${(ctx.localProjects || []).length}` : ''}
                  project${(ctx.localProjects || []).length !== 1 ? 's' : ''}
                </span>
                <button class="btn toggle-mode" @click="${ctx.toggleMode}">
                  ${ctx.useRawMode ? '📋 Table' : '📝 Raw JSON'}
                </button>
              </div>
            </div>

            ${ctx.useRawMode ? html`
              <textarea
                style="width:100%;height:100%;font-family:monospace;padding:8px;flex:1"
                .value="${JSON.stringify(ctx.content, null, 2)}"
                @input="${(e) => {
                  try {
                    ctx.content = JSON.parse(e.target.value);
                    ctx.localProjects = JSON.parse(JSON.stringify(ctx.content.project_map || []));
                  } catch { /* ignore parse errors while typing */ }
                }}"
              ></textarea>
            ` : html`
              ${renderBrowsePanelTemplate(ctx)}

              <div class="search-bar">
                <span class="small">🔎</span>
                <input type="text" class="search-input"
                  placeholder="Search by name or area path…"
                  .value="${ctx._searchFilter}"
                  @input="${(e) => { ctx._searchFilter = e.target.value; }}"
                />
                ${ctx._searchFilter ? html`
                  <button class="btn" style="padding:4px 8px"
                    @click="${() => { ctx._searchFilter = ''; }}">✕</button>
                ` : ''}
              </div>

              <div class="table-container">
                <table>
                  <thead>
                    <tr>
                        <th style="width:36px"></th>
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
                          ${ctx._searchFilter
                            ? `No projects match "${ctx._searchFilter}"`
                            : 'No projects configured. Click "+ Add Project" to create one.'}
                        </td>
                      </tr>
                    ` : filteredProjects.map((project) => {
                        const realIndex = (ctx.localProjects || []).indexOf(project);
                        return renderRowTemplate(ctx, project, realIndex);
                      })}
                  </tbody>
                </table>
              </div>
            `}
          </div>
        </div>
        <div class="actions">
          ${ctx.statusMsg
            ? html`<span class="status ${ctx.statusType}">${ctx.statusMsg}</span>` : ''}
        </div>
      </div>
    </section>
  `;
};
