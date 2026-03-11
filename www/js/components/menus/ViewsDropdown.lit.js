import { PopoverBase } from './PopoverBase.lit.js';
import { html, css } from '../../vendor/lit.js';
import { state } from '../../services/State.js';
import { bus } from '../../core/EventBus.js';
import { ViewManagementEvents } from '../../core/EventRegistry.js';
import { saveIconTemplate, cloneIconTemplate, editIconTemplate, deleteIconTemplate } from '../../services/IconService.js';

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
        padding: 4px 8px;
        cursor: pointer;
        border-radius: 4px;
        transition: all 0.15s ease;
        gap: 8px;
        margin: 0 4px;
        color: #222 !important;
        min-height: 32px;
        border: 1px solid transparent;
      }

      .view-item:hover {
        background: #dfe4ea;
        border-color: rgba(0, 0, 0, 0.1);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      }

      .view-item.active {
        background: #e8f0fe;
        font-weight: 600;
        border-color: rgba(66, 133, 244, 0.3);
      }

      .view-item.active:hover {
        background: #d2e3fc;
        border-color: rgba(66, 133, 244, 0.5);
        box-shadow: 0 1px 3px rgba(66, 133, 244, 0.2);
      }

      .view-name {
        flex: 1;
        color: #222 !important;
        padding: 4px 0;
      }

      .view-actions {
        display: flex;
        gap: 2px;
        opacity: 0;
        transition: opacity 0.2s;
      }

      .view-item:hover .view-actions {
        opacity: 1;
      }

      .action-icon-btn {
        background: rgba(0, 0, 0, 0.05);
        border: 1px solid rgba(0, 0, 0, 0.1);
        border-radius: 4px;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 14px;
        transition: all 0.2s;
        padding: 0;
      }

      .action-icon-btn svg {
        width: 16px;
        height: 16px;
        display: block;
      }

      .action-icon-btn:hover {
        background: rgba(0, 0, 0, 0.15);
        border-color: rgba(0, 0, 0, 0.25);
        transform: scale(1.05);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
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
    // data contains { viewId, activeViewData }
    this.activeViewId = data.viewId || data.view?.id || data.activeViewData?.id || null;
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

  async _onUpdateView(e, view) {
    e.stopPropagation();
    try {
      await state.viewManagementService.saveCurrentView(view.name, view.id);
    } catch (err) {
      console.error('Failed to update view:', err);
    }
  }

  async _onSaveAsNewView(e) {
    e.stopPropagation();
    await this._onSaveNewView();
  }

  async _onRenameView(e, view) {
    e.stopPropagation();
    const { openViewRenameModal } = await import('../modalHelpers.js');
    await openViewRenameModal({ id: view.id, name: view.name });
  }

  async _onDeleteView(e, view) {
    e.stopPropagation();
    const { openViewDeleteModal } = await import('../modalHelpers.js');
    await openViewDeleteModal({ id: view.id, name: view.name });
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
              <div class="view-actions">
                ${view.readonly && view.id === 'default'
                  ? html`
                      <button
                        class="action-icon-btn"
                        @click=${e => this._onSaveAsNewView(e)}
                        title="Save as New View">
                        ${cloneIconTemplate}
                      </button>
                    `
                  : html`
                      <button
                        class="action-icon-btn"
                        @click=${e => this._onUpdateView(e, view)}
                        title="Update View">
                        ${saveIconTemplate}
                      </button>
                      <button
                        class="action-icon-btn"
                        @click=${e => this._onSaveAsNewView(e)}
                        title="Save as New View">
                        ${cloneIconTemplate}
                      </button>
                      <button
                        class="action-icon-btn"
                        @click=${e => this._onRenameView(e, view)}
                        title="Rename View">
                        ${editIconTemplate}
                      </button>
                      <button
                        class="action-icon-btn"
                        @click=${e => this._onDeleteView(e, view)}
                        title="Delete View">
                        ${deleteIconTemplate}
                      </button>
                    `}
              </div>
            </div>
          `
        )}
      </div>
    `;
  }
}

customElements.define('views-dropdown', ViewsDropdown);
