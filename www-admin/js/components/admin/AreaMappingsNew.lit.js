import { LitElement, html, css } from '/static/js/vendor/lit.js';
import { adminProvider } from '../../services/providerREST.js';

export class AreaMappingsNew extends LitElement {
  static properties = {
    mappings: { type: Object },
    projects: { type: Array },
    loading: { type: Boolean },
    refreshing: { type: Boolean },
    error: { type: String },
    success: { type: String },
    expandedProjects: { type: Object, state: true },
    showRawJson: { type: Boolean },
    rawJsonContent: { type: String }
  };

  static styles = css`
    :host { display: block; height: 100%; }
    h2 { margin-top: 0; font-size: 1.1rem; }
    
    .panel { 
      padding: 12px; 
      background: #fff; 
      border: 1px solid #e5e7eb; 
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      height: calc(100vh - 160px);
      box-sizing: border-box;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      padding-bottom: 12px;
      border-bottom: 1px solid #e5e7eb;
    }

    .actions {
      display: flex;
      gap: 8px;
    }

    button {
      padding: 8px 16px;
      border-radius: 6px;
      border: 1px solid #ccc;
      background: #f3f4f6;
      cursor: pointer;
      font-size: 0.9rem;
      transition: all 0.2s;
    }

    button:hover { background: #e5e7eb; }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    button.primary {
      background: #3b82f6;
      color: #fff;
      border-color: #3b82f6;
    }

    button.primary:hover { background: #2563eb; }

    .message {
      padding: 12px;
      margin-bottom: 12px;
      border-radius: 6px;
      font-size: 0.9rem;
    }

    .error {
      background: #fef2f2;
      border: 1px solid #fecaca;
      color: #ef4444;
    }

    .success {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      color: #16a34a;
    }

    .info-box {
      background: #f9fafb;
      border-left: 4px solid #3b82f6;
      padding: 12px 16px;
      margin-bottom: 16px;
      font-size: 0.9rem;
      color: #374151;
    }

    .last-update {
      font-size: 0.85rem;
      color: #6b7280;
      margin-bottom: 24px;
    }

    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
      gap: 16px;
      padding: 4px;
    }

    @media (max-width: 1200px) {
      .cards-grid {
        grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
      }
    }

    @media (max-width: 768px) {
      .cards-grid {
        grid-template-columns: 1fr;
      }
    }
    
    .content {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }

    .area-card {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 16px;
      transition: box-shadow 0.2s;
    }

    .area-card:hover {
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      border-color: #d1d5db;
    }

    .area-card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 16px;
      gap: 16px;
    }

    .area-info {
      flex: 1;
      min-width: 0;
    }

    .project-badge {
      display: inline-block;
      padding: 4px 10px;
      background: #3b82f6;
      color: white;
      font-size: 10px;
      font-weight: 700;
      border-radius: 4px;
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .area-path {
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 14px;
      color: #1d4ed8;
      font-weight: 500;
      word-break: break-word;
      line-height: 1.4;
    }

    .refresh-btn {
      padding: 8px 12px;
      font-size: 16px;
      min-width: auto;
      flex-shrink: 0;
      border-radius: 4px;
    }

    .area-stats {
      font-size: 13px;
      color: #6b7280;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid #e5e7eb;
    }

    .project-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px;
      cursor: pointer;
      border-bottom: 1px solid #e5e7eb;
      transition: background 0.1s;
    }

    .project-header:hover {
      background: #f3f4f6;
    }

    .project-title {
      display: flex;
      align-items: center;
      gap: 12px;
      font-weight: 600;
      font-size: 14px;
    }

    .expand-icon {
      transition: transform 0.2s;
    }

    .expand-icon.expanded {
      transform: rotate(90deg);
    }

    .project-stats {
      font-size: 12px;
      color: #6b7280;
    }

    .project-content {
      display: none;
      padding: 16px;
    }

    .project-content.expanded {
      display: block;
    }

    .area-item {
      margin-bottom: 24px;
      padding: 16px;
      background: #f9fafb;
      border-radius: 4px;
      border: 1px solid #e5e7eb;
    }

    .area-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 12px;
    }

    .area-path {
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 13px;
      color: #1d4ed8;
      font-weight: 500;
      word-break: break-all;
    }

    .area-actions {
      display: flex;
      gap: 8px;
    }

    .area-actions button {
      padding: 4px 8px;
      font-size: 11px;
    }

    .plans-list {
    .plan-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      transition: all 0.15s;
    }

    .plan-item:hover {
      background: #f3f4f6;
      border-color: #3b82f6;
    }

    .plan-item.disabled {
      opacity: 0.5;
    }

    .plan-item.disabled:hover {
      background: #fff;
    }plan-item:hover {
      background: #f3f4f6;
    }

    .plan-item.disabled {
      opacity: 0.6;
    }

    .plan-checkbox {
      flex-shrink: 0;
    }

    .plan-name {
      font-size: 14px;
      color: #1f2937;
      font-weight: 500;
      margin-bottom: 4px;
    }

    .plan-id {
      font-size: 11px;
      color: #6b7280;
      font-family: 'Consolas', 'Monaco', monospace;
      word-break: break-all;
    } font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .plan-id {
      font-size: 11px;
      color: #6b7280;
      font-family: 'Consolas', 'Monaco', monospace;
      margin-top: 2px;
    }

    .no-plans {
      font-size: 13px;
      color: #6b7280;
      font-style: italic;
      padding: 12px;
      text-align: center;
    }

    .empty-state {
      text-align: center;
      padding: 48px 20px;
      color: #6b7280;
    }

    .empty-state svg {
      width: 64px;
      height: 64px;
      margin-bottom: 16px;
      opacity: 0.5;
    }

    .loading {
      text-align: center;
      padding: 48px 20px;
      color: #6b7280;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .spinner {
      display: inline-block;
      width: 32px;
      height: 32px;
      border: 3px solid #e5e7eb;
      border-top-color: #3b82f6;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-bottom: 16px;
    }
    
    .raw-json-editor {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-height: 0;
    }

    .raw-json-editor textarea {
      flex: 1;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 0.85rem;
      padding: 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      background: #fff;
      color: #1f2937;
      resize: none;
    }
    
    .raw-json-editor textarea:focus {
      outline: none;
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }
    
    .json-actions {
      display: flex;
      gap: 8px;
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
    }
  `;

