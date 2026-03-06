import { PopoverBase } from './PopoverBase.lit.js';
import { html, css } from '../../vendor/lit.js';
import { state } from '../../services/State.js';
import { bus } from '../../core/EventBus.js';
import { ViewManagementEvents } from '../../core/EventRegistry.js';

/**
 * ViewsDropdown - Dropdown component for view management
 */
export class ViewsDropdown extends PopoverBase {
  static properties = {
    ...PopoverBase.properties,
    views: { type: Array },
    activeViewId: { type: String }
  };

  static styles = [
    PopoverBase.styles,
    css`
      :host {
        color: #222;
      }

      .popover-container {
        background: #fff !important;
        color: #222 !important;
        border: 1px solid rgba(0,0,0,0.12);
        box-shadow: 0 6px 18px rgba(0,0,0,0.18);
      }

      .views-list {
        color: #222;
      }

      .view-item {
        display: flex;
        align-items: center;
        padding: 0px 4px;
        cursor: pointer;
        border-radius: 4px;
        transition: background 0.2s;
        gap: 8px;
        margin: 0 4px;
        color: #222 !important;
      }

      .view-item:hover {
        background: #f3f5f7;
      }

      .view-item.active {
        background: #e8f0fe;
        font-weight: 600;
      }

      .view-name {
        flex: 1;
        color: #222 !important;
      }

      .view-controls {
        opacity: 0;
        transition: opacity 0.2s;
      }

      .view-item:hover .view-controls {
        opacity: 1;
      }

      .context-menu-btn {
        background: none;
        border: none;
        color: #666;
        cursor: pointer;
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 16px;
      }

      .context-menu-btn:hover {
        background: rgba(0, 0, 0, 0.08);
        color: #222;
      }

      .actions-section {
        border-top: 1px solid rgba(0, 0, 0, 0.12);
        margin-top: 8px;
        padding-top: 8px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .action-button {
        background: #f7f7f7;
        border: 1px solid rgba(0, 0, 0, 0.12);
        border-radius: 4px;
        padding: 8px 12px;
        color: #222;
        cursor: pointer;
        text-align: left;
        transition: background 0.2s;
      }

      .action-button:hover {
        background: #ececec;
      }
    `
  ];

  constructor() {
    super();
    this.views = [];
    this.activeViewId = null;
    this._onViewsChanged = this._onViewsChanged.bind(this);
    this._onViewActivated = this._onViewActivated.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    bus.on(ViewManagementEvents.LIST, this._onViewsChanged);
    bus.on(ViewManagementEvents.ACTIVATED, this._onViewActivated);
    this._loadViews();
  }

  disconnectedCallback() {
    bus.off(ViewManagementEvents.LIST, this._onViewsChanged);
    bus.off(ViewManagementEvents.ACTIVATED, this._onViewActivated);
    super.disconnectedCallback();
  }

  _onViewsChanged(data) {
    // Accept either an array of views or a wrapper object { views: [...], activeViewId }
    if (Array.isArray(data)) {
      this.views = data;
    } else if (data && Array.isArray(data.views)) {
      this.views = data.views;
      // If the event payload includes an activeViewId, keep in sync
      if (data.activeViewId) this.activeViewId = data.activeViewId;
    } else {
      this.views = [];
    }
    this.requestUpdate();
  }

  _onViewActivated(data) {
    this.activeViewId = data.view?.id || null;
    this.requestUpdate();
  }

  async _loadViews() {
    // Delegate loading to ViewManagementService so the emitted LIST event
    // provides a single harmonized payload format (object with views + metadata)
    if (state.viewManagementService) {
      try {
        await state.viewManagementService.loadViews();
        // The ViewManagementService will emit ViewManagementEvents.LIST which
        // our _onViewsChanged handler will process and update `this.views`.
      } catch (err) {
        console.error('Failed to load views:', err);
      }
    }
  }

  async _onViewClick(view) {
    try {
      await state.viewManagementService.loadAndApplyView(view.id);
      this.close();
    } catch (err) {
      console.error('Failed to load view:', err);
    }
  }

