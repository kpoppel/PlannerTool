/**
 * PluginHistory - Lifecycle wrapper for task history overlay
 */
import { isEnabled } from '../config.js';
import { bus } from '../core/EventBus.js';
import { PluginEvents } from '../core/EventRegistry.js';

class PluginHistory {
  constructor(id = 'plugin-history', config = {}) {
    this.id = id;
    this.config = config;
    this._el = null;
    this._componentLoaded = false;
    this.active = false;
  }

  getMetadata() {
    return {
      id: this.id,
      name: 'Task History',
      description: 'Display task date change history on timeline',
      icon: 'history',
      section: 'tools',
      autoActivate: false
    };
  }

  async init() {
    if (!isEnabled('USE_PLUGIN_SYSTEM')) return;
    if (!this._componentLoaded) {
      await import('./PluginHistoryComponent.js');
      this._componentLoaded = true;
    }
  }

  async activate() {
    if (!this._componentLoaded) await this.init();
    
    if (!this._el) {
      this._el = document.createElement('plugin-history');
      document.body.appendChild(this._el);
    }
    
    if (this._el?.open) this._el.open();
    this.active = true;
    bus.emit(PluginEvents.ACTIVATED, { id: this.id });
  }

  async deactivate() {
    if (this._el?.close) this._el.close();
    this.active = false;
    bus.emit(PluginEvents.DEACTIVATED, { id: this.id });
  }

  async destroy() {
    this._el?.remove();
    this._el = null;
    this.active = false;
  }

  toggle() {
    return this.active ? this.deactivate() : this.activate();
  }

  async refresh() {
    if (this._el?.refresh) await this._el.refresh();
  }
}

export default PluginHistory;
