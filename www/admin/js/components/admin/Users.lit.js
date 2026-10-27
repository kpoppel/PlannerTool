import { LitElement, html, css } from '/static/js/vendor/lit.js';
import { adminProvider } from '../../services/providerREST.js';
import { showAccountKeyDialog } from '../../../../js/components/AuthDialog.lit.js';
import { AuthPresentationController } from '../../../../js/components/AuthStatus.lit.js';

const PERMISSIONS = [
  ['admin', 'Administrator'], ['manage_projects', 'Projects'],
  ['manage_workforce_teams', 'Teams & staffing'],
  ['manage_workforce_costs', 'Costs & suppliers'], ['manage_iterations', 'Iteration mappings'],
];
const PAGE_SIZE = 12;

function resultErrorMessage(result, fallback = 'Request failed') {
  if (result.error && (result.error.code === 'pat_invalid' || result.error.code === 'pat_required')) {
    return 'Enter a valid Azure DevOps PAT for the new account.';
  }
  if (typeof result.error === 'string') return result.error;
  if (result.error && result.error.message) return result.error.message;
  return fallback;
}

export class AdminUsers extends LitElement {
  static styles = css`
    :host { display: block; color: #252c35; }
    * { box-sizing: border-box; letter-spacing: 0; }
    [hidden] { display: none !important; }
    button, input, select, textarea { font: inherit; }
    button, select, input:not([type=checkbox]) { min-height: 34px; padding: 7px 10px;
      border: 1px solid #c5ccd4; border-radius: 4px; background: white; color: inherit; }
    button { cursor: pointer; }
    button:hover:not(:disabled) { background: #f3f5f7; }
    button:disabled { opacity: .45; cursor: default; }
    :focus-visible { outline: 3px solid #80afe5; outline-offset: 2px; }
    input[type=checkbox] { width: 16px; height: 16px; accent-color: #245fa5; }
    .primary { background: #245fa5; border-color: #245fa5; color: white; }
    .primary:hover:not(:disabled) { background: #1c4e89; }
    .danger { color: #ad3030; }
    .quiet { border-color: transparent; background: transparent; }
    .muted { color: #626b77; }
    .grow { flex: 1; }
    .heading, .filters, .selection, .footer, .dialog-head, .dialog-footer {
      display: flex; gap: 10px; align-items: center; }
    .heading { margin-bottom: 20px; }
    h2 { margin: 0; font-size: 22px; }
    h3 { margin: 0; font-size: 18px; }
    p { margin: 8px 0 16px; }
    .count, .badge { font-size: 12px; padding: 2px 6px; border-radius: 4px;
      background: #f1f3f5; color: #626b77; }
    .badge { margin-left: 7px; }
    .admin { background: #e4f1ec; color: #236a51; margin-left: 0; }
    .views { display: flex; gap: 24px; border-bottom: 1px solid #dce1e6;
      margin-bottom: 18px; flex-wrap: wrap; }
    .views button { border: 0; border-radius: 0; padding: 0 0 12px;
      background: none; color: #626b77; }
    .views button[aria-pressed=true] { color: #245fa5; box-shadow: 0 2px #245fa5; font-weight: bold; }
    .views .count { margin-left: 5px; }
    .filters { flex-wrap: wrap; margin-bottom: 14px; }
    .filters input { flex: 1; min-width: 180px; max-width: 340px; }
    .filters label { display: flex; align-items: center; gap: 8px; }
    .selection { flex-wrap: wrap; min-height: 56px; padding: 9px 12px;
      border-top: 1px solid #dce1e6; background: #f4f6f8; }
    .selection.active { background: #edf4fc; }
    .selection strong { min-width: 90px; }
    .table-scroll { overflow: auto; max-height: calc(100vh - 370px);
      min-height: 160px; border-bottom: 1px solid #dce1e6; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { position: sticky; top: 0; z-index: 1; background: #f9fafb;
      color: #626b77; font-size: 12px; font-weight: normal; text-align: left; }
    td, th { padding: 10px; height: 44px; border-bottom: 1px solid #edf0f3; }
    td:first-child, th:first-child { width: 36px; }
    td.email-cell { min-width: 160px; overflow-wrap: anywhere; }
    tr.selected { background: #edf4fc; }
    tbody tr:hover { background: #f6f9fc; }
    .email { border: 0; background: none; color: #245fa5; padding: 0;
      min-height: 24px; text-align: left; overflow-wrap: anywhere; }
    .permission { text-align: center; min-width: 70px; width: 86px; }
    .activity { min-width: 122px; font-size: 12px; }
    .access { display: inline-block; width: 9px; height: 9px;
      border-radius: 50%; background: #236a51; }
    .access.inherited { background: white; border: 2px solid #236a51; }
    .no-access { color: #a3acb6; }
    .footer { min-height: 52px; color: #626b77; font-size: 12px; flex-wrap: wrap; }
    .legend { display: flex; align-items: center; gap: 6px; }
    .legend .access { margin-left: 8px; }
    .icon-button { width: 34px; padding: 4px; font-size: 18px; }
    .empty { text-align: center; padding: 32px; color: #626b77; }
    .status { min-height: 24px; font-size: 13px; color: #236a51; }
    .error { padding: 10px 12px; border: 1px solid #fecaca; color: #ad3030;
      background: #fef2f2; border-radius: 4px; margin: 12px 0;
      overflow-wrap: anywhere; white-space: pre-line; }
    .overlay { position: fixed; inset: 0; z-index: 1000; background: #16233466;
      display: flex; align-items: center; justify-content: center; padding: 24px; }
    .dialog { width: 540px; max-width: 100%; max-height: calc(100vh - 48px);
      background: white; border: 1px solid #dce1e6; border-radius: 6px;
      box-shadow: 0 16px 70px #0003; display: flex; flex-direction: column; }
    .dialog-head { padding: 18px 24px; border-bottom: 1px solid #dce1e6; }
    .dialog-body { padding: 18px 24px; overflow: auto; overflow-wrap: anywhere; }
    .dialog-footer { justify-content: flex-end; padding: 14px 24px;
      background: #f4f6f8; border-top: 1px solid #dce1e6; }
    .permission-edit { display: flex; align-items: center; gap: 10px;
      padding: 13px 0; border-bottom: 1px solid #dce1e6; }
    .permission-edit span { flex: 1; }
    .permission-edit select { width: 152px; }
    small { display: block; margin-top: 3px; color: #626b77; }
    .notice { border-left: 3px solid #d29932; background: #fff9ec;
      padding: 10px 12px; font-size: 13px; margin: 14px 0; }
    .field { display: block; margin-bottom: 16px; }
    .field input, .field select, textarea { display: block; width: 100%; margin-top: 6px; }
    textarea { min-height: 180px; resize: vertical; border: 1px solid #c5ccd4;
      border-radius: 4px; padding: 10px; font: 13px/1.7 monospace; }
    .account-actions { display: grid; gap: 10px; }
    fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
  `;

