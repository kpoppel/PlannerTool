import { LitElement, html, css } from '/static/js/vendor/lit.js';
import { adminProvider } from '../../services/providerREST.js';

export class AdminUtilities extends LitElement {
  static styles = css`
    :host { display: block; height: 100%; }
    h2 { margin-top: 0; font-size: 1.1rem; }
    
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
    
    button:hover { background: #e5e7eb; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    
    button.primary {
      background: #3b82f6;
      color: #fff;
      border-color: #3b82f6;
    }
    
    button.primary:hover:not(:disabled) { background: #2563eb; }
    
    button.danger {
      background: #ef4444;
      color: #fff;
      border-color: #ef4444;
    }
    
    button.danger:hover:not(:disabled) { background: #dc2626; }
    
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
    
    .spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255,255,255,0.3);
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
    
    @keyframes spin {
      to { transform: rotate(360deg); }
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
    restoreData: { state: true }
  };

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
        users: true,
        views: true,
        scenarios: true
      };
    this.restoreData = null;
  }

  async handleReloadConfig() {
    if (!confirm('This will reload server and config state and invalidate runtime caches. Continue?')) return;
    this.reloadLoading = true;
    this.reloadStatus = '';
    this.reloadType = '';
    try {
      const result = await adminProvider.reloadConfig();
      if (result && result.ok) {
        this.reloadStatus = 'Configuration reloaded successfully';
        this.reloadType = 'success';
      } else {
        this.reloadStatus = result && result.error ? result.error : 'Reload failed';
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
        this.cleanupStatus = `Successfully cleaned up ${result.orphaned_cleaned || 0} orphaned cache entries`;
        this.cleanupType = 'success';
      } else {
        this.cleanupStatus = result.error || 'Cache cleanup failed';
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
    if (!confirm('This will clear all Azure cache data and force a refresh from Azure DevOps. Continue?')) {
      return;
    }

    this.invalidateLoading = true;
    this.invalidateStatus = '';
    this.invalidateType = '';
    
    try {
      const result = await adminProvider.invalidateCache();
      
      if (result.ok) {
        const cleared = result.cleared || 0;
        const orphaned = result.orphaned_cleaned || 0;
        this.invalidateStatus = `Successfully cleared ${cleared} cache entries and ${orphaned} orphaned entries`;
        this.invalidateType = 'success';
      } else {
        this.invalidateStatus = result.error || 'Cache invalidation failed';
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
      const backupData = await adminProvider.getBackup();
      if (backupData) {
        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
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
        this.backupStatus = 'Backup failed. See console for details.';
        this.backupType = 'error';
      }
    } catch (e) {
      this.backupStatus = `Error: ${e.message}`;
      this.backupType = 'error';
    } finally {
      this.backupLoading = false;
    }
  }

  handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        this.restoreData = JSON.parse(event.target.result);
        this.restoreStatus = 'File loaded. Ready to restore.';
        this.restoreType = 'info';
      } catch (err) {
        this.restoreStatus = `Error parsing file: ${err.message}`;
        this.restoreType = 'error';
        this.restoreData = null;
      }
    };
    reader.readAsText(file);
  }

  handleToggleRestoreOption(key) {
    this.restoreOptions = {
        ...this.restoreOptions,
        [key]: !this.restoreOptions[key]
    };
  }

  async handleRestore() {
    if (!this.restoreData) {
      this.restoreStatus = 'No file loaded to restore.';
      this.restoreType = 'error';
      return;
    }

    if (!confirm('This will overwrite existing data. Are you sure you want to restore?')) return;
    
    this.restoreLoading = true;
    this.restoreStatus = 'Restoring...';
    this.restoreType = 'info';

    const dataToRestore = {};
    // Map UI restore options to top-level keys in the backup file
    const mapping = { config: 'config', users: 'accounts', views: 'views', scenarios: 'scenarios' };
    for (const key in this.restoreOptions) {
      const srcKey = mapping[key];
      if (!srcKey) continue;
      if (this.restoreOptions[key] && this.restoreData[srcKey]) {
        dataToRestore[srcKey] = this.restoreData[srcKey];
      }
    }

    try {
      const result = await adminProvider.restoreBackup(dataToRestore);
      if (result.ok) {
        this.restoreStatus = 'Restore successful!';
        this.restoreType = 'success';
      } else {
        this.restoreStatus = `Restore failed: ${result.error || 'Unknown error'}`;
        this.restoreType = 'error';
      }
    } catch (e) {
      this.restoreStatus = `Error: ${e.message}`;
      this.restoreType = 'error';
    } finally {
      this.restoreLoading = false;
    }
  }

  renderBackupAndRestore() {
    const restoreCategories = this.restoreData ? Object.keys(this.restoreData) : [];

    return html`
      <div class="panel">
        <h3>Backup & Restore</h3>
        <p>
          Backup or restore the complete system configuration, including users, views, and scenarios.
          Cached data is not included in the backup.
        </p>
        <div class="actions">
          <button @click=${this.handleBackup} ?disabled=${this.backupLoading} class="primary">
            ${this.backupLoading ? html`<span class="spinner"></span>` : ''}
            Backup All
          </button>
        </div>
        ${this.backupStatus ? html`<div class="status ${this.backupType}">${this.backupStatus}</div>` : ''}

        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">

