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
      margin:0; 
    }
    
    .sidebar-list-item { display:block; }
    
    .view-item { 
      padding:4px 6px; 
      border-radius:6px; 
      width:100%; 
      display:flex; 
      align-items:center; 
      gap:8px; 
      box-sizing:border-box; 
      position:relative; 
    }
    
    .view-item.active { 
      background:rgba(255,255,255,0.18); 
    }
    
    .view-name { 
      cursor:pointer; 
      flex:1 1 auto; 
      font-weight:600; 
      font-size:0.85rem; 
      overflow:hidden; 
      text-overflow:ellipsis; 
      white-space:nowrap; 
      padding-right:56px; 
    }
    
    .view-controls { 
      display:inline-flex; 
      gap:4px; 
      align-items:center; 
      position:absolute; 
      right:6px; 
      top:50%; 
      transform:translateY(-50%); 
    }
    
    .view-btn { 
      background:#f7f7f7; 
      border:1px solid var(--color-border, #ccc); 
      border-radius:4px; 
      padding:2px 6px; 
      cursor:pointer; 
      font-size:0.75rem; 
      line-height:1; 
      color: #333;
    }
    
    .view-btn:hover { 
      background:#ececec; 
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
      await state.loadAndApplyView(view.id);
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

  _onViewMenuClick(e, view) {
    e.stopPropagation();
    
    // Dispatch event to parent/app to show view menu
    this.dispatchEvent(new CustomEvent('view-menu', {
      detail: { view, sourceEvent: e },
      bubbles: true,
      composed: true
    }));
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
              <span class="view-controls">
                <button type="button" 
                        class="view-btn" 
                        title="View actions" 
                        @click=${(e) => this._onViewMenuClick(e, v)}>⋯</button>
              </span>
            </li>
          `)}
        </ul>
      </div>
    `;
  }
}

customElements.define('view-menu', ViewMenuLit);