  constructor() {
    super();
    this.mappings = null;
    this.projects = [];
    this.loading = false;
    this.refreshing = false;
    this.error = null;
    this.success = null;
    this.expandedProjects = {};
  }

  async connectedCallback() {
    super.connectedCallback();
    await this.loadData();
  }

  async loadData() {
    this.loading = true;
    this.error = null;
    try {
      const [mappings, projects] = await Promise.all([
        adminProvider.getAreaMappings(),
        adminProvider.getProjects()
      ]);
      this.mappings = mappings;
      this.projects = projects?.project_map || [];
    } catch (err) {
      this.error = `Failed to load area mappings: ${err.message}`;
    } finally {
      this.loading = false;
    }
  }

  async refreshAll() {
    this.refreshing = true;
    this.error = null;
    this.success = null;
    try {
      await adminProvider.refreshAllAreaMappings();
      this.success = 'Successfully refreshed all area mappings';
      await this.loadData();
      setTimeout(() => { this.success = null; }, 3000);
    } catch (err) {
      this.error = `Failed to refresh mappings: ${err.message}`;
    } finally {
      this.refreshing = false;
    }
  }

  toggleRawJson() {
    this.showRawJson = !this.showRawJson;
    if (this.showRawJson) {
      // Switching to raw JSON mode - load current mappings as JSON
      this.rawJsonContent = JSON.stringify(this.mappings || {}, null, 2);
    }
  }

  async saveRawJson() {
    try {
      const parsed = JSON.parse(this.rawJsonContent);
      await adminProvider.saveAreaMappings(parsed);
      this.success = 'Mappings saved successfully';
      this.showRawJson = false;
      await this.loadData();
      setTimeout(() => { this.success = null; }, 3000);
    } catch (err) {
      this.error = `Error saving mappings: ${err.message}`;
    }
  }

  async refreshArea(projectId, areaPath) {
    this.error = null;
    this.success = null;
    try {
      await adminProvider.refreshAreaMapping(areaPath);
      this.success = `Refreshed ${areaPath}`;
      await this.loadData();
      setTimeout(() => { this.success = null; }, 3000);
    } catch (err) {
      this.error = `Failed to refresh ${areaPath}: ${err.message}`;
    }
  }

  async togglePlan(projectId, areaPath, planId, currentEnabled) {
    this.error = null;
    const newEnabled = !currentEnabled;
    try {
      await adminProvider.togglePlanEnabled(projectId, areaPath, planId, newEnabled);
      // Update local state immediately for responsive UI
      if (this.mappings?.[projectId]?.areas?.[areaPath]?.plans?.[planId]) {
        this.mappings[projectId].areas[areaPath].plans[planId].enabled = newEnabled;
        this.requestUpdate();
      }
    } catch (err) {
      this.error = `Failed to toggle plan: ${err.message}`;
      // Reload to get correct state
      await this.loadData();
    }
  }

  toggleProject(projectId) {
    this.expandedProjects = {
      ...this.expandedProjects,
      [projectId]: !this.expandedProjects[projectId]
    };
    this.requestUpdate();
  }

  toggleProject(projectId) {
    // Not needed anymore with card layout
  }