  static properties = {
    authentication: { attribute: false },
    users: { type: Array }, loading: { type: Boolean }, error: { type: String },
    newUser: { state: true }, newUserPat: { state: true }, requiresPat: { type: Boolean },
    statusMsg: { state: true }, resetting: { state: true }, saving: { state: true },
    search: { state: true }, view: { state: true }, permissionFilter: { state: true },
    accessFilter: { state: true }, selected: { state: true }, pageIndex: { state: true },
    ascending: { state: true }, sortBy: { state: true }, dialog: { state: true },
    editingIds: { state: true }, permissionDraft: { state: true }, proposed: { state: true },
    reviewError: { state: true }, mailScope: { state: true }, mailFormat: { state: true },
    mailIds: { state: true }, mailStatus: { state: true }, account: { state: true },
  };

  constructor() {
    super();
    this.authentication = null;
    new AuthPresentationController(this);
    this.users = [];
    this.loading = false;
    this.error = '';
    this.newUser = '';
    this.newUserPat = '';
    this.requiresPat = false;
    this.current = null;
    this.statusMsg = '';
    this.resetting = false;
    this.saving = false;
    this.search = '';
    this.view = 'all';
    this.permissionFilter = 'all';
    this.accessFilter = 'has';
    this.selected = new Set();
    this.pageIndex = 0;
    this.ascending = true;
    this.sortBy = 'email';
    this.dialog = '';
    this.editingIds = [];
    this.permissionDraft = {};
    this.proposed = [];
    this.reviewError = '';
    this.mailScope = 'all';
    this.mailFormat = 'semicolon';
    this.mailIds = [];
    this.mailStatus = '';
    this.account = null;
    this._returnFocus = null;
  }

  connectedCallback() { super.connectedCallback(); this.load(); }

  willUpdate() {
    if (!this.enrollmentAvailable && this.dialog === 'add') {
      this.dialog = '';
      this.newUserPat = '';
    }
  }

