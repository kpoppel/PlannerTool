import { html, css } from '/static/js/vendor/lit.js';
import { BaseConfigComponent } from './BaseConfigComponent.lit.js';
import { adminProvider } from '../../services/providerREST.js';
import {
  setMetadata,
  getMetadata,
  getStateCategoryColor,
  azureProjectFromAreaPath,
} from '../../services/azureMetadataCache.js';
import { adminProjectsStyles } from './projects/styles.js';
import {
  renderBrowsePanelTemplate,
  renderRowTemplate,
  renderStatesDisplayTemplate,
  renderStatesEditTemplate,
  renderMainTemplate,
} from './projects/templates.js';

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
    adminProjectsStyles,
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
    // Resolve organization URL from saved ADO config and pass it explicitly
    const adoCfg = await adminProvider.getAdo();
    const org = (adoCfg && adoCfg.organization_url) || '';
    const result = await adminProvider.browseAzureProjects(org);
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

  /** Add an Azure area path to the local project config (from browse panel) */
  async _onAddAreaPathToConfig(areaPath) {
    if (!areaPath) return;
    // avoid duplicates
    if ((this.localProjects || []).some((p) => p.area_path === areaPath)) {
      this.statusMsg = 'Area path already configured';
      this.statusType = 'warning';
      setTimeout(() => { this.statusMsg = ''; this.statusType = ''; this.requestUpdate(); }, 2500);
      return;
    }

    const sep = areaPath.includes('\\') ? '\\' : '/';
    const azureProject = areaPath.split(sep)[0];
    let metadata = azureProject ? getMetadata(azureProject) : null;

    try {
      this._azureBrowseLoading = true;
      // Fetch project-level metadata if not already cached
      if (!metadata && azureProject) {
        const pm = await adminProvider.getWorkItemMetadata(azureProject);
        if (!pm.error) {
          setMetadata(azureProject, pm);
          metadata = pm;
        }
      }
      // Fetch area-path specific metadata (types/states)
      if (azureProject) {
        const am = await adminProvider.getAreaPathMetadata(azureProject, areaPath);
        if (!am.error) {
          // prefer area-path metadata for types/states when available
          metadata = { ...(metadata || {}), ...(am || {}) };
          setMetadata(azureProject, metadata);
        }
      }
    } catch (err) {
      console.warn('Failed to load metadata for area path', areaPath, err);
    } finally {
      this._azureBrowseLoading = false;
    }

    const newProject = {
      name: areaPath.split(sep).slice(-1)[0] || areaPath,
      type: 'project',
      area_path: areaPath,
      task_types: metadata?.types ? [...metadata.types] : [],
      include_states: metadata?.states ? [...metadata.states] : [],
      display_states: metadata?.states ? [...metadata.states] : [],
    };

    this.localProjects = [...this.localProjects, newProject];
    this.content = { ...this.content, project_map: [...this.localProjects] };
    this.editingIndex = this.localProjects.length - 1;
    this._editMetadata = metadata || null;
    this._editMetadataError = '';
    this._azureBrowsePanelOpen = false;
    this.requestUpdate();
  }

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
  // Delegated to templates.renderStateChip

  /** States column in display mode: Fetch and Display sections on one horizontal line. */
  _renderStatesDisplay(project) {
    return renderStatesDisplayTemplate(this, project);
  }

  /** States column in edit mode: chip editors for Fetch and Display side by side. */
  _renderStatesEdit(project, index) {
    return renderStatesEditTemplate(this, project, index);
  }

  // --- Drag & drop reordering ---

  _onRowDragStart(e) {
    const tr = e.currentTarget;
    const idx = Number(tr.dataset.index);
    this._dragSrcIndex = idx;
    try {
      e.dataTransfer.setData('text/plain', String(idx));
      e.dataTransfer.effectAllowed = 'move';
    } catch (err) {
      // ignore
    }
    tr.classList.add('dragging');
  }

  _onRowDragEnter(e) {
    e.preventDefault();
    const tr = e.currentTarget;
    tr.classList.add('drag-over');
  }

  _onRowDragLeave(e) {
    const tr = e.currentTarget;
    tr.classList.remove('drag-over');
  }

  _onRowDragOver(e) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }

  _onRowDrop(e) {
    e.preventDefault();
    const tr = e.currentTarget;
    const tgt = Number(tr.dataset.index);
    const src = Number(e.dataTransfer?.getData('text/plain') ?? this._dragSrcIndex);
    this._performReorder(src, tgt);
    // cleanup classes
    tr.classList.remove('drag-over');
    const dragging = this.shadowRoot?.querySelectorAll?.('tr.dragging');
    if (dragging) dragging.forEach((r) => r.classList.remove('dragging'));
    delete this._dragSrcIndex;
    this.requestUpdate();
  }

  _onRowDragEnd(e) {
    const dragging = this.shadowRoot?.querySelectorAll?.('tr.dragging');
    if (dragging) dragging.forEach((r) => r.classList.remove('dragging'));
    delete this._dragSrcIndex;
    this.requestUpdate();
  }

  _performReorder(sourceIndex, targetIndex) {
    if (!Number.isFinite(sourceIndex) || !Number.isFinite(targetIndex)) return;
    if (sourceIndex === targetIndex) return;
    const arr = Array.isArray(this.localProjects) ? [...this.localProjects] : [];
    if (sourceIndex < 0 || sourceIndex >= arr.length) return;
    if (targetIndex < 0 || targetIndex >= arr.length) return;
    const [item] = arr.splice(sourceIndex, 1);
    let insertIndex = targetIndex;
    if (sourceIndex < targetIndex) insertIndex = targetIndex - 1;
    if (insertIndex < 0) insertIndex = 0;
    arr.splice(insertIndex, 0, item);
    this.localProjects = arr;
    this.content = { ...this.content, project_map: [...this.localProjects] };
    this.requestUpdate();
  }

  renderRow(project, index) {
    return renderRowTemplate(this, project, index);
  }

  render() {
    return renderMainTemplate(this);
  }
}

customElements.define('admin-projects', AdminProjects);
