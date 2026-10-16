import { LitElement, html, css } from '/static/js/vendor/lit.js';
import { adminProvider } from '../../services/providerREST.js';

const MAX_WORKFORCE_BYTES = 2 * 1024 * 1024;

export class AdminUtilities extends LitElement {
  static styles = css`
    :host {
      display: block;
      height: 100%;
    }
    h2 {
      margin-top: 0;
      font-size: 1.1rem;
    }

    .panel {
      padding: 16px;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      margin-bottom: 16px;
    }

    .panel h3 {
      margin-top: 0;
      font-size: 1rem;
      color: #374151;
      margin-bottom: 8px;
    }

    .panel p {
      margin: 0 0 12px;
      color: #6b7280;
      font-size: 0.9rem;
      line-height: 1.5;
    }

    .actions {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
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

    button:hover {
      background: #e5e7eb;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    button.primary {
      background: #3b82f6;
      color: #fff;
      border-color: #3b82f6;
    }

    button.primary:hover:not(:disabled) {
      background: #2563eb;
    }

    button.danger {
      background: #ef4444;
      color: #fff;
      border-color: #ef4444;
    }

    button.danger:hover:not(:disabled) {
      background: #dc2626;
    }

    .status {
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 0.9rem;
      margin-top: 8px;
    }

    .status.success {
      background: #d1fae5;
      color: #065f46;
      border: 1px solid #6ee7b7;
    }

    .status.error {
      background: #fee2e2;
      color: #991b1b;
      border: 1px solid #fca5a5;
    }

    .status.info {
      background: #dbeafe;
      color: #1e40af;
      border: 1px solid #93c5fd;
    }

    .status.warning {
      background: #fffbeb;
      color: #92400e;
      border: 1px solid #fbbf24;
    }

    .spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 50%;
      border-top-color: #fff;
      animation: spin 0.6s linear infinite;
      margin-right: 6px;
    }

    .backup-options {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 12px;
      margin-top: 16px;
      padding: 16px;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
    }

    .backup-options label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.9rem;
    }

    .workforce-transfer { padding-top: 24px; border-top: 1px solid #e5e7eb;
      margin-top: 24px; }
    .system-transfer h4, .workforce-transfer h4 { margin: 0 0 12px; font-size: 1rem; }
    .transfer-actions { display: grid; grid-template-columns: 112px 112px; gap: 40px; }
    .workforce-transfer p { font-size: 0.9rem; line-height: 1.5; }
    .workforce-transfer label { font-size: 0.9rem; }
    .workforce-table { overflow: auto; max-height: 520px; margin: 16px 0; }
    .workforce-table table { width: 100%; border-collapse: collapse; table-layout: fixed;
      min-width: 640px; font-size: 0.85rem; }
    .workforce-table th, .workforce-table td { text-align: left; padding: 10px 12px;
      vertical-align: top; border-bottom: 1px solid #e5e7eb; overflow-wrap: anywhere; }
    .workforce-table th { background: #f7f9fb; position: sticky; top: 0; z-index: 1; }
    .workforce-table .conflict { background: #fffbeb; }
    .workforce-table code { font-size: 0.78rem; }
    .workforce-table select { width: 100%; min-height: 34px; padding: 4px;
      border: 1px solid #cbd2da; border-radius: 4px; background: #fff; }
    .workforce-table summary { cursor: pointer; margin: 6px 0; }
    .workforce-table pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 0.78rem; }
    .workforce-identity { display: grid; gap: 4px; }
    .workforce-errors { color: #991b1b; padding-left: 24px; font-size: 0.9rem; }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
  `;

  static properties = {
    cleanupStatus: { type: String },
    cleanupType: { type: String },
    cleanupLoading: { type: Boolean },
    invalidateStatus: { type: String },
    invalidateType: { type: String },
    invalidateLoading: { type: Boolean },
    reloadStatus: { type: String },
    reloadType: { type: String },
    reloadLoading: { type: Boolean },
    backupStatus: { type: String },
    backupType: { type: String },
    backupLoading: { type: Boolean },
    restoreStatus: { type: String },
    restoreType: { type: String },
    restoreLoading: { type: Boolean },
    restoreOptions: { state: true },
    restoreData: { state: true },
    workforceStatus: { state: true },
    workforceType: { state: true },
    workforceLoading: { state: true },
    workforceSource: { state: true },
    workforceFilename: { state: true },
    workforceDecisions: { state: true },
    workforceReview: { state: true },
    workforceReviewed: { state: true },
  };