        <h4>Restore from File</h4>
        <div class="actions">
          <input type="file" @change=${this.handleFileSelect} accept=".json">
        </div>
        
        ${this.restoreData ? html`
            <div class="backup-options">
                <p>Select data to restore:</p>
                ${restoreCategories.map(key => html`
                    <label>
                        <input
                            type="checkbox"
                            .checked=${this.restoreOptions[key] !== false}
                            @change=${() => this.handleToggleRestoreOption(key)}
                        >
                        ${key.charAt(0).toUpperCase() + key.slice(1)}
                    </label>
                `)}
            </div>
            <div class="actions" style="margin-top: 16px;">
                <button @click=${this.handleRestore} ?disabled=${this.restoreLoading} class="danger">
                    ${this.restoreLoading ? html`<span class="spinner"></span>` : ''}
                    Restore Selected
                </button>
            </div>
        ` : ''}

        ${this.restoreStatus ? html`<div class="status ${this.restoreType}" style="margin-top: 12px;">${this.restoreStatus}</div>` : ''}
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
          Clean up orphaned cache index entries for files that no longer exist.
          This is useful after area path changes or manual cache deletions.
          Does not clear actual cache data.
        </p>
        <div class="actions">
          <button 
            @click=${this.handleCacheCleanup}
            ?disabled=${this.cleanupLoading}
          >
            ${this.cleanupLoading ? html`<span class="spinner"></span>` : ''}
            Clean Up Orphaned Entries
          </button>
        </div>
        ${this.cleanupStatus ? html`
          <div class="status ${this.cleanupType}">${this.cleanupStatus}</div>
        ` : ''}
      </div>

      <div class="panel">
        <h3>Reload Configuration</h3>
        <p>
          Force the server to reload configuration artifacts and invalidate runtime caches.
          Use this after editing configuration files to ensure all services pick up the changes.
        </p>
        <div class="actions">
          <button 
            class="primary"
            @click=${this.handleReloadConfig}
            ?disabled=${this.reloadLoading}
          >
            ${this.reloadLoading ? html`<span class="spinner"></span>` : ''}
            Reload Configuration
          </button>
        </div>
        ${this.reloadStatus ? html`
          <div class="status ${this.reloadType}">${this.reloadStatus}</div>
        ` : ''}
      </div>

      <div class="panel">
        <h3>Cache Invalidation</h3>
        <p>
          Clear all Azure cache data (work items, teams, plans, markers, iterations).
          The next data fetch will retrieve fresh data from Azure DevOps.
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
        ${this.invalidateStatus ? html`
          <div class="status ${this.invalidateType}">${this.invalidateStatus}</div>
        ` : ''}
      </div>
    `;
  }
}

customElements.define('admin-utilities', AdminUtilities);
