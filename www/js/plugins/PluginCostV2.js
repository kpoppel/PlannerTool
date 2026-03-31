/**
 * PluginCostV2
 * Single-responsibility: lifecycle wrapper that mounts/unmounts the
 * `plugin-cost-v2` component providing three-view cost analysis.
 *
 * This is a parallel implementation to PluginCost for A/B testing.
 * Views: Project, Task, Team - each with monthly cost/hours breakdowns.
 */
import { isEnabled } from '../config.js';
import { bus } from '../core/EventBus.js';
import { PluginEvents } from '../core/EventRegistry.js';

class PluginCostV2 {
  constructor(id = 'plugin-cost-v2', config = {}) {
    this.id = id;
    this.config = config;
    this._el = null;
    this._host = null;
    this._componentLoaded = false;
    this.initialized = false;
    this.active = false;
  }

  getMetadata() {
    return {
      id: this.id,
      name: this.config.name || 'Cost Analysis (v2)',
      description:
        this.config.description ||
        'Three-view cost analysis with project, task, and team breakdowns',
      icon: this.config.icon || 'assessment',
      section: 'tools',
      autoActivate: false,
      fullscreen: true,
    };
  }

  async init() {
    if (!isEnabled('USE_PLUGIN_SYSTEM')) return;
    if (!this._componentLoaded) {
      await import('./PluginCostV2Component.js');
      this._componentLoaded = true;
    }
    // Fullscreen plugins mount at app level
    const selector = this.config.mountPoint || 'app';
    this._host =
      document.querySelector(`#${selector}`) ||
      document.querySelector(`.${selector}`) ||
      document.body;
    this.initialized = true;
  }

  async activate() {
    if (!this._componentLoaded) await this.init();
    if (!this._host) {
      const selector = this.config.mountPoint || 'app';
      this._host =
        document.querySelector(`#${selector}`) ||
        document.querySelector(`.${selector}`) ||
        document.body;
    }
    if (!this._el) {
      this._el = document.createElement('plugin-cost-v2');
      // Mount as peer to timeline-board with same layout class
      this._el.classList.add('main');
      this._el.style.display = 'none'; // Start hidden
      this._host.appendChild(this._el);
    }
    // Hide timeline-board since this is a fullscreen plugin
    const timelineBoard = document.querySelector('timeline-board');
    if (timelineBoard) {
      this._savedTimelineBoardDisplay = timelineBoard.style.display || '';
      timelineBoard.style.display = 'none';
    }
    this._el.style.display = 'flex';

    // Open the plugin UI; component handles its own data loading
    if (this._el && typeof this._el.open === 'function') this._el.open();
    this.active = true;
    bus.emit(PluginEvents.ACTIVATED, { id: this.id });
  }

  async deactivate() {
    if (this._el && typeof this._el.close === 'function') this._el.close();
    // Restore timeline-board visibility
    const timelineBoard = document.querySelector('timeline-board');
    if (timelineBoard) {
      timelineBoard.style.display = this._savedTimelineBoardDisplay || '';
    }
    if (this._el) this._el.style.display = 'none';
    this.active = false;
    bus.emit(PluginEvents.DEACTIVATED, { id: this.id });
  }

  async destroy() {
    if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
    this._el = null;
    this.initialized = false;
    this.active = false;
  }

  toggle() {
    this.active ? this.deactivate() : this.activate();
  }
}

export default PluginCostV2;
