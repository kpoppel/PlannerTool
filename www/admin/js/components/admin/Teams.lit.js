import { LitElement, html, css } from '/static/js/vendor/lit.js';
import { adminProvider } from '../../services/providerREST.js';

export class AdminTeams extends LitElement {
  static properties = {
    content: { type: Object },
    staffing: { type: Array },
    activeTab: { type: String },
    expandedTeams: { type: Object },
    showArchived: { type: Boolean },
    loading: { type: Boolean },
    saving: { type: Boolean },
    statusMsg: { type: String },
    statusType: { type: String },
    deleteTeam: { type: String },
    deleteAcknowledged: { type: Boolean },
  };

  static styles = css`
    :host { display: block; color: #243041; }
    h2 { margin: 0; font-size: 1.25rem; }
    h3 { margin: 0 0 16px; font-size: 1.1rem; }
    .header, .toolbar, .actions { display: flex; align-items: center; gap: 12px; }
    .header { justify-content: space-between; margin-bottom: 20px; }
    .tabs { display: flex; gap: 16px; border-bottom: 1px solid #dce1e6; }
    .tabs button { border: 0; border-radius: 0; padding: 12px 4px; background: none; }
    .tabs button[aria-selected='true'] { border-bottom: 3px solid #2563eb; color: #1d4ed8; }
    .toolbar { justify-content: space-between; min-height: 64px; }
    .toolbar label, .acknowledgement { display: flex; align-items: center; gap: 8px; }
    .count { color: #626e7c; font-size: 0.9rem; }
    button { padding: 7px 12px; border: 1px solid #cbd2da; border-radius: 4px;
      background: #fff; color: #243041; cursor: pointer; font: inherit; font-size: 0.85rem; }
    button:hover { background: #f1f5f9; }
    button:disabled { opacity: 0.5; cursor: default; }
    button.danger { color: #b42332; border-color: #e5b3ba; }
    button.primary { background: #2563eb; color: #fff; border-color: #2563eb; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th { text-align: left; color: #626e7c; background: #f7f9fb; font-weight: 500; }
    th, td { padding: 13px 12px; border-bottom: 1px solid #e6eaee; }
    td:first-child { font-weight: 600; }
    .team-name { border: 0; background: transparent; padding: 4px 0; font-weight: 600;
      display: inline-flex; align-items: center; gap: 10px; text-align: left; }
    .disclosure { width: 10px; height: 10px; border-right: 2px solid currentColor;
      border-bottom: 2px solid currentColor; transform: rotate(-45deg); margin: 0 4px; }
    .team-name[aria-expanded='true'] .disclosure { transform: rotate(45deg); }
    .composition-cell { padding: 16px 24px 20px; background: #f7f9fb; }
    .composition-cell th { background: transparent; }
    .composition-cell table { max-width: 760px; }
    .composition-cell td:first-child { font-weight: 400; }
    .composition-heading { font-size: 0.9rem; margin: 0 0 8px; font-weight: 600; }
    .site-teams { font-weight: 400; line-height: 1.6; }
    .number { text-align: right; font-variant-numeric: tabular-nums; }
    .token { font-family: monospace; font-size: 0.85rem; }
    .archived { color: #626e7c; }
    .status { padding: 12px 0; font-size: 0.9rem; }
    .status.error { color: #b42332; }
    .status.success { color: #13714a; }
    .empty { padding: 32px 12px; text-align: center; color: #626e7c; }
    .backdrop { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center;
      background: rgba(20, 30, 40, 0.35); }
    .dialog { width: min(520px, calc(100% - 64px)); padding: 24px; background: #fff;
      border-radius: 6px; box-shadow: 0 12px 48px rgba(0, 0, 0, 0.2); }
    .dialog p { line-height: 1.5; margin: 12px 0; }
    .dialog .actions { justify-content: flex-end; margin-top: 24px; }
    .acknowledgement { margin-top: 20px; line-height: 1.4; }
  `;

  constructor() {
    super();
    this.content = null;
    this.staffing = [];
    this.activeTab = 'teams';
    this.expandedTeams = new Set();
    this.showArchived = false;
    this.loading = false;
    this.saving = false;
    this.statusMsg = '';
    this.statusType = '';
    this.deleteTeam = null;
    this.deleteAcknowledged = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this.loadConfig();
  }

