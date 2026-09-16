import { LitElement, html, css } from '../vendor/lit.js';
import { cmd, sel } from '../application/imports.js';
import { bus } from '../core/EventBus.js';
import { TimelineEvents, ViewEvents, ViewManagementEvents } from '../core/EventRegistry.js';

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
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 6px;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
      min-width: 320px;
      max-width: 400px;
      max-height: 500px;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      font-size: 13px;
      gap: 8px;
    }

    .sidebar-list {
      list-style: none;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 0 0 8px 0;
    }

    .sidebar-list-item {
      display: block;
    }

    .view-item {
      min-height: 32px;
      padding: 6px 8px;
      border-radius: 6px;
      width: 100%;
      display: flex;
      align-items: center;
      gap: 8px;
      box-sizing: border-box;
      position: relative;
      cursor: pointer;
      transition: background 120ms ease;
    }

    .view-item:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    .view-item.active {
      background: rgba(255, 255, 255, 0.18);
    }

    .view-item.active:hover {
      background: rgba(255, 255, 255, 0.22);
    }

    .view-name {
      flex: 1 1 auto;
      font-weight: 600;
      font-size: 13px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding-right: 4px;
    }

    .view-actions {
      display: inline-flex;
      gap: 2px;
      align-items: center;
      opacity: 1;
      transition: opacity 120ms ease;
    }

    .action-btn {
      background: transparent;
      border: none;
      border-radius: 3px;
      padding: 4px 6px;
      cursor: pointer;
      font-size: 0.8rem;
      line-height: 1;
      color: var(--color-sidebar-text);
      transition: background 100ms ease;
      opacity: 0.7;
    }

    .action-btn:hover {
      background: rgba(255, 255, 255, 0.15);
      opacity: 1;
    }

    .action-btn:active {
      background: rgba(255, 255, 255, 0.25);
    }

    .save-view-btn {
      width: 100%;
      min-height: 32px;
      padding: 6px 8px;
      background: rgba(102, 126, 234, 0.2);
      border: 1px solid rgba(102, 126, 234, 0.4);
      border-radius: 6px;
      color: var(--color-sidebar-text);
      cursor: pointer;
      font-weight: 600;
      font-size: 13px;
      text-align: center;
      transition: all 0.15s;
      margin-top: 4px;
    }

    .save-view-btn:hover {
      background: rgba(102, 126, 234, 0.35);
      border-color: rgba(102, 126, 234, 0.6);
    }
    .display-section {
      border-top: 1px solid rgba(255, 255, 255, 0.18);
      margin-top: 4px;
      padding-top: 8px;
    }

    .display-title {
      background: rgba(255, 255, 255, 0.08);
      border-radius: 4px;
      color: rgba(255, 255, 255, 0.78);
      font-size: 11px;
      font-weight: 600;
      line-height: 20px;
      margin: 0 0 4px;
      padding: 0 8px;
      text-transform: uppercase;
    }

    .segment-group {
      display: flex;
      gap: 4px;
    }

    .segment-btn {
      background: transparent;
      border: 1px solid transparent;
      border-radius: 6px;
      color: inherit;
      cursor: pointer;
      flex: 1 1 0;
      font: inherit;
      min-height: 32px;
      padding: 6px 8px;
      transition: background 120ms ease;
      white-space: nowrap;
    }

    .segment-btn:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    .segment-btn.active {
      background: rgba(255, 255, 255, 0.18);
    }

    .segment-btn.active:hover {
      background: rgba(255, 255, 255, 0.22);
    }
    .segment-btn:disabled { cursor: default; opacity: 0.45; }
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
    this._onDisplayChanged = () => this.requestUpdate();

    bus.on(ViewManagementEvents.LIST, this._onViewsList);
    bus.on(ViewManagementEvents.ACTIVATED, this._onViewActivated);
    bus.on(TimelineEvents.SCALE_CHANGED, this._onDisplayChanged);
    bus.on(ViewEvents.DISPLAY_MODE, this._onDisplayChanged);
    bus.on(ViewEvents.SORT_MODE, this._onDisplayChanged);
    bus.on(ViewEvents.CAPACITY_MODE, this._onDisplayChanged);

    // Don't initialize from state - views are passed as properties from TopMenu
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._onViewsList) bus.off(ViewManagementEvents.LIST, this._onViewsList);
    if (this._onViewActivated)
      bus.off(ViewManagementEvents.ACTIVATED, this._onViewActivated);
    if (this._onDisplayChanged) {
      bus.off(TimelineEvents.SCALE_CHANGED, this._onDisplayChanged);
      bus.off(ViewEvents.DISPLAY_MODE, this._onDisplayChanged);
      bus.off(ViewEvents.SORT_MODE, this._onDisplayChanged);
      bus.off(ViewEvents.CAPACITY_MODE, this._onDisplayChanged);
    }
  }

  async _onViewClick(e, view) {
    e.stopPropagation();
    // Load and apply the view
    try {
      await cmd.viewRestore.loadAndApplyView(view.id);
    } catch (err) {
      console.error('[ViewMenu] Failed to load view:', err);
      // Dispatch error event for parent to handle
      this.dispatchEvent(
        new CustomEvent('view-error', {
          detail: { view, error: err },
          bubbles: true,
          composed: true,
        })
      );
    }
  }

  async _onUpdateView(e, view) {
    e.stopPropagation();
    try {
      await cmd.viewRestore.saveCurrentView(view.name, view.id);
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
    try {
      const { openViewSaveModal } = await import('./modalHelpers.js');
      await openViewSaveModal();
    } catch (err) {
      console.error('[ViewMenu] Failed to open save modal:', err);
    }
  }

  _setTimelineScale(scale) { cmd.view.setTimelineScale(scale); }
  _setDisplayMode(mode) { cmd.view.setDisplayMode(mode); }
  _setFeatureSortMode(mode) { cmd.view.setFeatureSortMode(mode); }
  _setGraphType(type) { cmd.view.setCapacityViewMode(type); }

  render() {
    const sorted = [...(this.views || [])].sort((a, b) => {
      if (a.readonly && !b.readonly) return -1;
      if (!a.readonly && b.readonly) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });

    return html`
      <div class="menu-popover">
        <div class="display-section">
          <div class="display-title" role="heading" aria-level="2">Timeline Scale</div>
          <div class="segment-group">
            ${[['threeMonths', '3mo'], ['weeks', 'Weeks'], ['months', 'Months'], ['quarters', 'Quarters'], ['years', 'Years']].map(([value, label]) => html`<button class="segment-btn ${sel.view.getTimelineScale() === value ? 'active' : ''}" @click=${() => this._setTimelineScale(value)}>${label}</button>`)}
          </div>
        </div>
        <div class="display-section">
          <div class="display-title" role="heading" aria-level="2">Cards</div>
          <div class="segment-group">
            ${[['normal', 'Normal'], ['compact', 'Compact'], ['packed', 'Packed']].map(([value, label]) => html`<button class="segment-btn ${sel.view.getDisplayMode() === value ? 'active' : ''}" @click=${() => this._setDisplayMode(value)}>${label}</button>`)}
          </div>
        </div>
        <div class="display-section">
          <div class="display-title" role="heading" aria-level="2">Task Sort</div>
          <div class="segment-group">
            ${[['rank', 'Rank'], ['date', 'Date']].map(([value, label]) => html`<button class="segment-btn ${sel.view.getFeatureSortMode() === value && !sel.view.getPackedMode() ? 'active' : ''}" ?disabled=${sel.view.getPackedMode()} @click=${() => this._setFeatureSortMode(value)}>${label}</button>`)}
          </div>
        </div>
        <div class="display-section">
          <div class="display-title" role="heading" aria-level="2">Graph Type</div>
          <div class="segment-group">
            ${[['team', 'Team'], ['project', 'Project']].map(([value, label]) => html`<button class="segment-btn ${sel.view.getCapacityViewMode() === value ? 'active' : ''}" @click=${() => this._setGraphType(value)}>${label}</button>`)}
          </div>
        </div>
        <div class="display-section">
          <div class="display-title" role="heading" aria-level="2">Saved Views</div>
        <ul class="sidebar-list">
          ${sorted.map(
            (v) => html`
              <li
                class="sidebar-list-item view-item ${v.id === this.activeViewId ?
                  'active'
                : ''}"
                @click=${(e) => this._onViewClick(e, v)}
              >
                <span class="view-name" title="${v.name}">${v.name}</span>
                ${!v.readonly ?
                  html`
                    <span class="view-actions">
                      <button
                        type="button"
                        class="action-btn"
                        title="Update this view with current settings"
                        @click=${(e) => this._onUpdateView(e, v)}
                      >
                        💾
                      </button>
                      <button
                        type="button"
                        class="action-btn"
                        title="Rename view"
                        @click=${(e) => this._onRenameView(e, v)}
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        class="action-btn"
                        title="Delete view"
                        @click=${(e) => this._onDeleteView(e, v)}
                      >
                        🗑️
                      </button>
                    </span>
                  `
                : ''}
              </li>
            `
          )}
        </ul>
        <button type="button" class="save-view-btn" @click=${this._onSaveCurrentView}>
          💾 Save Settings as View
        </button>
        </div>
      </div>
    `;
  }
}

customElements.define('view-menu', ViewMenuLit);
