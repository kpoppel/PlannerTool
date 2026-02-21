import { LitElement, html, css } from '/static/js/vendor/lit.js';
import { BaseConfigComponent } from './BaseConfigComponent.lit.js';
import { adminProvider } from '../../services/providerREST.js';

export class AdminCost extends LitElement {
  static properties = {
    activeTab: { type: String },
    content: { type: Object },
    schema: { type: Object },
    loading: { type: Boolean },
    statusMsg: { type: String },
    statusType: { type: String },
    inspectData: { type: Object },
    inspectLoading: { type: Boolean }
  };

  static styles = css`
    :host { display: block; height: 100%; }
    
    .tabs {
      display: flex;
      gap: 4px;
      border-bottom: 2px solid #e5e7eb;
      margin-bottom: 16px;
    }
    
    .tab {
      padding: 8px 16px;
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      cursor: pointer;
      font-size: 0.95rem;
      color: #6b7280;
      transition: all 0.2s;
      margin-bottom: -2px;
    }
    
    .tab:hover { color: #374151; }
    
    .tab.active {
      color: #3b82f6;
      border-bottom-color: #3b82f6;
      font-weight: 600;
    }
    
    h2 { margin-top: 0; font-size: 1.1rem; }
    
    .panel { 
      padding: 12px; 
      background: #fff; 
      border: 1px solid #e5e7eb; 
      border-radius: 6px; 
      height: calc(100vh - 200px); 
      box-sizing: border-box;
      overflow-y: auto;
    }
    
    .actions { 
      margin-top: 12px; 
      display: flex; 
      gap: 8px; 
      align-items: center;
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
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
    
    button.primary {
      background: #3b82f6;
      color: #fff;
      border-color: #3b82f6;
    }
    
    button.primary:hover { background: #2563eb; }
    
    .status { 
      margin-left: 8px; 
      font-size: 0.9rem; 
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
    
    /* Inspection view styles */
    .summary-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    
    .card {
      padding: 16px;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
    }
    
    .card-title {
      font-size: 0.85rem;
      color: #6b7280;
      margin-bottom: 8px;
      text-transform: uppercase;
      font-weight: 600;
    }
    
    .card-value {
      font-size: 1.5rem;
      font-weight: 700;
      color: #1f2937;
    }
    
    .card-subtitle {
      font-size: 0.85rem;
      color: #6b7280;
      margin-top: 4px;
    }
    
    .section {
      margin-bottom: 24px;
    }
    
    .section-title {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 12px;
      color: #1f2937;
      border-bottom: 2px solid #e5e7eb;
      padding-bottom: 8px;
    }
    
    .team-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    
    .team-card {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 16px;
      background: #fff;
    }
    
    .team-card.matched { border-left: 4px solid #10b981; }
    .team-card.unmatched { border-left: 4px solid #ef4444; }
    .team-card.config-only { border-left: 4px solid #f59e0b; }
    
    .team-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 12px;
    }
    
    .team-name {
      font-weight: 600;
      font-size: 1rem;
      color: #1f2937;
    }
    
    .team-id {
      font-family: monospace;
      font-size: 0.85rem;
      color: #6b7280;
      margin-top: 4px;
    }
    
    .team-badge {
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    
    .team-badge.matched { background: #d1fae5; color: #065f46; }
    .team-badge.unmatched { background: #fee2e2; color: #991b1b; }
    .team-badge.config-only { background: #fef3c7; color: #92400e; }
    
    .team-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      margin-top: 12px;
      padding: 12px;
      background: #f9fafb;
      border-radius: 4px;
    }
    
    .stat {
      display: flex;
      flex-direction: column;
    }
    
    .stat-label {
      font-size: 0.75rem;
      color: #6b7280;
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    
    .stat-value {
      font-size: 0.95rem;
      font-weight: 600;
      color: #1f2937;
    }
    
    .members-list {
      margin-top: 12px;
    }
    
    .members-header {
      font-size: 0.85rem;
      font-weight: 600;
      color: #6b7280;
      margin-bottom: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    
    .members-content {
      display: none;
      margin-top: 8px;
      padding: 8px;
      background: #f9fafb;
      border-radius: 4px;
      max-height: 200px;
      overflow-y: auto;
    }
    
    .members-content.expanded {
      display: block;
    }
    
    .member {
      padding: 6px 0;
      border-bottom: 1px solid #e5e7eb;
      display: grid;
      grid-template-columns: 2fr 1fr 1fr 1fr 1fr;
      gap: 8px;
      font-size: 0.85rem;
    }
    
    .member:last-child { border-bottom: none; }
    
    .member-name { font-weight: 500; }
    .member-external { 
      color: #7c3aed;
      font-weight: 600;
    }
    .member-internal {
      color: #059669;
      font-weight: 600;
    }
    
    .alert {
      padding: 12px 16px;
      border-radius: 6px;
      margin-bottom: 16px;
      font-size: 0.9rem;
    }
    
    .alert.warning {
      background: #fef3c7;
      color: #92400e;
      border: 1px solid #fde68a;
    }
    
    .alert.info {
      background: #dbeafe;
      color: #1e40af;
      border: 1px solid #bfdbfe;
    }
    
    .expandable-icon {
      display: inline-block;
      width: 0;
      height: 0;
      border-left: 5px solid transparent;
      border-right: 5px solid transparent;
      border-top: 6px solid #6b7280;
      transition: transform 0.2s;
    }
    
    .expandable-icon.expanded {
      transform: rotate(180deg);
    }
    
    .config-info {
      background: #f9fafb;
      padding: 12px;
      border-radius: 6px;
      font-size: 0.85rem;
      margin-bottom: 16px;
    }
    
    .config-row {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
    }
    
    .config-label {
      color: #6b7280;
      font-weight: 500;
    }
    
    .config-value {
      font-family: monospace;
      color: #1f2937;
    }
  `;