  static restoreCategories = {
    config: 'Config', accounts: 'User accounts', views: 'Views', scenarios: 'Scenarios',
  };

  static accountRestoreWarning = 'Restoring user accounts replaces current account access with the backup state. Account keys may revert to older keys, newer keys may stop working, revoked browsers may regain access, and deleted accounts may return. Users who cannot enroll, sign in again, or delete their account may need an administrator to use Users > Reset access and provide a replacement account key. Active sessions will end. Ensure an administrator can regain access using the restored credentials before continuing. If no administrator can sign in, use the documented operator reset procedure.';

  constructor() {
    super();
    this.cleanupStatus = '';
    this.cleanupType = '';
    this.cleanupLoading = false;
    this.invalidateStatus = '';
    this.invalidateType = '';
    this.invalidateLoading = false;
    this.reloadStatus = '';
    this.reloadType = '';
    this.reloadLoading = false;
    this.backupStatus = '';
    this.backupType = '';
    this.backupLoading = false;
    this.restoreStatus = '';
    this.restoreType = '';
    this.restoreLoading = false;
    this.restoreOptions = {
      config: true,
      accounts: true,
      views: true,
      scenarios: true,
    };
    this.restoreData = null;
    this.workforceStatus = '';
    this.workforceType = '';
    this.workforceLoading = false;
    this.workforceSource = '';
    this.workforceFilename = '';
    this.workforceDecisions = {};
    this.workforceReview = null;
    this.workforceReviewed = false;
  }

  _errorMessage(result, fallback = 'Request failed') {
    if (result && result.error && typeof result.error.message === 'string') {
      const detail = result.error.detail;
      if (detail !== null && typeof detail === 'object' && typeof detail.message === 'string') {
        return detail.message;
      }
      if (detail !== null && typeof detail === 'object' && Object.hasOwn(detail, 'detail')) {
        const explanation = detail.detail;
        if (explanation !== null && typeof explanation === 'object'
            && typeof explanation.message === 'string') return explanation.message;
      }
      return result.error.message;
    }
    if (result && typeof result.error === 'string') {
      return result.error;
    }
    return fallback;
  }

  async handleReloadConfig() {
    if (
      !confirm(
        'This will reload server and config state and invalidate runtime caches. Continue?'
      )
    )
      return;
    this.reloadLoading = true;
    this.reloadStatus = '';
    this.reloadType = '';
    try {
      const result = await adminProvider.reloadConfig();
      if (result && result.ok) {
        this.reloadStatus = 'Configuration reloaded successfully';
        this.reloadType = 'success';
      } else {
        this.reloadStatus = this._errorMessage(result, 'Reload failed');
        this.reloadType = 'error';
      }
    } catch (e) {
      this.reloadStatus = `Error: ${e.message}`;
      this.reloadType = 'error';
    } finally {
      this.reloadLoading = false;
    }
  }

  async handleCacheCleanup() {
    this.cleanupLoading = true;
    this.cleanupStatus = '';
    this.cleanupType = '';

    try {
      const result = await adminProvider.cleanupCache();

      if (result.ok) {
        const orphaned = result.data?.orphaned_cleaned || 0;
        this.cleanupStatus = `Successfully cleaned up ${orphaned} orphaned cache entries`;
        this.cleanupType = 'success';
      } else {
        this.cleanupStatus = this._errorMessage(result, 'Cache cleanup failed');
        this.cleanupType = 'error';
      }
    } catch (e) {
      this.cleanupStatus = `Error: ${e.message}`;
      this.cleanupType = 'error';
    } finally {
      this.cleanupLoading = false;
    }
  }

  async handleCacheInvalidate() {
    if (
      !confirm(
        'This will clear all Azure cache data and force a refresh from Azure DevOps. Continue?'
      )
    ) {
      return;
    }

    this.invalidateLoading = true;
    this.invalidateStatus = '';
    this.invalidateType = '';

    try {
      const result = await adminProvider.invalidateCache();

      if (result.ok) {
        const cleared = result.data?.cleared || 0;
        const orphaned = result.data?.orphaned_cleaned || 0;
        this.invalidateStatus = `Successfully cleared ${cleared} cache entries and ${orphaned} orphaned entries`;
        this.invalidateType = 'success';
      } else {
        this.invalidateStatus = this._errorMessage(result, 'Cache invalidation failed');
        this.invalidateType = 'error';
      }
    } catch (e) {
      this.invalidateStatus = `Error: ${e.message}`;
      this.invalidateType = 'error';
    } finally {
      this.invalidateLoading = false;
    }
  }

