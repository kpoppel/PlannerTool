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
    invalidateLoading: { type: Boolean }
  };

  constructor() {
    super();
    this.cleanupStatus = '';
    this.cleanupType = '';
    this.cleanupLoading = false;
    this.invalidateStatus = '';
    this.invalidateType = '';
    this.invalidateLoading = false;
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

  render() {
    return html`
      <h2>Utilities</h2>

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