  get configType() { return 'cost'; }
  get title() { return 'Cost Configuration'; }
  get defaultContent() { 
    return {
      schema_version: 1,
      working_hours: {},
      internal_cost: { default_hourly_rate: 78 },
      external_cost: { default_hourly_rate: 120, external: {} }
    };
  }

  constructor() {
    super();
    this.activeTab = 'config';
    this.content = this.defaultContent;
    this.schema = null;
    this.loading = false;
    this.statusMsg = '';
    this.statusType = '';
    this.inspectData = null;
    this.inspectLoading = false;
    this.expandedTeams = new Set();
  }

  connectedCallback() {
    super.connectedCallback();
    this.loadConfig();
  }

  async loadConfig() {
    this.loading = true;
    try {
      const [schemaData, contentData] = await Promise.all([
        adminProvider.getSchema(this.configType),
        adminProvider.getCost()
      ]);
      
      this.schema = schemaData;
      this.content = this.parseContent(contentData);
      this.statusMsg = '';
    } catch (e) { 
      this.statusMsg = `Error loading cost configuration`; 
      this.statusType = 'error';
    } finally { 
      this.loading = false; 
    }
  }

  parseContent(data) {
    if (typeof data === 'string') {
      try {
        return JSON.parse(data);
      } catch (e) {
        return this.defaultContent;
      }
    }
    return data?.content || this.defaultContent;
  }

