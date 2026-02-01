/**
 * PluginMarkers - Lifecycle wrapper for delivery plan markers overlay
 */
import { isEnabled } from '../config.js';
import { bus } from '../core/EventBus.js';
import { PluginEvents } from '../core/EventRegistry.js';

class PluginMarkers {
  constructor(id = 'plugin-markers', config = {}) {
    this.id = id;
    this.config = config;
    this._el = null;
    this._componentLoaded = false;
    this.active = false;
  }

  getMetadata() {
    return {
      id: this.id,
      name: 'Plan Markers',
      description: 'Display delivery plan markers on timeline',
      icon: 'flag',
      section: 'tools',
      autoActivate: false
    };
  }

  async init() {
    if (!isEnabled('USE_PLUGIN_SYSTEM')) return;
    if (!this._componentLoaded) {
      await import('./PluginMarkersComponent.js');
      this._componentLoaded = true;
    }
  }

  async activate() {
    if (!this._componentLoaded) await this.init();
    
    if (!this._el) {
      this._el = document.createElement('plugin-markers');
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

export default PluginMarkers;
