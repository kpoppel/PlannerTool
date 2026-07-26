/**
 * PluginLinkEditor - Lifecycle wrapper for feature dependency link editor.
 * Migrated to MountedPlugin pattern — replaces manual element creation/mounting.
 * Uses custom _ensureElement() for shadow-DOM board mounting.
 */
import { MountedPlugin } from './MountedPlugin.js';
import { bus } from '../core/EventBus.js';
import { FeatureEvents } from '../core/EventRegistry.js';
import { getLinkEditorState } from './linkeditor/LinkEditorState.js';
import { findInBoard } from '../components/board-utils.js';

export class PluginLinkEditor extends MountedPlugin {
  static get defaultId() { return 'plugin-link-editor'; }

  constructor(id = PluginLinkEditor.defaultId, config = {}) {
    super(id, config);
    this._linkEditorState = getLinkEditorState();
    this._boundOnFeatureUpdate = this._onFeatureUpdate.bind(this);
  }

  get componentTag() { return 'plugin-link-editor'; }
  get componentPath() { return './PluginLinkEditorComponent.js'; }
  get mountSelector() { return 'app'; }

  /* ── custom element creation (shadow-DOM board mount) ─────────────── */

  async _ensureElement() {
    if (this._el) return;
    this._resolveHost();
    this._el = document.createElement(this.componentTag);
    this._el.classList.add('main');
    this._el.style.display = 'none';
    
    // Try shadow-DOM board mount first, fallback to document.body
    try {
      const board = findInBoard('feature-board');
      if (board) {
        const hostRoot = board.shadowRoot || board;
        const existing = hostRoot.querySelector(this.componentTag);
        if (existing) {
          this._el = existing;
          return;
        }
        try {
          hostRoot.appendChild(this._el);
          return;
        } catch { /* fall through to body */ }
      }
    } catch { /* fall through to body */ }
    
    this._host.appendChild(this._el);
  }

  async activate() {
    await super.activate();
    bus.on(FeatureEvents.UPDATED, this._boundOnFeatureUpdate);
    if (this._el?.open) this._el.open();
  }

  async deactivate() {
    bus.off(FeatureEvents.UPDATED, this._boundOnFeatureUpdate);
    if (this._el?.close) this._el.close();
    this._linkEditorState.disable();
    this._linkEditorState.clear();
    await super.deactivate();
  }

  getMetadata() {
    return {
      id: this.id,
      name: 'Link Editor',
      description: 'Edit dependency links between features',
      icon: 'link',
      section: 'tools',
      autoActivate: false,
    };
  }

  /* ── event handler ────────────────────────────────────────────────── */

  _onFeatureUpdate(payload) {
    if (this._el?.requestUpdate) this._el.requestUpdate();
  }

  getComponent() { return this._el; }
}

export default PluginLinkEditor;
