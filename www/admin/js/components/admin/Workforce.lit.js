import { LitElement, html, css, nothing } from '/static/js/vendor/lit.js';
import { adminProvider } from '../../services/providerREST.js';

const NUMBER = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });
const DATE = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
});

export class AdminWorkforce extends LitElement {
  static properties = {
    snapshot: { type: Object }, loading: { type: Boolean }, saving: { type: Boolean },
    activeTab: { type: String }, showArchived: { type: Boolean },
    expandedTeams: { type: Object }, collapsedGroups: { type: Object },
    dialog: { type: Object }, statusMsg: { type: String }, statusType: { type: String },
    deletion: { type: Object },
    permissions: { type: Array },
  };

  static styles = css`
    :host { display: block; color: #243041; }
    h2 { font-size: 1.25rem; margin: 0; }
    h3 { font-size: 1.1rem; margin: 0 0 20px; }
    .header, .toolbar, .actions { display: flex; align-items: center; gap: 12px; }
    .header, .toolbar { justify-content: space-between; }
    .header { margin-bottom: 20px; }
    .toolbar { min-height: 64px; }
    .tabs { display: flex; gap: 16px; border-bottom: 1px solid #dce1e6; }
    .tabs button { border: 0; border-radius: 0; background: none; padding: 12px 4px; }
    .tabs button[aria-selected='true'] { border-bottom: 3px solid #2563eb; color: #1d4ed8; }
    button, input, select { font: inherit; font-size: 0.875rem; }
    button { cursor: pointer; border: 1px solid #cbd2da; background: #fff;
      padding: 7px 12px; border-radius: 4px; color: inherit; }
    button:hover { background: #f1f5f9; }
    button:disabled { cursor: default; opacity: 0.5; }
    button.primary { background: #2563eb; color: #fff; border-color: #2563eb; }
    button.danger { color: #b42332; border-color: #b42332; }
    button.danger.primary { background: #b42332; color: #fff; }
    button.disclosure { border: 0; background: none; padding: 4px 0; font-weight: 600;
      display: inline-flex; align-items: center; gap: 10px; text-align: left; }
    button.link { border: 0; padding: 0; color: #1d4ed8; background: none; text-align: left; }
    button.link:hover { text-decoration: underline; }
    .arrow { width: 8px; height: 8px; border-right: 2px solid currentColor;
      border-bottom: 2px solid currentColor; transform: rotate(-45deg); margin: 0 6px; }
    [aria-expanded='true'] .arrow { transform: rotate(45deg); }
    table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e6eaee; }
    th { font-weight: 500; color: #626e7c; background: #f7f9fb; }
    th.number, td.number { text-align: right; font-variant-numeric: tabular-nums; }
    .group-row td { background: #edf2f6; font-weight: 600; }
    .group-row .actions { justify-content: flex-end; }
    .token { font-family: monospace; color: #626e7c; font-size: 0.85rem; }
    .muted { color: #626e7c; }
    .date { font-size: 0.78rem; white-space: nowrap; color: #626e7c; }
    .history { display: grid; grid-template-columns: 100px 1fr; gap: 6px 12px;
      margin: 0 0 20px; font-size: 0.85rem; }
    .history dd { margin: 0; }
    .composition { padding: 16px 24px 20px; background: #f7f9fb; }
    .composition th { background: transparent; }
    .composition .actions { margin: 12px 0 0; }
    .table-wrap { overflow-x: auto; }
    .status { padding: 12px 0; line-height: 1.5; }
    .status.error { color: #b42332; }
    .status.warning { color: #946200; }
    .status.success { color: #13714a; }
    .backdrop { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center;
      background: rgba(20, 30, 40, 0.35); }
    .dialog { width: min(520px, calc(100% - 64px)); max-height: calc(100vh - 64px);
      overflow-y: auto; background: #fff; padding: 24px; border-radius: 6px;
      box-shadow: 0 12px 48px rgba(0, 0, 0, 0.2); }
    .fields { display: grid; gap: 16px; }
    .fields label { display: grid; gap: 6px; }
    input:not([type='checkbox']), select { box-sizing: border-box; width: 100%; min-height: 36px;
      padding: 7px 10px; border: 1px solid #cbd2da; border-radius: 4px; background: #fff; }
    label.check { display: flex; align-items: center; gap: 8px; }
    .dialog .actions { justify-content: flex-end; margin-top: 24px; }
    .identity { display: grid; gap: 4px; margin: 0 0 20px; font-size: 0.85rem;
      overflow-wrap: anywhere; color: #626e7c; }
    .consequence { font-size: 0.85rem; color: #626e7c; line-height: 1.5; }
    .impact { margin-top: 20px; }
    .impact h4 { margin: 0 0 8px; font-size: 0.9rem; }
    .impact table { font-size: 0.8rem; }
    .impact th, .impact td { padding: 8px 4px; }
    .impact li { overflow-wrap: anywhere; line-height: 1.4; margin-bottom: 4px; }
    .empty { color: #626e7c; padding: 16px 12px; }
  `;

