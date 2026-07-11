/**
 * PluginEvents - Lifecycle wrapper for plan events SVG overlay
 */
import { isEnabled } from '../config.js';
import { bus } from '../core/EventBus.js';
import { Plugin } from '../core/Plugin.js';
import { PluginEvents } from '../core/EventRegistry.js';

class PluginEventsPlugin extends Plugin {
  constructor(id = 'plugin-events', config = {}) {
    super(id, config);
    this._el = null;
    this._componentLoaded = false;
  }

  getMetadata() {
    return {
      id: this.id,
      name: 'Plan Events',
      description: 'Display locally-stored plan events on the timeline',
      icon: 'event',
      section: 'tools',
      autoActivate: false,
    };
  }

  async init() {
    if (!isEnabled('USE_PLUGIN_SYSTEM')) return;
    if (!this._componentLoaded) {
      await import('./PluginEventsComponent.js');
      this._componentLoaded = true;
    }
    this.initialized = true;
  }

  async activate() {
    if (!this._componentLoaded) await this.init();

    if (!this._el) {
      this._el = document.createElement('plugin-events');
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
    this.initialized = false;
  }

  toggle() {
    return this.active ? this.deactivate() : this.activate();
  }

  async refresh() {
    if (this._el?.refresh) await this._el.refresh();
  }
}

export default PluginEventsPlugin;
