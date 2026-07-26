/**
 * PluginExportTimeline
 * Lifecycle wrapper that mounts a small component providing timeline export
 * functionality. Uses MountedPlugin base for standard lifecycle; overrides
 * _ensureElement() to handle shadow-DOM forceMount behavior.
 */
import { MountedPlugin } from './MountedPlugin.js';

export class PluginExportTimeline extends MountedPlugin {
  static get defaultId() { return 'plugin-export-timeline'; }

  constructor(id = PluginExportTimeline.defaultId, config = {}) {
    super(id, config);
  }

  get componentTag() { return 'plugin-export-timeline'; }
  get componentPath() { return './PluginExportTimelineComponent.js'; }

  /* ── custom element creation (shadow-DOM mount support) ─────────────── */

  async _ensureElement() {
    if (this._el) return;
    this._resolveHost();
    this._el = document.createElement(this.componentTag);
    this._el.classList.add('main');
    this._el.style.display = 'none';
    // Handle shadow-DOM mount when forceMountInBoard is set
    const mountToBoard = !!this.config.forceMountInBoard;
    if (mountToBoard) {
      const hostRoot =
        this._host && (this._host.shadowRoot || this._host.renderRoot) ?
          this._host.shadowRoot || this._host.renderRoot
        : this._host;
      try {
        hostRoot.appendChild(this._el);
      } catch (e) {
        document.body.appendChild(this._el);
      }
    } else {
      this._host.appendChild(this._el);
    }
  }

  async activate() {
    await super.activate();
    if (this._el?.open) this._el.open(this.config.mode);
  }

  getMetadata() {
    return {
      id: this.id,
      name: this.config.name || 'Export Timeline',
      description: this.config.description || 'Export timeline data to JSON or CSV',
      icon: this.config.icon || 'file_download',
      section: 'tools',
      autoActivate: false,
    };
  }
}

export default PluginExportTimeline;