  async loadConfig() {
    this.loading = true;
    this.statusMsg = '';
    try {
      const [teamsResult, staffingResult] = await Promise.all([
        adminProvider.getTeams(), adminProvider.getPeopleInspect(),
      ]);
      if (!teamsResult.ok) throw new Error(teamsResult.error.message);
      if (!staffingResult.ok) throw new Error(staffingResult.error.message);
      if (teamsResult.data.schema_version !== 2) {
        throw new Error('Workforce team administration requires team schema v2');
      }
      const data = staffingResult.data;
      this.content = teamsResult.data;
      this.staffing = [...data.matched_teams, ...data.excluded_teams, ...data.unmatched_teams]
        .map((team) => {
          const sites = new Map();
          for (const member of team.members) {
            if (!sites.has(member.site)) {
              sites.set(member.site, { site: member.site, internal_count: 0, external_count: 0 });
            }
            const composition = sites.get(member.site);
            if (member.external) composition.external_count += 1;
            else composition.internal_count += 1;
          }
          return { name: team.name, internal_count: team.internal_count,
            external_count: team.external_count, composition: [...sites.values()] };
        });
    } catch (error) {
      console.error('Loading workforce administration failed', error);
      this.statusMsg = error.message;
      this.statusType = 'error';
    } finally {
      this.loading = false;
    }
  }

  async _saveTeams(teams, message) {
    this.saving = true;
    this.statusMsg = '';
    try {
      const candidate = { ...this.content, teams };
      const result = await adminProvider.saveTeams(candidate);
      if (!result.ok) throw new Error(result.error.message);
      this.content = candidate;
      this.statusMsg = message;
      this.statusType = 'success';
      return true;
    } catch (error) {
      console.error('Saving workforce teams failed', error);
      this.statusMsg = error.message;
      this.statusType = 'error';
      return false;
    } finally {
      this.saving = false;
    }
  }

  async _onArchive(name, archived) {
    const teams = this.content.teams.map((team) => team.name === name
      ? { ...team, exclude: archived } : team);
    await this._saveTeams(teams, archived ? 'Team archived' : 'Team restored');
  }

  async _onDelete(name) {
    this.deleteTeam = name;
    this.deleteAcknowledged = false;
    await this.updateComplete;
    this.shadowRoot.querySelector('[data-action="cancel-delete"]').focus();
  }

  _onCancelDelete() {
    this.deleteTeam = null;
    this.deleteAcknowledged = false;
  }

  async _onConfirmDelete() {
    if (!this.deleteAcknowledged || this.saving) return;
    const teams = this.content.teams.filter((team) => team.name !== this.deleteTeam);
    if (await this._saveTeams(teams, 'Team permanently deleted')) this._onCancelDelete();
  }

  _staffingFor(name) {
    const found = this.staffing.find((team) => team.name === name);
    return found === undefined ? { internal_count: 0, external_count: 0, composition: [] } : found;
  }

  _onToggleComposition(name) {
    const expanded = new Set(this.expandedTeams);
    if (expanded.has(name)) expanded.delete(name);
    else expanded.add(name);
    this.expandedTeams = expanded;
  }

  _renderComposition(team) {
    const staffing = this._staffingFor(team.name);
    return html`<tr data-composition=${team.name}><td class="composition-cell" colspan="6">
      <div class="composition-heading">${team.name} composition</div>
      ${staffing.composition.length === 0 ? html`<div class="count">No staffing assigned</div>`
        : html`<table aria-label=${`${team.name} site composition`}>
          <thead><tr><th>Site</th><th class="number">Internal Resources</th>
            <th class="number">External Resources</th><th class="number">Total Resources</th></tr></thead>
          <tbody>${staffing.composition.map((row) => html`<tr>
            <td>${row.site === '' ? 'Unspecified site' : row.site}</td>
            <td class="number">${row.internal_count}</td><td class="number">${row.external_count}</td>
            <td class="number">${row.internal_count + row.external_count}</td>
          </tr>`)}</tbody></table>`}
    </td></tr>`;
  }

  _renderTeams(teams) {
    return html`<table aria-label="Team definitions">
      <thead><tr><th>Team</th><th>ADO Token</th><th>Status</th>
        <th class="number">Internal Resources</th><th class="number">External Resources</th>
        <th>Actions</th></tr></thead>
      <tbody>${teams.map((team) => {
        const staffing = this._staffingFor(team.name);
        return html`<tr data-team=${team.name} class=${team.exclude ? 'archived' : ''}>
          <td><button class="team-name" data-action="composition"
            aria-label=${`${team.name} composition`} aria-expanded=${this.expandedTeams.has(team.name)}
            @click=${() => this._onToggleComposition(team.name)}>
            <span class="disclosure" aria-hidden="true"></span>${team.name}
          </button></td><td class="token">${team.configured ? team.short_name : '-'}</td>
          <td>${team.configured ? (team.exclude ? 'Archived' : 'Active') : 'Not configured'}</td>
          <td class="number">${staffing.internal_count}</td>
          <td class="number">${staffing.external_count}</td>
          <td>${team.configured ? html`<div class="actions">
            <button data-action=${team.exclude ? 'restore' : 'archive'} ?disabled=${this.saving}
              @click=${() => this._onArchive(team.name, !team.exclude)}>
              ${team.exclude ? 'Restore' : 'Archive'}</button>
            <button class="danger" data-action="delete" ?disabled=${this.saving}
              @click=${() => this._onDelete(team.name)}>Delete</button>
          </div>` : ''}</td>
        </tr>${this.expandedTeams.has(team.name) ? this._renderComposition(team) : ''}`;
      })}</tbody></table>`;
  }

