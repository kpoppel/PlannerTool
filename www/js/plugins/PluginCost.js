/**
 * PluginCost
 * Single-responsibility: lifecycle wrapper that mounts/unmounts the
 * `plugin-cost` component providing three-view cost analysis.
 *
 * Views: Project, Task, Team - each with monthly cost/hours breakdowns.
 */
import { isEnabled } from '../config.js';
import { bus } from '../core/EventBus.js';
import { PluginEvents } from '../core/EventRegistry.js';
import { state } from '../services/State.js';

class PluginCost {
  constructor(id = 'plugin-cost', config = {}) {
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
      name: this.config.name || 'Cost Analysis',
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
      await import('./PluginCostComponent.js');
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
      this._el = document.createElement('plugin-cost');
      this._el.pluginId = this.id;
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

    // Restore persisted plugin state (if any) before opening so the component
    // loads data for the same window the user selected previously.
    const ps = state.pluginStateService.get(this.id) || {};
    if (ps.startDate) this._el.startDate = ps.startDate;
    if (ps.endDate) this._el.endDate = ps.endDate;

    // Open the plugin UI; component handles its own data loading
    if (this._el && typeof this._el.open === 'function') this._el.open();
    this.active = true;
    bus.emit(PluginEvents.ACTIVATED, { id: this.id });
  }

  async deactivate() {
    // Persist the currently-selected date range into the PluginStateService
    const s = {
      startDate: this._el.startDate,
      endDate: this._el.endDate,
    };
    state.pluginStateService.set(this.id, s, { saveToView: true });


    this._el.close();
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

export default PluginCost;