  async load() {
    this.loading = true;
    this.error = '';
    try {
      const result = await adminProvider.getUsers();
      if (!result.ok) throw new Error(resultErrorMessage(result, 'Failed to load users'));
      this.users = result.data.accounts.slice();
      this.current = result.data.currentId;
      this.requiresPat = result.data.requiresPat === true;
      this.selected = new Set([...this.selected].filter((id) => this.users.some((user) => user.id === id)));
      this._clampPage();
    } catch (error) {
      console.error('Loading admin users failed', error);
      this.error = String(error);
    } finally {
      this.loading = false;
    }
  }

  get busy() { return this.loading || this.saving || this.resetting; }
  get enrollmentAvailable() {
    return this.authentication === null || this.authentication.state.capabilities.enrollment;
  }
  _isAdmin(user) { return user.permissions.includes('admin'); }
  _hasAccess(user, permission) { return this._isAdmin(user) || user.permissions.includes(permission); }

  get filteredUsers() {
    const query = this.search.trim().toLowerCase();
    return this.users.filter((user) => user.email.toLowerCase().includes(query))
      .filter((user) => this.view === 'all' ||
        (this.view === 'admins' && this._isAdmin(user)) ||
        (this.view === 'delegated' && !this._isAdmin(user) && user.permissions.length > 0) ||
        (this.view === 'standard' && user.permissions.length === 0))
      .filter((user) => this.permissionFilter === 'all' ||
        this._hasAccess(user, this.permissionFilter) === (this.accessFilter === 'has'))
      .sort((left, right) => {
        if (this.sortBy === 'lastActive') {
          if (left.lastActive === null) return right.lastActive === null ? left.email.localeCompare(right.email) : 1;
          if (right.lastActive === null) return -1;
          const difference = left.lastActive - right.lastActive;
          if (difference !== 0) return this.ascending ? difference : -difference;
        }
        return this.ascending ? left.email.localeCompare(right.email) : right.email.localeCompare(left.email);
      });
  }

  _sort(column) {
    this.ascending = this.sortBy === column ? !this.ascending : true;
    this.sortBy = column;
    this.pageIndex = 0;
  }

  _clampPage() {
    this.pageIndex = Math.min(this.pageIndex,
      Math.max(0, Math.ceil(this.filteredUsers.length / PAGE_SIZE) - 1));
  }

  _filterChanged() {
    this.statusMsg = this.selected.size > 0 ? 'Selection cleared because filters changed.' : '';
    this.selected = new Set();
    this.pageIndex = 0;
    this.requestUpdate();
  }

  _clearFilters() {
    this.search = ''; this.view = 'all'; this.permissionFilter = 'all'; this.accessFilter = 'has';
    this._filterChanged();
  }

  _selectPage(checked) {
    const selected = new Set(this.selected);
    this.filteredUsers.slice(this.pageIndex * PAGE_SIZE, (this.pageIndex + 1) * PAGE_SIZE)
      .forEach((user) => { if (checked) selected.add(user.id); else selected.delete(user.id); });
    this.selected = selected;
  }

  _selectMatches() { this.selected = new Set(this.filteredUsers.map((user) => user.id)); }

  _toggleSelected(id, checked) {
    const selected = new Set(this.selected);
    if (checked) selected.add(id); else selected.delete(id);
    this.selected = selected;
  }

  _openDialog(name) {
    if (this.busy) return;
    if (this.dialog === '') this._returnFocus = this.shadowRoot.activeElement;
    this.error = '';
    this.dialog = name;
  }

  updated(changed) {
    if (!changed.has('dialog')) return;
    if (this.dialog !== '') this.shadowRoot.querySelector('[role=dialog]').focus();
    else if (this._returnFocus !== null && this._returnFocus.isConnected) this._returnFocus.focus();
  }

  _closeDialog() {
    if (this.busy) return;
    this.dialog = '';
    this.newUserPat = '';
    this.error = '';
  }