  constructor() {
    super();
    this.snapshot = null;
    this.permissions = [];
    this.loading = false;
    this.saving = false;
    this.activeTab = 'teams';
    this.showArchived = false;
    this.expandedTeams = new Set();
    this.collapsedGroups = new Set();
    this.dialog = null;
    this.deletion = null;
    this._deleteTrigger = null;
    this.statusMsg = '';
    this.statusType = '';
    this._dialogTrigger = null;
    this._returnDialog = null;
    this._returnTrigger = null;
  }

  connectedCallback() {
    super.connectedCallback();
    if (!this.canManageTeams && this.canManageCosts) this.activeTab = 'suppliers';
    this.loadConfig();
  }

  get canManageTeams() {
    return this.permissions.includes('admin') || this.permissions.includes('manage_workforce_teams');
  }

  get canManageCosts() {
    return this.permissions.includes('admin') || this.permissions.includes('manage_workforce_costs');
  }

  _errorMessage(result) {
    const detail = result.error.detail;
    // Boundary guard: payload comes from external persistence/API and may be missing fields; normalize here, not downstream.
    if (detail !== null && typeof detail === 'object' && Object.hasOwn(detail, 'detail')) {
      const explanation = detail.detail;
      if (explanation !== null && typeof explanation === 'object'
          && typeof explanation.message === 'string') return explanation.message;
    }
    return result.error.message;
  }

  async loadConfig() {
    this.loading = true;
    this.statusMsg = '';
    try {
      const result = await adminProvider.getWorkforce();
      if (!result.ok) throw new Error(this._errorMessage(result));
      if (result.data.content.teams.schema_version !== 3
          || result.data.content.workforce.schema_version !== 2) {
        throw new Error('Canonical Workforce schemas are required');
      }
      this.snapshot = result.data.content;
    } catch (error) {
      console.error('Loading canonical workforce failed', error);
      this.statusMsg = error.message;
      this.statusType = 'error';
    } finally {
      this.loading = false;
    }
  }

  _toggle(key, property) {
    const entries = new Set(this[property]);
    if (entries.has(key)) entries.delete(key);
    else entries.add(key);
    this[property] = entries;
  }

  _recordsFor(kind, snapshot = this.snapshot, supplierId = null) {
    switch (kind) {
      case 'team': return snapshot.teams.teams;
      case 'group': return snapshot.teams.groups;
      case 'staffing': return snapshot.workforce.staffing;
      case 'supplier': return snapshot.workforce.suppliers;
      case 'profile': return snapshot.workforce.suppliers.find((entry) => entry.id === supplierId).profiles;
      default: throw new Error(`Unknown workforce definition kind: ${kind}`);
    }
  }

  async _open(kind, id = null, teamId = null, supplierId = null) {
    if (this.dialog !== null && this.dialog.kind === 'staffing' && kind === 'profile') {
      this._returnDialog = structuredClone(this.dialog);
      this._returnTrigger = this._dialogTrigger;
    }
    this._dialogTrigger = this.shadowRoot.activeElement;
    const record = id === null ? null
      : this._recordsFor(kind, this.snapshot, supplierId).find((entry) => entry.id === id);
    let fields;
    if (kind === 'staffing') {
      const row = id === null ? { team_id: teamId, supplier_id: '', profile_id: '', fte: 1 }
        : record;
      fields = { team_id: row.team_id, supplier_id: row.supplier_id,
        profile_id: row.profile_id, fte: String(row.fte) };
    } else if (kind === 'supplier') {
      fields = record === null ? { name: '', external: false }
        : { name: record.name, external: record.external, archived: record.archived };
    } else if (kind === 'profile') {
      fields = record === null ? { name: '', monthly_project_hours: '', hourly_rate: '' }
        : { name: record.name, monthly_project_hours: String(record.monthly_project_hours),
          hourly_rate: String(record.hourly_rate), archived: record.archived };
    } else if (id === null) {
      fields = kind === 'team' ? { name: '', short_name: '', group_id: null }
        : { name: '', short_name: '' };
    } else {
      fields = { name: record.name, short_name: record.short_name, archived: record.archived };
      if (kind === 'team') {
        fields.group_id = record.group_id;
        if (Object.hasOwn(record, 'migration_incomplete')) {
          fields.migration_incomplete = record.migration_incomplete;
        }
      }
    }
    this.dialog = { kind, id, supplierId, fields, confirmingDelete: false };
    this.statusMsg = '';
    await this.updateComplete;
    this.shadowRoot.querySelector('.dialog input, .dialog select').focus();
  }

