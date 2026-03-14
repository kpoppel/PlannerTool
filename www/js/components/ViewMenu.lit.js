import { LitElement, html, css } from '../vendor/lit.js';
import { state } from '../services/State.js';
import { bus } from '../core/EventBus.js';
import { ViewManagementEvents } from '../core/EventRegistry.js';

/**
 * ViewMenu - Dropdown menu for Views
 * Shows saved views with action buttons
 */
export class ViewMenuLit extends LitElement {
  static properties = {
    views: { type: Array },
    activeViewId: { type: String },
  };

  static styles = css`
    :host {
      display: block;
    }

    .menu-popover {
      background: var(--color-sidebar-bg);
      color: var(--color-sidebar-text);
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 6px;
      box-shadow: 0 6px 18px rgba(0,0,0,0.25);
      min-width: 280px;
      max-width: 400px;
      max-height: 500px;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .sidebar-list { 
      list-style:none; 
      padding:0; 
      display:flex; 
      flex-direction:column; 
      gap:4px; 
      margin:0 0 8px 0; 
    }
    
    .sidebar-list-item { display:block; }
    
    .view-item { 
      padding:8px 10px; 
      border-radius:6px; 
      width:100%; 
      display:flex; 
      align-items:center; 
      gap:8px; 
      box-sizing:border-box; 
      position:relative;
      cursor:pointer;
      transition: background 120ms ease;
    }
    
    .view-item:hover {
      background:rgba(255,255,255,0.10);
    }
    
    .view-item.active { 
      background:rgba(255,255,255,0.18); 
    }
    
    .view-item.active:hover {
      background:rgba(255,255,255,0.22);
    }
    
    .view-name { 
      flex:1 1 auto; 
      font-weight:600; 
      font-size:0.85rem; 
      overflow:hidden; 
      text-overflow:ellipsis; 
      white-space:nowrap; 
      padding-right:4px;
    }
    
    .view-actions { 
      display:inline-flex; 
      gap:2px; 
      align-items:center; 
      opacity:1;
      transition: opacity 120ms ease;
    }
    
    .action-btn { 
      background:transparent;
      border:none;
      border-radius:3px; 
      padding:4px 6px; 
      cursor:pointer; 
      font-size:0.8rem; 
      line-height:1; 
      color: var(--color-sidebar-text);
      transition: background 100ms ease;
      opacity:0.7;
    }
    
    .action-btn:hover { 
      background:rgba(255,255,255,0.15);
      opacity:1;
    }

    .action-btn:active {
      background:rgba(255,255,255,0.25);
    }

    .save-view-btn {
      width: 100%;
      padding: 8px 12px;
      background: rgba(102, 126, 234, 0.2);
      border: 1px solid rgba(102, 126, 234, 0.4);
      border-radius: 6px;
      color: var(--color-sidebar-text);
      cursor: pointer;
      font-weight: 600;
      font-size: 0.85rem;
      text-align: center;
      transition: all 0.15s;
      margin-top: 4px;
    }

    .save-view-btn:hover {
      background: rgba(102, 126, 234, 0.35);
      border-color: rgba(102, 126, 234, 0.6);
    }
  `;

  constructor() {
    super();
    this.views = [];
    this.activeViewId = null;
  }

  connectedCallback() {
    super.connectedCallback();
    
    // Listen to view changes for real-time updates
    this._onViewsList = (payload) => {
      this.views = payload?.views ? [...payload.views] : [];
      this.activeViewId = payload?.activeId || null;
      this.requestUpdate();
    };
    
    this._onViewActivated = (payload) => {
      this.activeViewId = payload?.id || null;
      this.requestUpdate();
    };

    bus.on(ViewManagementEvents.LIST, this._onViewsList);
    bus.on(ViewManagementEvents.ACTIVATED, this._onViewActivated);

    // Don't initialize from state - views are passed as properties from TopMenu
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._onViewsList) bus.off(ViewManagementEvents.LIST, this._onViewsList);
    if (this._onViewActivated) bus.off(ViewManagementEvents.ACTIVATED, this._onViewActivated);
  }

  async _onViewClick(e, view) {
    e.stopPropagation();
    // Load and apply the view
    try {
      await state.viewManagementService.loadAndApplyView(view.id);
    } catch (err) {
      console.error('[ViewMenu] Failed to load view:', err);
      // Dispatch error event for parent to handle
      this.dispatchEvent(new CustomEvent('view-error', {
        detail: { view, error: err },
        bubbles: true,
        composed: true
      }));
    }
  }

  async _onUpdateView(e, view) {
    e.stopPropagation();
    try {
      await state.viewManagementService.saveCurrentView(view.name, view.id);
      console.log('[ViewMenu] Updated view:', view.name);
    } catch (err) {
      console.error('[ViewMenu] Failed to update view:', err);
    }
  }

  async _onRenameView(e, view) {
    e.stopPropagation();
    try {
      const { openViewRenameModal } = await import('./modalHelpers.js');
      await openViewRenameModal({ id: view.id, name: view.name });
    } catch (err) {
      console.error('[ViewMenu] Failed to open rename modal:', err);
    }
  }

  async _onDeleteView(e, view) {
    e.stopPropagation();
    try {
      const { openViewDeleteModal } = await import('./modalHelpers.js');
      await openViewDeleteModal({ id: view.id, name: view.name });
    } catch (err) {
      console.error('[ViewMenu] Failed to open delete modal:', err);
    }
  }

  async _onSaveCurrentView(e) {
    e.stopPropagation();
    // Show save view modal
    try {
      const ViewSaveModal = (await import('./ViewSaveModal.lit.js')).ViewSaveModal;
      const modal = document.createElement('view-save-modal');
      document.body.appendChild(modal);
    } catch (err) {
      console.error('[ViewMenu] Failed to open save modal:', err);
    }
  }

  render() {
    const sorted = [...(this.views || [])].sort((a, b) => {
      if (a.readonly && !b.readonly) return -1;
      if (!a.readonly && b.readonly) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });

    return html`
      <div class="menu-popover">
        <ul class="sidebar-list">
          ${sorted.map(v => html`
            <li class="sidebar-list-item view-item ${v.id === this.activeViewId ? 'active' : ''}" 
                @click=${(e) => this._onViewClick(e, v)}>
              <span class="view-name" title="${v.name}">${v.name}</span>
              ${!v.readonly ? html`
                <span class="view-actions">
                  <button type="button" 
                          class="action-btn" 
                          title="Update this view with current settings" 
                          @click=${(e) => this._onUpdateView(e, v)}>💾</button>
                  <button type="button" 
                          class="action-btn" 
                          title="Rename view" 
                          @click=${(e) => this._onRenameView(e, v)}>✏️</button>
                  <button type="button" 
                          class="action-btn" 
                          title="Delete view" 
                          @click=${(e) => this._onDeleteView(e, v)}>🗑️</button>
                </span>
              ` : ''}
            </li>
          `)}
        </ul>
        <button type="button" class="save-view-btn" @click=${this._onSaveCurrentView}>
          💾 Save Settings as View
        </button>
      </div>
    `;
  }
}

customElements.define('view-menu', ViewMenuLit);