  _onDialogKeyDown(event) {
    if (event.key === 'Escape') { event.preventDefault(); this._closeDialog(); }
    if (event.key !== 'Tab') return;
    const controls = [...this.shadowRoot.querySelectorAll(
      '[role=dialog] button:not(:disabled), [role=dialog] input:not(:disabled), ' +
      '[role=dialog] select:not(:disabled), [role=dialog] textarea',
    )];
    if (controls.length === 0) { event.preventDefault(); return; }
    const first = controls[0];
    const last = controls[controls.length - 1];
    const focused = this.shadowRoot.activeElement;
    if (event.shiftKey && (focused === first || focused.getAttribute('role') === 'dialog')) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (focused === last || focused.getAttribute('role') === 'dialog')) {
      event.preventDefault(); first.focus();
    }
  }

  async _runMutation(operation) {
    if (this.busy) return false;
    this.saving = true;
    this.statusMsg = 'Saving...';
    this.error = '';
    try {
      const result = await operation();
      if (!result.ok) throw new Error(resultErrorMessage(result, 'Save failed'));
      await this.load();
      this.statusMsg = 'Saved successfully.';
      return true;
    } catch (error) {
      console.error('Saving admin user failed', error);
      this.error = String(error);
      this.statusMsg = '';
      return false;
    } finally {
      this.saving = false;
    }
  }

  _openAdd() {
    if (!this.enrollmentAvailable) return;
    this.newUser = ''; this.newUserPat = ''; this._openDialog('add');
  }

  async addUser() {
    if (!this.enrollmentAvailable) return;
    const email = this.newUser.trim().toLowerCase();
    if (email === '' || this.busy) return;
    if (!email.includes('@')) { this.error = 'Please enter a valid email address'; return; }
    if (this.users.some((user) => user.email.toLowerCase() === email)) {
      this.error = 'User already exists'; return;
    }
    if (await this._runMutation(() => adminProvider.createUser(email, [], this.newUserPat))) {
      this.newUser = ''; this.newUserPat = ''; this.dialog = '';
      this._clearFilters(); this.search = email; this.statusMsg = `Added ${email}.`;
    }
  }

  _cannotRemove(account) {
    return account.id === this.current ||
      (this._isAdmin(account) && this.users.filter((user) => this._isAdmin(user)).length === 1);
  }

  async removeFrom(account) {
    if (this.busy || this._cannotRemove(account)) return;
    if (!window.confirm(`Remove ${account.email} and revoke their account access?`)) return;
    if (await this._runMutation(() => adminProvider.deleteUser(account.id))) this.dialog = '';
  }

  async resetAccess(account) {
    if (!this.enrollmentAvailable) return;
    if (this.busy) return;
    const selfReset = this.current === account.id;
    const warning = selfReset
      ? `Resetting access for ${account.email} will sign you out of every browser. Save the new account key before continuing. Proceed?`
      : `Revoke every remembered browser for ${account.email} and issue a new account key?`;
    if (!window.confirm(warning)) return;
    this.resetting = true;
    this.error = '';
    try {
      const result = await adminProvider.resetAccountAccess(account.id);
      if (!result.ok) { this.error = resultErrorMessage(result, 'Access reset failed'); return; }
      this.dialog = '';
      await showAccountKeyDialog(result.data.accountKey, account.email);
      if (selfReset) window.location.assign(new URL('../', window.location.href).href);
      this.statusMsg = `Access reset for ${account.email}.`;
    } catch (error) {
      console.error('Resetting account access failed', { id: account.id, error });
      this.error = String(error);
    } finally {
      this.resetting = false;
    }
  }

  _openEditor(ids) {
    this.editingIds = ids.slice();
    this.reviewError = '';
    const user = this.users.find((candidate) => candidate.id === ids[0]);
    this.permissionDraft = Object.fromEntries(PERMISSIONS.map(([key]) =>
      [key, ids.length === 1 ? user.permissions.includes(key) : 'keep']));
    this._openDialog('permissions');
  }

  _setPermissionDraft(key, value) { this.permissionDraft = { ...this.permissionDraft, [key]: value }; }

  _reviewPermissions() {
    const single = this.editingIds.length === 1;
    this.proposed = this.users.filter((user) => this.editingIds.includes(user.id)).map((user) => {
      const permissions = new Set(user.permissions);
      PERMISSIONS.forEach(([key]) => {
        if (single && this.permissionDraft.admin && key !== 'admin') return;
        const action = single ? (this.permissionDraft[key] ? 'grant' : 'revoke') : this.permissionDraft[key];
        if (action === 'grant') permissions.add(key);
        if (action === 'revoke') permissions.delete(key);
      });
      return { id: user.id, email: user.email, before: user.permissions, permissions: [...permissions] };
    }).filter((change) => [...change.before].sort().join(',') !== [...change.permissions].sort().join(','));
    const selfDemotion = this.proposed.some((change) => change.id === this.current &&
      change.before.includes('admin') && !change.permissions.includes('admin'));
    const remainingAdmin = this.users.some((user) => {
      const change = this.proposed.find((candidate) => candidate.id === user.id);
      return change === undefined ? this._isAdmin(user) : change.permissions.includes('admin');
    });
    this.reviewError = selfDemotion ? 'Your own administrator access cannot be removed here.'
      : this.users.some((user) => this._isAdmin(user)) && !remainingAdmin
        ? 'At least one administrator must remain.' : '';
    this.dialog = 'review';
  }

  async _applyPermissions() {
    if (this.busy || this.reviewError !== '' || this.proposed.length === 0) return;
    this.saving = true;
    this.error = '';
    const failures = [];
    let completed = 0;
    const changes = [...this.proposed].sort((left, right) =>
      Number(right.permissions.includes('admin')) - Number(left.permissions.includes('admin')));
    for (const change of changes) {
      this.statusMsg = `Saving ${completed + failures.length + 1} of ${changes.length}...`;
      try {
        const result = await adminProvider.setUserPermissions(change.id, change.permissions);
        if (!result.ok) throw new Error(resultErrorMessage(result, 'Permission update failed'));
        this.users = this.users.map((user) => user.id === change.id
          ? { ...user, permissions: change.permissions } : user);
        completed++;
      } catch (error) {
        console.error('Saving user permissions failed', { id: change.id, error });
        failures.push({ id: change.id, message: `${change.email}: ${String(error)}` });
      }
    }
    this.selected = new Set(failures.map((failure) => failure.id));
    this.error = failures.map((failure) => failure.message).join('\n');
    this.statusMsg = `Updated ${completed} of ${changes.length} accounts.` +
      (failures.length > 0 ? ' Failed accounts remain selected for retry.' : '');
    this.dialog = '';
    this.saving = false;
    this._clampPage();
  }

  _openMail(scope, ids = []) {
    this.mailScope = scope; this.mailIds = ids; this.mailStatus = ''; this._openDialog('mail');
  }

  get mailRecipients() {
    const users = this.mailScope === 'all' ? this.users
      : this.mailScope === 'filtered' ? this.filteredUsers
        : this.users.filter((user) => this.mailScope === 'one'
          ? this.mailIds.includes(user.id) : this.selected.has(user.id));
    return [...new Set(users.map((user) => user.email))].sort();
  }

  get mailText() { return this.mailRecipients.join(this.mailFormat === 'lines' ? '\n' : '; '); }
  get mailCsv() {
    return 'email\r\n' + this.mailRecipients.map((email) => `"${email.replaceAll('"', '""')}"`).join('\r\n');
  }

  async _copyEmails() {
    try {
      await navigator.clipboard.writeText(this.mailText);
      this.mailStatus = `${this.mailRecipients.length} email addresses copied.`;
    } catch (error) {
      console.error('Copying user email addresses failed', error);
      this.mailStatus = 'Clipboard unavailable. Select and copy the addresses below.';
      const textarea = this.shadowRoot.querySelector('#emails');
      textarea.focus(); textarea.select();
    }
  }

  _downloadEmails() {
    const url = URL.createObjectURL(new Blob([this.mailCsv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'planner-user-emails.csv'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    this.mailStatus = `Downloaded ${this.mailRecipients.length} email addresses.`;
  }

  _renderPermissionEditor() {
    const single = this.editingIds.length === 1;
    const targets = this.users.filter((user) => this.editingIds.includes(user.id));
    return html`<p class="muted">${single ? targets[0].email : `${targets.length} selected accounts`}</p>
      ${PERMISSIONS.map(([key, label]) => html`<label class="permission-edit">
        ${single ? html`<input type="checkbox" data-permission=${key}
          .checked=${key !== 'admin' && this.permissionDraft.admin ? true : this.permissionDraft[key]}
          ?disabled=${key !== 'admin' && this.permissionDraft.admin}
          @change=${(event) => this._setPermissionDraft(key, event.target.checked)}>` : ''}
        <span>${label}${single ? '' : html`<small>${targets.filter((user) =>
          this._hasAccess(user, key)).length} of ${targets.length} have access</small>`}</span>
        ${single ? '' : html`<select data-permission=${key} aria-label=${label}
          @change=${(event) => this._setPermissionDraft(key, event.target.value)}>
          ${[['keep', 'Keep unchanged'], ['grant', 'Grant'], ['revoke', 'Revoke']].map(([value, text]) =>
            html`<option value=${value} .selected=${this.permissionDraft[key] === value}>${text}</option>`)}
        </select>`}
      </label>`)}
      <div class="notice">${single
        ? 'Administrators inherit all delegated permissions. Direct permissions are retained when administrator access changes.'
        : 'Only permissions marked Grant or Revoke will change. Administrators retain inherited access while they remain administrators.'}</div>`;
  }

  _renderReview() {
    return html`<p>${this.proposed.length} of ${this.editingIds.length} selected accounts will change.</p>
      ${this.proposed.map((change) => html`<p><strong>${change.email}</strong><br>
        ${PERMISSIONS.filter(([key]) => change.before.includes(key) !== change.permissions.includes(key))
          .map(([key, label]) => html`<span>${label}: ${change.permissions.includes(key) ? 'grant' : 'revoke'}<br></span>`)}
      </p>`)}
      <div class="notice">Administrator access includes all administration areas. Delegated permission
        changes do not restrict accounts that remain administrators. Changes are saved per account.</div>
      ${this.reviewError === '' ? '' : html`<div class="error" role="alert">${this.reviewError}</div>`}`;
  }

  _renderMail() {
    return html`<label class="field">Recipients<select id="mail-scope" @change=${(event) => {
      this.mailScope = event.target.value; this.mailStatus = '';
    }}>
      ${this.mailIds.length === 0 ? '' : html`<option value="one"
        .selected=${this.mailScope === 'one'}>${this.users.find((user) => user.id === this.mailIds[0]).email}</option>`}
      <option value="selected" ?disabled=${this.selected.size === 0}
        .selected=${this.mailScope === 'selected'}>Selected users (${this.selected.size})</option>
      <option value="filtered" .selected=${this.mailScope === 'filtered'}>All matching users (${this.filteredUsers.length})</option>
      <option value="all" .selected=${this.mailScope === 'all'}>All users (${this.users.length})</option>
    </select></label>
    <label class="field">Format<select id="mail-format" @change=${(event) => {
      this.mailFormat = event.target.value; this.mailStatus = '';
    }}>
      <option value="semicolon" .selected=${this.mailFormat === 'semicolon'}>Email addresses, semicolon-separated</option>
      <option value="lines" .selected=${this.mailFormat === 'lines'}>Email addresses, one per line</option>
    </select></label>
    <label for="emails">${this.mailRecipients.length} unique recipients</label>
    <textarea id="emails" readonly spellcheck="false" .value=${this.mailText}></textarea>
    <p class="muted">Use BCC when sending to multiple users to keep their email addresses private.</p>
    <div role="status">${this.mailStatus}</div>`;
  }

  _renderDialog() {
    if (this.dialog === '') return '';
    const titles = { add: 'Add user', permissions: this.editingIds.length === 1
      ? 'Edit user permissions' : `Edit ${this.editingIds.length} users`,
      review: 'Review permission changes', mail: 'Mailing list', account: 'Account actions' };
    return html`<div class="overlay" @keydown=${this._onDialogKeyDown}>
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"
        tabindex="-1" aria-busy=${this.busy}>
        <div class="dialog-head"><h3 id="dialog-title">${titles[this.dialog]}</h3><span class="grow"></span>
          <button class="quiet icon-button" aria-label="Close dialog" title="Close"
            ?disabled=${this.busy} @click=${this._closeDialog}>&times;</button></div>
        <div class="dialog-body"><fieldset ?disabled=${this.busy} ?inert=${this.busy}>
          ${this.error === '' ? '' : html`<div class="error" role="alert">${this.error}</div>`}
          ${this.dialog === 'permissions' ? this._renderPermissionEditor() : ''}
          ${this.dialog === 'review' ? this._renderReview() : ''}
          ${this.dialog === 'mail' ? this._renderMail() : ''}
          ${this.dialog === 'add' ? html`<form id="add-form" @submit=${(event) => {
            event.preventDefault(); this.addUser();
          }}>
            <label class="field">Email<input type="email" required autocomplete="off"
              .value=${this.newUser} @input=${(event) => { this.newUser = event.target.value; }}></label>
            ${this.requiresPat && (this.authentication === null || this.authentication.state.capabilities.pat) ? html`<label class="field">Azure DevOps PAT<input type="password"
              autocomplete="new-password" data-pat="User" required .value=${this.newUserPat}
              @input=${(event) => { this.newUserPat = event.target.value; }}></label>` : ''}
            <p class="muted">Initial access: standard user</p>
          </form>` : ''}
          ${this.dialog === 'account' ? html`<p>${this.account.email}</p><div class="account-actions">
            <button @click=${() => this._openEditor([this.account.id])}>Edit permissions</button>
            <button @click=${() => this._openMail('one', [this.account.id])}>Copy email</button>
            ${this.enrollmentAvailable ? html`
              <button @click=${() => this.resetAccess(this.account)}>Reset access</button>` : ''}
            <button class="danger" ?disabled=${this._cannotRemove(this.account)}
              @click=${() => this.removeFrom(this.account)}>Remove user</button>
          </div>` : ''}
        </fieldset></div>
        <div class="dialog-footer">
          ${this.busy ? html`<span role="status">${this.statusMsg}</span>` : ''}
          <button ?disabled=${this.busy} @click=${() => {
            if (this.dialog === 'review') this.dialog = 'permissions'; else this._closeDialog();
          }}>${this.dialog === 'review' ? 'Back' : 'Close'}</button>
          ${this.dialog === 'add' ? html`<button class="primary" type="submit" form="add-form"
            ?disabled=${this.busy}>Add user</button>` : ''}
          ${this.dialog === 'permissions' ? html`<button class="primary" @click=${this._reviewPermissions}
            ?disabled=${this.busy}>Review changes</button>` : ''}
          ${this.dialog === 'review' ? html`<button class="primary" @click=${this._applyPermissions}
            ?disabled=${this.busy || this.reviewError !== '' || this.proposed.length === 0}>Apply changes</button>` : ''}
          ${this.dialog === 'mail' ? html`<button @click=${this._downloadEmails}
            ?disabled=${this.mailRecipients.length === 0}>Download CSV</button>
            <button class="primary" @click=${this._copyEmails}
              ?disabled=${this.mailRecipients.length === 0}>Copy emails</button>` : ''}
        </div>
      </section></div>`;
  }

  _renderLastActive(user) {
    if (user.lastActive === null) return html`<span class="muted"
      title="No activity has been recorded since tracking began">Not recorded</span>`;
    const date = new Date(user.lastActive * 1000);
    return html`<time datetime=${date.toISOString()} title=${date.toLocaleString()}>
      ${date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</time>`;
  }

  render() {
    const filtered = this.filteredUsers;
    const pageUsers = filtered.slice(this.pageIndex * PAGE_SIZE, (this.pageIndex + 1) * PAGE_SIZE);
    const pageSelected = pageUsers.filter((user) => this.selected.has(user.id)).length;
    const views = [
      ['all', 'All users', this.users.length],
      ['admins', 'Administrators', this.users.filter((user) => this._isAdmin(user)).length],
      ['delegated', 'Delegated access', this.users.filter((user) =>
        !this._isAdmin(user) && user.permissions.length > 0).length],
      ['standard', 'Standard access', this.users.filter((user) => user.permissions.length === 0).length],
    ];
    return html`<section ?inert=${this.dialog !== '' || this.resetting}
      aria-hidden=${this.dialog !== '' || this.resetting} aria-busy=${this.busy}>
      <div class="heading"><h2>Users</h2><span class="count">${this.users.length}</span>
        <span class="grow"></span><button ?disabled=${this.busy} @click=${() =>
          this._openMail(this.selected.size > 0 ? 'selected' : 'filtered')}>Mailing list</button>
        ${this.enrollmentAvailable ? html`<button class="primary" ?disabled=${this.busy}
          @click=${this._openAdd}>Add user</button>` : ''}</div>
      <fieldset ?disabled=${this.busy}>
        <div class="views" aria-label="User views">${views.map(([value, label, count]) => html`
          <button aria-pressed=${this.view === value} @click=${() => {
            this.view = value; this._filterChanged();
          }}>${label}<span class="count">${count}</span></button>`)}</div>
        <div class="filters">
          <input type="search" aria-label="Search email" placeholder="Search email" .value=${this.search}
            @input=${(event) => { this.search = event.target.value; this._filterChanged(); }}>
          <label>Permission<select id="permission" @change=${(event) => {
            this.permissionFilter = event.target.value; this._filterChanged();
          }}><option value="all" .selected=${this.permissionFilter === 'all'}>Any permission</option>
            ${PERMISSIONS.map(([key, label]) => html`<option value=${key}
              .selected=${this.permissionFilter === key}>${label}</option>`)}
          </select></label>
          <select aria-label="Permission access" ?hidden=${this.permissionFilter === 'all'}
            @change=${(event) => { this.accessFilter = event.target.value; this._filterChanged(); }}>
            <option value="has" .selected=${this.accessFilter === 'has'}>Has access</option>
            <option value="without" .selected=${this.accessFilter === 'without'}>Does not have access</option>
          </select>
          <button class="quiet" @click=${this._clearFilters}>Clear filters</button><span class="grow"></span>
          <span class="muted">${filtered.length} matching users</span>
        </div>
        <div class="selection ${this.selected.size > 0 ? 'active' : ''}">
          <strong>${this.selected.size} selected</strong>
          <button class="quiet" ?disabled=${filtered.length === 0} @click=${this._selectMatches}>
            Select all ${filtered.length} matches</button>
          <button class="quiet" ?disabled=${this.selected.size === 0}
            @click=${() => { this.selected = new Set(); }}>Clear selection</button><span class="grow"></span>
          <button ?disabled=${this.selected.size === 0} @click=${() =>
            this._openEditor([...this.selected])}>Edit permissions</button>
          <button ?disabled=${this.selected.size === 0} @click=${() => this._openMail('selected')}>Copy emails</button>
        </div>
        <div class="table-scroll"><table aria-label="Users and effective permissions"><thead><tr>
          <th><input type="checkbox" aria-label="Select this page"
            .checked=${pageUsers.length > 0 && pageSelected === pageUsers.length}
            .indeterminate=${pageSelected > 0 && pageSelected < pageUsers.length}
            ?disabled=${pageUsers.length === 0} @change=${(event) => this._selectPage(event.target.checked)}></th>
          <th aria-sort=${this.sortBy === 'email' ? (this.ascending ? 'ascending' : 'descending') : 'none'}>
            <button class="email" @click=${() => this._sort('email')}>Email
              ${this.sortBy === 'email' ? (this.ascending ? html`&#8593;` : html`&#8595;`) : ''}</button></th>
          <th>Account access</th>${PERMISSIONS.slice(1).map(([, label]) => html`<th class="permission">${label}</th>`)}
          <th class="activity" aria-sort=${this.sortBy === 'lastActive' ? (this.ascending ? 'ascending' : 'descending') : 'none'}>
            <button class="email" aria-label="Last active" title="Sort by last activity"
              @click=${() => this._sort('lastActive')}>Last active
              ${this.sortBy === 'lastActive' ? (this.ascending ? html`&#8593;` : html`&#8595;`) : ''}</button></th>
          <th aria-label="Actions"></th>
        </tr></thead><tbody>${pageUsers.map((user) => html`<tr class=${this.selected.has(user.id) ? 'selected' : ''}>
          <td><input type="checkbox" aria-label=${`Select ${user.email}`} .checked=${this.selected.has(user.id)}
            @change=${(event) => this._toggleSelected(user.id, event.target.checked)}></td>
          <td class="email-cell"><button class="email" @click=${() => this._openEditor([user.id])}>${user.email}</button>
            ${this.current === user.id ? html`<span class="badge">You</span>` : ''}</td>
          <td>${this._isAdmin(user) ? html`<span class="badge admin">Administrator</span>`
            : user.permissions.length > 0 ? 'Delegated' : html`<span class="muted">Standard</span>`}</td>
          ${PERMISSIONS.slice(1).map(([key, label]) => html`<td class="permission">${this._hasAccess(user, key)
            ? html`<span class="access ${this._isAdmin(user) ? 'inherited' : ''}" role="img"
              aria-label=${`${label}: ${this._isAdmin(user) ? 'via administrator' : 'direct access'}`}
              title=${`${label}: ${this._isAdmin(user) ? 'via administrator' : 'direct access'}`}></span>`
            : html`<span class="no-access" aria-label=${`${label}: no access`}>-</span>`}</td>`)}
          <td class="activity">${this._renderLastActive(user)}</td>
          <td><button class="quiet icon-button" title="Account actions" aria-label=${`Actions for ${user.email}`}
            @click=${() => { this.account = user; this._openDialog('account'); }}>&hellip;</button></td>
        </tr>`)}</tbody></table>
        ${this.loading && this.users.length === 0 ? html`<div class="empty">Loading users...</div>`
          : filtered.length === 0 ? html`<div class="empty">${this.users.length === 0
            ? 'No users yet. Add the first user above.' : 'No users match these filters.'}</div>` : ''}</div>
        <div class="footer"><span>${filtered.length === 0 ? '0 users'
          : `${this.pageIndex * PAGE_SIZE + 1}-${Math.min((this.pageIndex + 1) * PAGE_SIZE, filtered.length)} of ${filtered.length}`}</span>
          <span class="legend"><span class="access"></span>Direct access
            <span class="access inherited"></span>Via administrator</span><span class="grow"></span>
          <button class="quiet icon-button" title="Reload users" aria-label="Reload users"
            @click=${() => { this.selected = new Set(); this.load(); }}>&#8635;</button>
          <button class="icon-button" aria-label="Previous page" title="Previous page" ?disabled=${this.pageIndex === 0}
            @click=${() => { this.pageIndex--; }}>&lt;</button>
          <span>Page ${this.pageIndex + 1} of ${Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))}</span>
          <button class="icon-button" aria-label="Next page" title="Next page"
            ?disabled=${(this.pageIndex + 1) * PAGE_SIZE >= filtered.length}
            @click=${() => { this.pageIndex++; }}>&gt;</button>
        </div>
      </fieldset>
      ${this.error === '' ? '' : html`<div class="error" role="alert">${this.error}</div>`}
      <div class="status" role="status">${this.statusMsg}</div>
    </section>${this._renderDialog()}`;
  }
}
customElements.define('admin-users', AdminUsers);