  _close() {
    if (this._returnDialog !== null) {
      this.dialog = this._returnDialog;
      this._returnDialog = null;
      this._dialogTrigger = this._returnTrigger;
      this._returnTrigger = null;
      this.updateComplete.then(() => this.shadowRoot.querySelector('.dialog input, .dialog select').focus());
      return;
    }
    this.dialog = null;
    // Lifecycle guard: element may be absent or not upgraded yet at this phase of render/interaction.
    if (this._dialogTrigger !== null) this._dialogTrigger.focus();
  }

  _onField(event) {
    const { name, type, value, checked } = event.target;
    let next = type === 'checkbox' ? checked : value;
    if (name === 'group_id' && value === '') next = null;
    const fields = { ...this.dialog.fields, [name]: next };
    if (name === 'supplier_id') fields.profile_id = '';
    this.dialog = { ...this.dialog, fields };
  }

  async _openDeletion(teamId) {
    this._deleteTrigger = this.shadowRoot.activeElement;
    const pending = { teamId, loading: true, review: null, acknowledged: false };
    this.deletion = pending;
    this.statusMsg = '';
    this.statusType = '';
    try {
      const result = await adminProvider.reviewWorkforceTeamDeletion(teamId);
      if (this.deletion !== pending) return;
      if (!result.ok) throw new Error(this._errorMessage(result));
      if (result.data.content.revision !== this.snapshot.revision) {
        throw new Error('Workforce changed; reload before reviewing deletion');
      }
      this.deletion = { ...pending, loading: false, review: result.data.content };
      await this.updateComplete;
      this.shadowRoot.querySelector('[data-action="cancel-delete"]').focus();
    } catch (error) {
      if (this.deletion !== pending) return;
      console.error('Reviewing team deletion failed', error);
      this.deletion = { ...pending, loading: false };
      this.statusMsg = error.message;
      this.statusType = 'error';
    }
  }

  _closeDeletion() {
    this.deletion = null;
    const trigger = this._deleteTrigger;
    this.updateComplete.then(() => {
      // Lifecycle guard: element may be absent or not upgraded yet at this phase of render/interaction.
      if (trigger !== null && trigger.isConnected) trigger.focus();
      else this.shadowRoot.querySelector('.header button').focus();
    });
  }

  async _onDelete() {
    if (this.saving || this.deletion.loading || !this.deletion.acknowledged
        || this.deletion.review === null || this.statusType === 'error') return;
    const { teamId, review } = this.deletion;
    await this._commit(null, null, { teamId, payload: {
      revision: review.revision,
      confirmation: { acknowledged: true, review_revision: review.review_revision },
    } });
  }

  async _onArchiveInstead() {
    const candidate = structuredClone(this.snapshot);
    candidate.teams.teams.find((team) => team.id === this.deletion.teamId).archived = true;
    await this._commit(candidate);
  }

  async _commit(candidate, creation = null, deletion = null) {
    this.saving = true;
    this.statusMsg = '';
    try {
      const result = deletion !== null ? await adminProvider.deleteWorkforceTeam(deletion.teamId, deletion.payload)
        : creation === null ? await adminProvider.saveWorkforce(candidate)
        : await adminProvider.createWorkforceDefinition(creation.kind, creation.payload);
      if (!result.ok) throw new Error(this._errorMessage(result));
      this.snapshot = result.data.content;
      if (Object.hasOwn(result.data, 'warnings')) {
        this.statusMsg = result.data.warnings.map((warning) => warning.message).join(' ');
        this.statusType = 'warning';
      } else {
        this.statusMsg = deletion === null ? 'Workforce saved'
          : 'Team permanently deleted. Retained allocations and selections remain unresolved.';
        this.statusType = 'success';
      }
      if (this.dialog !== null) this._close();
      if (this.deletion !== null) this._closeDeletion();
    } catch (error) {
      console.error('Saving canonical workforce failed', error);
      this.statusMsg = error.message;
      this.statusType = 'error';
      if (this.deletion !== null) this.deletion = { ...this.deletion, acknowledged: false };
    } finally {
      this.saving = false;
    }
  }