  getAllAreaMappings() {
    // Flatten all areas from all projects into a single list
    const allAreas = [];
    
    if (!this.mappings) {
      console.log('No mappings data');
      return allAreas;
    }
    
    console.log('Mappings keys:', Object.keys(this.mappings));
    console.log('Projects:', this.projects);
    
    // Iterate through all keys in mappings (excluding last_update)
    for (const [projectId, projectData] of Object.entries(this.mappings)) {
      if (projectId === 'last_update') continue;
      
      // Find project name from projects list
      const project = this.projects.find(p => p.id === projectId);
      const projectName = project?.name || projectId;
      
      const areas = projectData?.areas || {};
      console.log(`Project ${projectId}:`, Object.keys(areas).length, 'areas');
      
      for (const [areaPath, areaData] of Object.entries(areas)) {
        allAreas.push({
          projectId,
          projectName,
          areaPath,
          plans: areaData?.plans || {}
        });
      }
    }
    
    console.log('Total areas:', allAreas.length);
    return allAreas;
  }

  renderAreaCard(areaMapping) {
    const { projectId, projectName, areaPath, plans } = areaMapping;
    const planCount = Object.keys(plans).length;
    const enabledCount = Object.values(plans).filter(p => p.enabled).length;

    return html`
      <div class="area-card">
        <div class="area-card-header">
          <div class="area-info">
            <div class="project-badge">${projectName}</div>
            <div class="area-path">${areaPath}</div>
          </div>
          <button @click="${() => this.refreshArea(projectId, areaPath)}" class="refresh-btn" ?disabled="${this.refreshing}">
            🔄
          </button>
        </div>
        
        <div class="area-stats">
          ${planCount} plan${planCount !== 1 ? 's' : ''} • ${enabledCount} enabled
        </div>
        
        ${planCount === 0 ? html`
          <div class="no-plans">No plans found for this area</div>
        ` : html`
          <div class="plans-list">
            ${Object.entries(plans).map(([planId, planInfo]) => html`
              <div class="plan-item ${planInfo.enabled ? '' : 'disabled'}">
                <div class="plan-checkbox">
                  <input
                    type="checkbox"
                    .checked="${planInfo.enabled}"
                    @change="${() => this.togglePlan(projectId, areaPath, planId, planInfo.enabled)}"
                  />
                </div>
                <div class="plan-info">
                  <div class="plan-name">${planInfo.name || planId}</div>
                  <div class="plan-id">${planId}</div>
                </div>
              </div>
            `)}
          </div>
        `}
      </div>
    `;
  }

  render() {
    if (this.loading) {
      return html`
        <section>
          <h2>Area Mappings</h2>
          <div class="panel">
            <div class="loading">
              <div class="spinner"></div>
              <div>Loading area mappings...</div>
            </div>
          </div>
        </section>
      `;
    }

    const hasData = this.mappings && Object.keys(this.mappings).some(k => k !== 'last_update');
    const lastUpdate = this.mappings?.last_update;

    return html`
      <section>
        <h2>Area Mappings</h2>
        <div class="panel">
          <div class="header">
            <div class="info-box" style="margin: 0; flex: 1;">
              Area mappings connect Azure DevOps area paths to delivery plan IDs. 
              Plans are automatically discovered from Azure. Use the checkboxes to enable/disable plans for the overlay plugin.
            </div>
            <div class="actions">
              <button @click="${this.toggleRawJson}">
                ${this.showRawJson ? '📋 Card View' : '📝 Raw JSON'}
              </button>
              <button @click="${this.refreshAll}" ?disabled="${this.refreshing}" class="primary">
                ${this.refreshing ? '⏳ Refreshing...' : '🔄 Refresh All'}
              </button>
            </div>
          </div>

          ${this.error ? html`<div class="message error">${this.error}</div>` : ''}
          ${this.success ? html`<div class="message success">${this.success}</div>` : ''}

          ${this.showRawJson ? html`
            <div class="raw-json-editor">
              <textarea 
                .value="${this.rawJsonContent}"
                @input="${(e) => { this.rawJsonContent = e.target.value; }}"
              ></textarea>
              <div class="json-actions">
                <button @click="${this.saveRawJson}" class="primary">💾 Save</button>
                <button @click="${this.loadData}">🔄 Reload</button>
              </div>
            </div>
          ` : html`
            <div class="content">
              ${lastUpdate ? html`
                <div class="last-update">
                  Last updated: ${new Date(lastUpdate).toLocaleString()}
                </div>
              ` : ''}

              ${!hasData ? html`
              <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
                </svg>
                <div>No area mappings found</div>
                <div>Click "Refresh All" to fetch mappings from Azure DevOps</div>
              </div>
            ` : html`
              <div class="cards-grid">
                ${this.getAllAreaMappings().map(area => this.renderAreaCard(area))}
              </div>
            `}
            </div>
          `}
        </div>
      </section>
    `;
  }
}

customElements.define('area-mappings-new', AreaMappingsNew);
