/**
 * PluginLinkEditorComponent.js
 * UI component for the Link Editor plugin
 * Provides a toolbar for managing link editing mode
 */

import { LitElement, html, css } from '../vendor/lit.js';
import { ACTIONS, getLinkEditorState } from './linkeditor/LinkEditorState.js';
import './linkeditor/LinkEditorOverlay.js';
import { setTimelinePanningAllowed } from '../components/Timeline.lit.js';
import { findInBoard } from '../components/board-utils.js';
import { pluginManager } from '../core/PluginManager.js';

export class PluginLinkEditorComponent extends LitElement {
  static properties = {
    visible: { type: Boolean },
    enabled: { type: Boolean },
    pendingAction: { type: Object },
  };

  constructor() {
    super();
    this.visible = false;
    this.enabled = false;
    this.pendingAction = null;
    this._linkEditorState = getLinkEditorState();
    this._overlay = null;
    this._unsubscribe = null;
  }

  static styles = css`
    :host {
      display: block;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 100;
      pointer-events: none;
    }

    :host(:not([visible])) {
      display: none;
    }

    /* Floating toolbar */
    .floating-toolbar {
      position: fixed;
      top: 80px;
      right: 20px;
      background: white;
      padding: 16px;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      pointer-events: auto;
      z-index: 200;
      min-width: 260px;
    }

    .toolbar-title {
      font-size: 12px;
      font-weight: 600;
      color: #666;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .instructions {
      font-size: 13px;
      color: #555;
      line-height: 1.5;
      margin-bottom: 16px;
      padding: 10px;
      background: #f8f9fa;
      border-radius: 4px;
      border-left: 3px solid #2196f3;
    }

    .instructions ul {
      margin: 8px 0 0 0;
      padding-left: 20px;
    }

    .instructions li {
      margin: 4px 0;
    }

    .legend {
      display: grid;
      grid-template-columns: 24px 1fr;
      gap: 8px;
      margin-bottom: 16px;
      font-size: 13px;
    }

    .legend-item {
      display: contents;
    }

    .legend-color {
      width: 24px;
      height: 24px;
      border-radius: 4px;
      border: 1px solid rgba(0, 0, 0, 0.1);
    }

    .legend-label {
      display: flex;
      align-items: center;
      color: #333;
    }

    .status-message {
      padding: 10px;
      background: #e3f2fd;
      color: #1976d2;
      border-radius: 4px;
      font-size: 13px;
      margin-bottom: 12px;
      font-weight: 500;
      border: 1px solid #2196f3;
    }

    .status-message.pending {
      background: #fff3e0;
      color: #e65100;
      border-color: #ff9800;
    }

    .button-row {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }

    button {
      padding: 8px 16px;
      border: 1px solid #ddd;
      border-radius: 4px;
      background: #fff;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.15s ease;
      flex: 1;
    }

    button:hover {
      background: #f5f5f5;
      border-color: #ccc;
    }

    button.primary {
      background: #2196f3;
      color: white;
      border-color: #2196f3;
    }

    button.primary:hover {
      background: #1976d2;
      border-color: #1976d2;
    }

    button.secondary {
      background: #f5f5f5;
    }

    button.secondary:hover {
      background: #e0e0e0;
    }

    .hint {
      font-size: 11px;
      color: #888;
      margin-top: 8px;
      font-style: italic;
    }

    .close-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 24px;
      height: 24px;
      padding: 0;
      background: transparent;
      border: none;
      color: #999;
      font-size: 16px;
      cursor: pointer;
      border-radius: 4px;
      margin: 0;
    }

    .close-btn:hover {
      color: #333;
      background: #f0f0f0;
    }
  `;