  async _onSaveDialog(event) {
    event.preventDefault();
    if (this.saving || !this.shadowRoot.querySelector('form').reportValidity()) return;
    const { kind, id, supplierId } = this.dialog;
    const fields = { ...this.dialog.fields };
    if (kind === 'staffing') fields.fte = Number(fields.fte);
    if (kind === 'profile') {
      fields.monthly_project_hours = Number(fields.monthly_project_hours);
      fields.hourly_rate = Number(fields.hourly_rate);
    }
    if (id === null) {
      const payload = { revision: this.snapshot.revision, fields };
      if (kind === 'profile') payload.supplier_id = supplierId;
      await this._commit(null, { kind, payload });
    } else {
      const candidate = structuredClone(this.snapshot);
      const records = this._recordsFor(kind, candidate, supplierId);
      Object.assign(records.find((entry) => entry.id === id), fields);
      await this._commit(candidate);
    }
  }

  async _onDeleteStaffing() {
    if (this.saving) return;
    const candidate = structuredClone(this.snapshot);
    candidate.workforce.staffing = candidate.workforce.staffing.filter(
      (row) => row.id !== this.dialog.id,
    );
    await this._commit(candidate);
  }

  _onDialogKey(event) {
    if (event.key === 'Escape' && !this.saving) {
      if (this.deletion !== null) this._closeDeletion();
      else this._close();
    }
    if (event.key !== 'Tab') return;
    const controls = [...this.shadowRoot.querySelectorAll('.dialog input, .dialog select, .dialog button')]
      .filter((control) => !control.disabled);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && this.shadowRoot.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && this.shadowRoot.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  _rowBasis(row) {
    const supplier = this.snapshot.workforce.suppliers.find((entry) => entry.id === row.supplier_id);
    const profile = supplier.profiles.find((entry) => entry.id === row.profile_id);
    const hours = row.fte * profile.monthly_project_hours;
    return { supplier, profile, hours, cost: hours * profile.hourly_rate };
  }

  _teamFte(team) {
    let internal = 0;
    let external = 0;
    for (const row of this.snapshot.workforce.staffing.filter((entry) => entry.team_id === team.id)) {
      if (this._rowBasis(row).supplier.external) external += row.fte;
      else internal += row.fte;
    }
    return { internal, external };
  }

  _renderDate(record, field) {
    if (!Object.hasOwn(record, field)) return html`<span class="muted">Not recorded</span>`;
    return html`<time datetime=${record[field]} title=${record[field]}>${DATE.format(new Date(record[field]))} UTC</time>`;
  }

  _renderComposition(team) {
    const rows = this.snapshot.workforce.staffing.filter((row) => row.team_id === team.id);
    return html`<tr data-composition=${team.id}><td colspan="7" class="composition">
      ${rows.length === 0 ? html`<p class="empty">No staffing assigned</p>` : html`
        <table aria-label=${`${team.name} staffing`}><thead><tr><th>Supplier</th><th>Profile</th>
          <th>Classification</th><th class="number">FTE</th><th class="number">Monthly Hours</th>
          <th class="number">Monthly Cost</th>
          <th>Last Updated</th><th>Actions</th></tr></thead><tbody>${rows.map((row) => {
            const { supplier, profile, hours, cost } = this._rowBasis(row);
            return html`<tr><td>${supplier.name}</td><td><button class="link" data-open-profile=${row.id}
              ?disabled=${this.saving || !this.canManageCosts} @click=${() => this._open('profile', profile.id, null, supplier.id)}>
              ${profile.name}</button></td>
              <td>${supplier.external ? 'External' : 'Internal'}</td>
              <td class="number">${NUMBER.format(row.fte)}</td>
              <td class="number">${NUMBER.format(hours)}</td>
              <td class="number">${NUMBER.format(cost)}</td>
              <td class="date">${this._renderDate(row, 'last_updated')}</td><td>
                <button data-edit-staffing=${row.id} ?disabled=${this.saving || !this.canManageTeams}
                  @click=${() => this._open('staffing', row.id)}>Edit</button></td></tr>`;
          })}</tbody></table>`}
      <div class="actions"><button ?disabled=${this.saving || team.archived || !this.canManageTeams}
        @click=${() => this._open('staffing', null, team.id)}>Add Staffing</button></div>
    </td></tr>`;
  }

  _renderTeam(team) {
    const fte = this._teamFte(team);
    return html`<tr data-team=${team.id}><td><button class="disclosure" data-expand=${team.id}
      aria-expanded=${this.expandedTeams.has(team.id)} @click=${() => this._toggle(team.id, 'expandedTeams')}>
      <span class="arrow" aria-hidden="true"></span>${team.name}</button></td>
      <td class="token">${team.allocation_token}</td><td>${team.archived ? 'Archived' : 'Active'}
        ${team.migration_incomplete === true ? html`<div class="muted">Needs review</div>` : nothing}</td>
      <td class="number">${NUMBER.format(fte.internal)}</td>
      <td class="number">${NUMBER.format(fte.external)}</td>
      <td class="date">${this._renderDate(team, 'last_updated')}</td><td>
      <div class="actions">
        <button data-edit-team=${team.id} ?disabled=${this.saving || !this.canManageTeams}
          @click=${() => this._open('team', team.id)}>Edit</button>
        <button class="danger" data-delete-team=${team.id} ?disabled=${this.saving || !this.canManageTeams}
          @click=${() => this._openDeletion(team.id)}>Delete</button></div></td></tr>
      ${this.expandedTeams.has(team.id) ? this._renderComposition(team) : nothing}`;
  }

  _renderGroup(group) {
    const groupId = group === null ? null : group.id;
    const key = group === null ? 'ungrouped' : group.id;
    const teams = this.snapshot.teams.teams.filter((team) => team.group_id === groupId
      && (this.showArchived || !team.archived));
    if (group !== null && group.archived && !this.showArchived && teams.length === 0) return nothing;
    return html`<tbody data-group=${key}><tr class="group-row"><td colspan="5">
      <button class="disclosure" aria-expanded=${!this.collapsedGroups.has(key)}
        @click=${() => this._toggle(key, 'collapsedGroups')}><span class="arrow" aria-hidden="true"></span>
        ${group === null ? 'Ungrouped' : group.name}</button>
      <span class="muted">${teams.length} teams${group !== null && group.archived ? ' / Archived' : ''}</span>
      </td><td class="date">${group === null ? nothing : this._renderDate(group, 'last_updated')}</td>
      <td>${group === null ? nothing : html`<button ?disabled=${this.saving || !this.canManageTeams}
        @click=${() => this._open('group', group.id)}>Edit Group</button>`}</td></tr>
      ${this.collapsedGroups.has(key) ? nothing : teams.map((team) => this._renderTeam(team))}
    </tbody>`;
  }

  _renderSuppliers() {
    return html`<table><thead><tr><th>Supplier</th><th>Classification</th><th>Profile</th>
      <th class="number">Monthly Project Hours</th><th class="number">Hourly Rate</th><th>State</th>
      <th>Last Updated</th><th>Actions</th>
      </tr></thead><tbody>${this.snapshot.workforce.suppliers.filter((supplier) =>
        this.showArchived || !supplier.archived).map((supplier) => html`
        <tr data-supplier=${supplier.id}><td>${supplier.name}</td>
          <td>${supplier.external ? 'External' : 'Internal'}</td><td colspan="3"></td>
          <td>${supplier.archived ? 'Archived' : 'Active'}</td>
          <td class="date">${this._renderDate(supplier, 'last_updated')}</td><td><div class="actions">
            <button data-edit-supplier=${supplier.id} ?disabled=${this.saving || !this.canManageCosts}
              @click=${() => this._open('supplier', supplier.id)}>Edit</button>
            <button data-new-profile=${supplier.id} ?disabled=${this.saving || supplier.archived || !this.canManageCosts}
              @click=${() => this._open('profile', null, null, supplier.id)}>New Profile</button>
          </div></td></tr>
        ${supplier.profiles.filter((profile) => this.showArchived || !profile.archived)
          .map((profile) => html`<tr data-profile=${profile.id}><td></td><td></td><td>${profile.name}</td>
            <td class="number">${NUMBER.format(profile.monthly_project_hours)}</td>
            <td class="number">${NUMBER.format(profile.hourly_rate)}</td>
            <td>${profile.archived ? 'Archived' : 'Active'}</td>
            <td class="date">${this._renderDate(profile, 'last_updated')}</td><td>
              <button data-edit-profile=${profile.id} ?disabled=${this.saving || !this.canManageCosts}
                @click=${() => this._open('profile', profile.id, null, supplier.id)}>Edit</button>
            </td></tr>`)}
      `)}</tbody></table>`;
  }

  _renderImpact() {
    const { kind, id, supplierId } = this.dialog;
    if (id === null || (kind !== 'supplier' && kind !== 'profile')) return nothing;
    const ownerId = kind === 'supplier' ? id : supplierId;
    const rows = this.snapshot.workforce.staffing.filter((row) => row.supplier_id === ownerId
      && (kind === 'supplier' || row.profile_id === id));
    return html`<section class="impact"><h4>Affected Staffing (${rows.length} rows)</h4>
      ${rows.length === 0 ? html`<p class="muted">No staffing references</p>` : html`
        <table><thead><tr><th>Team</th><th class="number">FTE</th>
          <th class="number">Current Hours</th><th class="number">Current Cost</th></tr></thead>
          <tbody>${rows.map((row) => {
            const team = this.snapshot.teams.teams.find((entry) => entry.id === row.team_id);
            const { hours, cost } = this._rowBasis(row);
            return html`<tr data-affected-staffing=${row.id}><td>${team.name}${team.archived ? ' / Archived' : ''}</td>
              <td class="number">${NUMBER.format(row.fte)}</td><td class="number">${NUMBER.format(hours)}</td>
              <td class="number">${NUMBER.format(cost)}</td></tr>`;
          })}</tbody></table>`}</section>`;
  }

  _renderDialog() {
    const { kind, id, fields, supplierId } = this.dialog;
    const title = `${id === null ? 'New' : 'Edit'} ${kind[0].toUpperCase()}${kind.slice(1)}`;
    const retainedRow = kind === 'staffing' && id !== null
      ? this.snapshot.workforce.staffing.find((row) => row.id === id) : null;
    const record = id === null ? null
      : this._recordsFor(kind, this.snapshot, supplierId).find((entry) => entry.id === id);
    const suppliers = this.snapshot.workforce.suppliers.filter((supplier) => !supplier.archived
      || (retainedRow !== null && retainedRow.supplier_id === supplier.id));
    const selectedSupplier = suppliers.find((supplier) => supplier.id === fields.supplier_id);
    const profiles = selectedSupplier === undefined ? [] : selectedSupplier.profiles.filter((profile) =>
      !profile.archived || (retainedRow !== null && retainedRow.supplier_id === selectedSupplier.id
        && retainedRow.profile_id === profile.id));
    return html`<div class="backdrop"><section class="dialog" role="dialog" aria-modal="true"
      aria-labelledby="workforce-dialog-title" @keydown=${this._onDialogKey}>
      <h3 id="workforce-dialog-title">${title}</h3>
      ${id === null ? nothing : html`<div class="identity"><span>ID: ${id}</span>
        ${kind === 'team' || kind === 'group' ? html`<span>ADO Token: ${record.allocation_token}</span>` : nothing}</div>`}
      ${kind === 'profile' ? html`<p class="muted">Supplier: ${this.snapshot.workforce.suppliers
        .find((entry) => entry.id === supplierId).name}</p>` : nothing}
      ${record === null ? nothing : html`<dl class="history">
        <dt>Last Updated</dt><dd>${this._renderDate(record, 'last_updated')}</dd></dl>`}
      <form @submit=${this._onSaveDialog}><fieldset class="fields" ?disabled=${this.saving}
        style="border:0;padding:0;margin:0">
        ${kind === 'staffing' ? html`
          <label>Supplier<select name="supplier_id" required @input=${this._onField}>
            <option value="" disabled .selected=${fields.supplier_id === ''}>Select supplier</option>${suppliers.map((supplier) =>
              html`<option value=${supplier.id} .selected=${supplier.id === fields.supplier_id}>${supplier.name}</option>`)}</select></label>
          <label>Profile<select name="profile_id" required @input=${this._onField}>
            <option value="" disabled .selected=${fields.profile_id === ''}>Select profile</option>${profiles.map((profile) =>
              html`<option value=${profile.id} .selected=${profile.id === fields.profile_id}>${profile.name}</option>`)}</select></label>
          <label>FTE<input name="fte" type="number" min="0" step="any" required
            .value=${fields.fte} @input=${this._onField}></label>
          <button type="button" data-action="edit-selected-profile" ?disabled=${fields.profile_id === '' || !this.canManageCosts}
            @click=${() => this._open('profile', fields.profile_id, null, fields.supplier_id)}>Edit Selected Profile</button>` : html`
          <label>Name<input name="name" required .value=${fields.name} @input=${this._onField}></label>
          ${kind === 'profile' ? html`
            <label>Monthly Project Hours<input name="monthly_project_hours" type="number" min="0"
              step="any" required .value=${fields.monthly_project_hours} @input=${this._onField}></label>
            <label>Hourly Rate<input name="hourly_rate" type="number" min="0" step="any" required
              .value=${fields.hourly_rate} @input=${this._onField}></label>` : kind === 'supplier' ? html`
            <label class="check"><input name="external" type="checkbox" .checked=${fields.external}
              @input=${this._onField}>External supplier</label>` : html`
          <label>Short Name<input name="short_name" required .value=${fields.short_name} @input=${this._onField}></label>
          ${kind === 'team' ? html`<label>Group<select name="group_id"
            @input=${this._onField}>
            <option value="" .selected=${fields.group_id === null}>Ungrouped</option>${this.snapshot.teams.groups.filter((group) =>
              !group.archived || group.id === fields.group_id).map((group) =>
              html`<option value=${group.id} .selected=${group.id === fields.group_id}>${group.name}${group.archived ? ' / Archived' : ''}</option>`)}</select></label>` : nothing}`}
          ${kind === 'team' && Object.hasOwn(fields, 'migration_incomplete') ? html`
            <label class="check"><input name="migration_incomplete" type="checkbox"
              .checked=${fields.migration_incomplete} @input=${this._onField}>Migration information incomplete</label>
          ` : nothing}
          ${id === null ? nothing : html`<label class="check"><input name="archived" type="checkbox"
            ?disabled=${fields.migration_incomplete === true}
            .checked=${fields.archived} @input=${this._onField}>Archived</label>`}`}
        </fieldset>
        ${this._renderImpact()}
        <p class="consequence">Changes affect historical calculations using current definitions. Archiving preserves existing staffing references.</p>
        ${kind === 'staffing' && id !== null && this.dialog.confirmingDelete ? html`
          <p class="status error" role="alert">Deleting this staffing row changes historical calculations
            using the current definitions. This action cannot be undone.</p>` : nothing}
        ${this.statusMsg ? html`<div class="status ${this.statusType}"
          role=${this.statusType === 'error' ? 'alert' : 'status'}>${this.statusMsg}</div>` : nothing}
        <div class="actions"><button type="button" ?disabled=${this.saving} @click=${this._close}>Cancel</button>
          ${kind === 'staffing' && id !== null ? this.dialog.confirmingDelete ? html`
            <button class="danger" type="button" data-action="cancel-delete-staffing"
              ?disabled=${this.saving} @click=${() => {
                this.dialog = { ...this.dialog, confirmingDelete: false };
              }}>Keep Staffing</button>
            <button class="danger primary" type="button" data-action="confirm-delete-staffing"
              ?disabled=${this.saving} @click=${this._onDeleteStaffing}>Confirm Delete</button>` : html`
            <button class="danger" type="button" data-action="delete-staffing"
              ?disabled=${this.saving} @click=${() => {
                this.dialog = { ...this.dialog, confirmingDelete: true };
              }}>Delete Staffing</button>` : nothing}
          <button class="primary" type="submit" data-action="save-dialog" ?disabled=${this.saving}>
            ${this.saving ? 'Saving' : 'Save'}</button></div>
      </form></section></div>`;
  }

  _renderReferenceList(title, references) {
    return html`<section class="impact"><h4>${title} (${references.length})</h4>
      ${references.length === 0 ? html`<p class="muted">None retained locally</p>` : html`
        <ul>${references.map((entry) => html`<li>${entry.namespace} / ${entry.key}:
          ${Object.hasOwn(entry, 'record_id') ? html`Task ${entry.record_id}: ` : nothing}
          ${entry.path.join(' / ')}</li>`)}</ul>`}</section>`;
  }

  _renderDeletion() {
    const { loading, review, acknowledged, teamId } = this.deletion;
    return html`<div class="backdrop"><section class="dialog" role="dialog" aria-modal="true"
      aria-labelledby="workforce-deletion-title" @keydown=${this._onDialogKey}>
      <h3 id="workforce-deletion-title">Permanently Delete Team</h3>
      <p class="status error">Deletion removes this team's identity and cost basis and can render
        calculations for past ADO tasks unusable. It does not remove or rewrite their allocation blocks.</p>
      <p class="consequence">Unloaded or expired ADO tasks may still reference the token.
        No local reference count proves deletion historically safe.</p>
      ${loading ? html`<p>Reviewing retained references</p>` : review === null ? nothing : html`
        <div class="identity"><span>Team: ${review.team.name}</span><span>ID: ${review.team.id}</span>
          <span>ADO Token: ${review.team.allocation_token}</span>
          <span>Group: ${review.group === null ? 'Ungrouped' : review.group.name}</span></div>
        <section class="impact"><h4>Staffing To Remove (${review.staffing.length})</h4>
          <ul>${review.staffing.map((row) => html`<li><span class="token">${row.id}</span>:
            ${this._rowBasis(row).supplier.name} / ${this._rowBasis(row).profile.name}: ${row.fte} FTE</li>`)}</ul></section>
        ${this._renderReferenceList('Availability Lists To Update', review.availability)}
        ${this._renderReferenceList('Allocations Retained As Unresolved', review.retained_allocations)}
        ${this._renderReferenceList('Selections Retained As Unresolved', review.saved_selections)}
        <p class="consequence">Shared suppliers and profiles remain. Only this team, its staffing
          and the listed availability references are removed.</p>
        <label class="check"><input name="deletion_acknowledged" type="checkbox" .checked=${acknowledged}
          ?disabled=${this.saving} @change=${(event) => {
            this.deletion = { ...this.deletion, acknowledged: event.target.checked };
          }}>I acknowledge that historical ADO calculations may become unusable.</label>`}
      ${this.statusType === 'error' && this.statusMsg ? html`<div class="status error" role="alert">
        ${this.statusMsg}</div>` : nothing}
      <div class="actions"><button data-action="cancel-delete" ?disabled=${this.saving}
        @click=${this._closeDeletion}>Cancel</button>
        ${this.statusType === 'error' ? html`<button ?disabled=${this.saving}
          @click=${() => this._openDeletion(teamId)}>Review Again</button>` : nothing}
        ${review === null ? nothing : html`<button data-action="archive-instead"
          ?disabled=${this.saving || review.team.archived} @click=${this._onArchiveInstead}>Archive Instead</button>
          <button class="danger primary" data-action="confirm-delete"
            ?disabled=${this.saving || !acknowledged || this.statusType === 'error'}
            @click=${this._onDelete}>Permanently Delete</button>`}</div>
    </section></div>`;
  }

  render() {
    return html`<div class="header"><h2>Workforce</h2><button ?disabled=${this.loading || this.saving || this.dialog !== null || this.deletion !== null}
      @click=${this.loadConfig}>Reload</button></div>
      ${this.statusMsg && this.dialog === null && this.deletion === null ? html`<div class="status ${this.statusType}"
        role=${this.statusType === 'error' ? 'alert' : 'status'}>${this.statusMsg}</div>` : nothing}
      ${this.loading ? html`<p>Loading</p>` : this.snapshot === null ? nothing : html`
        <div class="tabs" role="tablist"><button role="tab" aria-selected=${this.activeTab === 'teams'}
          ?disabled=${this.saving || this.dialog !== null} @click=${() => { this.activeTab = 'teams'; }}>Teams & Composition</button>
          <button role="tab" data-action="suppliers-tab" aria-selected=${this.activeTab === 'suppliers'}
            ?disabled=${this.saving || this.dialog !== null} @click=${() => { this.activeTab = 'suppliers'; }}>Suppliers & Profiles</button></div>
        <div class="toolbar"><label><input type="checkbox" .checked=${this.showArchived}
          @change=${(event) => { this.showArchived = event.target.checked; }}>Show archived</label>
          ${this.activeTab === 'teams' ? html`<div class="actions">
            <button data-action="new-group" ?disabled=${this.saving || this.dialog !== null || !this.canManageTeams}
              @click=${() => this._open('group')}>New Group</button>
            <button class="primary" data-action="new-team" ?disabled=${this.saving || this.dialog !== null || !this.canManageTeams}
              @click=${() => this._open('team')}>New Team</button></div>` : html`
              <button class="primary" data-action="new-supplier" ?disabled=${this.saving || this.dialog !== null || !this.canManageCosts}
                @click=${() => this._open('supplier')}>New Supplier</button>`}</div>
        <div class="table-wrap">${this.activeTab === 'suppliers' ? this._renderSuppliers() : html`
          <table><thead><tr><th>Team / Group</th><th>ADO Token</th><th>State</th>
            <th class="number">Internal FTE</th><th class="number">External FTE</th>
            <th>Last Updated</th><th>Actions</th></tr></thead>
            ${this.snapshot.teams.groups.map((group) => this._renderGroup(group))}${this._renderGroup(null)}</table>`}</div>`}
      ${this.dialog === null ? nothing : this._renderDialog()}
      ${this.deletion === null ? nothing : this._renderDeletion()}`;
  }
}

customElements.define('admin-workforce', AdminWorkforce);