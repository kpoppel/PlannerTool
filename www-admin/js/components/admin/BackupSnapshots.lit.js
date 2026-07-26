import { LitElement, html, css } from '/static/js/vendor/lit.js';

/**
 * AdminBackupSnapshots - Manage individual config backup snapshots.
 * Lists all timestamped backups grouped by config key, with actions:
 * View (raw JSON), Delete, Restore, and Prune (keep last N).
 */
export class AdminBackupSnapshots extends LitElement {
  static properties = {
    _snapshots: { state: true },
    _loading: { state: true },
    _error: { state: true },
    _viewing: { state: true },   // snapshot being viewed in modal
    _pruneN: { state: true },     // prune keep-last value
    _actionMsg: { state: true },  // transient action message
  };

  static styles = css`
    :host { display: block; height: 100%; }
    h2 { margin-top: 0; font-size: 1.1rem; }
    .panel { padding: 12px; background: #fff; border: 1px solid #e5e7eb; border-radius: 6px; height: calc(100vh - 160px); overflow-y: auto; display: flex; flex-direction: column; }
    .toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #e5e7eb; flex-wrap: wrap; }
    .toolbar label { font-size: 0.9rem; color: #333; }
    .toolbar input[type="number"] { width: 64px; padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 0.9rem; }
    button { padding: 6px 14px; border-radius: 6px; border: 1px solid #ccc; background: #f3f4f6; cursor: pointer; font-size: 0.85rem; }
    button:hover { background: #e5e7eb; }
    button.primary { background: #3b82f6; color: #fff; border-color: #3b82f6; }
    button.primary:hover { background: #2563eb; }
    button.danger { background: #ef4444; color: #fff; border-color: #ef4444; }
    button.danger:hover { background: #dc2626; }
    .group-title { font-weight: 700; margin: 16px 0 8px; padding-top: 8px; border-top: 1px solid #e5e7eb; font-size: 1rem; color: #23344d; }
    .group-title:first-of-type { border-top: none; margin-top: 0; padding-top: 0; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #f3f4f6; }
    th { color: #6b7280; font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }
    tr:hover td { background: #f9fafb; }
    .actions-cell { white-space: nowrap; display: flex; gap: 4px; }
    .actions-cell button { padding: 3px 8px; font-size: 0.8rem; }
    .msg { margin-top: 8px; padding: 6px 12px; border-radius: 4px; font-size: 0.85rem; background: #ecfdf5; color: #065f46; }
    .msg.error { background: #fef2f2; color: #991b1b; }

    /* Modal overlay */
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
    .modal { background: #fff; border-radius: 8px; box-shadow: 0 8px 32px rgba(0,0,0,0.2); width: min(90vw, 720px); max-height: 80vh; display: flex; flex-direction: column; }
    .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-weight: 600; }
    .modal-body { padding: 16px; overflow-y: auto; flex: 1; }
    .modal-body pre { margin: 0; white-space: pre-wrap; word-break: break-all; font-size: 0.85rem; color: #333; background: #f9fafb; padding: 12px; border-radius: 4px; border: 1px solid #e5e7eb; }
    .modal-close { background: none; border: none; font-size: 1.2rem; cursor: pointer; color: #6b7280; padding: 0 4px; }
    .modal-close:hover { color: #111; }
  `;

  constructor() {
    super();
    this._snapshots = [];
    this._loading = false;
    this._error = null;
    this._viewing = null;
    this._pruneN = 5;
    this._actionMsg = '';
  }

  async connectedCallback() {
    super.connectedCallback();
    await this.loadSnapshots();
  }

  async loadSnapshots() {
    this._loading = true;
    this._error = null;
    try {
      const res = await fetch('/admin/v1/backup-snapshots');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this._snapshots = data.snapshots || [];
    } catch (e) {
      this._error = e.message;
    } finally {
      this._loading = false;
    }
  }