  async handleBackup() {
    this.backupLoading = true;
    this.backupStatus = 'Backing up...';
    this.backupType = 'info';

    try {
      const backupResult = await adminProvider.getBackup();
      if (backupResult?.ok) {
        const blob = new Blob([JSON.stringify(backupResult.data, null, 2)], {
          type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `planner-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.backupStatus = 'Backup successful!';
        this.backupType = 'success';
      } else {
        this.backupStatus = this._errorMessage(backupResult, 'Backup failed. See console for details.');
        this.backupType = 'error';
      }
    } catch (e) {
      this.backupStatus = `Error: ${e.message}`;
      this.backupType = 'error';
    } finally {
      this.backupLoading = false;
    }
  }

  async handleFileSelect(event) {
    if (this.restoreLoading) return;
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = '';
    this.restoreData = null;
    this.restoreLoading = true;
    this.restoreStatus = 'Checking backup compatibility...';
    this.restoreType = 'info';
    try {
      const source = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read system backup file.'));
        reader.readAsText(file, 'UTF-8');
      });
      const data = JSON.parse(source);
      const result = await adminProvider.validateBackup(data);
      if (!result.ok) {
        this.restoreStatus = this._errorMessage(result);
        this.restoreType = 'error';
        return;
      }
      this.restoreData = data;
      this.restoreStatus = `Backup compatible with server schema ${result.data.schema_revision}. Ready to restore.`;
      this.restoreType = 'info';
    } catch (error) {
      console.error('System backup validation failed', { name: error.name });
      this.restoreStatus = `Error loading backup: ${error.message}`;
      this.restoreType = 'error';
    } finally {
      this.restoreLoading = false;
    }
  }

  handleToggleRestoreOption(key) {
    this.restoreOptions = {
      ...this.restoreOptions,
      [key]: !this.restoreOptions[key],
    };
  }

  async handleRestore() {
    if (!this.restoreData) {
      this.restoreStatus = 'No file loaded to restore.';
      this.restoreType = 'error';
      return;
    }

    const restoringAccounts = this.restoreOptions.accounts && Object.hasOwn(this.restoreData, 'accounts');
    const confirmation = restoringAccounts
      ? this.constructor.accountRestoreWarning + '\n\nOverwrite selected data?'
      : 'This will overwrite selected data. Are you sure you want to restore?';
    if (!confirm(confirmation))
      return;

    this.restoreLoading = true;
    this.restoreStatus = 'Restoring...';
    this.restoreType = 'info';

    const dataToRestore = {};
    if (Object.hasOwn(this.restoreData, 'schema_revision')) {
      dataToRestore.schema_revision = this.restoreData.schema_revision;
    }
    for (const key in this.restoreOptions) {
      if (this.restoreOptions[key] && Object.hasOwn(this.restoreData, key)) {
        dataToRestore[key] = this.restoreData[key];
      }
    }
    if (restoringAccounts) dataToRestore.authentication = this.restoreData.authentication;

    try {
      const result = await adminProvider.restoreBackup(dataToRestore);
      if (result.ok) {
        const warning = result.data.warning;
        if (warning) {
          this.restoreStatus = warning;
          this.restoreType = 'warning';
        } else {
          this.restoreStatus = restoringAccounts
            ? 'Restore successful. ' + this.constructor.accountRestoreWarning : 'Restore successful!';
          this.restoreType = restoringAccounts ? 'warning' : 'success';
        }
      } else {
        this.restoreStatus = `Restore failed: ${this._errorMessage(result, 'Unknown error')}`;
        this.restoreType = 'error';
      }
    } catch (e) {
      this.restoreStatus = `Error: ${e.message}`;
      this.restoreType = 'error';
    } finally {
      this.restoreLoading = false;
    }
  }

  async handleWorkforceExport() {
    if (this.workforceLoading) return;
    this.workforceLoading = true;
    this.workforceStatus = '';
    try {
      const result = await adminProvider.exportWorkforce();
      if (!result.ok) {
        this.workforceStatus = this._errorMessage(result);
        this.workforceType = 'error';
        return;
      }
      const { source, filename } = result.data.content;
      const url = URL.createObjectURL(new Blob([source], { type: 'application/yaml' }));
      const anchor = document.createElement('a');
      try {
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
      } finally {
        anchor.remove();
        URL.revokeObjectURL(url);
      }
      this.workforceStatus = 'Workforce exported.';
      this.workforceType = 'success';
    } catch (error) {
      console.error('Workforce export failed', error);
      this.workforceStatus = error.message;
      this.workforceType = 'error';
    } finally {
      this.workforceLoading = false;
    }
  }

  async handleWorkforceFileSelect(event) {
    if (this.workforceLoading) return;
    const file = event.target.files[0];
    if (!file) return;
    this.workforceSource = '';
    this.workforceFilename = file.name;
    this.workforceDecisions = {};
    this.workforceReview = null;
    this.workforceReviewed = false;
    this.workforceStatus = '';
    if (file.size > MAX_WORKFORCE_BYTES) {
      this.workforceStatus = 'Workforce file must be no larger than 2 MiB.';
      this.workforceType = 'error';
      return;
    }
    this.workforceLoading = true;
    try {
      this.workforceSource = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read workforce file.'));
        reader.readAsText(file, 'UTF-8');
      });
    } catch (error) {
      console.error('Workforce file read failed', error);
      this.workforceStatus = error.message;
      this.workforceType = 'error';
      return;
    } finally {
      this.workforceLoading = false;
    }
    await this.handleWorkforcePreview();
  }

  async handleWorkforcePreview() {
    if (this.workforceLoading) return;
    this.workforceLoading = true;
    this.workforceReviewed = false;
    this.workforceStatus = '';
    try {
      const result = await adminProvider.previewWorkforceImport(
        this.workforceSource, this.workforceDecisions,
      );
      if (!result.ok) {
        this.workforceReview = null;
        this.workforceStatus = this._errorMessage(result);
        this.workforceType = 'error';
        return;
      }
      this.workforceReview = result.data.content;
      this.workforceReviewed = true;
    } catch (error) {
      console.error('Workforce preview failed', error);
      this.workforceReview = null;
      this.workforceStatus = error.message;
      this.workforceType = 'error';
    } finally {
      this.workforceLoading = false;
    }
  }

  handleWorkforceDecision(identity, choice) {
    const decisions = { ...this.workforceDecisions };
    if (choice === '') delete decisions[identity];
    else decisions[identity] = choice;
    this.workforceDecisions = decisions;
    this.workforceReviewed = false;
    this.workforceStatus = '';
  }

  handleWorkforceCancel() {
    this.workforceSource = '';
    this.workforceFilename = '';
    this.workforceDecisions = {};
    this.workforceReview = null;
    this.workforceReviewed = false;
    this.workforceStatus = '';
    this.renderRoot.querySelector('#workforce-file').value = '';
  }

  async handleWorkforceImport() {
    if (this.workforceLoading || !this.workforceReviewed || !this.workforceReview.ready) return;
    if (!confirm('Import the reviewed workforce and overwrite only the selected conflicting records? '
      + 'Destination-only definitions and unrelated configuration will be kept.')) return;
    this.workforceLoading = true;
    const review = this.workforceReview;
    this.workforceReviewed = false;
    try {
      const result = await adminProvider.importWorkforce({
        source: this.workforceSource, decisions: this.workforceDecisions,
        revision: review.revision, review_revision: review.review_revision,
      });
      if (!result.ok) {
        this.workforceStatus = this._errorMessage(result);
        this.workforceType = 'error';
        return;
      }
      this.handleWorkforceCancel();
      if (Object.hasOwn(result.data, 'warnings') && result.data.warnings.length > 0) {
        this.workforceStatus = 'Workforce imported. '
          + result.data.warnings.map(warning => warning.message).join(' ');
        this.workforceType = 'warning';
      } else {
        this.workforceStatus = 'Workforce imported successfully.';
        this.workforceType = 'success';
      }
    } catch (error) {
      console.error('Workforce import failed', error);
      this.workforceStatus = error.message;
      this.workforceType = 'error';
    } finally {
      this.workforceLoading = false;
    }
  }

  renderWorkforceTransfer() {
    const review = this.workforceReview;
    return html`
      <section class="workforce-transfer" aria-labelledby="workforce-transfer-heading"
        aria-busy=${this.workforceLoading}>
        <h4 id="workforce-transfer-heading">Workforce</h4>
        <div class="transfer-actions">
          <button @click=${this.handleWorkforceExport} ?disabled=${this.workforceLoading}>
            Backup
          </button>
          <button ?disabled=${this.workforceLoading}
            @click=${() => this.renderRoot.querySelector('#workforce-file').click()}>
            Restore
          </button>
        </div>
        <input id="workforce-file" type="file" accept=".yaml,.yml" hidden
          aria-label="Import workforce file" ?disabled=${this.workforceLoading}
          @change=${this.handleWorkforceFileSelect} />
        ${this.workforceSource ? html`
          <div class="actions">
            <button @click=${this.handleWorkforcePreview} ?disabled=${this.workforceLoading}>
              ${this.workforceLoading ? 'Working...' : 'Review Choices'}
            </button>
            <button @click=${this.handleWorkforceCancel} ?disabled=${this.workforceLoading}>Cancel</button>
          </div>
        ` : ''}
        ${review ? html`
          <h5>Import Preview: ${this.workforceFilename}</h5>
          <p>${review.records.filter(row => row.status === 'new').length} new,
            ${review.records.filter(row => row.status === 'identical').length} identical,
            ${review.records.filter(row => row.status === 'conflict').length} conflicting records.</p>
          <div class="workforce-table">
            <table aria-label="Workforce import records">
              <thead><tr><th>Definition</th><th>Current</th><th>Incoming</th><th>Action</th></tr></thead>
              <tbody>${review.records.map(row => html`
                <tr class=${row.status === 'conflict' ? 'conflict' : ''}>
                  <td><div class="workforce-identity"><strong>${row.name}</strong>
                    <span>${row.kind}</span><code>${row.id}</code></div></td>
                  <td>${row.current ? html`<details><summary>Current values</summary>
                    <pre>${JSON.stringify(row.current, null, 2)}</pre></details>` : 'Not present'}</td>
                  <td><details><summary>Incoming values</summary>
                    <pre>${JSON.stringify(row.incoming, null, 2)}</pre></details></td>
                  <td>${row.status === 'conflict' || row.status === 'new' ? html`
                    <select aria-label=${`Decision for ${row.name} (${row.id})`}
                      data-workforce-decision=${row.id} ?disabled=${this.workforceLoading}
                      @change=${event => this.handleWorkforceDecision(row.id, event.target.value)}>
                      <option value="" .selected=${!Object.hasOwn(this.workforceDecisions, row.id)}>
                        ${row.status === 'new' ? 'Add' : 'Choose...'}
                      </option>
                      <option value="skip" .selected=${this.workforceDecisions[row.id] === 'skip'}>Skip</option>
                      ${row.structural || row.status === 'new' ? '' : html`
                        <option value="overwrite" .selected=${this.workforceDecisions[row.id] === 'overwrite'}>Overwrite</option>
                      `}
                    </select>
                    ${row.structural ? html`<p>Identity or token collision. Skip required.</p>` : ''}
                  ` : 'Keep unchanged'}</td>
                </tr>
              `)}</tbody>
            </table>
          </div>
          <p>Checked ${review.coverage.retained_tasks} retained tasks,
            ${review.coverage.scenarios} scenarios and ${review.coverage.views} saved views.
            Historical ADO references cannot be fully verified. No ADO tasks will be rewritten.</p>
          ${this.workforceReviewed && review.errors.length > 0 ? html`
            <ul class="workforce-errors" role="alert">${review.errors.map(error => html`<li>${error}</li>`)}</ul>
          ` : ''}
          <button id="workforce-import" class="primary" @click=${this.handleWorkforceImport}
            ?disabled=${this.workforceLoading || !this.workforceReviewed || !review.ready}>
            Import Workforce
          </button>
        ` : ''}
        ${this.workforceStatus ? html`
          <div class="status ${this.workforceType}" role="status">${this.workforceStatus}</div>
        ` : ''}
      </section>
    `;
  }

  renderBackupAndRestore() {
    const restoreCategories = this.restoreData
      ? Object.keys(this.constructor.restoreCategories).filter(key => Object.hasOwn(this.restoreData, key))
      : [];

    return html`
      <div class="panel">
        <h3>Backup & Restore</h3>
        <section class="system-transfer" aria-labelledby="system-transfer-heading">
        <h4 id="system-transfer-heading">System</h4>
        <div class="transfer-actions">
          <button
            @click=${this.handleBackup}
            ?disabled=${this.backupLoading}
            class="primary"
          >
            ${this.backupLoading ? html`<span class="spinner"></span>` : ''} Backup
          </button>
          <button ?disabled=${this.restoreLoading}
            @click=${() => this.renderRoot.querySelector('#system-file').click()}>
            Restore
          </button>
        </div>
        ${this.backupStatus ?
          html`<div class="status ${this.backupType}">${this.backupStatus}</div>`
        : ''}

        <input id="system-file" type="file" hidden aria-label="Restore system backup"
          @change=${this.handleFileSelect} accept=".json" ?disabled=${this.restoreLoading} />

        ${this.restoreData ?
          html`
            <div class="backup-options">
              <p>Select data to restore:</p>
              ${restoreCategories.map(
                (key) => html`
                  <label>
                    <input
                      type="checkbox"
                      id=${'restore-' + key}
                      .checked=${this.restoreOptions[key]}
                      ?disabled=${this.restoreLoading}
                      @change=${() => this.handleToggleRestoreOption(key)}
                    />
                    ${this.constructor.restoreCategories[key]}
                  </label>
                `
              )}
            </div>
            ${this.restoreOptions.accounts && Object.hasOwn(this.restoreData, 'accounts')
              ? html`<p id="accountRestoreWarning" class="status warning" role="alert">${this.constructor.accountRestoreWarning}</p>`
              : ''}
            <div class="actions" style="margin-top: 16px;">
              <button
                @click=${this.handleRestore}
                ?disabled=${this.restoreLoading}
                class="danger"
              >
                ${this.restoreLoading ? html`<span class="spinner"></span>` : ''} Restore
                Selected
              </button>
            </div>
          `
        : ''}
        ${this.restoreStatus ?
          html`<div class="status ${this.restoreType}" style="margin-top: 12px;">
            ${this.restoreStatus}
          </div>`
        : ''}
        </section>
        ${this.renderWorkforceTransfer()}
      </div>
    `;
  }

  render() {
    return html`
      <h2>Utilities</h2>

      ${this.renderBackupAndRestore()}

      <div class="panel">
        <h3>Cache Cleanup</h3>
        <p>
          Clean up orphaned cache index entries for files that no longer exist. This is
          useful after area path changes or manual cache deletions. Does not clear actual
          cache data.
        </p>
        <div class="actions">
          <button @click=${this.handleCacheCleanup} ?disabled=${this.cleanupLoading}>
            ${this.cleanupLoading ? html`<span class="spinner"></span>` : ''} Clean Up
            Orphaned Entries
          </button>
        </div>
        ${this.cleanupStatus ?
          html` <div class="status ${this.cleanupType}">${this.cleanupStatus}</div> `
        : ''}
      </div>

      <div class="panel">
        <h3>Reload Configuration</h3>
        <p>
          Force the server to reload configuration artifacts and invalidate runtime
          caches. Use this after editing configuration files to ensure all services pick
          up the changes.
        </p>
        <div class="actions">
          <button
            class="primary"
            @click=${this.handleReloadConfig}
            ?disabled=${this.reloadLoading}
          >
            ${this.reloadLoading ? html`<span class="spinner"></span>` : ''} Reload
            Configuration
          </button>
        </div>
        ${this.reloadStatus ?
          html` <div class="status ${this.reloadType}">${this.reloadStatus}</div> `
        : ''}
      </div>

      <div class="panel">
        <h3>Cache Invalidation</h3>
        <p>
          Clear all Azure cache data (work items, teams, plans, markers, iterations). The
          next data fetch will retrieve fresh data from Azure DevOps.
          <strong>This will force a complete refresh and may take some time.</strong>
        </p>
        <div class="actions">
          <button
            class="danger"
            @click=${this.handleCacheInvalidate}
            ?disabled=${this.invalidateLoading}
          >
            ${this.invalidateLoading ? html`<span class="spinner"></span>` : ''}
            Invalidate All Caches
          </button>
        </div>
        ${this.invalidateStatus ?
          html`
            <div class="status ${this.invalidateType}">${this.invalidateStatus}</div>
          `
        : ''}
      </div>
    `;
  }
}

customElements.define('admin-utilities', AdminUtilities);