  _siteInventory() {
    const sites = new Map();
    for (const team of this.staffing) {
      for (const row of team.composition) {
        if (!sites.has(row.site)) {
          sites.set(row.site, { site: row.site, teams: [], internal_count: 0, external_count: 0 });
        }
        const site = sites.get(row.site);
        site.teams.push(team.name);
        site.internal_count += row.internal_count;
        site.external_count += row.external_count;
      }
    }
    return [...sites.values()];
  }

  _renderSites(sites) {
    return html`<table aria-label="Site inventory">
      <thead><tr><th>Site</th><th>Teams</th><th class="number">Internal Resources</th>
        <th class="number">External Resources</th></tr></thead>
      <tbody>${sites.map((site) => html`<tr data-site=${site.site}>
        <td>${site.site === '' ? 'Unspecified site' : site.site}</td>
        <td class="site-teams">${site.teams.join(', ')}</td>
        <td class="number">${site.internal_count}</td><td class="number">${site.external_count}</td>
      </tr>`)}</tbody></table>`;
  }

  _renderDeleteDialog() {
    return html`<div class="backdrop"><section class="dialog" role="dialog" aria-modal="true"
      aria-labelledby="delete-title" @keydown=${(event) => {
        if (event.key === 'Escape' && !this.saving) this._onCancelDelete();
      }}>
      <h3 id="delete-title">Permanently delete ${this.deleteTeam}?</h3>
      <p>Deleting this team removes its allocation identity. Calculations for past ADO tasks
        may become unusable. Their allocation blocks will not be removed or rewritten.</p>
      <p>Archive preserves the team for historical calculations. Unloaded or expired ADO tasks
        may still refer to this team.</p>
      <label class="acknowledgement"><input type="checkbox" data-action="acknowledge-delete"
        .checked=${this.deleteAcknowledged} ?disabled=${this.saving}
        @change=${(event) => { this.deleteAcknowledged = event.target.checked; }}>
        I understand that historical calculations may become unusable.</label>
      <div class="actions">
        <button data-action="cancel-delete" ?disabled=${this.saving}
          @click=${this._onCancelDelete}>Cancel</button>
        <button class="danger" data-action="confirm-delete"
          ?disabled=${!this.deleteAcknowledged || this.saving}
          @click=${this._onConfirmDelete}>Permanently Delete</button>
      </div>
    </section></div>`;
  }

  render() {
    return html`<section>
      <div class="header"><h2>Workforce</h2>
        <button data-action="reload" ?disabled=${this.loading || this.saving}
          @click=${this.loadConfig}>Reload</button></div>
      <div class="tabs" role="tablist" aria-label="Workforce views">
        ${['teams', 'sites'].map((tab) => html`<button role="tab" data-action=${tab}
          aria-selected=${this.activeTab === tab}
          @click=${() => { this.activeTab = tab; }}>${tab === 'teams' ? 'Teams & Composition' : 'Sites'}</button>`)}
      </div>
      ${this.statusMsg ? html`<div class="status ${this.statusType}" role="status">${this.statusMsg}</div>` : ''}
      ${this.loading ? html`<div class="empty">Loading workforce...</div>` : this._renderContent()}
      ${this.deleteTeam !== null ? this._renderDeleteDialog() : ''}
    </section>`;
  }

  _renderContent() {
    if (this.content === null) return html`<div class="empty">Workforce data unavailable</div>`;
    const configuredNames = new Set(this.content.teams.map((team) => team.name));
    const teams = [
      ...this.content.teams.filter((team) => this.showArchived || !team.exclude)
        .map((team) => ({ ...team, configured: true })),
      ...this.staffing.filter((team) => !configuredNames.has(team.name))
        .map((team) => ({ name: team.name, exclude: false, configured: false })),
    ];
    const sites = this._siteInventory();
    return html`<div class="toolbar">
      <span class="count">${this.activeTab === 'teams' ? `${teams.length} teams` : `${sites.length} sites`}</span>
      ${this.activeTab === 'teams' ? html`<label><input type="checkbox" data-action="show-archived"
        .checked=${this.showArchived}
        @change=${(event) => { this.showArchived = event.target.checked; }}>Show archived teams</label>` : ''}
      </div><div class="table-wrap">
        ${this.activeTab === 'teams' ? this._renderTeams(teams) : this._renderSites(sites)}
      </div>`;
  }
}

customElements.define('admin-teams', AdminTeams);
