/**
 * PluginDependencies.js
 * Lifecycle wrapper for the Dependencies SVG overlay plugin.
 *
 * This plugin auto-activates at startup (activated: true in modules.config.json)
 * to replace the former initDependencyRenderer() call in app.js.
 * The overlay content is toggled by ViewEvents.DEPENDENCIES from the sidebar.
 */
import { bus } from '../core/EventBus.js';
import { PluginEvents } from '../core/EventRegistry.js';
import { state } from '../services/State.js';

class PluginDependencies {
  constructor(id = 'plugin-dependencies', config = {}) {
    this.id = id;
    this.config = config;
    this._el = null;
    this._componentLoaded = false;
    this.active = false;
  }

  getMetadata() {
    return {
      id: this.id,
      name: 'Dependencies',
      description: 'Render dependency arrows between feature cards',
      icon: 'account_tree',
      section: 'overlay',
      autoActivate: true,
    };
  }

  async init() {
    if (!this._componentLoaded) {
      await import('./PluginDependenciesComponent.js');
      this._componentLoaded = true;
    }
  }

  async activate() {
    if (!this._componentLoaded) await this.init();

    if (!this._el) {
      this._el = document.createElement('plugin-dependencies');
      document.body.appendChild(this._el);
    }

    // Sync state flag silently to avoid circular event before overlay is ready
    state.setShowDependencies(true, true);
    if (this._el?.open) this._el.open();
    this.active = true;
    bus.emit(PluginEvents.ACTIVATED, { id: this.id });
  }

  async deactivate() {
    state.setShowDependencies(false, true);
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
}

export default PluginDependencies;