  connectedCallback() {
    super.connectedCallback();

    // Subscribe to link editor state changes
    this._unsubscribe = this._linkEditorState.subscribe(() => {
      this.enabled = this._linkEditorState.enabled;
      this.pendingAction = this._linkEditorState.pendingAction;
      this.requestUpdate();
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  }

  render() {
    return html`
      <div class="floating-toolbar">
        <button class="close-btn" @click="${this._handleClose}" title="Close">×</button>
        <div class="toolbar-title">Link Editor</div>

        ${this.pendingAction ?
          html`
            <div class="status-message pending">
              Action: ${this.pendingAction.action}<br />
              Click a target card or press ESC to cancel
            </div>
          `
        : html`
            <div class="status-message">
              Link editing active<br />
              Hover over cards to see link areas
            </div>
          `}
        ${!this.pendingAction ?
          html`
            <div class="instructions">
              <strong>How to use:</strong>
              <ul>
                <li>Hover a card to see colored link areas</li>
                <li>Click an area, then click target card</li>
                <li>Scroll normally to find cards</li>
                <li>Changes save to active scenario</li>
              </ul>
            </div>

            <div class="legend">
              <div class="legend-item">
                <div
                  class="legend-color"
                  style="background: linear-gradient(135deg, #2ad0d6, #1fb8be);"
                ></div>
                <div class="legend-label">Predecessor (left)</div>
              </div>
              <div class="legend-item">
                <div
                  class="legend-color"
                  style="background: linear-gradient(135deg, #0ca58a, #0a8972);"
                ></div>
                <div class="legend-label">Successor (right)</div>
              </div>
              <div class="legend-item">
                <div
                  class="legend-color"
                  style="background: linear-gradient(180deg, #ffd34f, #f5c43a);"
                ></div>
                <div class="legend-label">Parent (top)</div>
              </div>
              <div class="legend-item">
                <div
                  class="legend-color"
                  style="background: linear-gradient(180deg, #2fbf4f, #26a041);"
                ></div>
                <div class="legend-label">Related (bottom)</div>
              </div>
            </div>
          `
        : ''}

        <div class="hint">💡 Use the Details Panel to view and delete existing links</div>
      </div>
    `;
  }

  firstUpdated() {
    // Ensure a single `link-editor-overlay` exists inside the feature board
    try {
      const board = findInBoard('feature-board');
      if (!board) return;
      const hostRoot = board.shadowRoot || board;

      // Reuse existing overlay if present
      let overlay =
        (hostRoot.querySelector && hostRoot.querySelector('link-editor-overlay')) ||
        document.querySelector('link-editor-overlay');

      if (!overlay) {
        overlay = document.createElement('link-editor-overlay');
        try {
          hostRoot.appendChild(overlay);
        } catch (e) {
          // Fallback to document body
          try {
            document.body.appendChild(overlay);
          } catch (err) {
            console.error('[PluginLinkEditor] Failed to append overlay:', err);
          }
        }
      }

      // Style the overlay to cover the board
      try {
        overlay.style.position = 'absolute';
        overlay.style.top = '0px';
        overlay.style.left = '0px';
        overlay.style.width = `${board.scrollWidth || board.clientWidth}px`;
        overlay.style.height = `${board.scrollHeight || board.clientHeight}px`;
        overlay.style.pointerEvents = 'auto';
        overlay.style.zIndex = '15';
      } catch (e) {
        console.error('[PluginLinkEditor] Failed to style overlay:', e);
      }

      this._overlay = overlay;
    } catch (e) {
      console.error('[PluginLinkEditor] Error setting up overlay:', e);
    }
  }

  updated(changedProps) {
    if (changedProps.has('visible')) {
      if (this.visible && this._overlay) {
        this._overlay.enable();
      } else if (this._overlay) {
        this._overlay.disable();
      }
    }
  }

  // --- Public API ---

  _handleClose() {
    // Call plugin.deactivate() which will call this.close()
    const plugin = pluginManager.get('plugin-link-editor');
    if (plugin) plugin.deactivate();
  }

  open() {
    console.log('[PluginLinkEditor] Opening plugin');
    this.visible = true;
    this.setAttribute('visible', '');
    this._linkEditorState.enable();

    // Only disable drag-panning, but allow viewport scrolling
    // The overlay will handle this more elegantly
    try {
      setTimelinePanningAllowed(false);
    } catch (e) {
      console.warn('[PluginLinkEditor] Failed to disable panning:', e);
    }

    // Ensure overlay is shown
    this.updateComplete.then(() => {
      console.log('[PluginLinkEditor] Update complete, enabling overlay');
      if (this._overlay) {
        this._overlay.enable();
      }
    });
  }

  close() {
    this.visible = false;
    this.removeAttribute('visible');
    this._linkEditorState.disable();

    if (this._overlay) {
      this._overlay.disable();
    }

    // Re-enable timeline panning
    try {
      setTimelinePanningAllowed(true);
    } catch (e) {
      console.warn('[PluginLinkEditor] Failed to re-enable panning:', e);
    }
  }

  toggle() {
    if (this.visible) {
      this.close();
    } else {
      this.open();
    }
  }
}

customElements.define('plugin-link-editor', PluginLinkEditorComponent);

export default PluginLinkEditorComponent;