  async loadInspectData() {
    this.inspectLoading = true;
    try {
      const response = await fetch('/admin/v1/cost/inspect', {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error(`Failed to load inspection data: ${response.statusText}`);
      }
      
      this.inspectData = await response.json();
      this.statusMsg = 'Inspection data loaded successfully';
      this.statusType = 'success';
    } catch (e) {
      this.statusMsg = `Error loading inspection data: ${e.message}`;
      this.statusType = 'error';
    } finally {
      this.inspectLoading = false;
    }
  }

  toggleTeamMembers(teamId) {
    if (this.expandedTeams.has(teamId)) {
      this.expandedTeams.delete(teamId);
    } else {
      this.expandedTeams.add(teamId);
    }
    this.requestUpdate();
  }

  async handleSave() {
    this.loading = true;
    this.statusMsg = '';
    try {
      const formData = this.shadowRoot.querySelector('schema-form')?.getData();
      await adminProvider.saveCost(formData || this.content);
      this.statusMsg = 'Saved successfully';
      this.statusType = 'success';
    } catch (e) {
      this.statusMsg = `Error: ${e.message}`;
      this.statusType = 'error';
    } finally {
      this.loading = false;
    }
  }

  switchTab(tab) {
    this.activeTab = tab;
    if (tab === 'inspect' && !this.inspectData) {
      this.loadInspectData();
    }
  }

  renderConfigTab() {
    return html`
      <div class="panel">
        <h2>${this.title}</h2>
        ${this.loading ? html`<div class="loading">Loading...</div>` : html`
          <div class="editor">
            <schema-form 
              .schema=${this.schema}
              .data=${this.content}
              @change=${(e) => { this.content = e.detail; }}
            ></schema-form>
          </div>
          <div class="actions">
            <button class="primary" @click=${this.handleSave}>Save Changes</button>
            <button @click=${this.loadConfig}>Reload</button>
            ${this.statusMsg ? html`<span class="status ${this.statusType}">${this.statusMsg}</span>` : ''}
          </div>
        `}
      </div>
    `;
  }

  renderInspectTab() {
    if (this.inspectLoading) {
      return html`<div class="loading">Loading inspection data...</div>`;
    }

    if (!this.inspectData) {
      return html`
        <div class="panel">
          <button class="primary" @click=${this.loadInspectData}>Load Inspection Data</button>
        </div>
      `;
    }

    const { summary, configured_teams, database_teams, matched_teams, 
            config_only_teams, database_only_teams, unmatched_people, cost_config } = this.inspectData;

    return html`
      <div class="panel">
        <h2>Team Matching & Cost Inspection</h2>
        
        ${database_only_teams.length > 0 ? html`
          <div class="alert warning">
            <strong>⚠️ Warning:</strong> ${database_only_teams.length} team(s) in database.yml 
            are not configured in teams.yml. Cost calculations for work assigned to these teams will fail.
          </div>
        ` : ''}
        
        ${config_only_teams.length > 0 ? html`
          <div class="alert info">
            <strong>ℹ️ Info:</strong> ${config_only_teams.length} team(s) in teams.yml 
            have no members in database.yml.
          </div>
        ` : ''}

        <div class="summary-cards">
          <div class="card">
            <div class="card-title">Configured Teams</div>
            <div class="card-value">${summary.configured_count}</div>
            <div class="card-subtitle">From teams.yml</div>
          </div>
          <div class="card">
            <div class="card-title">Database Teams</div>
            <div class="card-value">${summary.database_count}</div>
            <div class="card-subtitle">From database.yml</div>
          </div>
          <div class="card">
            <div class="card-title">Matched Teams</div>
            <div class="card-value">${summary.matched_count}</div>
            <div class="card-subtitle">Ready for cost calc</div>
          </div>
          <div class="card">
            <div class="card-title">Total Monthly Cost</div>
            <div class="card-value">€${(summary.total_internal_cost_monthly + summary.total_external_cost_monthly).toLocaleString()}</div>
            <div class="card-subtitle">Int: €${summary.total_internal_cost_monthly.toLocaleString()} | Ext: €${summary.total_external_cost_monthly.toLocaleString()}</div>
          </div>
        </div>

        <div class="config-info">
          <div class="config-row">
            <span class="config-label">Internal Hourly Rate:</span>
            <span class="config-value">€${cost_config.internal_hourly_rate}</span>
          </div>
          <div class="config-row">
            <span class="config-label">External Default Rate:</span>
            <span class="config-value">€${cost_config.external_hourly_rate_default}</span>
          </div>
        </div>

        ${database_only_teams.length > 0 ? html`
          <div class="section">
            <div class="section-title">⚠️ Teams in Database but NOT in Config (${database_only_teams.length})</div>
            <div class="team-list">
              ${database_only_teams.map(team => this.renderTeamCard(team, 'unmatched'))}
            </div>
          </div>
        ` : ''}

        ${matched_teams.length > 0 ? html`
          <div class="section">
            <div class="section-title">✓ Matched Teams (${matched_teams.length})</div>
            <div class="team-list">
              ${matched_teams.map(team => this.renderTeamCard(team, 'matched'))}
            </div>
          </div>
        ` : ''}

        ${config_only_teams.length > 0 ? html`
          <div class="section">
            <div class="section-title">ℹ️ Teams in Config but NOT in Database (${config_only_teams.length})</div>
            <div class="team-list">
              ${config_only_teams.map(team => this.renderTeamCard(team, 'config-only'))}
            </div>
          </div>
        ` : ''}

        <div class="actions">
          <button @click=${this.loadInspectData}>Refresh</button>
          ${this.statusMsg ? html`<span class="status ${this.statusType}">${this.statusMsg}</span>` : ''}
        </div>
      </div>
    `;
  }

  renderTeamCard(team, type) {
    const isExpanded = this.expandedTeams.has(team.id);
    const hasMembers = team.members && team.members.length > 0;
    
    return html`
      <div class="team-card ${type}">
        <div class="team-header">
          <div>
            <div class="team-name">${team.name}</div>
            <div class="team-id">${team.id}</div>
          </div>
          <div class="team-badge ${type}">
            ${type === 'matched' ? '✓ Matched' : 
              type === 'unmatched' ? '⚠️ Not in Config' : 
              'ℹ️ No Members'}
          </div>
        </div>

        ${hasMembers ? html`
          <div class="team-stats">
            <div class="stat">
              <span class="stat-label">Internal</span>
              <span class="stat-value">${team.internal_count || 0} members</span>
            </div>
            <div class="stat">
              <span class="stat-label">External</span>
              <span class="stat-value">${team.external_count || 0} members</span>
            </div>
            <div class="stat">
              <span class="stat-label">Monthly Hours</span>
              <span class="stat-value">${((team.internal_hours_total || 0) + (team.external_hours_total || 0)).toFixed(0)}h</span>
            </div>
            <div class="stat">
              <span class="stat-label">Monthly Cost</span>
              <span class="stat-value">€${((team.internal_cost_total || 0) + (team.external_cost_total || 0)).toLocaleString()}</span>
            </div>
          </div>

          <div class="members-list">
            <div class="members-header" @click=${() => this.toggleTeamMembers(team.id)}>
              <span class="expandable-icon ${isExpanded ? 'expanded' : ''}"></span>
              <span>Members (${team.members.length})</span>
            </div>
            <div class="members-content ${isExpanded ? 'expanded' : ''}">
              <div class="member" style="font-weight: 600; border-bottom: 2px solid #cbd5e1;">
                <span>Name</span>
                <span>Type</span>
                <span>Site</span>
                <span>Rate/h</span>
                <span>Hours/mo</span>
              </div>
              ${team.members.map(member => html`
                <div class="member">
                  <span class="member-name">${member.name}</span>
                  <span class="${member.external ? 'member-external' : 'member-internal'}">
                    ${member.external ? 'External' : 'Internal'}
                  </span>
                  <span>${member.site || '-'}</span>
                  <span>€${member.hourly_rate}</span>
                  <span>${member.hours_per_month}h</span>
                </div>
              `)}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  render() {
    return html`
      <div>
        <div class="tabs">
          <button 
            class="tab ${this.activeTab === 'config' ? 'active' : ''}" 
            @click=${() => this.switchTab('config')}
          >
            Configuration
          </button>
          <button 
            class="tab ${this.activeTab === 'inspect' ? 'active' : ''}" 
            @click=${() => this.switchTab('inspect')}
          >
            Inspect Teams
          </button>
        </div>

        ${this.activeTab === 'config' ? this.renderConfigTab() : this.renderInspectTab()}
      </div>
    `;
  }
}

customElements.define('admin-cost', AdminCost);