  async handleView(key) {
    try {
      const res = await fetch(`/admin/v1/backup-snapshots/${encodeURIComponent(key)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this._viewing = JSON.stringify(data.content, null, 2);
    } catch (e) {
      alert(`Failed to load snapshot: ${e.message}`);
    }
  }

  async handleDelete(key) {
    if (!confirm(`Delete backup "${key}"?`)) return;
    try {
      const res = await fetch(`/admin/v1/backup-snapshots/${encodeURIComponent(key)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this._actionMsg = `Deleted "${key}"`;
      await this.loadSnapshots();
    } catch (e) {
      alert(`Failed to delete: ${e.message}`);
    } finally {
      setTimeout(() => { this._actionMsg = ''; }, 3000);
    }
  }

  async handleRestore(key) {
    if (!confirm(`Restore config from backup "${key}"? This will overwrite the current value.`)) return;
    try {
      const res = await fetch(`/admin/v1/backup-snapshots/${encodeURIComponent(key)}`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this._actionMsg = `Restored from "${key}"`;
      await this.loadSnapshots();
    } catch (e) {
      alert(`Failed to restore: ${e.message}`);
    } finally {
      setTimeout(() => { this._actionMsg = ''; }, 3000);
    }
  }

  async handlePrune() {
    if (!confirm(`Prune backups, keeping last ${this._pruneN} per config key?`)) return;
    try {
      const res = await fetch('/admin/v1/backup-snapshots/prune', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keep_last: this._pruneN }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this._actionMsg = `Pruned: deleted ${data.deleted_count}, kept ${data.kept_count}`;
      await this.loadSnapshots();
    } catch (e) {
      alert(`Failed to prune: ${e.message}`);
    } finally {
      setTimeout(() => { this._actionMsg = ''; }, 3000);
    }
  }

  _groupedSnapshots() {
    const groups = {};
    for (const s of this._snapshots) {
      (groups[s.config_key] ??= []).push(s);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }

  render() {
    return html`<div class="panel">
      <h2>Backup Snapshots</h2>
      <div class="toolbar">
        <label for="prune-n">Prune: keep last </label>
        <input id="prune-n" type="number" min="0" .value=${this._pruneN} @change=${(e) => { this._pruneN = parseInt(e.target.value, 10) || 0; }} />
        <button class="primary" @click=${() => this.handlePrune()}>Prune</button>
      </div>

      ${this._actionMsg ? html`<div class="msg">${this._actionMsg}</div>` : ''}
      ${this._error ? html`<div class="msg error">Error: ${this._error}</div>` : ''}
      ${this._loading && this._snapshots.length === 0 ? html`<div>Loading…</div>` : ''}

      ${this._groupedSnapshots().map(([configKey, entries]) => html`
        <div class="group-title">${configKey} (${entries.length})</div>
        <table>
          <thead><tr><th>Timestamp</th><th>Backup Key</th><th>Actions</th></tr></thead>
          <tbody>
            ${entries.map(entry => html`<tr>
              <td>${entry.timestamp_str}</td>
              <td style="font-family:monospace;font-size:0.8rem;max-width:240px;overflow:hidden;text-overflow:ellipsis;">${entry.key}</td>
              <td class="actions-cell">
                <button @click=${() => this.handleView(entry.key)}>View</button>
                <button @click=${() => this.handleRestore(entry.key)}>Restore</button>
                <button class="danger" @click=${() => this.handleDelete(entry.key)}>Delete</button>
              </td>
            </tr>`)}
          </tbody>
        </table>
      `)}

      ${this._viewing !== null ? html`<div class="modal-overlay" @click=${(e) => { if (e.target === e.currentTarget) this._viewing = null; }}>
        <div class="modal">
          <div class="modal-header">
            <span>Snapshot Content</span>
            <button class="modal-close" @click=${() => this._viewing = null}>&times;</button>
          </div>
          <div class="modal-body"><pre>${this._viewing}</pre></div>
        </div>
      </div>` : ''}
    </div>`;
  }
}

customElements.define('admin-backup-snapshots', AdminBackupSnapshots);