  async _onSaveNewView() {
    try {
      const { openViewSaveModal } = await import('../modalHelpers.js');
      const defaultName = this._generateDefaultViewName();
      await openViewSaveModal({ name: defaultName });
      this.close();
    } catch (err) {
      console.error('Failed to open save view modal:', err);
    }
  }

  async _onCopyToNewView() {
    // Same as save new view
    await this._onSaveNewView();
  }

  _generateDefaultViewName() {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const maxN = Math.max(
      0,
      ...(this.views || [])
        .filter(v => !v.readonly)
        .map(v => /^\d{2}-\d{2} View (\d+)$/i.exec(v.name)?.[1])
        .filter(Boolean)
        .map(n => parseInt(n, 10))
    );
    return `${mm}-${dd} View ${maxN + 1}`;
  }

  async _onViewMenuClick(e, view) {
    e.stopPropagation();
    
    // Remove any existing context menus
    document.querySelectorAll('.view-menu-popover').forEach(p => p.remove());
    
    const menuBtn = e.currentTarget;
    const pop = document.createElement('div');
    pop.className = 'view-menu-popover scenario-menu-popover';
    
    const addItem = (label, emoji, onClick, disabled = false) => {
      const item = document.createElement('div');
      item.className = 'scenario-menu-item';
      if (disabled) item.classList.add('disabled');
      item.innerHTML = `<span>${emoji}</span><span>${label}</span>`;
      if (!disabled) {
        item.addEventListener('click', ev => {
          ev.stopPropagation();
          onClick();
          pop.remove();
        });
      }
      pop.appendChild(item);
    };
    
    if (view.readonly && view.id === 'default') {
      addItem('Clone & Save as New View', '⎘', async () => {
        await this._onSaveNewView();
      });
    } else {
      addItem('Update View', '💾', async () => {
        try {
          await state.viewManagementService.saveCurrentView(view.name, view.id);
        } catch (err) {
          console.error('Failed to update view:', err);
        }
      });
      
      addItem('Rename View', '✏️', async () => {
        const { openViewRenameModal } = await import('../modalHelpers.js');
        await openViewRenameModal({ id: view.id, name: view.name });
      });
      
      addItem('Delete View', '🗑️', async () => {
        const { openViewDeleteModal } = await import('../modalHelpers.js');
        await openViewDeleteModal({ id: view.id, name: view.name });
      });
    }
    
    const rect = menuBtn.getBoundingClientRect();
    Object.assign(pop.style, {
      position: 'absolute',
      top: `${rect.top + window.scrollY + rect.height + 4}px`,
      left: `${rect.left + window.scrollX - 20}px`,
      background: '#fff',
      color: '#222',
      border: '1px solid rgba(0,0,0,0.12)',
      borderRadius: '6px',
      boxShadow: '0 6px 18px rgba(0,0,0,0.18)',
      minWidth: '160px',
      zIndex: '2000'
    });
    document.body.appendChild(pop);
    setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }), 0);
  }

  renderContent() {
    const sorted = [...(this.views || [])].sort((a, b) => {
      if (a.readonly && !b.readonly) return -1;
      if (b.readonly && !a.readonly) return 1;
      return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
    });

    return html`
      <div class="views-list">
        ${sorted.map(
          view => html`
            <div
              class="view-item ${view.id === this.activeViewId ? 'active' : ''}"
              @click=${() => this._onViewClick(view)}>
              <span class="view-name">${view.name}</span>
              <span class="view-controls">
                <button
                  class="context-menu-btn"
                  @click=${e => this._onViewMenuClick(e, view)}
                  title="View actions">
                  ⋯
                </button>
              </span>
            </div>
          `
        )}
      </div>
      
      <div class="actions-section">
        <button class="action-button" @click=${() => this._onCopyToNewView()}>
          Copy selected to new view
        </button>
        <button class="action-button" @click=${() => this._onSaveNewView()}>
          Save view
        </button>
      </div>
    `;
  }
}

customElements.define('views-dropdown', ViewsDropdown);
