import { LitElement, html, css } from '/static/js/vendor/lit.js';
import { BaseConfigComponent } from './BaseConfigComponent.lit.js';
import { adminProvider } from '../../services/providerREST.js';

export class AdminPeople extends LitElement {
  static properties = {
    activeTab: { type: String },
    content: { type: Object },
    schema: { type: Object },
    loading: { type: Boolean },
    statusMsg: { type: String },
    statusType: { type: String },
    inspectData: { type: Object },
    inspectLoading: { type: Boolean },
    expandedTeams: { type: Object }
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
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
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
    
    .info-row {
      padding: 8px 12px;
      background: #eff6ff;
      border-left: 4px solid #3b82f6;
      border-radius: 4px;
      margin-bottom: 20px;
      font-size: 0.9rem;
      color: #1e40af;
    }
    
    .info-label {
      font-weight: 600;
      margin-right: 8px;
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
    .team-card.no-people { border-left: 4px solid #f59e0b; }
    .team-card.excluded { border-left: 4px solid #6b7280; }
    
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
    .team-badge.no-people { background: #fef3c7; color: #92400e; }
    .team-badge.excluded { background: #f3f4f6; color: #4b5563; }
    
    .team-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
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
      user-select: none;
    }
    
    .expandable-icon {
      width: 0;
      height: 0;
      border-left: 5px solid transparent;
      border-right: 5px solid transparent;
      border-top: 6px solid #6b7280;
      transform: rotate(-90deg);
      transition: transform 0.2s;
    }
    
    .expandable-icon.expanded {
      transform: rotate(0deg);
    }
    
    .members-content {
      display: none;
      margin-top: 8px;
      padding: 8px;
      background: #f9fafb;
      border-radius: 4px;
      max-height: 300px;
      overflow-y: auto;
    }
    
    .members-content.expanded {
      display: block;
    }
    
    .member {
      padding: 6px 0;
      border-bottom: 1px solid #e5e7eb;
      display: grid;
      grid-template-columns: 2fr 1fr 1fr;
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
      border-left: 4px solid #f59e0b;
      color: #92400e;
    }
    
    .alert.info {
      background: #dbeafe;
      border-left: 4px solid #3b82f6;
      color: #1e40af;
    }
  `;

  constructor() {
    super();
    this.activeTab = 'config';
    this.content = null;
    this.schema = null;
    this.loading = false;
    this.statusMsg = '';
    this.statusType = '';
    this.inspectData = null;
    this.inspectLoading = false;
    this.expandedTeams = new Set();
  }

  get configType() { return 'people'; }
  get title() { return 'People Configuration'; }
  get defaultContent() { 
    return { 
      schema_version: 1, 
      database_file: 'config/database.yaml',
      database: { 
        people: [] 
      } 
    }; 
  }

  connectedCallback() {
    super.connectedCallback();
    this.loadConfig();
  }

  async loadConfig() {
    this.loading = true;
    try {
      // Load schema
      const schemaRes = await fetch(`/admin/v1/schema/${this.configType}`);
      if (schemaRes.ok) {
        this.schema = await schemaRes.json();
      }

      // Load content
      const methodName = `get${this.configType.charAt(0).toUpperCase() + this.configType.slice(1)}`;
      const content = await adminProvider[methodName]();
      this.content = content || this.defaultContent;
    } catch (e) {
      this.statusMsg = `Error loading config: ${e.message}`;
      this.statusType = 'error';
    } finally {
      this.loading = false;
    }
  }

  async loadInspectData() {
    this.inspectLoading = true;
    this.statusMsg = '';
    try {
      this.inspectData = await adminProvider.getPeopleInspect();
      if (!this.inspectData) {
        throw new Error('No data returned from server');
      }
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
      await adminProvider.savePeople(formData || this.content);
      this.statusMsg = 'Saved successfully';
      this.statusType = 'success';
      // Reload inspect data if on that tab
      if (this.activeTab === 'inspect' && this.inspectData) {
        setTimeout(() => this.loadInspectData(), 500);
      }
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

    const { summary, matched_teams, unmatched_teams, teams_without_people, 
            excluded_teams, unassigned_people } = this.inspectData;

    return html`
      <div class="panel">
        <h2>People & Team Inspection</h2>
        
        <div class="info-row">
          <span class="info-label">Database Source:</span>
          <span>${summary.database_path}</span>
        </div>
        
        ${unmatched_teams.length > 0 ? html`
          <div class="alert warning">
            <strong>⚠️ Warning:</strong> ${unmatched_teams.length} team(s) have people assigned 
            but are not configured in teams.yml. Add these teams to teams.yml.
          </div>
        ` : ''}
        
        ${teams_without_people.length > 0 ? html`
          <div class="alert info">
            <strong>ℹ️ Info:</strong> ${teams_without_people.length} configured team(s) 
            have no people assigned in the database.
          </div>
        ` : ''}
        
        ${unassigned_people.length > 0 ? html`
          <div class="alert warning">
            <strong>⚠️ Warning:</strong> ${unassigned_people.length} people have no team assignment.
          </div>
        ` : ''}

        <div class="summary-cards">
          <div class="card">
            <div class="card-title">Total People</div>
            <div class="card-value">${summary.total_people}</div>
            <div class="card-subtitle">From database</div>
          </div>
          <div class="card">
            <div class="card-title">Internal</div>
            <div class="card-value">${summary.total_internal}</div>
            <div class="card-subtitle">Staff members</div>
          </div>
          <div class="card">
            <div class="card-title">External</div>
            <div class="card-value">${summary.total_external}</div>
            <div class="card-subtitle">Contractors</div>
          </div>
          <div class="card">
            <div class="card-title">Matched Teams</div>
            <div class="card-value">${summary.matched_teams}</div>
            <div class="card-subtitle">In config & database</div>
          </div>
          <div class="card">
            <div class="card-title">Unmatched Teams</div>
            <div class="card-value">${summary.unmatched_teams}</div>
            <div class="card-subtitle">Not in config</div>
          </div>
        </div>

        ${unmatched_teams.length > 0 ? html`
          <div class="section">
            <div class="section-title">⚠️ Teams with People but NOT in Config (${unmatched_teams.length})</div>
            <div class="team-list">
              ${unmatched_teams.map(team => this.renderTeamCard(team, 'unmatched'))}
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

        ${teams_without_people.length > 0 ? html`
          <div class="section">
            <div class="section-title">ℹ️ Configured Teams with No People (${teams_without_people.length})</div>
            <div class="team-list">
              ${teams_without_people.map(team => this.renderTeamCard(team, 'no-people'))}
            </div>
          </div>
        ` : ''}

        ${excluded_teams && excluded_teams.length > 0 ? html`
          <div class="section">
            <div class="section-title">🚫 Excluded Teams (${excluded_teams.length})</div>
            <div class="team-list">
              ${excluded_teams.map(team => this.renderTeamCard(team, 'excluded'))}
            </div>
          </div>
        ` : ''}

        ${unassigned_people.length > 0 ? html`
          <div class="section">
            <div class="section-title">⚠️ Unassigned People (${unassigned_people.length})</div>
            <div class="team-list">
              ${unassigned_people.map(person => this.renderUnassignedPerson(person))}
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
              type === 'excluded' ? '🚫 Excluded' :
              'ℹ️ No People'}
          </div>
        </div>

        ${hasMembers ? html`
          <div class="team-stats">
            <div class="stat">
              <span class="stat-label">Total Members</span>
              <span class="stat-value">${team.members.length}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Internal</span>
              <span class="stat-value">${team.internal_count || 0}</span>
            </div>
            <div class="stat">
              <span class="stat-label">External</span>
              <span class="stat-value">${team.external_count || 0}</span>
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
              </div>
              ${team.members.map(member => html`
                <div class="member">
                  <span class="member-name">${member.name}</span>
                  <span class="${member.external ? 'member-external' : 'member-internal'}">
                    ${member.external ? 'External' : 'Internal'}
                  </span>
                  <span>${member.site || '-'}</span>
                </div>
              `)}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  renderUnassignedPerson(person) {
    return html`
      <div class="team-card unmatched">
        <div class="team-header">
          <div>
            <div class="team-name">${person.name}</div>
            <div class="team-id">${person.reason}</div>
          </div>
          <div class="team-badge unmatched">⚠️ No Team</div>
        </div>
        <div class="team-stats">
          <div class="stat">
            <span class="stat-label">Type</span>
            <span class="stat-value">${person.external ? 'External' : 'Internal'}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Site</span>
            <span class="stat-value">${person.site || '-'}</span>
          </div>
        </div>
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

customElements.define('admin-people', AdminPeople);
